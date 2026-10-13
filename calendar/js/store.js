import { DRIVE_SETTINGS_NAME, LS, PLACEHOLDER_CLIENT_ID, WYZANT_CALENDAR_ID, WYZANT_DEFAULT_OFFSET_HOURS } from "../config.js";
import { SOURCE_RANK } from "./zones.js";

export function defaultSettings() {
  return {
    version: 1,
    updated: new Date().toISOString(),
    offsets: {},
    contacts: {},
    weekStart: 0,
  };
}

export function clientIdConfigured(id) {
  const value = String(id || "").trim();
  if (!value) return false;
  if (value === PLACEHOLDER_CLIENT_ID) return false;
  if (value.startsWith("YOUR_CLIENT_ID")) return false;
  return value.endsWith(".apps.googleusercontent.com");
}

export function loadClientId() {
  try {
    return localStorage.getItem(LS.clientId) || "";
  } catch {
    return "";
  }
}

export function saveClientId(id) {
  try {
    localStorage.setItem(LS.clientId, String(id || "").trim());
  } catch { /* private mode */ }
}

export function loadLocalSettings() {
  try {
    const raw = localStorage.getItem(LS.settings);
    if (!raw) return defaultSettings();
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function saveLocalSettings(settings) {
  try {
    localStorage.setItem(LS.settings, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function normalizeSettings(input) {
  const base = defaultSettings();
  if (!input || typeof input !== "object") return base;
  return {
    version: 1,
    updated: input.updated || base.updated,
    weekStart: input.weekStart === 1 ? 1 : 0,
    offsets: input.offsets && typeof input.offsets === "object" ? input.offsets : {},
    contacts: input.contacts && typeof input.contacts === "object" ? input.contacts : {},
  };
}

/** Fill the Wyzant correction once. A stored row — even disabled — is left alone. */
export function withOffsetDefaults(settings) {
  const next = normalizeSettings(settings);
  if (!next.offsets[WYZANT_CALENDAR_ID]) {
    next.offsets = {
      ...next.offsets,
      [WYZANT_CALENDAR_ID]: {
        hours: WYZANT_DEFAULT_OFFSET_HOURS,
        enabled: true,
        updated: next.updated,
      },
    };
  }
  return next;
}

function newer(a, b) {
  return String(a || "") >= String(b || "");
}

export function mergeSettings(local, remote) {
  const a = normalizeSettings(local);
  const b = normalizeSettings(remote);
  const contacts = { ...b.contacts };
  for (const [email, row] of Object.entries(a.contacts)) {
    const other = contacts[email];
    if (!other) {
      contacts[email] = row;
      continue;
    }
    const ra = SOURCE_RANK[row.source] || 0;
    const rb = SOURCE_RANK[other.source] || 0;
    if (ra > rb) contacts[email] = row;
    else if (rb > ra) contacts[email] = other;
    else contacts[email] = newer(row.updated, other.updated) ? row : other;
  }
  const offsets = { ...b.offsets };
  for (const [id, row] of Object.entries(a.offsets)) {
    const other = offsets[id];
    if (!other || newer(row.updated, other.updated)) offsets[id] = row;
  }
  return withOffsetDefaults({
    version: 1,
    updated: newer(a.updated, b.updated) ? a.updated : b.updated,
    weekStart: newer(a.updated, b.updated) ? a.weekStart : b.weekStart,
    offsets,
    contacts,
  });
}

async function driveJson(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": options.headers?.["Content-Type"] || "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 404) return { missing: true };
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || res.statusText);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return {};
  const type = res.headers.get("content-type") || "";
  if (type.includes("json")) return res.json();
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

export async function pullDriveSettings(token) {
  const listed = await driveJson(
    token,
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=${encodeURIComponent(`name='${DRIVE_SETTINGS_NAME}'`)}`,
  );
  const file = listed.files?.[0];
  if (!file) return { settings: null, fileId: null };
  const data = await driveJson(token, `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  return { settings: normalizeSettings(data), fileId: file.id };
}

export async function pushDriveSettings(token, settings, fileId) {
  const body = JSON.stringify(settings);
  if (!fileId) {
    const boundary = `axiom${Date.now()}`;
    const meta = JSON.stringify({
      name: DRIVE_SETTINGS_NAME,
      parents: ["appDataFolder"],
      mimeType: "application/json",
    });
    const payload =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n` +
      `--${boundary}--`;
    const created = await driveJson(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: payload,
    });
    return created.id || null;
  }
  await driveJson(token, `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return fileId;
}
