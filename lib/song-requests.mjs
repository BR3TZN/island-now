import { cleanText, DEFAULT_CHAT_MESSAGE, requestChatMessage } from './song-input.mjs';
import { SpotifyFailure } from './spotify.mjs';
import { TwitchFailure, TwitchService, rewardId } from './twitch.mjs';
import { TwitchEventSub } from './twitch-eventsub.mjs';

const HISTORY_LIMIT = 200;
const BACKLOG_LIMIT = 20;
const defaults = () => ({ enabled: false, reward: null, template: DEFAULT_CHAT_MESSAGE, history: [] });
const badInput = message => new TwitchFailure(message, 400);

export class SongRequests {
  constructor({ store, spotify, fetchFn, now = Date.now, connectWebSocket }) {
    Object.assign(this, { store, spotify, now, connectWebSocket });
    this.twitch = new TwitchService({ store, fetchFn, now, onAuthChange: p => this.authChanged(p) });
    this.listeners = new Map(); this.rewardCache = new Map(); this.jobs = new Map();
    this.running = false;
  }
  config(p) { return p.songRequests || defaults(); }
  ownConfig(p) { return p.songRequests ||= defaults(); }
  eligible(p, config = this.config(p)) {
    return !!p.twitch && config.reward?.broadcasterId === p.twitch.userId && config.reward.clientId === p.twitch.clientId;
  }
  view(p) {
    const { enabled, reward, template, history } = this.config(p);
    const entry = this.listeners.get(p.id);
    const spotifyReady = this.spotify.canQueue(p), twitchConnected = !!p.twitch;
    const status = !enabled ? 'off' : !twitchConnected ? 'twitch_required' : !spotifyReady ? 'spotify_required'
      : !this.eligible(p) ? 'reward_required' : entry?.status || 'connecting';
    return { enabled, status, detail: entry?.detail || '', spotifyReady, twitchConnected,
      twitchLogin: p.twitch?.login || '', hasTwitchClientId: !!p.twitchClientId, pairing: this.twitch.pairing(p), template,
      reward: reward ? { id: reward.id, title: reward.title, cost: reward.cost, manageable: reward.manageable } : null,
      recent: history.slice(-10).reverse().map(({ at, status, user, title, artist, note }) => ({ at, status, user, title, artist, note })) };
  }
  start() {
    this.running = true;
    let changed = false;
    for (const p of this.store.state.profiles) {
      for (const item of this.config(p).history) if (item.status === 'processing') {
        item.status = 'unknown'; item.note = 'Anwendung wurde während der Verarbeitung beendet. Spotify-Warteschlange und Twitch-Einlösung prüfen.'; changed = true;
      }
    }
    if (changed) this.store.save();
    const validate = () => {
      for (const p of this.store.state.profiles) if (p.twitch) {
        this.twitch.validate(p).catch(() => {}).finally(() => this.sync(p));
      }
    };
    validate(); this.validation = setInterval(validate, 60 * 60 * 1000); this.validation.unref();
  }
  stop() {
    this.running = false; clearInterval(this.validation); this.twitch.stop();
    for (const p of this.store.state.profiles) this.detach(p);
  }
  detach(p) { this.listeners.get(p.id)?.socket.stop(); this.listeners.delete(p.id); }
  authChanged(p) {
    this.rewardCache.delete(p.id); this.detach(p);
    const config = p.songRequests;
    if (config && !this.eligible(p, config)) {
      config.enabled = false;
      if (p.twitch) config.reward = null;
      this.store.save();
    }
    this.sync(p);
  }
  disconnect(p) { this.twitch.cancelPair(p); this.twitch.invalidate(p); }
  sync(p) {
    const config = this.config(p), auth = p.twitch, selected = config.reward?.id;
    if (!this.running || !config.enabled || !this.spotify.canQueue(p) || !this.eligible(p, config)) return this.detach(p);
    const current = this.listeners.get(p.id);
    if (current?.auth === auth && current.rewardId === selected && current.socket.running) return;
    this.detach(p);
    const entry = { auth, rewardId: selected, status: 'connecting', detail: '' };
    entry.socket = new TwitchEventSub({ connect: this.connectWebSocket, now: this.now,
      subscribe: session => this.twitch.subscribe(p, auth, selected, session),
      onEvent: event => this.receive(p, entry, event),
      onState: (status, detail = '') => Object.assign(entry, { status, detail }),
      onRevoked: status => {
        if (status === 'authorization_revoked' || status === 'user_removed') this.twitch.invalidate(p, auth);
        else Object.assign(entry, { status: 'error', detail: 'Twitch hat den Reward-Trigger beendet. Reward prüfen und Song Requests erneut einschalten.' });
      },
    });
    this.listeners.set(p.id, entry); entry.socket.start();
  }
  async rewards(p, fresh = false) {
    const auth = p.twitch, cache = this.rewardCache.get(p.id);
    if (!fresh && cache?.auth === auth && cache?.until > this.now()) return cache.rewards;
    const rewards = await this.twitch.rewards(p, auth);
    this.twitch.assertCurrent(p, auth);
    this.rewardCache.set(p.id, { auth, until: this.now() + 60000, rewards });
    return rewards;
  }
  async createReward(p, data) {
    const title = cleanText(data.title, 46), cost = data.cost;
    if (!title || title.length > 45 || !Number.isSafeInteger(cost) || cost < 1) throw badInput('Reward-Name (max. 45 Zeichen) und ganze Punktekosten ab 1 eingeben.');
    const reward = await this.twitch.createReward(p, { title, cost });
    this.rewardCache.delete(p.id);
    return reward;
  }
  async update(p, data) {
    const stored = p.songRequests, before = this.config(p), auth = p.twitch;
    const enabled = 'enabled' in data ? data.enabled : before.enabled;
    if (typeof enabled !== 'boolean') throw badInput('Ungültiger Schalterwert.');
    if (enabled && !this.spotify.canQueue(p)) throw badInput('Spotify zuerst für Song Requests freigeben.');
    if (enabled && !auth) throw badInput('Twitch zuerst verbinden.');
    const template = 'template' in data ? cleanText(data.template, 501) : before.template;
    if (!template || template.length > 500) throw badInput('Chatnachricht mit 1 bis 500 Zeichen eingeben.');
    const selected = 'rewardId' in data ? data.rewardId : before.reward?.id || '';
    if (selected !== '' && !rewardId(selected)) throw badInput('Einen gültigen Twitch-Reward auswählen.');
    let reward = before.reward;
    if (selected !== (reward?.id || '') || enabled && (!before.enabled || !this.eligible(p, before))) {
      if (!selected) reward = null;
      else {
        const item = (await this.rewards(p, enabled && !before.enabled)).find(r => r.id === selected);
        if (!item?.acceptsInput) throw badInput('Einen Twitch-Reward mit erforderlicher Texteingabe auswählen.');
        reward = { ...item, broadcasterId: auth.userId, clientId: auth.clientId };
      }
    }
    if (p.songRequests !== stored || p.twitch !== auth) throw new TwitchFailure('Die Verbindung oder Einstellungen wurden geändert. Nochmals speichern.', 409);
    if (enabled) {
      if (!this.spotify.canQueue(p)) throw badInput('Spotify zuerst für Song Requests freigeben.');
      if (!reward?.enabled || reward.broadcasterId !== auth.userId || reward.clientId !== auth.clientId) throw badInput('Einen aktiven Twitch-Reward mit Texteingabe auswählen.');
      if (this.store.state.profiles.some(other => other !== p && other.twitch?.userId === auth.userId && this.config(other).enabled))
        throw badInput('Für diesen Twitch-Kanal sind Song Requests bereits in einem anderen Spotify-Profil aktiv.');
    }
    p.songRequests = { ...before, enabled, reward, template }; this.store.save(); this.sync(p);
    return this.view(p);
  }
  active(p, entry) { return this.running && this.listeners.get(p.id) === entry && p.twitch === entry.auth && this.config(p).enabled && this.spotify.canQueue(p); }
  receive(p, entry, event) {
    const redemptionStatus = typeof event.status === 'string' ? event.status.toLowerCase() : '';
    if (!this.active(p, entry) || event.broadcaster_user_id !== entry.auth.userId || event.reward?.id !== entry.rewardId
      || !rewardId(event.id) || !['unfulfilled', 'fulfilled'].includes(redemptionStatus)) return;
    if (this.store.state.profiles.some(profile => this.config(profile).history.some(item => item.id === event.id))) return;
    const config = this.ownConfig(p), job = this.jobs.get(p.id) || { tail: Promise.resolve(), count: 0 };
    const record = { id: event.id, at: this.now(), user: cleanText(event.user_login || event.user_name, 25) || 'Zuschauer', title: '', artist: '',
      status: 'processing', note: '' };
    const saturated = job.count >= BACKLOG_LIMIT;
    if (saturated) Object.assign(record, { status: 'rejected', note: 'Zu viele offene Songwünsche. Einlösung im Twitch-Dashboard prüfen.' });
    config.history.push(record);
    if (config.history.length > HISTORY_LIMIT) config.history.splice(config.history.findIndex(item => item.status !== 'processing'), 1);
    try { this.store.save(); }
    catch { Object.assign(record, { status: 'rejected', note: 'Songwunsch konnte lokal nicht gespeichert werden.' }); return; }
    if (saturated) return;
    const authVersion = p.authVersion, isActive = () => this.active(p, entry) && p.authVersion === authVersion;
    const settle = config.reward.manageable && redemptionStatus === 'unfulfilled';
    job.count++;
    this.jobs.set(p.id, job);
    job.tail = job.tail.then(() => this.process(p, entry, event, record, settle, isActive)).catch(() => {
      entry.detail = 'Songwunsch konnte lokal nicht abgeschlossen werden.';
    }).finally(() => { if (--job.count === 0) this.jobs.delete(p.id); });
  }
  async process(p, entry, event, record, settle, isActive) {
    if (!isActive()) { Object.assign(record, { status: 'rejected', note: 'Song Requests wurden vor der Verarbeitung ausgeschaltet oder geändert.' }); this.store.save(); return; }
    let track;
    try { track = await this.spotify.requestSong(p, event.user_input, isActive, song => { record.title = song.title; record.artist = song.artist; }); }
    catch (error) {
      record.status = error.code === 'queue_unknown' ? 'unknown' : 'rejected';
      record.note = error instanceof SpotifyFailure ? error.message : 'Der Songwunsch konnte nicht verarbeitet werden.';
      this.store.save();
      if (settle && record.status === 'rejected' && isActive()) {
        try { await this.twitch.settle(p, entry.auth, event, 'CANCELED'); record.note += ' Kanalpunkte erstattet.'; }
        catch { record.note += ' Rückerstattung in Twitch prüfen.'; }
        this.store.save();
      }
      return;
    }
    record.status = 'queued'; this.store.save();
    if (!isActive()) { record.note = 'Eingereiht. Song Requests wurden vor der Chatbestätigung ausgeschaltet oder geändert.'; this.store.save(); return; }
    const chat = requestChatMessage(this.config(p).template, track, record.user);
    const [posted, fulfilled] = await Promise.allSettled([
      this.twitch.chat(p, entry.auth, chat),
      settle ? this.twitch.settle(p, entry.auth, event, 'FULFILLED') : Promise.resolve(),
    ]);
    record.note = [posted.status === 'rejected' && 'Chatbestätigung fehlgeschlagen.', fulfilled.status === 'rejected' && 'Einlösung in Twitch prüfen.'].filter(Boolean).join(' ');
    this.store.save();
  }
}
