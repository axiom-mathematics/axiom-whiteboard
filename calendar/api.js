/** Google Calendar API v3. Browser-only; the access token never touches a backend. */

import { TIMEZONE } from "./config.js";

const BASE = "https://www.googleapis.com/calendar/v3";

export async function gcal(token, path, { method = "GET", params, body } = {}) {
  const url = new URL(BASE + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function calPath(calendarId, suffix = "") {
  return `/calendars/${encodeURIComponent(calendarId)}${suffix}`;
}

export async function listCalendarList(token) {
  const items = [];
  let pageToken;
  do {
    const data = await gcal(token, "/users/me/calendarList", {
      params: { maxResults: 250, pageToken },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  items.sort((a, b) => (a.primary === b.primary ? 0 : a.primary ? -1 : 1) || (a.summary || "").localeCompare(b.summary || ""));
  return items;
}

export async function listEvents(token, calendarId, timeMin, timeMax) {
  const items = [];
  let pageToken;
  do {
    const data = await gcal(token, calPath(calendarId, "/events"), {
      params: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: 2500,
        timeZone: TIMEZONE,
        showDeleted: "false",
        pageToken,
      },
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

export async function searchEvents(token, calendarId, query) {
  const data = await gcal(token, calPath(calendarId, "/events"), {
    params: {
      q: query,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: 15,
      timeZone: TIMEZONE,
    },
  });
  return data.items || [];
}

export function insertEvent(token, calendarId, body, sendUpdates = "all") {
  return gcal(token, calPath(calendarId, "/events"), {
    method: "POST",
    params: { sendUpdates },
    body,
  });
}

export function patchEvent(token, calendarId, eventId, body, sendUpdates = "all") {
  return gcal(token, calPath(calendarId, `/events/${encodeURIComponent(eventId)}`), {
    method: "PATCH",
    params: { sendUpdates },
    body,
  });
}

export function updateEvent(token, calendarId, eventId, body, sendUpdates = "all") {
  return gcal(token, calPath(calendarId, `/events/${encodeURIComponent(eventId)}`), {
    method: "PUT",
    params: { sendUpdates, conferenceDataVersion: "1" },
    body,
  });
}

export function deleteEvent(token, calendarId, eventId, sendUpdates = "all") {
  return gcal(token, calPath(calendarId, `/events/${encodeURIComponent(eventId)}`), {
    method: "DELETE",
    params: { sendUpdates },
  });
}

export function moveEvent(token, calendarId, eventId, destination, sendUpdates = "all") {
  return gcal(token, calPath(calendarId, `/events/${encodeURIComponent(eventId)}/move`), {
    method: "POST",
    params: { destination, sendUpdates },
  });
}

export function getColors(token) {
  return gcal(token, "/colors");
}
