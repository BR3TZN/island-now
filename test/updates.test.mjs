import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UpdateService, isNewer } from '../lib/updates.mjs';
import { writeZip, readZip, sha256, validatePackage, safePayloadPath } from '../lib/archive.mjs';
import { createApp } from '../server.mjs';
import { createStore } from '../lib/store.mjs';

function packageFor(version = '1.3.0', alter = () => {}) {
  const files = new Map(Object.entries({
    'package.json': JSON.stringify({ name: 'island-now', version }),
    'server.mjs': '// new application', 'public/index.html': '<!doctype html><title>New</title>',
    'windows/Tray.cs': '// tray source', 'windows/Install-Update.ps1': '# installer',
    'Island-Now.exe': 'MZ test fixture; never executed',
  }).map(([name, data]) => [name, Buffer.from(data)]));
  const manifest = { schema: 1, app: 'island-now', version, platform: 'windows', files: [...files].map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) })) };
  alter(files, manifest);
  files.set('update-manifest.json', Buffer.from(JSON.stringify(manifest)));
  return writeZip(files);
}
function fixture(t, transform = x => x) {
  const root = mkdtempSync(join(tmpdir(), 'island-update-'));
  mkdirSync(join(root, 'windows')); mkdirSync(join(root, '.data'));
  writeFileSync(join(root, 'windows', 'Install-Update.ps1'), '# trusted existing updater');
  writeFileSync(join(root, '.data', 'private-marker'), 'PRIVATE-SHOULD-STAY'); writeFileSync(join(root, 'server.mjs'), '// old application');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = packageFor(), name = 'Island-Now-1.3.0-windows.zip';
  let requests = 0, ready = null;
  const release = transform({ tag_name: 'v1.3.0', draft: false, prerelease: false, body: 'New features', assets: [{ name, state: 'uploaded', size: bytes.length, digest: `sha256:${sha256(bytes)}`, browser_download_url: `https://github.com/BR3TZN/island-now/releases/download/v1.3.0/${name}` }] });
  const manager = new UpdateService({ root, version: '1.2.0', canInstall: true, onReady: token => ready = token, fetchFn: async url => {
    requests++;
    if (url.endsWith('/releases/latest')) return Response.json(release);
    return new Response(bytes, { headers: { 'Content-Length': String(bytes.length) } });
  } });
  return { root, manager, bytes, get requests() { return requests; }, get ready() { return ready; } };
}

test('Stable version ordering rejects downgrades, prereleases and malformed versions', () => {
  assert.equal(isNewer('1.10.0', '1.9.9'), true); assert.equal(isNewer('2.0.0', '1.99.99'), true);
  for (const version of ['1.2.0', '1.1.9', '1.3.0-beta', '../../2.0.0', '99999999999.0.0']) assert.equal(isNewer(version, '1.2.0'), false);
});
test('Release package roundtrip checks every file and rejects wrong application versions', () => {
  const bytes = packageFor(); assert.equal(validatePackage(bytes, '1.3.0').manifest.version, '1.3.0');
  assert.equal(readZip(bytes).get('server.mjs').toString(), '// new application');
  assert.throws(() => validatePackage(bytes, '1.4.0'));
  assert.throws(() => validatePackage(packageFor('1.3.0', (files, manifest) => manifest.files[0].sha256 = '0'.repeat(64)), '1.3.0'));
});
test('ZIP validation rejects traversal, private data, device names, case collisions and corruption', () => {
  for (const path of ['../server.mjs', '.data/state.enc', 'public/../x', '/public/x', 'public/CON.txt', 'public/a:stream', 'public/a\\b', 'public/name.']) assert.throws(() => safePayloadPath(path));
  assert.throws(() => readZip(writeZip(new Map([['public/a.txt', Buffer.from('a')], ['public/A.txt', Buffer.from('b')]]))));
  const bytes = packageFor(); const modified = Buffer.from(bytes); modified[60] ^= 0xff; assert.throws(() => readZip(modified));
  const replaced = Buffer.from(bytes.toString('latin1').replaceAll('public/index.html', '.data/secret.json'), 'latin1'); assert.throws(() => readZip(replaced));
});
test('Installer stages a verified release while private data and active application remain unchanged', async t => {
  const f = fixture(t); const checked = await f.manager.check(); assert.equal(checked.status, 'available');
  assert.equal(f.manager.beginInstall('1.3.0').status, 'downloading');
  assert.throws(() => f.manager.beginInstall('1.3.0'));
  await f.manager.job; assert.equal(f.manager.snapshot.status, 'staged'); assert.match(f.ready, /^[a-f0-9]{32}$/);
  const stage = join(f.root, '.updates', 'pending', f.ready);
  const plan = JSON.parse(readFileSync(join(stage, 'plan.json'), 'utf8'));
  assert.equal(plan.version, '1.3.0'); assert.ok(plan.files.every(f => !f.path.includes('.data')));
  assert.equal(readFileSync(join(f.root, '.data', 'private-marker'), 'utf8'), 'PRIVATE-SHOULD-STAY');
  assert.equal(readFileSync(join(f.root, 'server.mjs'), 'utf8'), '// old application');
  assert.equal(readFileSync(join(stage, 'Install-Update.ps1'), 'utf8'), '# trusted existing updater');
  assert.equal(readFileSync(join(stage, 'payload', 'server.mjs'), 'utf8'), '// new application');
});
test('Download checksum failure never stages or replaces application files', async t => {
  const f = fixture(t, release => ({ ...release, assets: release.assets.map(a => ({ ...a, digest: 'sha256:' + '0'.repeat(64) })) }));
  await f.manager.check(); f.manager.beginInstall('1.3.0'); await f.manager.job;
  assert.equal(f.manager.snapshot.status, 'error'); assert.equal(f.ready, null); assert.equal(existsSync(join(f.root, '.updates')), false);
  assert.equal(readFileSync(join(f.root, 'server.mjs'), 'utf8'), '// old application');
});
test('Untrusted download URLs, draft releases and absent digests cannot be installed', async t => {
  for (const change of [r => ({ ...r, draft: true }), r => ({ ...r, prerelease: true }), r => ({ ...r, assets: r.assets.map(a => ({ ...a, browser_download_url: 'https://evil.example/app.zip' })) }), r => ({ ...r, assets: r.assets.map(a => ({ ...a, digest: null })) })]) {
    const f = fixture(t, change); assert.equal((await f.manager.check()).status, 'error'); assert.throws(() => f.manager.beginInstall('1.3.0')); assert.equal(f.ready, null);
  }
});
test('Missing GitHub release and unsupported startup mode are reported without installation', async t => {
  const f = fixture(t); f.manager.fetch = async () => new Response('', { status: 404 });
  assert.equal((await f.manager.check()).status, 'unpublished');
  const noTray = fixture(t); noTray.manager.canInstall = false; await noTray.manager.check(); assert.throws(() => noTray.manager.beginInstall('1.3.0'));
});
test('Update endpoints require same-origin CSRF protection before network access or installation', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'island-api-update-')); let calls = 0;
  const app = createApp({ store: createStore(dir), port: 0, updateOptions: { fetchFn: async () => { calls++; return new Response('', { status: 404 }); } } });
  const origin = await app.start(); t.after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });
  const bad = await fetch(`${origin}/api/updates/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(bad.status, 403); assert.equal(calls, 0);
  const state = await (await fetch(`${origin}/api/state`)).json();
  const good = await fetch(`${origin}/api/updates/check`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Island-CSRF': state.csrf }, body: '{}' });
  assert.equal(good.status, 200); assert.equal((await good.json()).status, 'unpublished'); assert.equal(calls, 1);
});
