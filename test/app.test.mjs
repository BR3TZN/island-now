import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { WidgetState } from '../public/widget-state.mjs';
import { dominantAccent, readableAccent } from '../public/cover-colors.mjs';
import { CoverCache } from '../lib/covers.mjs';
import { settingsFrom } from '../lib/model.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const clientId = 'a'.repeat(32);
const rawTrack = { is_playing: true, progress_ms: 45000, item: { id: 'song-a', type: 'track', name: '<script>Never execute</script>', artists: [{ name: 'Artist A' }], duration_ms: 200000, album: { name: 'Album A', images: [{ width: 640, url: 'https://i.scdn.co/image/demo' }] }, external_urls: { spotify: 'https://open.spotify.com/track/song-a' } } };
const response = (data, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function fixture(t, fetchFn, clock) {
  const directory = mkdtempSync(join(tmpdir(), 'island-test-'));
  const store = createStore(directory); const app = createApp({ store, port: 0, fetchFn, ...(clock ? { now: clock } : {}) });
  const origin = await app.start();
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const state = await (await fetch(`${origin}/api/state`)).json();
  const call = (path, method = 'GET', data) => fetch(`${origin}${path}`, { method, headers: method === 'GET' ? {} : { Origin: origin, 'Content-Type': 'application/json', 'X-Island-CSRF': state.csrf }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}), redirect: 'manual' });
  return { app, store, origin, state, call, directory, profile: store.state.profiles[0] };
}
function connectProfile(p, now = Date.now()) { Object.assign(p, { clientId, accessToken: 'ACCESS-SECRET', refreshToken: 'REFRESH-SECRET', expiresAt: now + 3600000, connectedAt: now }); }

test('OAuth PKCE: browser-bound callback, one-time state, no tokens in UI or OBS URL', async t => {
  let tokenForm;
  const f = await fixture(t, async (url, options) => { assert.equal(url, 'https://accounts.spotify.com/api/token'); tokenForm = options.body; return response({ access_token: 'ACCESS-SECRET', refresh_token: 'REFRESH-SECRET', expires_in: 3600 }); });
  assert.equal((await f.call(`/api/profiles/${f.profile.id}`, 'PATCH', { clientId })).status, 200);
  const start = await f.call(`/api/profiles/${f.profile.id}/connect`, 'POST', {});
  assert.equal(start.status, 200); const auth = new URL((await start.json()).url);
  assert.equal(auth.origin, 'https://accounts.spotify.com');
  assert.equal(auth.searchParams.get('scope'), 'user-read-currently-playing');
  assert.equal(auth.searchParams.get('redirect_uri'), `${f.origin}/auth/callback`);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.has('client_secret'), false);
  const state = auth.searchParams.get('state'), cookie = start.headers.get('set-cookie').split(';')[0];
  const noCookie = await f.call(`/auth/callback?state=${state}&code=code`);
  assert.equal(noCookie.headers.get('location'), '/?error=oauth_state'); assert.equal(tokenForm, undefined);
  const finish = await fetch(`${f.origin}/auth/callback?state=${state}&code=code`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(finish.status, 303); assert.equal(finish.headers.get('location'), `/?connected=${f.profile.id}`);
  assert.equal(createHash('sha256').update(tokenForm.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.equal(tokenForm.has('client_secret'), false);
  const replay = await fetch(`${f.origin}/auth/callback?state=${state}&code=code`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(replay.headers.get('location'), '/?error=oauth_state');
  const exposed = await (await f.call('/api/state')).text();
  assert.equal(exposed.includes('ACCESS-SECRET'), false); assert.equal(exposed.includes('REFRESH-SECRET'), false);
  assert.equal(f.profile.refreshToken, 'REFRESH-SECRET');
  assert.equal(readFileSync(join(f.directory, 'state.enc')).includes(Buffer.from('REFRESH-SECRET')), false);
  assert.equal(createStore(f.directory).state.profiles[0].refreshToken, 'REFRESH-SECRET');
});

test('Untrusted write requests and Host rebinding are rejected', async t => {
  const f = await fixture(t, async () => { throw new Error('Unexpected network'); });
  let res = await fetch(`${f.origin}/api/profiles`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json', 'X-Island-CSRF': f.state.csrf }, body: '{}' });
  assert.equal(res.status, 403);
  res = await fetch(`${f.origin}/api/profiles`, { method: 'POST', headers: { Origin: f.origin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const r = http.get(`${f.origin}/api/state`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }); r.on('error', reject); });
  assert.equal(hostStatus, 403);
  res = await fetch(`${f.origin}/api/state`, { headers: { Origin: 'https://evil.example' } }); assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('OBS output is read-only, never contains credentials, settings persist, rotated links stop working', async t => {
  const f = await fixture(t, async () => response(rawTrack)); connectProfile(f.profile);
  const oldKey = f.profile.overlayKey;
  const patch = await f.call(`/api/profiles/${f.profile.id}`, 'PATCH', { settings: { theme: 'studio', accent: '#08f700', width: 9999, hidePaused: false, mode: 'always', displaySeconds: 0 } });
  assert.equal(patch.status, 200);
  const data = await (await f.call(`/api/overlay/${oldKey}`)).json();
  assert.equal(data.track.title, rawTrack.item.name); assert.equal(data.settings.width, 720); assert.equal(data.settings.displaySeconds, 5);
  assert.equal(data.settings.accent, '#08f700'); assert.equal(data.status, 'playing');
  assert.equal(JSON.stringify(data).includes('SECRET'), false); assert.equal(data.clientId, undefined); assert.equal(data.profileId, undefined);
  assert.equal(createStore(f.directory).state.profiles[0].settings.theme, 'studio');
  const rotate = await f.call(`/api/profiles/${f.profile.id}/rotate`, 'POST', {}); assert.equal(rotate.status, 200);
  assert.notEqual(f.profile.overlayKey, oldKey); assert.equal((await f.call(`/api/overlay/${oldKey}`)).status, 404);
  assert.equal((await f.call(`/overlay/${oldKey}`)).status, 404);
});

test('Refresh is deduplicated, accepts rotation, and retains refresh token if not returned', async t => {
  let refreshes = 0, plays = 0; let now = 1700000000000;
  const f = await fixture(t, async (url, options) => {
    if (url.includes('/api/token')) { refreshes++; assert.equal(options.body.get('client_id'), clientId); return response({ access_token: `NEW-${refreshes}`, expires_in: 3600, ...(refreshes === 1 ? { refresh_token: 'ROTATED' } : {}) }); }
    plays++; return response(rawTrack);
  }, () => now);
  connectProfile(f.profile, now); f.profile.expiresAt = now - 1;
  const results = await Promise.all(Array.from({ length: 8 }, () => f.app.spotify.playback(f.profile)));
  assert.equal(refreshes, 1); assert.equal(plays, 1); assert.ok(results.every(r => r.status === 'playing'));
  assert.equal(f.profile.refreshToken, 'ROTATED');
  now += 3600001; await f.app.spotify.playback(f.profile); assert.equal(refreshes, 2); assert.equal(f.profile.refreshToken, 'ROTATED');
});

test('401 refreshes and retries only once; revoked refresh token ends session', async t => {
  let calls = 0, refreshes = 0;
  const f = await fixture(t, async url => { if (url.includes('/api/token')) { refreshes++; return response({ access_token: 'NEW', expires_in: 3600 }); } calls++; return calls === 1 ? response({}, 401) : response(rawTrack); });
  connectProfile(f.profile); const result = await f.app.spotify.playback(f.profile);
  assert.equal(result.status, 'playing'); assert.equal(refreshes, 1); assert.equal(calls, 2);
  const g = await fixture(t, async url => url.includes('/api/token') ? response({ error: 'invalid_grant' }, 400) : response({}, 401)); connectProfile(g.profile); g.profile.expiresAt = 0;
  await g.app.spotify.playback(g.profile); assert.equal(g.profile.refreshToken, undefined); assert.equal(g.profile.accessToken, undefined);
  assert.equal((await g.app.spotify.playback(g.profile)).status, 'disconnected');
});

test('429 Retry-After blocks all profiles sharing a client ID; requests resume after backoff', async t => {
  let now = 1700000000000, requests = 0;
  const f = await fixture(t, async () => { requests++; return requests === 1 ? response({}, 429, { 'Retry-After': '25' }) : response(rawTrack); }, () => now);
  connectProfile(f.profile, now);
  const second = { ...f.profile, id: 'second', authVersion: 'second' }; f.store.state.profiles.push(second);
  const first = await f.app.spotify.playback(f.profile); assert.equal(first.code, 'rate_limited'); assert.equal(first.retryAt, now + 25000);
  await f.app.spotify.playback(second); await f.app.spotify.playback(f.profile); assert.equal(requests, 1);
  now += 25001; assert.equal((await f.app.spotify.playback(f.profile)).status, 'playing'); assert.equal(requests, 2);
});

test('204, ads, unavailable playback and unsupported types produce transparent output; 403 is actionable', async t => {
  for (const reply of [() => response(null, 204), () => response({ item: null, currently_playing_type: 'ad' }), () => response({ item: { type: 'unknown' } })]) {
    const f = await fixture(t, async () => reply()); connectProfile(f.profile);
    const result = await f.app.spotify.playback(f.profile); assert.equal(result.status, 'idle'); assert.equal(result.track, null);
  }
  const f = await fixture(t, async () => response({}, 403)); connectProfile(f.profile);
  const result = await f.app.spotify.playback(f.profile); assert.equal(result.code, 'forbidden'); assert.match(result.message, /Nutzerfreigabe/); assert.equal(result.track, null);
});

test('Disconnect during refresh cannot silently restore the login', async t => {
  let finish, started;
  const requested = new Promise(resolve => started = resolve);
  const f = await fixture(t, async url => {
    if (url.includes('/api/token')) { started(); return new Promise(resolve => finish = () => resolve(response({ access_token: 'LATE', refresh_token: 'LATE-REFRESH', expires_in: 3600 }))); }
    throw new Error('Playback should not be fetched');
  });
  connectProfile(f.profile); f.profile.expiresAt = 0;
  const work = f.app.spotify.playback(f.profile); await requested;
  assert.equal((await f.call(`/api/profiles/${f.profile.id}/disconnect`, 'POST', {})).status, 200);
  finish(); await work; assert.equal(f.profile.refreshToken, undefined); assert.equal(f.profile.accessToken, undefined);
});

test('Podcast and local-file metadata are normalized without unsafe URLs', async t => {
  const f = await fixture(t, async () => response({ is_playing: false, progress_ms: 50, item: { type: 'episode', id: 'ep', name: 'Episode 01', duration_ms: 900000, show: { name: 'Podcast A' }, images: [{ url: 'javascript:alert(1)' }], external_urls: { spotify: 'https://evil.example' } } }));
  connectProfile(f.profile); const result = await f.app.spotify.playback(f.profile);
  assert.equal(result.status, 'paused'); assert.equal(result.track.artist, 'Podcast A'); assert.equal(result.track.cover, ''); assert.equal(result.track.url, '');
});

test('Widget visibility: song changes, pauses, resume, manual reveal, stale data, progress', () => {
  const state = new WidgetState(); const now = 100000;
  const base = { status: 'playing', receivedAt: now, settings: { mode: 'change', displaySeconds: 15, hidePaused: true }, track: { id: 'one', duration: 180000, progress: 30000, isPlaying: true } };
  state.update(base, now); assert.equal(state.frame(now).visible, true); assert.equal(state.frame(now + 5000).progress, 35000);
  state.update({ ...base, receivedAt: now + 14000 }, now + 14000); assert.equal(state.frame(now + 15000).visible, false);
  state.update({ ...base, track: { ...base.track, id: 'two' }, receivedAt: now + 16000 }, now + 16000); assert.equal(state.frame(now + 16001).visible, true);
  state.update({ ...base, status: 'paused', track: { ...base.track, isPlaying: false }, receivedAt: now + 17000 }, now + 17000); assert.equal(state.frame(now + 17000).visible, false); assert.equal(state.frame(now + 17500).progress, 30000);
  state.update({ ...base, receivedAt: now + 18000 }, now + 18000); assert.equal(state.frame(now + 18000).visible, true);
  state.update({ ...base, receivedAt: now + 40000, reveal: 'reveal1' }, now + 40000); assert.equal(state.frame(now + 40000).visible, true);
  assert.equal(state.frame(now + 61000).visible, false);
  state.update({ ...base, settings: { mode: 'always', hidePaused: false }, status: 'paused', track: { ...base.track, isPlaying: false } }, now + 62000); assert.equal(state.frame(now + 62000).visible, true);
  state.update({ status: 'error', track: null }, now + 63000); assert.equal(state.frame(now + 63000).visible, false);
});

test('Static assets resolve; no external JS and no broken DOM references in controls', async t => {
  const f = await fixture(t, async () => response(null, 204));
  const html = await (await f.call('/')).text();
  assert.match(html, /Dein Sound/); assert.match(html, /viewport/); assert.match(html, /aria-live/);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const js = await (await f.call('/app.js')).text();
  for (const m of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(m[1]), `Missing element ${m[1]}`);
  for (const path of ['/app.js', '/styles.css', '/widget.js', '/widget-state.mjs', '/themes.mjs', '/cover-colors.mjs', '/widget.css', '/overlay.html', '/demo-cover.svg', '/favicon.svg', '/help.html']) assert.equal((await f.call(path)).status, 200, path);
  assert.equal(/<script[^>]+src="https?:/i.test(html), false);
  const overlay = await (await f.call('/overlay.html')).text();
  const overlayIds = new Set([...overlay.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const widget = await (await f.call('/widget.js')).text();
  for (const m of widget.matchAll(/\$\('([^']+)'\)/g)) assert.ok(overlayIds.has(m[1]), `Missing widget element ${m[1]}`);
  assert.equal(/\.innerHTML\s*=/.test(js + widget), false);
});

test('All five themes, cover colors and animation settings survive persistence', async t => {
  const f = await fixture(t, async () => response(null, 204));
  for (const theme of ['island', 'studio', 'compact', 'cyberpunk', 'forza']) {
    const result = await (await f.call(`/api/profiles/${f.profile.id}`, 'PATCH', { settings: { theme, accentMode: 'cover', motion: 'top', motionDuration: 950, trackTransition: 'slide' } })).json();
    assert.equal(result.settings.theme, theme); assert.equal(result.settings.accentMode, 'cover');
    const restored = createStore(f.directory).state.profiles[0].settings;
    assert.equal(restored.theme, theme); assert.equal(restored.motion, 'top'); assert.equal(restored.motionDuration, 950); assert.equal(restored.trackTransition, 'slide');
  }
  const safe = settingsFrom({ theme: 'unknown', motion: 'url(evil)', motionDuration: 999999, trackTransition: 'bad', accentMode: 'bad' }, f.profile.settings);
  assert.equal(safe.theme, 'forza'); assert.equal(safe.motion, 'top'); assert.equal(safe.trackTransition, 'slide'); assert.equal(safe.accentMode, 'cover'); assert.equal(safe.motionDuration, 1500);
});

test('Cover colors favor dominant colored areas, keep contrast and provide fallback', () => {
  const bytes = [];
  for (let i = 0; i < 100; i++) bytes.push(...(i < 65 ? [25, 80, 200, 255] : i < 90 ? [5, 5, 5, 255] : [255, 255, 255, 255]));
  const chosen = dominantAccent({ data: Uint8ClampedArray.from(bytes) });
  const rgb = [1, 3, 5].map(i => parseInt(chosen.slice(i, i + 2), 16)); assert.ok(rgb[2] > rgb[0] + 50);
  const lum = rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  assert.ok((lum + .05) / .058 >= 4.45);
  assert.equal(dominantAccent({ data: [0, 0, 0, 0] }, '#40d9cf'), '#40d9cf');
  assert.match(readableAccent([15, 40, 70], .173, 3), /^#[0-9a-f]{6}$/);
});

test('Same-origin cover endpoint only serves current known cover, deduplicates and expires old links', async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOZkAAAAASUVORK5CYII=', 'base64');
  let covers = 0;
  const f = await fixture(t, async (url, options) => {
    if (url === 'https://i.scdn.co/image/demo') { covers++; assert.equal(options.redirect, 'error'); return new Response(png, { headers: { 'Content-Type': 'image/png' } }); }
    return response(rawTrack);
  });
  connectProfile(f.profile);
  const data = await (await f.call(`/api/overlay/${f.profile.overlayKey}`)).json();
  assert.match(data.track.cover, /^\/api\/cover\//);
  const images = await Promise.all([f.call(data.track.cover), f.call(data.track.cover)]);
  assert.ok(images.every(r => r.status === 200 && r.headers.get('content-type') === 'image/png'));
  assert.equal(Buffer.compare(Buffer.from(await images[0].arrayBuffer()), png), 0); assert.equal(covers, 1);
  assert.equal((await f.call(data.track.cover.replace(/[^/]+$/, '0'.repeat(16)))).status, 404); assert.equal(covers, 1);
  await f.call(`/api/profiles/${f.profile.id}/rotate`, 'POST', {}); assert.equal((await f.call(data.track.cover)).status, 404);
});

test('Cover fetching rejects arbitrary URLs, redirects, non-images and oversized bodies', async () => {
  let fetched = false;
  const forbidden = new CoverCache(async () => { fetched = true; });
  await assert.rejects(forbidden.get('http://127.0.0.1/private')); assert.equal(fetched, false);
  const html = new CoverCache(async () => new Response('html', { headers: { 'Content-Type': 'text/html' } }));
  await assert.rejects(html.get('https://i.scdn.co/image/a'));
  const large = new CoverCache(async () => new Response('large', { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(5 * 1024 * 1024) } }));
  await assert.rejects(large.get('https://i.scdn.co/image/a'));
});

test('Tray backend exits cleanly on shutdown command and on launcher pipe closing', { timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'island-tray-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const command of ['shutdown\n', '']) {
    const reserve = http.createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port;
    await new Promise(resolve => reserve.close(resolve));
    const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url)), '--tray'], { env: { ...process.env, ISLAND_PORT: String(port), ISLAND_DATA_DIR: directory }, stdio: ['pipe', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = ''; child.stdout.on('data', chunk => output += chunk);
    for (let i = 0; i < 60 && !output.includes('Windows-Tray'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.match(output, /Windows-Tray/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/state`)).status, 200);
    const exiting = once(child, 'exit'); child.stdin.end(command); const [code] = await exiting; assert.equal(code, 0);
  }
});
