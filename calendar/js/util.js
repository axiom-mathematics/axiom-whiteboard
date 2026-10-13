export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function snapMinutes(mins, step = 15) {
  return Math.round(mins / step) * step;
}

export function safeHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch {
    return null;
  }
}

export function safeTel(url) {
  if (!url) return null;
  const raw = String(url).trim();
  if (/^tel:\+?[0-9().\-\s]+$/i.test(raw)) return raw;
  return null;
}

export function fold(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

export function firstName(display) {
  const s = String(display ?? "").trim();
  if (!s) return "";
  return s.split(/\s+/)[0];
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function eventKey(calendarId, eventId) {
  return `${calendarId}\n${eventId}`;
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function videoIcon(extraClass = "") {
  return `<svg class="ico ${extraClass}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17 10.5V7a2 2 0 0 0-2-2H5A2 2 0 0 0 3 7v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5l4 3.5V7l-4 3.5z"/></svg>`;
}

export function meetLinkOf(event) {
  const points = event?.conferenceData?.entryPoints || [];
  const video = points.find((p) => p.entryPointType === "video" && p.uri);
  if (video?.uri) return safeHttpUrl(video.uri);
  if (event?.hangoutLink) return safeHttpUrl(event.hangoutLink);
  return null;
}

export function phoneEntryOf(event) {
  const points = event?.conferenceData?.entryPoints || [];
  return points.find((p) => p.entryPointType === "phone") || null;
}

export function dialInText(event) {
  const phones = (event?.conferenceData?.entryPoints || []).filter((p) => p.entryPointType === "phone");
  if (!phones.length) return "";
  const lines = ["Join by phone"];
  for (const p of phones) {
    const label = p.label || p.uri || "";
    const pin = p.pin ? ` PIN: ${p.pin}#` : "";
    const region = p.regionCode ? `(${p.regionCode}) ` : "";
    lines.push(`${region}${label}${pin}`.trim());
  }
  return lines.join("\n");
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function googleEventUrl(eventId, calendarId) {
  try {
    const raw = `${eventId} ${calendarId}`;
    const eid = btoa(unescape(encodeURIComponent(raw))).replace(/=+$/g, "");
    return `https://calendar.google.com/calendar/event?eid=${eid}`;
  } catch {
    return "https://calendar.google.com/";
  }
}
