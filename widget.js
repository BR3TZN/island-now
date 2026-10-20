import { WidgetState } from './widget-state.mjs';
import { THEME_IDS, MOTION_IDS } from './themes.mjs';
import { dominantAccent, readableAccent } from './cover-colors.mjs';
const $ = id => document.getElementById(id);
const state = new WidgetState(); const card = $('widget');
const preview = new URLSearchParams(location.search).get('preview') === '1';
const key = location.pathname.match(/^\/overlay\/([A-Za-z0-9_-]{43})$/)?.[1];
let settings = {}, lastTrack = '', interval;
const coverColors = new Map();
let trackRevision = 0, lastReveal, appVersion;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const time = ms => { const n = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
const color = x => /^#[0-9a-f]{6}$/i.test(x || '') ? x : '#1ed760';
function applyAccent(value, source = 'manual') {
  let accent = color(value);
  if (source === 'cover' && settings.theme === 'forza') accent = readableAccent([1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)), .173, 3);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-rgb', [1, 3, 5].map(i => parseInt(accent.slice(i, i + 2), 16)).join(','));
  if (preview) parent.postMessage({ type: 'island-accent', color: accent, source }, location.origin);
}
function updateAccent() {
  const image = $('cover'), fallback = color(settings.accent);
  card.classList.toggle('cover-accent', settings.accentMode === 'cover');
  if (settings.accentMode !== 'cover' || !image.getAttribute('src') || image.classList.contains('failed')) return applyAccent(fallback);
  const url = image.currentSrc || image.src;
  if (coverColors.has(url)) return applyAccent(coverColors.get(url), 'cover');
  if (!image.complete || !image.naturalWidth) return applyAccent(fallback, 'fallback');
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 48;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 48, 48);
    const accent = dominantAccent(context.getImageData(0, 0, 48, 48), fallback);
    coverColors.set(url, accent); if (coverColors.size > 24) coverColors.delete(coverColors.keys().next().value);
    applyAccent(accent, 'cover');
  } catch { applyAccent(fallback, 'fallback'); }
}
function marquee() {
  for (const id of ['song-title', 'song-artist']) {
    const el = $(id);
    const extra = el.scrollWidth - el.parentElement.clientWidth;
    const key = `${el.textContent}:${extra}`;
    if (extra <= 3) { el.classList.remove('scrolling'); delete el.dataset.scrollKey; }
    else if (el.dataset.scrollKey !== key) {
      el.classList.remove('scrolling'); el.style.setProperty('--marquee-distance', `${-extra - 2}px`);
      el.style.setProperty('--marquee-duration', `${Math.max(9, extra / 25 + 5)}s`); void el.offsetWidth;
      el.classList.add('scrolling'); el.dataset.scrollKey = key;
    }
  }
}
function preloadCover(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const image = new Image(); const timeout = setTimeout(() => finish(null), 12000);
    const finish = value => { clearTimeout(timeout); image.onload = image.onerror = null; resolve(value); };
    image.onload = () => finish(image); image.onerror = () => finish(null); image.src = url;
  });
}
async function renderTrack(t, hasPrevious) {
  const ticket = ++trackRevision, duration = Math.max(150, Math.min(1500, settings.motionDuration || 650));
  const mode = reducedMotion() ? 'none' : settings.trackTransition || 'fade';
  const textElements = [$('song-title').parentElement, $('song-artist').parentElement];
  const loaded = preloadCover(t.cover);
  for (const el of [...textElements, $('cover'), $('cover-back')]) el.getAnimations().forEach(a => a.cancel());
  if (hasPrevious && mode !== 'none') {
    await Promise.all(textElements.map(el => el.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: mode === 'slide' ? 'translateX(-14px)' : 'translateX(0)' }], { duration: duration * .3, easing: 'ease-in' }).finished.catch(() => {})));
  }
  if (ticket !== trackRevision) return;
  $('song-title').textContent = t.title; $('song-artist').textContent = t.artist;
  $('song-title').title = t.title; $('song-artist').title = t.artist;
  try { const u = new URL(t.url); card.href = u.protocol === 'https:' && u.hostname === 'open.spotify.com' ? u.href : 'https://open.spotify.com'; } catch { card.href = 'https://open.spotify.com'; }
  card.setAttribute('aria-label', `${t.title} · ${t.artist} auf Spotify öffnen`);
  if (hasPrevious && mode !== 'none') textElements.forEach(el => el.animate([{ opacity: 0, transform: mode === 'slide' ? 'translateX(14px)' : 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: duration * .7, easing: 'cubic-bezier(.16,1,.3,1)' }));
  requestAnimationFrame(marquee);
  const image = await loaded;
  if (ticket !== trackRevision) return;
  const front = $('cover'), back = $('cover-back');
  const previous = front.getAttribute('src');
  if (previous && !front.classList.contains('failed') && image && hasPrevious && mode !== 'none') back.src = previous; else back.removeAttribute('src');
  if (image) { front.classList.remove('failed'); front.src = image.src; front.alt = t.album ? `Cover: ${t.album}` : 'Albumcover'; }
  else { front.removeAttribute('src'); front.classList.add('failed'); back.removeAttribute('src'); }
  if (image && hasPrevious && mode !== 'none') {
    const frames = [{ opacity: 0, transform: mode === 'slide' ? 'translateX(14px)' : 'translateX(0)' }, { opacity: 1, transform: 'translateX(0)' }];
    front.animate(frames, { duration, easing: 'cubic-bezier(.16,1,.3,1)' });
    back.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: mode === 'slide' ? 'translateX(-14px)' : 'translateX(0)' }], { duration, easing: 'ease-out' }).finished.then(() => { if (ticket === trackRevision) back.removeAttribute('src'); }).catch(() => {});
  }
  updateAccent();
}
const motionTransform = motion => ({ left: 'translate3d(-80px,0,0)', right: 'translate3d(80px,0,0)', top: 'translate3d(0,-45px,0)', bottom: 'translate3d(0,45px,0)', scale: 'scale(.9)' })[motion] || 'translate3d(0,0,0)';
function replayEntrance() {
  if (settings.motion === 'none' || reducedMotion()) return;
  card.animate([{ opacity: 0, transform: motionTransform(settings.motion) }, { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' }], { duration: settings.motionDuration || 650, easing: 'cubic-bezier(.16,1,.3,1)' });
}
function receive(data) {
  if (!data || typeof data !== 'object') return;
  if (data.appVersion) { if (appVersion && data.appVersion !== appVersion) { location.reload(); return; } appVersion = data.appVersion; }
  settings = data.settings || settings; data.settings = settings;
  state.update(data);
  card.dataset.theme = THEME_IDS.includes(settings.theme) ? settings.theme : 'island';
  card.dataset.motion = MOTION_IDS.includes(settings.motion) ? settings.motion : 'fade';
  card.style.setProperty('--motion-duration', `${Math.max(150, Math.min(1500, settings.motionDuration || 650))}ms`);
  const width = Math.max(320, Math.min(720, Number(settings.width) || 600));
  document.documentElement.style.setProperty('--width', `${width}px`);
  card.classList.toggle('narrow', width < 460);
  card.classList.toggle('paused', data.status === 'paused');
  card.classList.toggle('no-cover', settings.showCover === false);
  card.classList.toggle('no-time', settings.showTime === false);
  card.classList.toggle('no-progress', settings.showProgress === false);
  $('play-label').textContent = data.status === 'paused' ? 'PAUSIERT' : 'LÄUFT GERADE';
  if (data.track) {
    const t = data.track;
    const signature = JSON.stringify([t.id, t.title, t.artist, t.cover]);
    if (lastTrack !== signature) {
      renderTrack(t, !!lastTrack); lastTrack = signature;
    }
    $('duration').textContent = time(t.duration);
  }
  updateAccent(); requestAnimationFrame(marquee); draw();
  if (data.reveal && lastReveal !== undefined && data.reveal !== lastReveal) replayEntrance();
  lastReveal = data.reveal;
}
function draw() {
  const frame = state.frame();
  card.classList.toggle('hidden', !frame.visible);
  if (state.data?.track) {
    $('elapsed').textContent = time(frame.progress);
    $('progress-fill').style.width = `${state.data.track.duration ? frame.progress / state.data.track.duration * 100 : 0}%`;
  }
}
$('cover').addEventListener('load', updateAccent);
$('cover').addEventListener('error', () => { $('cover').classList.add('failed'); updateAccent(); });
new ResizeObserver(marquee).observe(card);
if (preview) {
  window.addEventListener('message', e => { if (e.origin === location.origin && e.source === parent && e.data?.type === 'island-preview') receive(e.data.payload); });
  parent.postMessage({ type: 'island-ready' }, location.origin);
} else if (key) {
  async function poll() {
    let delay = 2000;
    try {
      const res = await fetch(`/api/overlay/${key}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const data = await res.json(); receive(data);
      if (res.status === 404) return;
      if (data.retryAt) delay = Math.max(2000, data.retryAt - Date.now());
      else if (data.status === 'idle' || data.status === 'disconnected') delay = 5000;
      else if (data.status === 'error') delay = 10000;
    } catch { receive({ status: 'error', track: null, settings }); delay = 5000; }
    interval = setTimeout(poll, Math.min(delay, 2147483647));
  }
  poll(); window.addEventListener('pagehide', () => clearTimeout(interval));
}
setInterval(draw, 100);
