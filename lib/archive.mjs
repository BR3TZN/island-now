import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
export function crc32(bytes) { let crc = 0xffffffff; for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function safePayloadPath(value) {
  if (typeof value !== 'string' || value.length > 220 || /[\\\x00-\x1f:]/.test(value)) throw new Error('Ungültiger Dateipfad im Update.');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || p.startsWith('.'))) throw new Error('Unsicherer Dateipfad im Update.');
  if (!['server.mjs', 'package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'START-WINDOWS.cmd', 'START-KONSOLE.cmd', 'START-MAC-LINUX.sh', 'Island-Now.exe', 'update-manifest.json'].includes(value)
      && !/^(lib|public|windows|docs|scripts|test)\//.test(value)) throw new Error('Das Update enthält eine nicht erlaubte Datei.');
  return value;
}
export function readZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > 40 * 1024 * 1024) throw new Error('Ungültige ZIP-Datei.');
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('ZIP-Format wird nicht unterstützt.');
  const count = buffer.readUInt16LE(end + 10), offset = buffer.readUInt32LE(end + 16), size = buffer.readUInt32LE(end + 12);
  if (!count || count > 512 || buffer.readUInt16LE(end + 8) !== count || offset + size !== end) throw new Error('ZIP-Inhaltsverzeichnis ist ungültig.');
  const result = new Map(), names = new Set(); let pos = offset, expanded = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error('ZIP-Eintrag beschädigt.');
    const flags = buffer.readUInt16LE(pos + 8), method = buffer.readUInt16LE(pos + 10), crc = buffer.readUInt32LE(pos + 16), compressed = buffer.readUInt32LE(pos + 20), length = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28), extraLength = buffer.readUInt16LE(pos + 30), commentLength = buffer.readUInt16LE(pos + 32), external = buffer.readUInt32LE(pos + 38), local = buffer.readUInt32LE(pos + 42);
    const next = pos + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || ![0, 8].includes(method) || length > 32 * 1024 * 1024 || (external >>> 16 & 0xf000) === 0xa000) throw new Error('Nicht unterstützter ZIP-Eintrag.');
    const nameBytes = buffer.subarray(pos + 46, pos + 46 + nameLength);
    const fullName = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); pos = next;
    if (!fullName.startsWith('Island-Now/')) throw new Error('Falscher Paketordner.');
    const relative = fullName.slice(11);
    if (!relative || relative.endsWith('/')) continue;
    const path = safePayloadPath(relative), folded = path.toLowerCase();
    if (names.has(folded)) throw new Error('Doppelter Dateiname im Update.'); names.add(folded);
    if (local + 30 > offset || buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP-Dateikopf beschädigt.');
    const localNameLength = buffer.readUInt16LE(local + 26), localExtra = buffer.readUInt16LE(local + 28), start = local + 30 + localNameLength + localExtra;
    if (start + compressed > offset || !nameBytes.equals(buffer.subarray(local + 30, local + 30 + localNameLength))) throw new Error('Widersprüchlicher ZIP-Dateikopf.');
    const packed = buffer.subarray(start, start + compressed);
    const bytes = method === 0 ? Buffer.from(packed) : inflateRawSync(packed, { maxOutputLength: 32 * 1024 * 1024 });
    expanded += bytes.length;
    if (bytes.length !== length || crc32(bytes) !== crc || expanded > 100 * 1024 * 1024) throw new Error('ZIP-Prüfung fehlgeschlagen.');
    result.set(path, bytes);
  }
  if (pos !== end) throw new Error('ZIP-Inhaltsverzeichnis beschädigt.');
  return result;
}
export function writeZip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [relative, bytes] of entries) {
    safePayloadPath(relative); const name = Buffer.from(`Island-Now/${relative}`), packed = deflateRawSync(bytes, { level: 9 }), crc = crc32(bytes);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(bytes.length, 22); h.writeUInt16LE(name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE((relative.endsWith('.sh') ? 0o100755 : 0o100644) << 16 >>> 0, 38); c.writeUInt32LE(offset, 42);
    local.push(h, name, packed); central.push(c, name); offset += h.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function validatePackage(bytes, version, requireWindows = true) {
  const files = readZip(bytes), manifest = JSON.parse(files.get('update-manifest.json')?.toString() || 'null');
  if (manifest?.schema !== 1 || manifest.app !== 'island-now' || manifest.version !== version || requireWindows && manifest.platform !== 'windows' || !Array.isArray(manifest.files) || manifest.files.length !== files.size - 1) throw new Error('Das Paket passt nicht zu dieser Version.');
  const listed = new Set();
  for (const item of manifest.files) {
    safePayloadPath(item.path); const data = files.get(item.path);
    if (listed.has(item.path) || !data || data.length !== item.bytes || sha256(data) !== item.sha256) throw new Error('Eine Paketdatei stimmt nicht mit der Prüfsumme überein.');
    listed.add(item.path);
  }
  const required = ['server.mjs', 'package.json', 'public/index.html', 'windows/Tray.cs', 'windows/Install-Update.ps1'];
  if (requireWindows) required.push('Island-Now.exe');
  if (required.some(p => !files.has(p))) throw new Error('Das Update ist unvollständig.');
  const pkg = JSON.parse(files.get('package.json').toString());
  if (pkg.name !== 'island-now' || pkg.version !== version) throw new Error('Paketversion widerspricht dem Release.');
  return { files, manifest };
}
