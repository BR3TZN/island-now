const TRACK_ID = /^[A-Za-z0-9]{22}$/;

export const DEFAULT_CHAT_MESSAGE = 'Songwunsch von @{user}: {titel} – {interpret} wurde zur Spotify-Warteschlange hinzugefügt.';
export const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max) : '';

export function parseSongRequest(input) {
  if (typeof input !== 'string' || input.length > 500) return null;
  const text = input.trim();
  const uri = /^spotify:track:([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return { id: uri[1] };
  if (/^(https?:\/\/|open\.spotify\.com\/|spotify:)/i.test(text)) {
    try {
      const url = new URL(text.startsWith('open.spotify.com/') ? `https://${text}` : text);
      const match = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?track\/([A-Za-z0-9]{22})\/?$/i.exec(url.pathname);
      if (url.origin === 'https://open.spotify.com' && !url.username && !url.password && match) return { id: match[1] };
    } catch {}
    return null;
  }
  const parts = text.split(/\s+[-–—]\s+/u);
  if (parts.length < 2) return null;
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

const normalized = value => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/ß/g, 'ss').replace(/[^\p{L}\p{N}]/gu, '');

export function matchRequestedTrack(items, { title, artist }) {
  const targetTitle = normalized(title), targetArtist = normalized(artist);
  if (!targetTitle || !targetArtist || !Array.isArray(items)) return null;
  let alternate = null;
  for (const item of items) {
    const track = requestedTrack(item);
    if (!track || ![...track.artists, track.artist].some(name => normalized(name) === targetArtist)) continue;
    if (normalized(track.title) === targetTitle) return track;
    const base = track.title.replace(/\s+(?:[-–—]\s+|\()(?:\d{4}\s+)?(?:remaster(?:ed)?|radio edit|single version)\b.*$/iu, '');
    if (!alternate && normalized(base) === targetTitle) alternate = track;
  }
  return alternate;
}

export function requestChatMessage(template, track, user) {
  const fields = { titel: track.title, interpret: track.artist, user };
  const text = cleanText(template.replace(/\{(titel|interpret|user)\}/g, (_, key) => fields[key]), 500);
  // Viewer-controlled metadata must never turn a confirmation into a chat command.
  return Array.from(/^[!/.]/u.test(text) ? `Song Request: ${text}` : text).slice(0, 500).join('');
}
