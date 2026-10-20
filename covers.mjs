import { coverLink } from './model.mjs';

export class CoverCache {
  constructor(fetchFn = fetch) { this.fetch = fetchFn; this.cache = new Map(); this.pending = new Map(); }
  async get(url) {
    if (!coverLink(url)) throw new Error('Unsupported cover URL');
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now()) return cached;
    if (this.pending.has(url)) return this.pending.get(url);
    const task = (async () => {
      const response = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      const type = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) { await response.body?.cancel(); throw new Error('Invalid cover response'); }
      const limit = 4 * 1024 * 1024;
      if (Number(response.headers.get('Content-Length')) > limit) { await response.body?.cancel(); throw new Error('Cover too large'); }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw new Error('Cover too large');
        chunks.push(chunk);
      }
      if (!size) throw new Error('Empty cover');
      const result = { data: Buffer.concat(chunks), type, expires: Date.now() + 15 * 60 * 1000 };
      this.cache.delete(url); this.cache.set(url, result);
      while (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value);
      return result;
    })().finally(() => this.pending.delete(url));
    this.pending.set(url, task); return task;
  }
}
