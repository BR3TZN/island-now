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
  const query = cleanText(text, 500);
  if (!/[\p{L}\p{N}]/u.test(query)) return null;
  const parts = query.split(/\s+[-–—]\s+/u);
  if (parts.length < 2) return { query };
  const artist = cleanText(parts.pop(), 120), title = cleanText(parts.join(' - '), 180);
  // Keep the full text: a dash can be part of the title, e.g. "Levels - Radio Edit".
  return title && artist ? { title, artist, query } : { query };
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

function selectMatch(items, scoreTrack) {
  if (!Array.isArray(items)) return null;
  let matches = [], bestScore = 0;
  for (const item of items) {
    const track = requestedTrack(item);
    if (!track) continue;
    const score = scoreTrack(track);
    if (score <= 0 || score < bestScore) continue;
    if (score > bestScore) { matches = []; bestScore = score; }
    matches.push({ track, popularity: item.popularity });
  }
  if (!matches.length) return null;
  // Popularity is optional. Only compare it when the tied results have comparable values.
  if (!matches.every(({ popularity }) => Number.isInteger(popularity) && popularity >= 0 && popularity <= 100)) return matches[0].track;
  return matches.reduce((best, item) => item.popularity > best.popularity ? item : best).track;
}

function partialScore(terms, title, artist) {
  let exact = 0, titleHits = 0;
  for (const term of terms) {
    const inTitle = title.includes(term);
    if (inTitle || artist.includes(term)) { exact++; if (inTitle) titleHits++; continue; }
    if (term.length < 4) return 0;
    if (title.some(word => word.startsWith(term))) titleHits++;
    else if (!artist.some(word => word.startsWith(term))) return 0;
  }
  // An artist alone or a phrase with unrelated words cannot queue a random song.
  if (!titleHits) return 0;
  return 1 + exact / terms.length * 2 + Math.min(1, titleHits / title.length);
}

export function matchRequestedTrack(items, { title, artist, query }) {
  if (title && artist) {
    const targetTitle = normalized(title), targetArtist = normalized(artist);
    if (!targetTitle || !targetArtist) return null;
    return selectMatch(items, track => {
      if (![...track.artists, track.artist].some(name => normalized(name) === targetArtist)) return 0;
      if (normalized(track.title) === targetTitle) return 2;
      return normalized(baseTitle(track.title)) === targetTitle ? 1 : 0;
    });
  }
  const queryWords = words(query || ''), target = queryWords.join('');
  if (!target) return null;
  const terms = [...new Set(queryWords)];
  return selectMatch(items, track => {
    const titleWords = words(track.title), full = titleWords.join(''), base = normalized(baseTitle(track.title));
    const names = [...track.artists, track.artist].map(normalized);
    const withArtist = name => name && names.some(artistName => target === artistName + name || target === name + artistName);
    if (withArtist(full)) return 8;
    if (withArtist(base)) return 7;
    if (target === full || target === base) return 6;
    return partialScore(terms, titleWords, words(track.artist));
  });
}

export function requestChatMessage(template, track, user) {
  const fields = { titel: track.title, interpret: track.artist, user };
  const text = cleanText(template.replace(/\{(titel|interpret|user)\}/g, (_, key) => fields[key]), 500);
  // Viewer-controlled metadata must never turn a confirmation into a chat command.
  return Array.from(/^[!/.]/u.test(text) ? `Song Request: ${text}` : text).slice(0, 500).join('');
}
