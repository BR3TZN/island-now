import { cleanText } from './song-input.mjs';

const ID = 'https://id.twitch.tv/oauth2/';
const HELIX = 'https://api.twitch.tv/helix/';
const REWARDS = 'channel_points/custom_rewards';
const SCOPES = ['channel:manage:redemptions', 'user:write:chat'];
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const REDEMPTION_EVENT = 'channel.channel_points_custom_reward_redemption.add';
export const rewardId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const hasScopes = scopes => Array.isArray(scopes) && SCOPES.every(scope => scopes.includes(scope));
const formData = entries => { const form = new FormData(); for (const [key, value] of Object.entries(entries)) form.set(key, value); return form; };
const tokenPair = data => typeof data?.access_token === 'string' && data.access_token && typeof data.refresh_token === 'string' && data.refresh_token;

export class TwitchFailure extends Error {
  constructor(message, status = 502, retryAt = 0) { super(message); this.status = status; this.retryAt = retryAt; }
}

function rewardView(reward, manageable = false) {
  if (!rewardId(reward?.id)) return null;
  return { id: reward.id, title: cleanText(reward.title, 45), cost: Number(reward.cost) || 0,
    enabled: reward.is_enabled === true, acceptsInput: reward.is_user_input_required === true,
    paused: reward.is_paused === true, manageable };
}

export class TwitchService {
  constructor({ store, fetchFn = fetch, now = Date.now, onAuthChange = () => {} }) {
    Object.assign(this, { store, fetch: fetchFn, now, onAuthChange });
    this.pairs = new Map(); this.refreshing = new WeakMap();
  }
  async request(url, options = {}) {
    try { return await this.fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
    catch { throw new TwitchFailure('Twitch ist gerade nicht erreichbar.'); }
  }
  failure(res) {
    if (res.status === 429) {
      const reset = Number(res.headers.get('Ratelimit-Reset')) * 1000;
      return new TwitchFailure('Twitch begrenzt gerade die Anfragen.', 429, Math.max(this.now() + 5000, reset || this.now() + 30000));
    }
    if (res.status === 403) return new TwitchFailure('Twitch verweigert die Aktion. Kanalpunkte müssen für den verbundenen Kanal verfügbar sein.', 403);
    if (res.status === 400) return new TwitchFailure('Twitch lehnt die Eingabe ab. Client-ID, Reward-Name und Kosten prüfen.', 400);
    if (res.status === 404) return new TwitchFailure('Dieser Twitch-Reward oder die Einlösung ist nicht mehr verfügbar.', 404);
    return new TwitchFailure('Twitch konnte die Anfrage nicht verarbeiten.', res.status >= 400 && res.status < 500 ? res.status : 502);
  }
  pairing(p) {
    const pair = this.pairs.get(p.id);
    if (pair?.userCode) return { code: pair.userCode, url: pair.url, expiresAt: pair.expiresAt };
    return pair?.error ? { error: pair.error } : null;
  }
  cancelPair(p) { clearTimeout(this.pairs.get(p.id)?.timer); this.pairs.delete(p.id); }
  stop() { for (const pair of this.pairs.values()) clearTimeout(pair.timer); this.pairs.clear(); }
  async beginPair(p, input) {
    const clientId = cleanText(input, 64) || p.twitch?.clientId || p.twitchClientId || '';
    if (!/^[A-Za-z0-9]{20,64}$/.test(clientId)) throw new TwitchFailure('Twitch-Client-ID einer App vom Typ „Public“ eingeben.', 400);
    this.cancelPair(p);
    const pair = { clientId };
    this.pairs.set(p.id, pair);
    try {
      const res = await this.request(`${ID}device`, { method: 'POST', body: formData({ client_id: clientId, scopes: SCOPES.join(' ') }) });
      if (!res.ok) throw this.failure(res);
      const data = await res.json();
      let url;
      try { url = new URL(data.verification_uri); } catch {}
      if (!url || !['https://www.twitch.tv', 'https://twitch.tv'].includes(url.origin) || url.pathname !== '/activate' || url.username || url.password
          || !/^[A-Za-z0-9-]{4,24}$/.test(data.user_code || '') || typeof data.device_code !== 'string' || !data.device_code
          || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new TwitchFailure('Twitch hat keinen gültigen Gerätecode zurückgegeben.');
      if (this.pairs.get(p.id) !== pair) return;
      Object.assign(pair, { deviceCode: data.device_code, userCode: data.user_code, url: url.href,
        expiresAt: this.now() + data.expires_in * 1000, interval: Math.max(1000, (Number(data.interval) || 5) * 1000) });
      this.schedulePair(p, pair);
    } catch (error) {
      if (this.pairs.get(p.id) === pair) this.cancelPair(p);
      throw error;
    }
  }
  schedulePair(p, pair) {
    const remaining = pair.expiresAt - this.now();
    pair.timer = setTimeout(() => this.pollPair(p, pair), Math.max(0, Math.min(remaining, pair.interval)));
    pair.timer.unref();
  }
  async pollPair(p, pair) {
    if (this.pairs.get(p.id) !== pair) return;
    clearTimeout(pair.timer);
    const fail = error => { if (this.pairs.get(p.id) === pair) this.pairs.set(p.id, { error }); };
    if (this.now() >= pair.expiresAt) return fail('Der Gerätecode ist abgelaufen. Twitch-Anmeldung erneut starten.');
    try {
      if (!pair.tokens) {
        const res = await this.request(`${ID}token`, { method: 'POST', body: formData({ client_id: pair.clientId,
          scopes: SCOPES.join(' '), device_code: pair.deviceCode, grant_type: DEVICE_GRANT }) });
        const data = await res.json().catch(() => ({}));
        if (this.pairs.get(p.id) !== pair) return;
        const reason = data.error || data.message;
        if (!res.ok && (reason === 'authorization_pending' || reason === 'slow_down' || res.status === 429 || res.status >= 500)) {
          if (reason === 'slow_down' || res.status === 429) pair.interval += 5000;
          return this.schedulePair(p, pair);
        }
        if (!res.ok || !tokenPair(data)) return fail('Twitch-Anmeldung nicht abgeschlossen. Einen neuen Gerätecode anfordern.');
        pair.tokens = data;
      }
      const data = pair.tokens;
      const identity = await this.identity(data.access_token);
      if (identity.client_id !== pair.clientId || !/^\d+$/.test(identity.user_id || '') || !hasScopes(identity.scopes)) return fail('Twitch-Konto oder Berechtigungen konnten nicht bestätigt werden.');
      if (this.pairs.get(p.id) !== pair) return;
      const previous = p.twitch;
      p.twitchClientId = pair.clientId;
      p.twitch = { clientId: pair.clientId, userId: identity.user_id, login: cleanText(identity.login, 25),
        accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: this.now() + (Number(data.expires_in) || 14400) * 1000 };
      this.cancelPair(p); this.store.save(); this.onAuthChange(p, previous);
    } catch (error) {
      if (this.pairs.get(p.id) !== pair) return;
      if (error instanceof TwitchFailure && (error.status >= 500 || error.status === 429)) this.schedulePair(p, pair);
      else fail('Twitch-Anmeldung konnte nicht bestätigt werden. Einen neuen Gerätecode anfordern.');
    }
  }
  invalidate(p, auth = p.twitch) {
    if (!auth || p.twitch !== auth) return;
    delete p.twitch; this.store.save(); this.onAuthChange(p, auth);
  }
  assertCurrent(p, auth) {
    if (!auth || p.twitch !== auth || !this.store.state.profiles.includes(p)) throw new TwitchFailure('Twitch zuerst verbinden.', 401);
  }
  async access(p, auth, rejectedToken) {
    this.assertCurrent(p, auth);
    if (this.refreshing.has(auth)) return this.refreshing.get(auth);
    if (auth.expiresAt > this.now() && auth.accessToken !== rejectedToken) return auth.accessToken;
    const task = (async () => {
      const res = await this.request(`${ID}token`, { method: 'POST', body: new URLSearchParams({
        client_id: auth.clientId, refresh_token: auth.refreshToken, grant_type: 'refresh_token' }) });
      const data = await res.json().catch(() => ({}));
      this.assertCurrent(p, auth);
      if (res.status === 400 || res.status === 401 || res.ok && (!tokenPair(data) || data.scope && !hasScopes(data.scope))) {
        this.invalidate(p, auth); throw new TwitchFailure('Twitch-Anmeldung abgelaufen. Twitch erneut verbinden.', 401);
      }
      if (!res.ok) throw this.failure(res);
      Object.assign(auth, { accessToken: data.access_token, refreshToken: data.refresh_token,
        expiresAt: this.now() + (Number(data.expires_in) || 14400) * 1000 });
      this.store.save(); return auth.accessToken;
    })().finally(() => this.refreshing.delete(auth));
    this.refreshing.set(auth, task); return task;
  }
  async identity(token) {
    const res = await this.request(`${ID}validate`, { headers: { Authorization: `OAuth ${token}` } });
    if (res.status === 401) throw new TwitchFailure('Twitch-Anmeldung ist ungültig.', 401);
    if (!res.ok) throw this.failure(res);
    return res.json();
  }
  async validate(p, auth = p.twitch) {
    const token = await this.access(p, auth);
    try {
      const identity = await this.identity(token).catch(async error => {
        if (error.status !== 401) throw error;
        return this.identity(await this.access(p, auth, token));
      });
      this.assertCurrent(p, auth);
      if (identity.client_id !== auth.clientId || identity.user_id !== auth.userId || !hasScopes(identity.scopes)) throw new TwitchFailure('Twitch-Berechtigungen haben sich geändert.', 401);
    } catch (error) {
      if (error.status === 401) this.invalidate(p, auth);
      throw error;
    }
  }
  async helix(p, path, { query = {}, method = 'GET', data, auth = p.twitch } = {}) {
    let token = await this.access(p, auth);
    const send = () => {
      this.assertCurrent(p, auth);
      return this.request(`${HELIX}${path}?${new URLSearchParams(query)}`, { method,
        headers: { Authorization: `Bearer ${token}`, 'Client-Id': auth.clientId, ...(data ? { 'Content-Type': 'application/json' } : {}) },
        ...(data ? { body: JSON.stringify(data) } : {}) });
    };
    let res = await send();
    if (res.status === 401) { token = await this.access(p, auth, token); res = await send(); }
    this.assertCurrent(p, auth);
    if (res.status === 401) { this.invalidate(p, auth); throw new TwitchFailure('Twitch erneut verbinden.', 401); }
    if (!res.ok) throw this.failure(res);
    return res.status === 204 ? {} : await res.json();
  }
  async rewards(p, auth = p.twitch) {
    this.assertCurrent(p, auth);
    const query = { broadcaster_id: auth.userId };
    const [all, owned] = await Promise.all([
      this.helix(p, REWARDS, { query, auth }),
      this.helix(p, REWARDS, { query: { ...query, only_manageable_rewards: 'true' }, auth }),
    ]);
    const manageable = new Set(owned.data?.map(r => r.id));
    return (all.data || []).map(r => rewardView(r, manageable.has(r.id))).filter(Boolean);
  }
  async createReward(p, { title, cost }, auth = p.twitch) {
    this.assertCurrent(p, auth);
    const result = await this.helix(p, REWARDS, { query: { broadcaster_id: auth.userId }, method: 'POST', auth,
      data: { title, cost, prompt: 'Direkten Spotify-Track-Link oder „Songtitel - Interpret“ eingeben.',
        is_enabled: true, is_user_input_required: true, should_redemptions_skip_request_queue: false } });
    const reward = rewardView(result.data?.[0], true);
    if (!reward) throw new TwitchFailure('Twitch hat den Reward nicht bestätigt. Im Creator Dashboard nachsehen.');
    return reward;
  }
  async subscribe(p, auth, selected, sessionId) {
    const result = await this.helix(p, 'eventsub/subscriptions', { method: 'POST', auth,
      data: { type: REDEMPTION_EVENT, version: '1', condition: { broadcaster_user_id: auth.userId, reward_id: selected },
        transport: { method: 'websocket', session_id: sessionId } } });
    if (result.data?.[0]?.status !== 'enabled') throw new TwitchFailure('Twitch hat den Reward-Trigger nicht bestätigt.');
  }
  async settle(p, auth, event, status) {
    await this.helix(p, `${REWARDS}/redemptions`, { method: 'PATCH', auth,
      query: { broadcaster_id: auth.userId, reward_id: event.reward.id, id: event.id }, data: { status } });
  }
  async chat(p, auth, message) {
    const result = await this.helix(p, 'chat/messages', { method: 'POST', auth,
      data: { broadcaster_id: auth.userId, sender_id: auth.userId, message } });
    if (result.data?.[0]?.is_sent !== true) throw new TwitchFailure('Twitch hat die Chatnachricht nicht zugestellt.');
  }
}
