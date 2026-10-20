import { THEME_IDS, MOTION_IDS, TRACK_TRANSITIONS } from '../public/themes.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'island', accent: '#1ed760', accentMode: 'manual', width: 600,
  mode: 'change', displaySeconds: 15, hidePaused: true,
  showProgress: true, showTime: true, showCover: true,
  motion: 'fade', motionDuration: 650, trackTransition: 'fade',
});

export function settingsFrom(input = {}, previous = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...previous };
  if (THEME_IDS.includes(input.theme)) s.theme = input.theme;
  if (/^#[0-9a-f]{6}$/i.test(input.accent || '')) s.accent = input.accent;
  if (['manual', 'cover'].includes(input.accentMode)) s.accentMode = input.accentMode;
  if (MOTION_IDS.includes(input.motion)) s.motion = input.motion;
  if (TRACK_TRANSITIONS.includes(input.trackTransition)) s.trackTransition = input.trackTransition;
  if (Number.isFinite(input.motionDuration)) s.motionDuration = Math.min(1500, Math.max(150, Math.round(input.motionDuration)));
  if (Number.isFinite(input.width)) s.width = Math.min(720, Math.max(320, Math.round(input.width)));
  if (['always', 'change'].includes(input.mode)) s.mode = input.mode;
  if (Number.isFinite(input.displaySeconds)) s.displaySeconds = Math.min(120, Math.max(5, Math.round(input.displaySeconds)));
  for (const key of ['hidePaused', 'showProgress', 'showTime', 'showCover']) {
    if (typeof input[key] === 'boolean') s[key] = input[key];
  }
  return s;
}

const safeString = (x, limit = 1200) => typeof x === 'string' ? x.slice(0, limit) : '';
const safeNumber = x => Number.isFinite(x) ? Math.max(0, x) : 0;
export function spotifyLink(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'open.spotify.com' ? u.href : ''; }
  catch { return ''; }
}
export function coverLink(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['i.scdn.co', 'image-cdn-ak.spotifycdn.com', 'image-cdn-fa.spotifycdn.com', 'mosaic.scdn.co'].includes(u.hostname) ? u.href : '';
  } catch { return ''; }
}

export function normalizePlayback(raw, receivedAt) {
  const item = raw?.item;
  if (!item || !['track', 'episode'].includes(item.type)) return { status: 'idle', track: null, receivedAt };
  const podcast = item.type === 'episode';
  const title = safeString(item.name);
  const artist = podcast ? safeString(item.show?.name || item.show?.publisher || 'Podcast')
    : (Array.isArray(item.artists) ? item.artists.map(a => safeString(a.name)).filter(Boolean).join(', ') : '');
  const images = podcast ? item.images || item.show?.images : item.album?.images;
  const cover = Array.isArray(images) ? images.find(i => i.width >= 300)?.url || images[0]?.url : '';
  const duration = safeNumber(item.duration_ms);
  return {
    status: raw.is_playing ? 'playing' : 'paused', receivedAt,
    track: {
      id: safeString(item.id || item.uri || `${title}:${artist}`, 300), type: item.type,
      title, artist, album: safeString(item.album?.name || item.show?.name),
      cover: coverLink(cover), url: spotifyLink(item.external_urls?.spotify),
      duration, progress: Math.min(duration, safeNumber(raw.progress_ms)),
      isPlaying: raw.is_playing === true, isLocal: item.is_local === true,
    },
  };
}
