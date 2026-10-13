/** Google Calendar event colorIds 1–11. Fallback if colors.get is unreachable. */
export const EVENT_PALETTE = {
  "1": { background: "#a4bdfc", foreground: "#1d1d1d", name: "Lavender" },
  "2": { background: "#7ae7bf", foreground: "#1d1d1d", name: "Sage" },
  "3": { background: "#dbadff", foreground: "#1d1d1d", name: "Grape" },
  "4": { background: "#ff887c", foreground: "#1d1d1d", name: "Flamingo" },
  "5": { background: "#fbd75b", foreground: "#1d1d1d", name: "Banana" },
  "6": { background: "#ffb878", foreground: "#1d1d1d", name: "Tangerine" },
  "7": { background: "#46d6db", foreground: "#1d1d1d", name: "Peacock" },
  "8": { background: "#e1e1e1", foreground: "#1d1d1d", name: "Graphite" },
  "9": { background: "#5484ed", foreground: "#1d1d1d", name: "Blueberry" },
  "10": { background: "#51b749", foreground: "#1d1d1d", name: "Basil" },
  "11": { background: "#dc2127", foreground: "#1d1d1d", name: "Tomato" },
};

export function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function normalizeHex(hex) {
  if (!hex) return null;
  let h = String(hex).trim().toLowerCase();
  if (!h.startsWith("#")) h = `#${h}`;
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/.test(h)) return null;
  return h;
}

/** Perceptual-ish distance so "nearest Google color" tracks the wheel. */
function colorDistance(a, b) {
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return (2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db;
}

export function nearestEventColorId(hex, palette = EVENT_PALETTE) {
  const rgb = hexToRgb(normalizeHex(hex) || "");
  if (!rgb) return "1";
  let best = "1";
  let bestD = Infinity;
  for (const [id, entry] of Object.entries(palette)) {
    const other = hexToRgb(entry.background);
    if (!other) continue;
    const d = colorDistance(rgb, other);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function paletteHex(colorId, palette = EVENT_PALETTE) {
  return palette[String(colorId)]?.background || null;
}

export function textOn(hex) {
  const rgb = hexToRgb(normalizeHex(hex) || "");
  if (!rgb) return "#202124";
  const lin = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return L > 0.42 ? "#202124" : "#ffffff";
}

export function shade(hex, amount) {
  const rgb = hexToRgb(normalizeHex(hex) || "");
  if (!rgb) return hex;
  const f = (n) => n + (amount < 0 ? n : 255 - n) * amount;
  return rgbToHex(f(rgb.r), f(rgb.g), f(rgb.b));
}

export function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

/**
 * Color shown in THIS app.
 * Custom hex stored by Steve wins. Otherwise Google's colorId, then the calendar color.
 * Nothing here writes back to Google.
 */
export function displayColor(event, calendar, palette = EVENT_PALETTE) {
  const custom = normalizeHex(event?.extendedProperties?.private?.axiomColor || event?.axiomColor);
  if (custom) return custom;
  const fromId = paletteHex(event?.colorId, palette);
  if (fromId) return fromId;
  return calendar?.backgroundColor || "#039be5";
}

export function mergePalette(apiColors) {
  const palette = { ...EVENT_PALETTE };
  const events = apiColors?.event || {};
  for (const [id, entry] of Object.entries(events)) {
    if (!entry?.background) continue;
    palette[id] = {
      background: entry.background,
      foreground: entry.foreground || "#1d1d1d",
      name: EVENT_PALETTE[id]?.name || `Color ${id}`,
    };
  }
  return palette;
}
