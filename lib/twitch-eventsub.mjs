import { REDEMPTION_EVENT } from './twitch.mjs';

const EVENTSUB_ORIGIN = 'wss://eventsub.wss.twitch.tv';
const EVENTSUB_URL = `${EVENTSUB_ORIGIN}/ws`;

function reconnectUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === EVENTSUB_ORIGIN && !url.username && !url.password && !url.hash ? value : null;
  } catch { return null; }
}

export class TwitchEventSub {
  constructor({ connect = url => new WebSocket(url), subscribe, onEvent, onState, onRevoked, now = Date.now }) {
    Object.assign(this, { connect, subscribe, onEvent, onState, onRevoked, now });
    this.running = false; this.attempt = 0;
  }
  start() {
    if (this.running) return;
    this.running = true; this.attempt = 0;
    this.onState('connecting'); this.open(EVENTSUB_URL);
  }
  stop() {
    this.running = false; clearTimeout(this.retry);
    this.drop(this.primary); this.drop(this.next);
  }
  current(holder) { return this.running && (holder === this.primary || holder === this.next); }
  drop(holder) {
    if (!holder) return;
    if (holder === this.primary) this.primary = null;
    if (holder === this.next) this.next = null;
    clearTimeout(holder.timer);
    try { holder.socket.close(); } catch {}
  }
  retryLater(message, retryAt = 0) {
    if (!this.running) return;
    this.onState('reconnecting', message);
    const delay = Math.min(60000, 1500 * 2 ** Math.min(this.attempt++, 6));
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.open(EVENTSUB_URL), Math.min(2147483647, Math.max(delay, retryAt - this.now())));
    this.retry.unref();
  }
  lost(holder, error) {
    if (!this.current(holder)) return;
    this.drop(holder);
    if (this.primary || this.next) return;
    if (error && [400, 401, 403, 404].includes(error.status)) {
      this.stop(); this.onState('error', error.message); return;
    }
    this.retryLater(error?.message || 'Twitch-Verbindung unterbrochen. Verbinde erneut …', error?.retryAt);
  }
  watch(holder, ms) {
    clearTimeout(holder.timer);
    holder.timer = setTimeout(() => this.lost(holder), ms);
    holder.timer.unref();
  }
  open(url, migration = false) {
    if (!this.running) return;
    let socket;
    try { socket = this.connect(url); }
    catch { if (!this.primary) this.retryLater('Twitch-Verbindung konnte nicht geöffnet werden.'); return; }
    const holder = { socket, migration, welcomed: false, keepalive: 0 };
    if (migration) this.next = holder; else this.primary = holder;
    this.watch(holder, 15000);
    socket.addEventListener('message', e => this.receive(holder, e.data));
    socket.addEventListener('error', () => this.lost(holder));
    socket.addEventListener('close', () => this.lost(holder));
  }
  receive(holder, raw) {
    if (!this.current(holder) || typeof raw !== 'string' || raw.length > 65536) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    const type = message?.metadata?.message_type, payload = message?.payload;
    if (type === 'session_welcome' && !holder.welcomed) {
      const session = payload?.session;
      if (typeof session?.id !== 'string' || !session.id) return this.lost(holder);
      holder.welcomed = true;
      holder.keepalive = Math.max(10, Math.min(600, Number(session.keepalive_timeout_seconds) || 30)) * 1000 + 1500;
      this.watch(holder, holder.keepalive);
      if (holder.migration) {
        this.drop(this.primary); this.next = null; this.primary = holder;
        this.attempt = 0; this.onState('listening'); return;
      }
      Promise.resolve().then(() => this.current(holder) && this.subscribe(session.id)).then(() => {
        if (this.current(holder)) { this.attempt = 0; this.onState('listening'); }
      }).catch(error => this.lost(holder, error));
      return;
    }
    if (!holder.welcomed) return;
    if (type === 'session_keepalive' || type === 'notification') this.watch(holder, holder.keepalive);
    if (type === 'session_reconnect' && holder === this.primary && !this.next) {
      const url = reconnectUrl(payload?.session?.reconnect_url);
      if (url) { this.onState('reconnecting', 'Twitch wechselt den EventSub-Server …'); this.open(url, true); }
    }
    if (payload?.subscription?.type !== REDEMPTION_EVENT) return;
    if (type === 'notification' && payload.event) this.onEvent(payload.event);
    if (type === 'revocation') {
      this.stop(); this.onRevoked(payload.subscription.status);
    }
  }
}
