import http from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createStore } from './lib/store.mjs';
import { DEFAULT_SETTINGS, settingsFrom } from './lib/model.mjs';
import { SpotifyService } from './lib/spotify.mjs';
import { CoverCache } from './lib/covers.mjs';
import { UpdateService } from './lib/updates.mjs';
import { APP_VERSION } from './lib/version.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const random = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validClientId = id => typeof id === 'string' && /^[0-9a-f]{32}$/i.test(id);
const labelFrom = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : 'Mein Spotify';
const newProfile = (label = 'Mein Spotify', clientId = '') => ({ id: randomBytes(12).toString('hex'), label: labelFrom(label), clientId, overlayKey: random(), authVersion: random(), settings: { ...DEFAULT_SETTINGS } });

function openBrowser(url) {
  const p = process.platform === 'win32' ? spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' })
    : process.platform === 'darwin' ? spawn('open', [url], { detached: true, stdio: 'ignore' })
    : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  p.on('error', () => {}); p.unref();
}

export function createApp({ store = createStore(process.env.ISLAND_DATA_DIR || join(root, '.data')), fetchFn = fetch, port = 17653, now = Date.now, updateOptions = {} } = {}) {
  if (!store.state.profiles.length) { store.state.profiles.push(newProfile()); store.save(); }
  const spotify = new SpotifyService({ store, fetchFn, now });
  const covers = new CoverCache(fetchFn);
  const updates = new UpdateService({ root, ...updateOptions });
  const csrf = random(); const pending = new Map(); const reveals = new Map();
  let origin = `http://127.0.0.1:${port}`;
  const callback = () => `${origin}/auth/callback`;
  const coverHash = url => createHash('sha256').update(url).digest('hex').slice(0, 16);
  const playbackView = (p, data) => data.track?.cover ? { ...data, track: { ...data.track, cover: `/api/cover/${p.overlayKey}/${coverHash(data.track.cover)}` } } : data;
  const publicProfile = p => ({ id: p.id, label: p.label, clientId: p.clientId, connected: spotify.connected(p), connectedAt: p.connectedAt || null, settings: p.settings, overlayUrl: `${origin}/overlay/${p.overlayKey}` });
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const redirect = (res, url, cookie) => { res.writeHead(303, { Location: url, ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(); };
  const errorRedirect = (res, code) => redirect(res, `/?error=${code}`);
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 16384) throw Object.assign(new Error('Anfrage zu groß.'), { status: 413 }); chunks.push(chunk); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); return data; }
    catch { throw Object.assign(new Error('Ungültige Eingabe.'), { status: 400 }); }
  }
  const staticFiles = {
    '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
    '/widget.js': ['widget.js', 'text/javascript'], '/widget-state.mjs': ['widget-state.mjs', 'text/javascript'], '/widget.css': ['widget.css', 'text/css'],
    '/themes.mjs': ['themes.mjs', 'text/javascript'], '/cover-colors.mjs': ['cover-colors.mjs', 'text/javascript'],
    '/retro-player.mjs': ['retro-player.mjs', 'text/javascript'],
    '/overlay.html': ['overlay.html', 'text/html'], '/demo-cover.svg': ['demo-cover.svg', 'image/svg+xml'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'], '/help.html': ['help.html', 'text/html'],
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.scdn.co https://image-cdn-ak.spotifycdn.com https://image-cdn-fa.spotifycdn.com https://mosaic.scdn.co; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    try {
      const actualPort = new URL(origin).port;
      if (req.headers.host === `localhost:${actualPort}` && req.method === 'GET') return redirect(res, `${origin}${req.url.startsWith('/') && !req.url.startsWith('//') ? req.url : '/'}`);
      if (req.headers.host !== `127.0.0.1:${actualPort}`) return json(res, 403, { error: 'Anwendung über 127.0.0.1 öffnen.' });
      const url = new URL(req.url, origin); const path = url.pathname;
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) return json(res, 405, { error: 'Methode nicht erlaubt.' });
      if (['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.headers.origin !== origin || !equal(req.headers['x-island-csrf'], csrf)) return json(res, 403, { error: 'Die Browser-Sitzung ist abgelaufen. Seite neu laden.' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'JSON erforderlich.' });
      }
      if (path === '/api/state' && req.method === 'GET') return json(res, 200, { app: 'Island Now', version: APP_VERSION, csrf, redirectUri: callback(), profiles: store.state.profiles.map(publicProfile) });
      if (path === '/api/updates' && req.method === 'GET') return json(res, 200, updates.snapshot);
      if (path === '/api/updates/check' && req.method === 'POST') { await body(req); return json(res, 200, await updates.check()); }
      if (path === '/api/updates/install' && req.method === 'POST') {
        const input = await body(req);
        try { return json(res, 202, updates.beginInstall(input.version)); }
        catch (error) { return json(res, 400, { error: error.message }); }
      }
      if (path === '/api/profiles' && req.method === 'POST') {
        const data = await body(req);
        if (store.state.profiles.length >= 20) return json(res, 400, { error: 'Maximal 20 lokale Profile.' });
        if (data.clientId && !validClientId(data.clientId)) return json(res, 400, { error: 'Die Client-ID muss aus 32 Hex-Zeichen bestehen.' });
        const p = newProfile(data.label, data.clientId || ''); store.state.profiles.push(p); store.save(); return json(res, 201, publicProfile(p));
      }
      const profileMatch = path.match(/^\/api\/profiles\/([a-f0-9]{24})(?:\/(connect|disconnect|rotate|reveal|playback))?$/);
      if (profileMatch) {
        const p = store.state.profiles.find(x => x.id === profileMatch[1]);
        if (!p) return json(res, 404, { error: 'Profil nicht gefunden.' });
        const action = profileMatch[2];
        if (!action && req.method === 'PATCH') {
          const data = await body(req);
          if ('clientId' in data && data.clientId !== '' && !validClientId(data.clientId)) return json(res, 400, { error: 'Die Client-ID muss aus 32 Hex-Zeichen bestehen.' });
          if ('label' in data) p.label = labelFrom(data.label);
          if ('clientId' in data && data.clientId !== p.clientId) { spotify.invalidate(p); p.clientId = data.clientId; p.authVersion = random(); for (const [key, val] of pending) if (val.profileId === p.id) pending.delete(key); }
          if (data.settings) p.settings = settingsFrom(data.settings, p.settings);
          store.save(); return json(res, 200, publicProfile(p));
        }
        if (action === 'connect' && req.method === 'POST') {
          if (!validClientId(p.clientId)) return json(res, 400, { error: 'Zuerst deine Spotify Client-ID speichern.' });
          for (const [key, val] of pending) if (val.expires < now()) pending.delete(key);
          if (pending.size > 50) return json(res, 429, { error: 'Zu viele Anmeldeversuche. Zehn Minuten warten.' });
          const state = random(), verifier = randomBytes(64).toString('base64url'), browserNonce = random();
          const cookieName = `island_oauth_${state.slice(0, 12)}`;
          pending.set(state, { verifier, browserNonce, cookieName, profileId: p.id, clientId: p.clientId, authVersion: p.authVersion, expires: now() + 600000 });
          res.setHeader('Set-Cookie', `${cookieName}=${browserNonce}; HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=600`);
          const auth = new URL('https://accounts.spotify.com/authorize');
          auth.search = new URLSearchParams({ client_id: p.clientId, response_type: 'code', redirect_uri: callback(), scope: 'user-read-currently-playing', state, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), show_dialog: 'true' });
          return json(res, 200, { url: auth.href });
        }
        if (action === 'disconnect' && req.method === 'POST') {
          await body(req); spotify.invalidate(p); p.authVersion = random(); delete p.connectedAt;
          for (const [key, val] of pending) if (val.profileId === p.id) pending.delete(key);
          store.save(); return json(res, 200, publicProfile(p));
        }
        if (action === 'rotate' && req.method === 'POST') { await body(req); p.overlayKey = random(); store.save(); return json(res, 200, publicProfile(p)); }
        if (action === 'reveal' && req.method === 'POST') { await body(req); const stamp = random(); reveals.set(p.id, stamp); return json(res, 200, { ok: true }); }
        if (action === 'playback' && req.method === 'GET') return json(res, 200, playbackView(p, await spotify.playback(p)));
        return json(res, 405, { error: 'Methode nicht erlaubt.' });
      }
      if (path === '/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state') || ''; const transaction = pending.get(state);
        if (!transaction || transaction.expires < now()) { pending.delete(state); return errorRedirect(res, 'oauth_state'); }
        const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(c => c.trim().split('=')));
        if (!equal(cookies[transaction.cookieName], transaction.browserNonce)) return errorRedirect(res, 'oauth_state');
        pending.delete(state);
        res.setHeader('Set-Cookie', `${transaction.cookieName}=; HttpOnly; SameSite=Lax; Path=/auth/callback; Max-Age=0`);
        const p = store.state.profiles.find(x => x.id === transaction.profileId);
        if (!p || p.clientId !== transaction.clientId || p.authVersion !== transaction.authVersion) return errorRedirect(res, 'oauth_state');
        if (url.searchParams.has('error')) return errorRedirect(res, 'oauth_denied');
        const code = url.searchParams.get('code'); if (!code || code.length > 4096) return errorRedirect(res, 'oauth_failed');
        let tokens;
        try { tokens = await spotify.token({ grant_type: 'authorization_code', code, redirect_uri: callback(), client_id: transaction.clientId, code_verifier: transaction.verifier }); }
        catch { return errorRedirect(res, 'oauth_failed'); }
        if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token || p.authVersion !== transaction.authVersion) return errorRedirect(res, 'oauth_failed');
        p.accessToken = tokens.access_token; p.refreshToken = tokens.refresh_token; p.expiresAt = now() + tokens.expires_in * 1000;
        p.connectedAt = now(); p.authVersion = random(); spotify.clear(p.id); store.save();
        return redirect(res, `/?connected=${p.id}`);
      }
      const overlayMatch = path.match(/^\/api\/overlay\/([A-Za-z0-9_-]{43})$/);
      if (overlayMatch && req.method === 'GET') {
        const p = store.state.profiles.find(x => equal(x.overlayKey, overlayMatch[1]));
        if (!p) return json(res, 404, { status: 'invalid', track: null });
        return json(res, 200, { ...playbackView(p, await spotify.playback(p)), appVersion: APP_VERSION, settings: p.settings, reveal: reveals.get(p.id) || null });
      }
      const coverMatch = path.match(/^\/api\/cover\/([A-Za-z0-9_-]{43})\/([a-f0-9]{16})$/);
      if (coverMatch && req.method === 'GET') {
        const p = store.state.profiles.find(x => equal(x.overlayKey, coverMatch[1]));
        if (!p) return json(res, 404, { error: 'Cover nicht verfügbar.' });
        const playback = await spotify.playback(p);
        if (!playback.track?.cover || coverHash(playback.track.cover) !== coverMatch[2]) return json(res, 404, { error: 'Cover nicht verfügbar.' });
        try {
          const image = await covers.get(playback.track.cover);
          res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.data.length }); return res.end(image.data);
        } catch { return json(res, 502, { error: 'Cover derzeit nicht verfügbar.' }); }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 404, { error: 'Nicht gefunden.' });
      const overlayPage = path.match(/^\/overlay\/([A-Za-z0-9_-]{43})$/);
      if (overlayPage && !store.state.profiles.some(x => equal(x.overlayKey, overlayPage[1]))) return json(res, 404, { error: 'Overlay-Link ist ungültig.' });
      const file = overlayPage ? ['overlay.html', 'text/html'] : staticFiles[path];
      if (!file) return json(res, 404, { error: 'Nicht gefunden.' });
      const data = await readFile(join(root, 'public', file[0]));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Lokaler Fehler. Anwendung neu starten; gespeicherte Daten bleiben erhalten.' });
      else res.end();
    }
  });
  server.requestTimeout = 20000; server.headersTimeout = 15000;
  return { server, store, spotify, updates, get origin() { return origin; },
    async start() {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
      origin = `http://127.0.0.1:${server.address().port}`; return origin;
    },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.ISLAND_PORT || 17653);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('ISLAND_PORT muss zwischen 1024 und 65535 liegen.'); process.exit(1); }
  try {
    const trayMode = process.argv.includes('--tray');
    const app = createApp({ port, updateOptions: { canInstall: process.platform === 'win32' && trayMode, onReady: token => process.stdout.write(`ISLAND_UPDATE_READY:${token}\n`) } }); const url = await app.start();
    console.log(`\nIsland Now ${APP_VERSION}\n${url}\n\n${trayMode ? 'Die Anwendung läuft im Windows-Tray.' : 'Dieses Fenster offen lassen, solange OBS das Widget verwendet.\nBeenden mit Strg+C.'}\n`);
    if (process.argv.includes('--open')) openBrowser(url);
    let stopping = false;
    const stop = () => { if (stopping) return; stopping = true; app.server.close(); app.server.closeAllConnections(); process.exit(0); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
    if (trayMode) {
      const input = createInterface({ input: process.stdin, terminal: false });
      input.on('line', line => { if (line.trim() === 'shutdown') stop(); }); input.on('close', stop);
    }
  } catch (e) { console.error(e.code === 'EADDRINUSE' ? `Port ${port} ist belegt. Falls Island Now bereits läuft, http://127.0.0.1:${port} öffnen. Sonst die andere Anwendung schließen.` : e.message); process.exitCode = 1; }
}
