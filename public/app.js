import { THEME_ACCENTS } from './themes.mjs';
import { dominantAccent } from './cover-colors.mjs';
const $ = id => document.getElementById(id);
let app, activeId, settings, csrf, saveTimer, toastTimer, revision = 0, saveQueue = Promise.resolve();
let previewMode = 'demo', lastLive = null, demoIndex = 0, demoStarted = Date.now(), testingUntil = 0, previewReady = false;
let clientIdTimer;
let updateState, updateTimer, updateWasStarted = false;
let appearance = 'neutral', appearanceCover, appearanceRevision = 0;
const pageAccents = new Map(), neutralAccent = '#d2d6dd';
const demos = [
  { id: 'demo-1', title: 'Night Drive', artist: 'Island Demo', duration: 228000 },
  { id: 'demo-2', title: 'A Little Longer Than Expected (Midnight Session)', artist: 'Island Demo, Studio Collective', duration: 262000 },
  { id: 'demo-3', title: 'Neon Skies', artist: 'Island Demo', duration: 194000 },
];
const active = () => app?.profiles.find(p => p.id === activeId);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3800); }
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); $('message').hidden = !text; }
async function api(path, method = 'GET', data) {
  const res = await fetch(path, { method, cache: 'no-store', signal: AbortSignal.timeout(20000), headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Island-CSRF': csrf }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Die Anfrage konnte nicht verarbeitet werden.');
  return result;
}
function remember() { try { localStorage.setItem('island-profile', activeId); } catch {} }
async function syncAppearance() {
  // Follow the active Spotify account even when the widget preview shows a demo.
  const cover = appearance === 'cover' ? (active()?.connected ? lastLive?.track?.cover : previewMode === 'demo' ? '/demo-cover.svg' : '') || '' : '';
  if (cover === appearanceCover) return;
  appearanceCover = cover;
  const rev = ++appearanceRevision;
  if (!cover) { document.documentElement.style.setProperty('--ui-accent', neutralAccent); return; }
  try {
    const url = new URL(cover, location.origin);
    if (url.origin !== location.origin) throw new Error('Unexpected cover origin');
    let color = pageAccents.get(url.href);
    if (!color) {
      const img = new Image(); img.src = url.href; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 32, 32);
      color = dominantAccent(ctx.getImageData(0, 0, 32, 32), neutralAccent);
      pageAccents.set(url.href, color);
      if (pageAccents.size > 32) pageAccents.delete(pageAccents.keys().next().value);
    }
    if (rev === appearanceRevision) document.documentElement.style.setProperty('--ui-accent', color);
  } catch { if (rev === appearanceRevision) document.documentElement.style.setProperty('--ui-accent', neutralAccent); }
}
function refreshProfileList() {
  $('profile-select').replaceChildren(...app.profiles.map(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; return o; }));
  $('profile-select').value = activeId;
}
function renderConnection() {
  const p = active();
  concealClientId();
  $('connection-badge').classList.toggle('connected', p.connected);
  $('connection-badge').replaceChildren(Object.assign(document.createElement('span'), { className: 'dot' }), document.createTextNode(p.connected ? 'Spotify verbunden' : 'Nicht verbunden'));
  $('nav-dot').classList.toggle('connected', p.connected);
  $('profile-label').value = p.label; $('client-id').value = p.clientId;
  $('disconnect').hidden = !p.connected;
  $('connect').lastChild.textContent = p.connected ? ' Spotify erneut verbinden' : ' Mit Spotify verbinden';
  $('overlay-url').value = p.overlayUrl; $('open-overlay').href = p.overlayUrl;
  $('redirect-uri').value = app.redirectUri;
}
function renderSettings() {
  document.querySelectorAll('button[data-theme]').forEach(el => { const on = el.dataset.theme === settings.theme; el.classList.toggle('selected', on); el.setAttribute('aria-pressed', on); });
  document.querySelectorAll('[data-color]').forEach(el => { const on = el.dataset.color === settings.accent; el.classList.toggle('selected', on); el.setAttribute('aria-pressed', on); });
  document.querySelectorAll('[data-mode]').forEach(el => { const on = el.dataset.mode === settings.mode; el.classList.toggle('selected', on); el.setAttribute('aria-pressed', on); });
  for (const [id, key] of [['show-cover', 'showCover'], ['show-progress', 'showProgress'], ['show-time', 'showTime'], ['hide-paused', 'hidePaused']]) $(id).checked = settings[key];
  $('accent').value = settings.accent; $('accent-hex').textContent = settings.accent.toUpperCase();
  $('cover-accent').checked = settings.accentMode === 'cover';
  $('accent-source').textContent = settings.accentMode === 'cover' ? 'Wird aus dem Cover bestimmt' : 'Manuell gewählt';
  $('motion').value = settings.motion || 'fade'; $('track-transition').value = settings.trackTransition || 'fade';
  $('motion-duration').value = settings.motionDuration || 650; $('motion-duration-value').textContent = `${((settings.motionDuration || 650) / 1000).toLocaleString('de-AT')} s`;
  $('width').value = settings.width; $('width-value').textContent = `${settings.width} px`;
  $('display-seconds').value = Math.min(60, settings.displaySeconds); $('seconds-value').textContent = `${settings.displaySeconds} s`;
  $('duration-control').hidden = settings.mode === 'always';
  $('mode-hint').textContent = settings.mode === 'change' ? 'Erscheint bei einem neuen Titel und blendet sich danach wieder aus.' : 'Bleibt während der Wiedergabe sichtbar. Titelwechsel werden automatisch übernommen.';
  fitPreview(); pushPreview();
}
function selectProfile(id) {
  activeId = id; remember(); const p = active(); settings = { ...p.settings }; lastLive = null;
  testingUntil = 0; previewMode = p.connected ? 'live' : 'demo';
  refreshProfileList(); renderConnection(); renderSettings(); renderPreviewMode();
  $('playback-status').textContent = p.connected ? 'Spotify-Verbindung wird geprüft …' : 'Noch kein Spotify-Konto verbunden.';
  $('playback-status').classList.remove('error'); pollPlayback();
}
function queueSave() {
  clearTimeout(saveTimer); revision++;
  $('save-status').textContent = 'Wird gespeichert …'; $('save-status').className = 'save-status pending';
  saveTimer = setTimeout(saveSettings, 250);
}
function saveSettings() {
  clearTimeout(saveTimer); saveTimer = null;
  const id = activeId, value = { ...settings }, rev = revision;
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    try {
      await api(`/api/profiles/${id}`, 'PATCH', { settings: value });
      const p = app.profiles.find(p => p.id === id); if (p) p.settings = value;
      if (id === activeId && rev === revision) { $('save-status').textContent = 'Gespeichert'; $('save-status').className = 'save-status'; }
    } catch (e) {
      if (id === activeId) { $('save-status').textContent = 'Nicht gespeichert'; $('save-status').className = 'save-status failed'; message(e.message, true); }
      throw e;
    }
  });
  saveQueue.catch(() => {}); return saveQueue;
}
async function flushSave() { if (saveTimer) saveSettings(); await saveQueue; }
function changeSetting(key, value) { settings[key] = value; testingUntil = 0; renderSettings(); queueSave(); }
function selectTheme(theme) {
  if (settings.accent === THEME_ACCENTS[settings.theme]) settings.accent = THEME_ACCENTS[theme];
  changeSetting('theme', theme);
}
function concealClientId() {
  clearTimeout(clientIdTimer); $('client-id').type = 'password';
  $('toggle-client-id').textContent = 'Anzeigen'; $('toggle-client-id').setAttribute('aria-pressed', 'false');
}
function fitPreview() {
  if (!settings) return;
  const w = settings.width + 56, height = settings.theme === 'forza' ? 380 : settings.theme === 'compact' ? 175 : 210;
  $('preview-stage').dataset.theme = settings.theme;
  $('preview').width = w; $('preview').height = height;
  const scale = Math.min(1, ($('preview-stage').clientWidth - 24) / w);
  $('frame-wrap').style.width = `${w}px`; $('frame-wrap').style.height = `${height}px`;
  $('frame-wrap').style.transform = `translate(-50%,-50%) scale(${scale})`;
}
function renderPreviewMode() {
  $('demo-mode').classList.toggle('selected', previewMode === 'demo'); $('demo-mode').setAttribute('aria-pressed', previewMode === 'demo');
  $('live-mode').classList.toggle('selected', previewMode === 'live'); $('live-mode').setAttribute('aria-pressed', previewMode === 'live');
  $('demo-badge').textContent = previewMode === 'demo' ? 'DEMO' : 'LIVE'; $('demo-next').hidden = previewMode !== 'demo';
  $('stage-caption').textContent = previewMode === 'demo' ? 'Beispieltitel · keine Spotify-Verbindung nötig' : 'Aktueller Titel deines verbundenen Kontos';
  pushPreview();
}
function pushPreview() {
  syncAppearance();
  if (!settings || !previewReady) return;
  let payload;
  if (previewMode === 'demo') { const t = demos[demoIndex]; payload = { status: 'playing', receivedAt: Date.now(), track: { ...t, album: 'Island Demo', cover: `${location.origin}/demo-cover.svg`, url: 'https://open.spotify.com', progress: (45000 + Date.now() - demoStarted) % t.duration, isPlaying: true } }; }
  else payload = lastLive || { status: 'disconnected', track: null };
  // Keep the design preview visible; the test button uses the actual visibility settings.
  payload = { ...payload, settings: { ...settings, ...(Date.now() < testingUntil ? {} : { mode: 'always' }) }, reveal: `preview-${testingUntil}` };
  $('stage-empty').hidden = previewMode === 'demo' || !!payload.track;
  if (previewMode === 'live' && !payload.track) $('stage-empty').textContent = payload.status === 'error' ? payload.message : active().connected ? 'In Spotify einen Titel starten. Das Widget erscheint automatisch.' : 'Spotify verbinden und einen Titel abspielen.';
  $('preview').contentWindow.postMessage({ type: 'island-preview', payload }, location.origin);
}
let playbackPending = false;
async function pollPlayback() {
  const p = active(); if (!p || !p.connected || playbackPending) { if (p && !p.connected) lastLive = null; pushPreview(); return; }
  const id = p.id; playbackPending = true;
  try {
    const data = await api(`/api/profiles/${id}/playback`); if (id !== activeId) return;
    lastLive = data; const el = $('playback-status'); el.classList.toggle('error', data.status === 'error');
    if (data.status === 'error') {
      el.textContent = data.message;
      if (data.code === 'reauth') { p.connected = false; renderConnection(); }
    } else if (data.status === 'disconnected') { p.connected = false; renderConnection(); el.textContent = 'Spotify erneut verbinden.'; }
    else if (data.track) el.textContent = `${data.status === 'paused' ? 'Pausiert' : 'Läuft gerade'}: ${data.track.title} · ${data.track.artist}`;
    else el.textContent = 'Verbunden. Momentan wird kein Titel abgespielt.';
    pushPreview();
  } catch { if (id === activeId) { $('playback-status').textContent = 'Die lokale Anwendung antwortet nicht. Das Startfenster prüfen und bei Bedarf neu starten.'; $('playback-status').classList.add('error'); lastLive = { status: 'error', track: null, message: 'Lokale Verbindung unterbrochen.' }; pushPreview(); } }
  finally { playbackPending = false; }
}
async function copy(id, buttonId) {
  const value = $(id).value;
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(value);
    else { $(id).select(); if (!document.execCommand('copy')) throw new Error(); }
    toast(id === 'overlay-url' ? 'OBS-URL kopiert.' : 'Redirect-URI kopiert.');
  } catch { $(id).focus(); $(id).select(); toast('Mit Strg+C kopieren.'); }
}
function renderUpdates(data) {
  updateState = data; $('update-current-version').textContent = data.currentVersion || app.version;
  $('update-status').textContent = data.message || '';
  const busy = ['checking', 'downloading', 'verifying', 'staged'].includes(data.status);
  $('check-updates').disabled = busy;
  $('install-update').hidden = data.status !== 'available'; $('install-update').disabled = !data.canInstall;
  $('update-install-hint').hidden = data.status !== 'available' || data.canInstall;
  $('update-release-link').hidden = !data.releaseUrl; if (data.releaseUrl) $('update-release-link').href = data.releaseUrl;
  $('update-notes').textContent = data.notes || ''; $('update-notes-details').hidden = !data.notes;
  $('update-progress').hidden = !['downloading', 'verifying', 'staged'].includes(data.status);
  if (Number.isFinite(data.progress)) $('update-progress').value = data.progress; else $('update-progress').removeAttribute('value');
  if (data.status === 'error' && updateWasStarted) { $('update-dialog').close(); updateWasStarted = false; message(data.message, true); }
}
async function checkUpdates() {
  try { renderUpdates({ ...(updateState || {}), status: 'checking', message: 'GitHub-Releases werden geprüft …' }); renderUpdates(await api('/api/updates/check', 'POST', {})); }
  catch (error) { renderUpdates({ ...(updateState || {}), status: 'error', message: error.message }); }
}
async function pollUpdate() {
  clearTimeout(updateTimer);
  if (!updateWasStarted) return;
  try {
    const fresh = await api('/api/state');
    if (fresh.version !== app.version) { location.reload(); return; }
    csrf = fresh.csrf;
    const data = await api('/api/updates'); renderUpdates(data);
    if (data.status === 'idle') { updateWasStarted = false; $('update-dialog').close(); message('Die Anwendung wurde neu gestartet. Der Update-Status steht im Tray-Protokoll.'); return; }
  } catch { $('update-dialog-status').textContent = 'Die Anwendung wird neu gestartet …'; }
  updateTimer = setTimeout(pollUpdate, 1500);
}
function bind() {
  try { appearance = localStorage.getItem('island-appearance') === 'cover' ? 'cover' : 'neutral'; } catch {}
  $('appearance').value = appearance;
  document.documentElement.dataset.appearance = appearance;
  $('appearance').onchange = e => {
    appearance = e.target.value === 'cover' ? 'cover' : 'neutral';
    document.documentElement.dataset.appearance = appearance;
    try { localStorage.setItem('island-appearance', appearance); } catch {}
    syncAppearance();
  };
  $('check-updates').onclick = checkUpdates;
  $('install-update').onclick = () => { $('update-target-version').textContent = updateState.latestVersion; $('confirm-update').disabled = false; $('cancel-update').disabled = false; $('update-dialog-status').textContent = 'Das Widget wird kurz neu gestartet. Anmeldung, Einstellungen und OBS-Link bleiben erhalten.'; $('update-dialog').showModal(); };
  $('cancel-update').onclick = () => $('update-dialog').close();
  $('confirm-update').onclick = async () => {
    $('confirm-update').disabled = true; $('cancel-update').disabled = true;
    try { await flushSave(); const data = await api('/api/updates/install', 'POST', { version: updateState.latestVersion }); updateWasStarted = true; renderUpdates(data); pollUpdate(); }
    catch (error) { $('update-dialog-status').textContent = error.message; $('cancel-update').disabled = false; $('confirm-update').disabled = false; }
  };
  $('update-dialog').addEventListener('cancel', e => { if (updateWasStarted) e.preventDefault(); });
  try { $('auto-check-updates').checked = localStorage.getItem('island-auto-updates') !== 'false'; } catch {}
  $('auto-check-updates').onchange = e => { try { localStorage.setItem('island-auto-updates', String(e.target.checked)); } catch {} };
  $('toggle-client-id').onclick = () => {
    if ($('client-id').type === 'text') return concealClientId();
    $('client-id').type = 'text'; $('toggle-client-id').textContent = 'Verbergen';
    $('toggle-client-id').setAttribute('aria-pressed', 'true'); clientIdTimer = setTimeout(concealClientId, 15000);
  };
  window.addEventListener('blur', concealClientId);
  document.addEventListener('visibilitychange', () => { if (document.hidden) concealClientId(); });
  $('copy-url').onclick = () => copy('overlay-url'); $('copy-redirect').onclick = () => copy('redirect-uri');
  document.querySelectorAll('button[data-theme]').forEach(el => el.onclick = () => selectTheme(el.dataset.theme));
  document.querySelectorAll('[data-color]').forEach(el => el.onclick = () => changeSetting('accent', el.dataset.color));
  document.querySelectorAll('[data-mode]').forEach(el => el.onclick = () => changeSetting('mode', el.dataset.mode));
  for (const [id, key] of [['show-cover', 'showCover'], ['show-progress', 'showProgress'], ['show-time', 'showTime'], ['hide-paused', 'hidePaused']]) $(id).onchange = e => changeSetting(key, e.target.checked);
  $('accent').oninput = e => changeSetting('accent', e.target.value); $('width').oninput = e => changeSetting('width', Number(e.target.value)); $('display-seconds').oninput = e => changeSetting('displaySeconds', Number(e.target.value));
  $('cover-accent').onchange = e => changeSetting('accentMode', e.target.checked ? 'cover' : 'manual');
  $('motion').onchange = e => changeSetting('motion', e.target.value);
  $('track-transition').onchange = e => changeSetting('trackTransition', e.target.value);
  $('motion-duration').oninput = e => changeSetting('motionDuration', Number(e.target.value));
  document.querySelectorAll('[data-bg]').forEach(el => el.onclick = () => { $('preview-stage').dataset.background = el.dataset.bg; document.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('selected', b === el)); });
  $('demo-mode').onclick = () => { previewMode = 'demo'; testingUntil = 0; renderPreviewMode(); };
  $('live-mode').onclick = () => { previewMode = 'live'; testingUntil = 0; renderPreviewMode(); pollPlayback(); };
  $('demo-next').onclick = () => { demoIndex = (demoIndex + 1) % demos.length; demoStarted = Date.now(); pushPreview(); };
  $('preview-reveal').onclick = async () => {
    testingUntil = Date.now() + settings.displaySeconds * 1000 + 2500; pushPreview();
    if (previewMode === 'live' && active().connected) {
      try { await flushSave(); await api(`/api/profiles/${activeId}/reveal`, 'POST', {}); toast('Auch in OBS erneut eingeblendet.'); } catch (e) { message(e.message, true); }
    } else toast(settings.mode === 'change' ? `Demo blendet sich nach ${settings.displaySeconds} Sekunden aus.` : 'Dauerhafte Einblendung aktiv.');
  };
  $('profile-select').onchange = async e => { const id = e.target.value; try { await flushSave(); selectProfile(id); } catch { $('profile-select').value = activeId; } };
  $('add-profile').onclick = () => { $('new-profile-label').value = ''; $('profile-dialog').showModal(); };
  $('cancel-profile').onclick = () => $('profile-dialog').close();
  $('add-profile-form').onsubmit = async e => {
    e.preventDefault(); try { await flushSave(); const p = await api('/api/profiles', 'POST', { label: $('new-profile-label').value }); app.profiles.push(p); selectProfile(p.id); $('profile-dialog').close(); $('connection').scrollIntoView(); $('client-id').focus(); } catch (err) { message(err.message, true); $('profile-dialog').close(); }
  };
  $('connection-form').onsubmit = async e => {
    e.preventDefault(); concealClientId(); $('connect').disabled = true;
    try {
      await flushSave(); const p = await api(`/api/profiles/${activeId}`, 'PATCH', { label: $('profile-label').value, clientId: $('client-id').value.trim() });
      Object.assign(active(), p); refreshProfileList();
      const result = await api(`/api/profiles/${activeId}/connect`, 'POST', {}); location.assign(result.url);
    } catch (err) { message(err.message, true); $('message').scrollIntoView({ block: 'nearest' }); }
    finally { $('connect').disabled = false; }
  };
  $('disconnect').onclick = async () => {
    $('disconnect').disabled = true;
    try { await flushSave(); Object.assign(active(), await api(`/api/profiles/${activeId}/disconnect`, 'POST', {})); lastLive = null; renderConnection(); pushPreview(); $('playback-status').textContent = 'Verbindung getrennt. Lokal gespeicherte Spotify-Tokens wurden entfernt.'; toast('Spotify getrennt.'); }
    catch (e) { message(e.message, true); } finally { $('disconnect').disabled = false; }
  };
  $('rotate-url').onclick = async () => {
    try { Object.assign(active(), await api(`/api/profiles/${activeId}/rotate`, 'POST', {})); renderConnection(); toast('Neuen Link jetzt in OBS eintragen.'); } catch (e) { message(e.message, true); }
  };
  new ResizeObserver(fitPreview).observe($('preview-stage'));
}
window.addEventListener('message', e => {
  if (e.origin !== location.origin || e.source !== $('preview').contentWindow) return;
  if (e.data?.type === 'island-ready') { previewReady = true; pushPreview(); }
  if (e.data?.type === 'island-accent' && settings?.accentMode === 'cover' && /^#[0-9a-f]{6}$/i.test(e.data.color || '')) {
    $('accent-source').textContent = `${e.data.source === 'cover' ? 'Cover' : 'Fallback'}: ${e.data.color.toUpperCase()}`;
  }
});
$('preview').addEventListener('load', () => { previewReady = true; pushPreview(); });
try {
  app = await api('/api/state'); csrf = app.csrf;
  let remembered; try { remembered = localStorage.getItem('island-profile'); } catch {}
  const query = new URLSearchParams(location.search);
  const selected = app.profiles.find(p => p.id === query.get('connected')) || app.profiles.find(p => p.id === remembered) || app.profiles[0];
  bind(); selectProfile(selected.id); $('version').textContent = app.version;
  renderUpdates(await api('/api/updates'));
  if ($('auto-check-updates').checked) setTimeout(checkUpdates, 2200);
  if (query.has('connected')) message('Spotify ist verbunden. Einen Titel abspielen und die Widget-URL in OBS einfügen.');
  const errors = { oauth_state: 'Die Anmeldung ist abgelaufen oder gehört zu einer anderen Browser-Sitzung. Erneut auf „Mit Spotify verbinden“ drücken und denselben Browser verwenden.', oauth_denied: 'Die Spotify-Freigabe wurde abgebrochen. Du kannst die Anmeldung erneut starten.', oauth_failed: 'Spotify konnte nicht verbunden werden. Client-ID, Redirect-URI und Nutzerfreigabe im Spotify Developer Dashboard prüfen.' };
  if (query.has('error')) message(errors[query.get('error')] || 'Die Anmeldung konnte nicht abgeschlossen werden.', true);
  if (query.size) history.replaceState({}, '', '/');
  setInterval(() => { pushPreview(); pollPlayback(); }, 2500);
} catch { message('Island Now ist nicht erreichbar. START-WINDOWS.cmd starten und diese Seite neu laden.', true); }
