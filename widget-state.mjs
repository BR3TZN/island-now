export class WidgetState {
  constructor() { this.data = null; this.lastContact = 0; this.shownAt = 0; this.lastId = null; this.lastStatus = null; this.lastMode = null; this.lastReveal = null; }
  update(data, now = Date.now()) {
    const id = data.track?.id;
    const mode = data.settings?.mode || 'change';
    if (id && (id !== this.lastId || data.status === 'playing' && this.lastStatus !== 'playing' || mode !== this.lastMode || data.reveal && data.reveal !== this.lastReveal)) this.shownAt = now;
    this.lastId = id; this.lastStatus = data.status; this.lastMode = mode; this.lastReveal = data.reveal;
    this.data = data; this.lastContact = now;
  }
  frame(now = Date.now()) {
    const d = this.data, s = d?.settings || {};
    if (!d?.track || !['playing', 'paused'].includes(d.status) || now - this.lastContact > 20000) return { visible: false, progress: 0 };
    const progress = Math.min(d.track.duration, Math.max(0, d.track.progress + (d.track.isPlaying ? Math.max(0, now - d.receivedAt) : 0)));
    const visible = !(s.hidePaused && d.status === 'paused') && (s.mode !== 'change' || now - this.shownAt < (s.displaySeconds || 15) * 1000);
    return { visible, progress };
  }
}
