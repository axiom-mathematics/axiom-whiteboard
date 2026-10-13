import { safeHttpUrl } from "./util.js";

/** Same public STUN servers the tutoring whiteboard uses. No TURN until Steve adds one. */
export const PUBLIC_STUN = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export const WHITEBOARD_URL = "https://axiom-mathematics.github.io/axiom-whiteboard/";

export const CALENDAR_PUBLIC_BASE = "https://axiom-mathematics.github.io/axiom-whiteboard/calendar/";

/** PeerJS cloud ids. Same rule the whiteboard's inlined PeerJS 1.5.5 uses. */
export const PEER_ID_RE = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

const ROOM_URL_RE = /https?:\/\/[^\s<>"']*room\.html\?id=([A-Za-z0-9_-]+)/i;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newRoomCode() {
  const buf = new Uint8Array(6);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  let code = "cal-";
  for (const b of buf) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export function cleanRoomId(raw) {
  const id = String(raw || "").trim().slice(0, 48);
  return PEER_ID_RE.test(id) ? id : "";
}

export function roomUrlForCode(code, base = CALENDAR_PUBLIC_BASE) {
  const root = String(base || CALENDAR_PUBLIC_BASE).replace(/\/?$/, "/");
  return `${root}room.html?id=${encodeURIComponent(code)}`;
}

export function axiomRoomLinkOf(event) {
  const text = `${event?.location || ""}\n${event?.description || ""}`;
  const match = text.match(ROOM_URL_RE);
  if (!match) return null;
  return safeHttpUrl(match[0].replace(/[),.;]+$/, ""));
}

export function stripRoomText(text) {
  return String(text || "")
    .replace(/[ \t]*Axiom video room:\s*/gi, "")
    .replace(/https?:\/\/[^\s<>"']*room\.html\?id=[A-Za-z0-9_-]+/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Put the room URL where guests will see it. A real place in the location is left alone. */
export function placeRoom(location, description, url) {
  const loc = stripRoomText(location);
  const desc = stripRoomText(description);
  const line = `Axiom video room: ${url}`;
  return {
    location: loc || url,
    description: desc ? `${desc}\n\n${line}` : line,
  };
}

export function normalizeTurn(turn) {
  const urls = String(turn?.urls || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^(turns?|stuns?):/i.test(s))
    .join(" ");
  return {
    urls,
    username: String(turn?.username || "").trim().slice(0, 200),
    credential: String(turn?.credential || "").slice(0, 200),
  };
}

export function iceServers(turn) {
  const servers = PUBLIC_STUN.map((s) => ({ urls: s.urls }));
  const clean = normalizeTurn(turn);
  if (!clean.urls) return servers;
  const entry = { urls: clean.urls.split(/\s+/) };
  if (clean.username) entry.username = clean.username;
  if (clean.credential) entry.credential = clean.credential;
  servers.push(entry);
  return servers;
}

export function iosDevice(nav) {
  const agent = nav?.userAgent || "";
  const platform = nav?.platform || "";
  const touch = Number(nav?.maxTouchPoints) || 0;
  return /iPhone|iPad|iPod/i.test(agent) || (platform === "MacIntel" && touch > 1);
}

/** iPhone and iPad Safari have no getDisplayMedia. Desktop needs the API. */
export function screenShareAvailable(nav) {
  if (iosDevice(nav)) return false;
  return typeof nav?.mediaDevices?.getDisplayMedia === "function";
}
