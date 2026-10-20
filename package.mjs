import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, sha256, validatePackage } from '../lib/archive.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const windows = process.argv.includes('--windows');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Version muss x.y.z sein.');
if (windows && !existsSync(join(root, 'Island-Now.exe'))) throw new Error('Windows-EXE zuerst erstellen.');
const entries = new Map();
for (const name of ['server.mjs', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'START-WINDOWS.cmd', 'START-KONSOLE.cmd', 'START-MAC-LINUX.sh', ...(windows ? ['Island-Now.exe'] : [])]) {
  if (existsSync(join(root, name))) entries.set(name, readFileSync(join(root, name)));
}
function walk(folder) {
  for (const item of readdirSync(join(root, folder), { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const relative = `${folder}/${item.name}`;
    if (item.isDirectory()) walk(relative); else if (item.isFile()) entries.set(relative, readFileSync(join(root, relative)));
  }
}
for (const folder of ['lib', 'public', 'windows', 'scripts', 'docs', 'test']) walk(folder);
for (const [path, data] of entries) if (path.endsWith('.cmd')) entries.set(path, Buffer.from(data.toString().replace(/\r?\n/g, '\r\n')));
const manifest = { schema: 1, app: 'island-now', version: pkg.version, platform: windows ? 'windows' : 'source', files: [...entries].map(([path, data]) => ({ path, bytes: data.length, sha256: sha256(data) })) };
entries.set('update-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
const archive = writeZip(entries); validatePackage(archive, pkg.version, windows);
const output = join(root, 'dist'); mkdirSync(output, { recursive: true });
const name = `Island-Now-${pkg.version}-${windows ? 'windows' : 'source'}.zip`;
writeFileSync(join(output, name), archive); writeFileSync(join(output, `${name}.sha256`), `${sha256(archive)}  ${name}\n`);
console.log(join(output, name));
