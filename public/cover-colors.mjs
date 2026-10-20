const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const luminance = rgb => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
const hex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

export function readableAccent(rgb, background = .008, contrast = 4.5) {
  const out = rgb.map(v => clamp(v, 0, 255));
  // Keep the cover hue while lifting dark colors against the widget's dark surface.
  for (let i = 0; i < 32 && (luminance(out) + .05) / (background + .05) < contrast; i++) {
    for (let c = 0; c < 3; c++) out[c] += (255 - out[c]) * .065;
  }
  return hex(out);
}

export function dominantAccent(pixels, fallback = '#1ed760') {
  const data = pixels?.data;
  if (!data || data.length < 4) return fallback;
  const buckets = new Map(); let count = 0, colorful = 0, neutralCount = 0; const neutral = [0, 0, 0];
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 180) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(...rgb) / 255, min = Math.min(...rgb) / 255;
    const saturation = max ? (max - min) / max : 0;
    if (max < .12 || max > .9 && saturation < .1) { neutralCount++; for (let c = 0; c < 3; c++) neutral[c] += rgb[c]; continue; }
    count++; if (saturation > .2) colorful++;
    const key = rgb.map(v => Math.floor(v / 32)).join(':');
    const b = buckets.get(key) || { count: 0, rgb: [0, 0, 0], saturation: 0, brightness: 0 };
    b.count++; b.saturation += saturation; b.brightness += max;
    for (let c = 0; c < 3; c++) b.rgb[c] += rgb[c];
    buckets.set(key, b);
  }
  if (!count) return neutralCount ? readableAccent(neutral.map(v => v / neutralCount)) : fallback;
  const preferColor = colorful >= count * .05;
  const candidates = [...buckets.values()].filter(b => b.count >= Math.max(1, count * .015) && (!preferColor || b.saturation / b.count > .2));
  const best = candidates.sort((a, b) => score(b) - score(a))[0];
  function score(b) { return b.count * (.65 + b.saturation / b.count * 1.4) * (.65 + b.brightness / b.count * .35); }
  return best ? readableAccent(best.rgb.map(c => c / best.count)) : fallback;
}
