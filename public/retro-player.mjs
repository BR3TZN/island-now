// Original pixel artwork at the classic 275 x 116 player size. No audio analysis.
// The bitmap letters and segment clock stay independent of installed system fonts.
const LETTERS = {
  ' ': [0,0,0,0,0,0,0], '?': [14,17,1,2,4,0,4],
  A:[14,17,17,31,17,17,17], B:[30,17,17,30,17,17,30], C:[14,17,16,16,16,17,14], D:[30,17,17,17,17,17,30],
  E:[31,16,16,30,16,16,31], F:[31,16,16,30,16,16,16], G:[14,17,16,23,17,17,15], H:[17,17,17,31,17,17,17],
  I:[14,4,4,4,4,4,14], J:[7,2,2,2,18,18,12], K:[17,18,20,24,20,18,17], L:[16,16,16,16,16,16,31],
  M:[17,27,21,21,17,17,17], N:[17,25,21,19,17,17,17], O:[14,17,17,17,17,17,14], P:[30,17,17,30,16,16,16],
  Q:[14,17,17,17,21,18,13], R:[30,17,17,30,20,18,17], S:[15,16,16,14,1,1,30], T:[31,4,4,4,4,4,4],
  U:[17,17,17,17,17,17,14], V:[17,17,17,17,17,10,4], W:[17,17,17,21,21,21,10], X:[17,17,10,4,10,17,17],
  Y:[17,17,10,4,4,4,4], Z:[31,1,2,4,8,16,31],
  a:[0,0,14,1,15,17,15], b:[16,16,30,17,17,17,30], c:[0,0,14,17,16,17,14], d:[1,1,15,17,17,17,15],
  e:[0,0,14,17,31,16,14], f:[6,9,8,28,8,8,8], g:[0,0,15,17,15,1,14], h:[16,16,30,17,17,17,17],
  i:[4,0,12,4,4,4,14], j:[2,0,6,2,2,18,12], k:[16,16,18,20,24,20,18], l:[12,4,4,4,4,4,14],
  m:[0,0,26,21,21,21,21], n:[0,0,30,17,17,17,17], o:[0,0,14,17,17,17,14], p:[0,0,30,17,30,16,16],
  q:[0,0,15,17,15,1,1], r:[0,0,22,25,16,16,16], s:[0,0,15,16,14,1,30], t:[8,8,28,8,8,9,6],
  u:[0,0,17,17,17,19,13], v:[0,0,17,17,17,10,4], w:[0,0,17,17,21,21,10], x:[0,0,17,10,4,10,17],
  y:[0,0,17,17,15,1,14], z:[0,0,31,2,4,8,31],
  '0':[14,17,19,21,25,17,14], '1':[4,12,4,4,4,4,14], '2':[14,17,1,2,4,8,31], '3':[30,1,1,14,1,1,30],
  '4':[2,6,10,18,31,2,2], '5':[31,16,16,30,1,1,30], '6':[14,16,16,30,17,17,14], '7':[31,1,2,4,8,8,8],
  '8':[14,17,17,14,17,17,14], '9':[14,17,17,15,1,1,14],
  '-':[0,0,0,31,0,0,0], '_':[0,0,0,0,0,0,31], '.':[0,0,0,0,0,12,12], ',':[0,0,0,0,4,4,8],
  ':':[0,12,12,0,12,12,0], ';':[0,12,12,0,4,4,8], '(':[2,4,8,8,8,4,2], ')':[8,4,2,2,2,4,8],
  '[':[14,8,8,8,8,8,14], ']':[14,2,2,2,2,2,14], '/':[1,2,2,4,8,8,16], '\\':[16,8,8,4,2,2,1],
  '!':[4,4,4,4,4,0,4], "'":[4,4,8,0,0,0,0], '"':[10,10,0,0,0,0,0], '+':[0,4,4,31,4,4,0],
  '=':[0,0,31,0,31,0,0], '&':[12,18,20,8,21,18,13], '#':[10,31,10,10,31,10,0], '%':[25,25,2,4,8,19,19],
};
const SMALL = {
  A:[2,5,7,5,5], B:[6,5,6,5,6], C:[3,4,4,4,3], D:[6,5,5,5,6], E:[7,4,6,4,7], F:[7,4,6,4,4],
  H:[5,5,7,5,5], I:[7,2,2,2,7], K:[5,5,6,5,5], L:[4,4,4,4,7], M:[5,7,7,5,5], N:[5,7,7,7,5],
  O:[2,5,5,5,2], P:[6,5,6,4,4], Q:[2,5,5,3,1], R:[6,5,6,5,5], S:[3,4,2,1,6], T:[7,2,2,2,2],
  U:[5,5,5,5,7], V:[5,5,5,5,2], Z:[7,1,2,4,7], '-':[0,0,7,0,0], ' ':[0,0,0,0,0],
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const clean = text => String(text ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/[–—]/g, '-').slice(0, 600);
const length = ms => { const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };
function text(c, value, x, y, color, small = false) {
  c.fillStyle = color;
  for (const char of clean(value)) {
    const rows = small ? SMALL[char.toUpperCase()] || SMALL['-'] : LETTERS[char] || LETTERS['?'];
    const width = small ? 3 : 5;
    if (x >= -width && x <= 275) for (let row = 0; row < rows.length; row++) for (let col = 0; col < width; col++) if (rows[row] & 1 << (width - col - 1)) c.fillRect(x + col, y + row, 1, 1);
    x += width + 1;
    if (x > 275) break;
  }
}
function box(c, x, y, w, h, fill = '#36364e', raised = true) {
  c.fillStyle = fill; c.fillRect(x, y, w, h);
  c.fillStyle = raised ? '#8b8eaa' : '#10101a'; c.fillRect(x, y, w, 1); c.fillRect(x, y, 1, h);
  c.fillStyle = raised ? '#11111b' : '#77798d'; c.fillRect(x, y + h - 1, w, 1); c.fillRect(x + w - 1, y, 1, h);
}
function triangle(c, x, y, direction, color = '#40586d') {
  c.fillStyle = '#e0f0f2';
  for (let i = 0; i < 6; i++) c.fillRect(x + (direction > 0 ? i : 5 - i), y + i, 1, 11 - i * 2);
  c.fillStyle = color;
  for (let i = 0; i < 5; i++) c.fillRect(x + 1 + (direction > 0 ? i : 4 - i), y + 1 + i, 1, 9 - i * 2);
}
function button(c, x, y, w, h) {
  box(c, x, y, w, h, '#8795a8');
  c.fillStyle = '#bccddd'; c.fillRect(x + 1, y + 1, w - 2, 2); c.fillRect(x + 1, y + 1, 2, h - 3);
  c.fillStyle = '#6b7c92'; c.fillRect(x + 2, y + h - 3, w - 3, 2); c.fillRect(x + w - 3, y + 2, 2, h - 3);
}
function knob(c, x, y, w = 13, h = 10, gold = false) {
  button(c, x, y, w, h);
  if (gold) { c.fillStyle = '#d2c696'; c.fillRect(x + 2, y + 2, w - 4, h - 4); c.fillStyle = '#fcf4c4'; c.fillRect(x + 2, y + 2, w - 4, 1); }
  else { c.fillStyle = '#4a5d71'; for (let i = 4; i < w - 3; i += 2) c.fillRect(x + i, y + 3, 1, h - 6); }
}
function bolt(c, x, y) {
  c.fillStyle = '#69623f'; c.fillRect(x, y + 3, 3, 4); c.fillRect(x + 2, y, 3, 5); c.fillRect(x + 3, y + 5, 5, 3); c.fillRect(x + 6, y + 6, 3, 5);
  c.fillStyle = '#d3bb63'; c.fillRect(x + 2, y + 2, 1, 3); c.fillRect(x + 3, y + 1, 1, 5); c.fillRect(x + 4, y + 5, 4, 1); c.fillRect(x + 7, y + 6, 1, 3);
}
function clock(c, progress, color) {
  const value = length(progress).padStart(5, '0'), width = value.length > 5 ? 7 : 10;
  const masks = [63,6,91,79,102,109,125,7,127,111];
  let x = 47;
  for (const char of value) {
    if (char === ':') { c.fillStyle = color; c.fillRect(x + 1, 33, 1, 2); c.fillRect(x + 1, 40, 1, 2); x += 5; continue; }
    const segments = [[1,0,width-2,1],[width-1,1,1,7],[width-1,9,1,7],[1,16,width-2,1],[0,9,1,7],[0,1,1,7],[1,8,width-2,1]];
    const mask = masks[Number(char)] || 0;
    segments.forEach((s, index) => { c.fillStyle = mask & 1 << index ? color : '#0c1c16'; c.fillRect(x + s[0], 28 + s[1], s[2], s[3]); });
    x += width + 2;
  }
}
function title(c, value, started, now, color, reducedMotion, alpha = 1, offset = 0) {
  const label = clean(value), width = label.length * 6;
  const scroll = width > 150 && !reducedMotion ? Math.floor(Math.max(0, now - started - 1800) / 65) % (width + 24) : 0;
  c.save(); c.beginPath(); c.rect(111, 27, 151, 10); c.clip(); c.globalAlpha = alpha;
  text(c, label, 112 - scroll + offset, 29, color);
  if (scroll) text(c, label, 112 - scroll + width + 24 + offset, 29, color);
  c.restore();
}

export function createRetroRenderer(canvas, Path = globalThis.Path2D) {
  canvas.width = 275; canvas.height = 116;
  const c = canvas.getContext('2d');
  if (!c) return () => {};
  c.imageSmoothingEnabled = false;
  const spotify = Path ? new Path('M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24Zm5.5 17.3a.75.75 0 0 1-1.03.24c-2.82-1.72-6.38-2.11-10.57-1.15a.75.75 0 1 1-.34-1.46c4.59-1.05 8.51-.6 11.7 1.34.35.21.46.67.24 1.03Zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.99-8.15-2.57-11.98-1.4a.94.94 0 0 1-.55-1.8c4.38-1.33 9.8-.68 13.51 1.6.44.27.58.85.31 1.29Zm.13-3.4C15.23 8.34 8.84 8.12 5.14 9.24a1.13 1.13 0 0 1-.65-2.16c4.25-1.29 11.31-1.04 15.76 1.6a1.13 1.13 0 0 1-1.15 1.95Z') : null;
  let current = '', previous = '', titleAt = 0, previousAt = 0, levelAt = 0;
  return function render(frame, now = Date.now()) {
    const settings = frame.settings || {}, track = frame.track, color = frame.accent || '#00ff00';
    const playing = frame.status === 'playing', reduced = frame.reducedMotion === true;
    const label = track ? clean(`${track.artist} - ${track.title} (${length(track.duration)})`) : 'Spotify - Island Now';
    if (label !== current) { previous = current; previousAt = titleAt; current = label; titleAt = now; }
    if (playing || !levelAt) levelAt = now;
    c.clearRect(0, 0, 275, 116);
    box(c, 0, 0, 275, 116, '#17171f'); box(c, 1, 1, 273, 114, '#29293d');
    box(c, 3, 3, 269, 110, '#41415d'); box(c, 5, 14, 265, 97, '#33334b', false);
    c.fillStyle = '#40405b'; c.fillRect(7, 16, 261, 92); c.fillStyle = '#36364e'; c.fillRect(9, 18, 257, 89);
    bolt(c, 6, 4);
    for (const [x, w] of [[21, 92], [162, 79]]) {
      box(c, x, 6, w, 6, '#a69c69', false); c.fillStyle = '#e1d8a1'; c.fillRect(x + 1, 7, w - 2, 1); c.fillStyle = '#eee7c0'; c.fillRect(x + 1, 10, w - 2, 1);
    }
    text(c, 'WINAMP', 118, 6, '#151523'); text(c, 'WINAMP', 117, 5, '#e0e1f0');
    for (const x of [244, 253, 263]) box(c, x, 6, 6, 6, '#a49e72');
    c.fillStyle = '#ddd5a4'; c.fillRect(245, 10, 4, 1); c.fillRect(254, 7, 4, 1); c.fillRect(264, 7, 1, 1); c.fillRect(268, 7, 1, 1); c.fillRect(265, 8, 1, 1); c.fillRect(267, 8, 1, 1); c.fillRect(266, 9, 1, 1); c.fillRect(265, 10, 1, 1); c.fillRect(267, 10, 1, 1);

    box(c, 13, 25, 91, 41, '#05080a', false);
    c.fillStyle = '#10121c'; for (let y = 27; y < 64; y += 2) for (let x = 15; x < 102; x += 2) c.fillRect(x, y, 1, 1);
    ['O','A','I','D','V'].forEach((letter, i) => text(c, letter, 16, 27 + i * 7, '#30394b', true));
    c.fillStyle = playing ? color : '#526559'; c.fillRect(25, 29, 3, 3);
    if (playing) { c.fillStyle = color; for (let i = 0; i < 5; i++) c.fillRect(31 + i, 28 + i, 1, 10 - i * 2); }
    else { c.fillStyle = color; c.fillRect(31, 29, 2, 8); c.fillRect(35, 29, 2, 8); }
    if (settings.showTime !== false) clock(c, frame.progress, color);
    c.fillStyle = '#31567e'; for (let x = 24; x < 102; x += 2) c.fillRect(x, 63, 1, 1);
    for (let i = 0; i < 25; i++) {
      const phase = reduced ? 1.3 : levelAt / 450;
      const envelope = .75 - i / 42;
      const height = clamp(Math.floor((8 + Math.sin(phase * 1.2 + i * 1.7) * 4 + Math.sin(phase * .7 + i * .47) * 5) * envelope), 1, 13);
      for (let h = 0; h < height; h += 2) { c.fillStyle = settings.accentMode === 'cover' ? color : h > 8 ? '#e0e933' : '#0ae20a'; c.fillRect(24 + i * 3, 61 - h, 2, 1); }
      c.fillStyle = '#a7b2bd'; c.fillRect(24 + i * 3, 58 - height, 2, 1);
    }

    box(c, 109, 25, 156, 15, '#020502', false);
    const fade = reduced || settings.trackTransition === 'none' ? 1 : clamp((now - titleAt) / clamp(Number(settings.motionDuration) || 650, 150, 1500), 0, 1);
    if (previous && fade < 1) title(c, previous, previousAt, now, color, reduced, 1 - fade, settings.trackTransition === 'slide' ? -Math.floor(fade * 8) : 0);
    title(c, current, titleAt, now, color, reduced, previous ? fade : 1, settings.trackTransition === 'slide' ? Math.floor((1 - fade) * 8) : 0);
    box(c, 110, 43, 20, 12, '#030703', false); text(c, '--', 113, 45, color);
    text(c, 'kbps', 133, 47, '#c5c7d7', true);
    box(c, 155, 43, 17, 12, '#030703', false); text(c, '--', 158, 45, color);
    text(c, 'kHz', 175, 47, '#c5c7d7', true); text(c, 'mono', 218, 47, '#9395a8', true); text(c, 'stereo', 239, 47, color, true);
    box(c, 109, 62, 64, 5, '#b96b0b', false); c.fillStyle = '#d78b17'; c.fillRect(111, 63, 59, 2); knob(c, 153, 59);
    box(c, 181, 62, 34, 5, '#1b6c0a', false); c.fillStyle = '#42a32d'; c.fillRect(183, 63, 29, 2); knob(c, 192, 59);
    for (const [x, name] of [[221, 'EQ'], [244, 'PL']]) { button(c, x, 59, 20, 11); c.fillStyle = '#266c3b'; c.fillRect(x + 3, 62, 2, 3); text(c, name, x + 7, 62, '#3c4d59', true); }
    if (settings.showProgress !== false) {
      box(c, 17, 74, 247, 10, '#252537', false); box(c, 18, 76, 245, 6, '#313147');
      const ratio = track?.duration ? clamp((Number(frame.progress) || 0) / track.duration, 0, 1) : 0;
      knob(c, 18 + Math.round(ratio * 217), 74, 29, 10, true);
    }

    [17,40,63,86,109].forEach(x => button(c, x, 91, 23, 18));
    c.fillStyle = '#43586b'; c.fillRect(22, 95, 2, 10); triangle(c, 25, 95, -1); triangle(c, 48, 95, 1);
    c.fillStyle = '#40566b'; c.fillRect(70, 95, 3, 10); c.fillRect(76, 95, 3, 10); c.fillStyle = '#d4e4eb'; c.fillRect(73, 95, 1, 10); c.fillRect(79, 95, 1, 10);
    c.fillStyle = '#40566b'; c.fillRect(92, 95, 10, 10); c.fillStyle = '#cbdde6'; c.fillRect(93, 96, 8, 1); c.fillRect(93, 96, 1, 8);
    triangle(c, 115, 95, 1); c.fillStyle = '#40566b'; c.fillRect(124, 95, 2, 10);
    button(c, 139, 91, 24, 18); c.fillStyle = '#40566b'; for (let i = 0; i < 6; i++) c.fillRect(145 + i, 100 - i, 12 - i * 2, 1); c.fillRect(145, 103, 12, 2);
    button(c, 169, 93, 45, 14); c.fillStyle = '#367a42'; c.fillRect(173, 97, 3, 3); text(c, 'SHUFFLE', 179, 98, '#425369', true);
    button(c, 216, 93, 22, 14); c.fillStyle = '#367a42'; c.fillRect(219, 97, 3, 3); c.fillStyle = '#43586b'; c.fillRect(225, 97, 8, 2); c.fillRect(231, 99, 2, 3); c.fillRect(225, 102, 8, 1); c.fillRect(225, 100, 1, 2);
    // Keep the service attribution in the original player's lower-right badge area.
    if (spotify) { c.save(); c.translate(248, 94); c.scale(14 / 24, 14 / 24); c.fillStyle = '#fff'; c.fill(spotify); c.restore(); }
  };
}
