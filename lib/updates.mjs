import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sha256, validatePackage } from './archive.mjs';
import { APP_VERSION, UPDATE_REPOSITORY } from './version.mjs';

const versionParts = value => /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})$/.test(value || '') ? value.split('.').map(Number) : null;
export function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current); if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false;
}
export class UpdateService {
  constructor({ root, fetchFn = fetch, version = APP_VERSION, repository = UPDATE_REPOSITORY, canInstall = false, onReady = () => {} }) {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Ungültiges Update-Repository.');
    Object.assign(this, { root, fetch: fetchFn, version, repository, canInstall, onReady });
    this.state = { status: 'idle', currentVersion: version, latestVersion: null, canInstall, repositoryUrl: `https://github.com/${repository}`, message: 'Noch nicht nach Updates gesucht.', checkedAt: null };
  }
  get snapshot() { return { ...this.state }; }
  set(status, message, more = {}) { Object.assign(this.state, { status, message, ...more }); return this.snapshot; }
  async request(url, limit = 1024 * 1024, progress) {
    const response = await this.fetch(url, { headers: { Accept: url.includes('/releases/latest') ? 'application/vnd.github+json' : 'application/octet-stream', 'User-Agent': `Island-Now/${this.version}` }, signal: AbortSignal.timeout(url.includes('/releases/latest') ? 12000 : 120000) });
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error('GitHub ist vorübergehend nicht erreichbar.'), { httpStatus: response.status }); }
    const expected = Number(response.headers.get('Content-Length')) || 0;
    if (expected > limit) { await response.body?.cancel(); throw new Error('Das Release-Paket überschreitet die zulässige Größe.'); }
    let count = 0; const chunks = [];
    for await (const chunk of response.body) { count += chunk.length; if (count > limit) throw new Error('Download ist zu groß.'); chunks.push(chunk); progress?.(count, expected); }
    return Buffer.concat(chunks);
  }
  trustedAsset(value, tag, name) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash
        && url.pathname === `/${this.repository}/releases/download/${tag}/${name}` ? url.href : null;
    } catch { return null; }
  }
  async check() {
    if (this.job || this.checking) return this.checking || this.snapshot;
    this.set('checking', 'GitHub-Releases werden geprüft …');
    this.checking = (async () => {
      try {
        const data = JSON.parse((await this.request(`https://api.github.com/repos/${this.repository}/releases/latest`)).toString());
        const latest = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/, '') : '';
        if (!versionParts(latest) || data.draft || data.prerelease) throw new Error('GitHub hat kein gültiges stabiles Release geliefert.');
        this.state.checkedAt = Date.now(); this.state.latestVersion = latest;
        if (!isNewer(latest, this.version)) { this.release = null; return this.set('current', 'Du verwendest die aktuelle Version.'); }
        const name = `Island-Now-${latest}-windows.zip`;
        const asset = data.assets?.find(a => a.name === name && a.state === 'uploaded');
        const url = asset && this.trustedAsset(asset.browser_download_url, data.tag_name, name);
        if (!url || !Number.isFinite(asset.size) || asset.size <= 0 || asset.size > 40 * 1024 * 1024) throw new Error('Im Release fehlt ein passendes Windows-Update-Paket.');
        const sidecar = data.assets.find(a => a.name === `${name}.sha256`);
        const checksumUrl = sidecar && this.trustedAsset(sidecar.browser_download_url, data.tag_name, sidecar.name);
        const digest = /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest.slice(7).toLowerCase() : null;
        if (!digest && !checksumUrl) throw new Error('Das Release enthält keine überprüfbare SHA-256-Prüfsumme.');
        this.release = { version: latest, name, url, size: asset.size, digest, checksumUrl };
        return this.set('available', `Version ${latest} ist verfügbar.`, { releaseUrl: `https://github.com/${this.repository}/releases/tag/${data.tag_name}`, notes: typeof data.body === 'string' ? data.body.slice(0, 6000) : '' });
      } catch (error) {
        this.release = null; this.state.checkedAt = Date.now();
        return this.set(error.httpStatus === 404 ? 'unpublished' : 'error', error.httpStatus === 404 ? 'Noch kein öffentliches Release verfügbar.' : error.message || 'Updates konnten nicht geprüft werden.');
      } finally { this.checking = null; }
    })();
    return this.checking;
  }
  beginInstall(version) {
    if (!this.canInstall) throw new Error('Die automatische Installation benötigt den Windows-Tray-Start.');
    if (this.job) throw new Error('Ein Update wird bereits vorbereitet.');
    if (this.state.status !== 'available' || !this.release || version !== this.release.version || !isNewer(version, this.version)) throw new Error('Zuerst erneut nach Updates suchen.');
    const release = { ...this.release };
    this.set('downloading', 'Update wird heruntergeladen …', { progress: 0 });
    this.job = this.stage(release).catch(error => this.set('error', error.message || 'Update konnte nicht vorbereitet werden.')).finally(() => { this.job = null; });
    return this.snapshot;
  }
  async stage(release) {
    const bytes = await this.request(release.url, 40 * 1024 * 1024, (done, total) => this.state.progress = total ? Math.round(done / total * 100) : null);
    let digest = release.digest;
    if (!digest) {
      const fields = (await this.request(release.checksumUrl, 2048)).toString().trim().split(/\s+/);
      if (fields.length !== 2 || !/^[a-f0-9]{64}$/i.test(fields[0]) || fields[1].replace(/^\*/, '') !== release.name) throw new Error('Ungültige Release-Prüfsumme.');
      digest = fields[0].toLowerCase();
    }
    if (bytes.length !== release.size || sha256(bytes) !== digest) throw new Error('Download-Prüfsumme stimmt nicht überein. Die Installation wurde gestoppt.');
    this.set('verifying', 'Paket und einzelne Dateien werden geprüft …');
    const { files, manifest } = validatePackage(bytes, release.version, true);
    const token = randomBytes(16).toString('hex'), stage = join(this.root, '.updates', 'pending', token), payload = join(stage, 'payload');
    mkdirSync(payload, { recursive: true, mode: 0o700 });
    for (const [path, data] of files) { const destination = join(payload, ...path.split('/')); mkdirSync(join(destination, '..'), { recursive: true }); writeFileSync(destination, data, { mode: path.endsWith('.sh') ? 0o700 : 0o600 }); }
    copyFileSync(join(this.root, 'windows', 'Install-Update.ps1'), join(stage, 'Install-Update.ps1'));
    const plan = { schema: 1, token, root: this.root, version: release.version, previousVersion: this.version, files: manifest.files };
    writeFileSync(join(stage, 'plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
    this.set('staged', 'Update geprüft. Die Anwendung wird neu gestartet …', { progress: 100 });
    await this.onReady(token);
    return this.snapshot;
  }
}
