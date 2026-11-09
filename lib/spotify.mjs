import { normalizePlayback } from './model.mjs';
import { matchRequestedTrack, parseSongRequest, requestedTrack } from './song-input.mjs';

export const QUEUE_SCOPE = 'user-modify-playback-state';

export class SpotifyFailure extends Error {
  constructor(code, message, retryAt = 0) { super(message); this.code = code; this.retryAt = retryAt; }
}

export class SpotifyService {
  constructor({ store, fetchFn = fetch, now = Date.now, onAuthChange = () => {} }) {
    this.store = store; this.fetch = fetchFn; this.now = now;
    this.onAuthChange = onAuthChange;
    this.cache = new Map(); this.pending = new Map(); this.refreshing = new Map(); this.rateLimits = new Map();
  }
  clear(id) { this.cache.delete(id); }
  connected(p) { return !!p.refreshToken; }
  canQueue(p) { return this.connected(p) && Array.isArray(p.spotifyScopes) && p.spotifyScopes.includes(QUEUE_SCOPE); }
  active(p, version) { return this.store.state.profiles.includes(p) && p.authVersion === version; }
  invalidate(p) {
    delete p.accessToken; delete p.refreshToken; delete p.expiresAt; delete p.spotifyScopes;
    p.authVersion = `${this.now()}-invalid`; this.store.save(); this.clear(p.id);
    this.onAuthChange(p);
  }
  async request(url, options) {
    try { return await this.fetch(url, { ...options, signal: AbortSignal.timeout(12000) }); }
    catch { throw new SpotifyFailure('network', 'Spotify ist gerade nicht erreichbar. Die Verbindung wird automatisch erneut versucht.'); }
  }
  async token(form) {
    const res = await this.request('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 429) {
        const until = this.now() + Math.max(1000, (Number(res.headers.get('Retry-After')) || 30) * 1000);
        this.rateLimits.set(form.client_id, until);
        throw new SpotifyFailure('rate_limited', 'Spotify begrenzt gerade die Anfragen. Das Widget wartet automatisch.', until);
      }
      if (data.error === 'invalid_grant') throw new SpotifyFailure('reauth', 'Die Anmeldung ist abgelaufen oder wurde widerrufen. Bitte Spotify erneut verbinden.');
      if (res.status >= 500) throw new SpotifyFailure('unavailable', 'Spotify antwortet gerade mit einem Serverfehler. Automatischer Wiederholungsversuch folgt.');
      throw new SpotifyFailure('oauth', 'Spotify hat die Anmeldung abgelehnt. Client-ID und Redirect-URI im Spotify Developer Dashboard prüfen.');
    }
    if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0)
      throw new SpotifyFailure('oauth', 'Spotify hat keine gültigen Anmeldedaten zurückgegeben. Bitte erneut verbinden.');
    return data;
  }
  async access(p, force = false) {
    if (!p.refreshToken) throw new SpotifyFailure('reauth', 'Spotify ist nicht verbunden.');
    if (this.refreshing.has(p.id)) return this.refreshing.get(p.id);
    if (!force && p.accessToken && p.expiresAt > this.now() + 60000) return p.accessToken;
    const version = p.authVersion;
    const task = (async () => {
      try {
        const data = await this.token({ grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId });
        if (!this.active(p, version)) throw new SpotifyFailure('reauth', 'Die Verbindung wurde geändert.');
        p.accessToken = data.access_token;
        if (typeof data.refresh_token === 'string' && data.refresh_token) p.refreshToken = data.refresh_token;
        p.expiresAt = this.now() + data.expires_in * 1000;
        if (typeof data.scope === 'string') p.spotifyScopes = data.scope.split(/\s+/).filter(Boolean);
        this.store.save(); this.onAuthChange(p); return p.accessToken;
      } catch (e) {
        if (e.code === 'reauth' && this.active(p, version)) this.invalidate(p);
        throw e;
      }
    })().finally(() => this.refreshing.delete(p.id));
    this.refreshing.set(p.id, task); return task;
  }
  async requestSong(p, input, isActive, onResolved) {
    if (!this.canQueue(p)) throw new SpotifyFailure('queue_scope', 'Spotify für Song Requests freigeben.');
    const parsed = parseSongRequest(input);
    if (!parsed) throw new SpotifyFailure('invalid_song', 'Spotify-Track-Link oder „Songtitel - Interpret“ eingeben.');
    const version = p.authVersion;
    const check = () => {
      if (!isActive() || !this.active(p, version)) throw new SpotifyFailure('request_stopped', 'Song Requests wurden während der Verarbeitung ausgeschaltet oder geändert.');
      if (!this.canQueue(p)) throw new SpotifyFailure('queue_scope', 'Spotify für Song Requests freigeben.');
      const retryAt = this.rateLimits.get(p.clientId) || 0;
      if (retryAt > this.now()) throw new SpotifyFailure('rate_limited', 'Spotify begrenzt gerade die Anfragen.', retryAt);
    };
    const call = async (path, method = 'GET') => {
      check();
      let token = await this.access(p);
      const send = async () => {
        check();
        try { return await this.request(`https://api.spotify.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}` }, redirect: 'error' }); }
        catch (e) {
          if (method === 'POST') throw new SpotifyFailure('queue_unknown', 'Spotify hat das Einreihen nicht bestätigt. Warteschlange prüfen.');
          throw e;
        }
      };
      let res = await send();
      if (res.status === 401) { check(); token = await this.access(p, true); res = await send(); }
      if (res.status === 401) {
        if (this.active(p, version)) this.invalidate(p);
        throw new SpotifyFailure('reauth', 'Spotify erneut verbinden.');
      }
      if (res.status === 429) {
        const retryAt = this.now() + Math.max(1000, (Number(res.headers.get('Retry-After')) || 30) * 1000);
        this.rateLimits.set(p.clientId, retryAt);
        throw new SpotifyFailure('rate_limited', 'Spotify begrenzt gerade die Anfragen.', retryAt);
      }
      if (res.status === 403) throw new SpotifyFailure('queue_forbidden', 'Spotify verweigert den Zugriff. Premium, App-Freigabe und Song-Request-Berechtigung prüfen.');
      if (method === 'POST' && res.status === 404) throw new SpotifyFailure('no_device', 'Kein aktives Spotify-Gerät. Einen Titel in Spotify starten.');
      if (method === 'POST' && res.status >= 500) throw new SpotifyFailure('queue_unknown', 'Spotify hat das Einreihen nicht bestätigt. Warteschlange prüfen.');
      if (method === 'GET' && res.status === 404) throw new SpotifyFailure('song_missing', 'Der Spotify-Titel ist nicht verfügbar.');
      if (!res.ok) throw new SpotifyFailure('request_failed', 'Spotify konnte den Songwunsch nicht verarbeiten.');
      return res;
    };
    const queryText = value => value.replace(/[":]/g, ' ');
    const search = new URLSearchParams({ type: 'track', limit: '10', q: parsed.id ? '' : `track:${queryText(parsed.title)} artist:${queryText(parsed.artist)}` });
    const result = await (await call(parsed.id ? `tracks/${parsed.id}` : `search?${search}`)).json();
    const track = parsed.id ? requestedTrack(result) : matchRequestedTrack(result.tracks?.items, parsed);
    if (!track) throw new SpotifyFailure('song_missing', 'Kein passender Song gefunden. Einen direkten Spotify-Track-Link verwenden.');
    onResolved(track);
    const res = await call(`me/player/queue?${new URLSearchParams({ uri: track.uri })}`, 'POST');
    if (res.status !== 204) throw new SpotifyFailure('queue_unknown', 'Spotify hat das Einreihen nicht bestätigt. Warteschlange prüfen.');
    return track;
  }
  async playback(p) {
    const now = this.now();
    if (!this.connected(p)) return { status: 'disconnected', track: null, receivedAt: now };
    const limitedUntil = this.rateLimits.get(p.clientId) || 0;
    if (limitedUntil > now) return { status: 'error', code: 'rate_limited', message: 'Spotify begrenzt gerade die Anfragen. Das Widget wartet automatisch.', retryAt: limitedUntil, track: null, receivedAt: now };
    const hit = this.cache.get(p.id);
    if (hit && now < hit.until) return hit.data;
    if (this.pending.has(p.id)) return this.pending.get(p.id);
    const version = p.authVersion;
    const task = this.loadPlayback(p, version).then(data => {
      if (!this.active(p, version)) return { status: this.connected(p) ? 'idle' : 'disconnected', track: null, receivedAt: this.now() };
      const ttl = data.retryAt ? Math.max(3000, data.retryAt - this.now()) : data.status === 'error' ? 10000 : data.status === 'idle' ? 5000 : 3000;
      this.cache.set(p.id, { data, until: this.now() + ttl }); return data;
    }).finally(() => this.pending.delete(p.id));
    this.pending.set(p.id, task); return task;
  }
  async loadPlayback(p, version) {
    try {
      let token = await this.access(p);
      const read = () => this.request('https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode', { headers: { Authorization: `Bearer ${token}` } });
      let res = await read();
      if (res.status === 401) { token = await this.access(p, true); res = await read(); }
      if (!this.active(p, version)) throw new SpotifyFailure('reauth', 'Die Verbindung wurde geändert.');
      if (res.status === 204) return { status: 'idle', track: null, receivedAt: this.now() };
      if (res.status === 401) { this.invalidate(p); throw new SpotifyFailure('reauth', 'Spotify erneut verbinden.'); }
      if (res.status === 403) throw new SpotifyFailure('forbidden', 'Spotify verweigert den Zugriff. Im Developer Dashboard Nutzerfreigabe, Premium des App-Inhabers und App-Status prüfen.');
      if (res.status === 429) {
        const retryAt = this.now() + Math.max(1000, (Number(res.headers.get('Retry-After')) || 30) * 1000);
        this.rateLimits.set(p.clientId, retryAt);
        throw new SpotifyFailure('rate_limited', 'Spotify begrenzt gerade die Anfragen. Das Widget wartet automatisch.', retryAt);
      }
      if (!res.ok) throw new SpotifyFailure('unavailable', 'Spotify ist vorübergehend nicht verfügbar. Automatischer Wiederholungsversuch folgt.');
      const data = await res.json(); return normalizePlayback(data, this.now());
    } catch (e) {
      return { status: 'error', code: e.code || 'network', message: e instanceof SpotifyFailure ? e.message : 'Die Spotify-Antwort konnte nicht verarbeitet werden.', retryAt: e.retryAt || 0, track: null, receivedAt: this.now() };
    }
  }
}
