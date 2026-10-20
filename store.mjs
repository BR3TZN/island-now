import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function createStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const keyFile = join(directory, 'vault.key');
  const stateFile = join(directory, 'state.enc');
  if (!existsSync(keyFile)) {
    if (existsSync(stateFile)) throw new Error('Der Schlüssel zur gespeicherten Anmeldung fehlt. Datenordner aus deinem Backup wiederherstellen.');
    writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  }
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error('Der lokale Datenschlüssel ist beschädigt.');
  let state = { version: 1, profiles: [] };
  if (existsSync(stateFile)) {
    try {
      const data = readFileSync(stateFile);
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      state = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
      if (state.version !== 1 || !Array.isArray(state.profiles)) throw new Error('Invalid schema');
    } catch { throw new Error('Gespeicherte Daten lassen sich nicht lesen. Der Datenordner wird nicht überschrieben.'); }
  }
  return {
    state,
    save() {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
      const tmp = join(directory, `state-${randomBytes(6).toString('hex')}.tmp`);
      writeFileSync(tmp, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
      renameSync(tmp, stateFile);
      try { chmodSync(stateFile, 0o600); } catch { /* Windows ACLs apply on Windows. */ }
    },
  };
}
