const TRACK_ID = /^[A-Za-z0-9]{22}$/;

export const DEFAULT_CHAT_MESSAGE = 'Songwunsch von @{user}: {titel} – {interpret} wurde zur Spotify-Warteschlange hinzugefügt.';
export const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max) : '';

export function parseSongRequest(input) {
  if (typeof input !== 'string' || input.length > 500) return null;
  const text = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return { id: uri[1] };
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|open\.spotify\.com\/|spotify:)/i.test(text)) {
    try {
      const url = new URL(/^open\.spotify\.com\//i.test(text) ? `https://${text}` : text);
      const match = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/i.exec(url.pathname);
      if (url.origin === 'https://open.spotify.com' && !url.username && !url.password && match) return { id: match[1] };
    } catch {}
    return null;
  }
  const parts = text.split(/\s+[-–—]\s+/u);
  if (parts.length < 2) {
    const query = cleanText(text, 500);
    return /[\p{L}\p{N}]/u.test(query) ? { query } : null;
  }
  const artist = cleanText(parts.pop(), 120), title = cleanText(parts.join(' - '), 180);
  return title && artist ? { title, artist } : null;
}

export function requestedTrack(track) {
  if (!track || !TRACK_ID.test(track.id || '') || track.is_local || track.is_playable === false || track.restrictions?.reason) return null;
  const title = cleanText(track.name, 180);
  const artists = Array.isArray(track.artists) ? track.artists.map(a => cleanText(a?.name, 100)).filter(Boolean) : [];
  if (!title || !artists.length) return null;
  return { title, artists, artist: cleanText(artists.join(', '), 160), uri: `spotify:track:${track.id}` };
}

const words = value => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/ß/g, 'ss').match(/[\p{L}\p{N}]+/gu) || [];
const normalized = value => words(value).join('');
const baseTitle = value => value.replace(/\s+(?:[-–—]\s+|\()(?:\d{4}\s+)?(?:remaster(?:ed)?|radio edit|single version)\b.*$/iu, '');

function matchFreeText(items, query) {
  const terms = words(query), target = terms.join('');
  let best = null, bestScore = 0;
  for (const item of items) {
    const track = requestedTrack(item);
    if (!track) continue;
    const titleWords = words(track.title), title = titleWords.join(''), base = normalized(baseTitle(track.title));
    const artists = [...track.artists, track.artist].map(normalized);
    const exact = name => artists.some(artist => target === artist + name || target === name + artist);
    const metadataWords = new Set([...titleWords, ...words(track.artist)]);
    // Keep Spotify's order when scores tie; prefer a complete title and artist over partial matches.
    const score = exact(title) ? 4 : target === title ? 3 : exact(base) || target === base ? 2
      : terms.some(word => titleWords.includes(word)) && terms.every(word => metadataWords.has(word)) ? 1 : 0;
    if (score > bestScore) { best = track; bestScore = score; }
  }
  return best;
}

export function matchRequestedTrack(items, { title, artist, query }) {
  if (!Array.isArray(items)) return null;
  if (query) return matchFreeText(items, query);
  const targetTitle = normalized(title), targetArtist = normalized(artist);
  if (!targetTitle || !targetArtist) return null;
  let alternate = null;
  for (const item of items) {
    const track = requestedTrack(item);
    if (!track || ![...track.artists, track.artist].some(name => normalized(name) === targetArtist)) continue;
    if (normalized(track.title) === targetTitle) return track;
    if (!alternate && normalized(baseTitle(track.title)) === targetTitle) alternate = track;
  }
  return alternate;
}

export function requestChatMessage(template, track, user) {
  const fields = { titel: track.title, interpret: track.artist, user };
  const text = cleanText(template.replace(/\{(titel|interpret|user)\}/g, (_, key) => fields[key]), 500);
  // Viewer-controlled metadata must never turn a confirmation into a chat command.
  return Array.from(/^[!/.]/u.test(text) ? `Song Request: ${text}` : text).slice(0, 500).join('');
}
