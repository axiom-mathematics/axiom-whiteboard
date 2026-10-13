function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

async function readError(res) {
  let message = res.statusText || "Request failed";
  try {
    const data = await res.json();
    message = data?.error?.message || message;
  } catch { /* ignore */ }
  const err = new Error(message);
  err.status = res.status;
  return err;
}

export function createApi(getToken) {
  async function request(url, { method = "GET", body, headers } = {}) {
    const token = await getToken();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    if (!res.ok) throw await readError(res);
    return res.json();
  }

  async function paged(url, pick) {
    const all = [];
    let pageToken;
    for (let i = 0; i < 20; i++) {
      const join = url.includes("?") ? "&" : "?";
      const page = await request(`${url}${pageToken ? `${join}pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      all.push(...(pick(page) || []));
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }
    return all;
  }

  const cal = "https://www.googleapis.com/calendar/v3";

  return {
    request,
    listCalendars() {
      return paged(`${cal}/users/me/calendarList?showHidden=true&maxResults=250`, (p) => p.items || []);
    },
    listColors() {
      return request(`${cal}/colors`);
    },
    async listEvents(calendarId, { timeMin, timeMax, q } = {}) {
      const items = [];
      let pageToken;
      for (let i = 0; i < 8; i++) {
        const query = qs({
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          timeMin,
          timeMax,
          q,
          showDeleted: false,
          pageToken,
        });
        const page = await request(`${cal}/calendars/${encodeURIComponent(calendarId)}/events${query}`);
        items.push(...(page.items || []));
        pageToken = page.nextPageToken;
        if (!pageToken) break;
      }
      return items;
    },
    getEvent(calendarId, eventId) {
      return request(`${cal}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    },
    insertEvent(calendarId, body, { conferenceDataVersion, sendUpdates } = {}) {
      const query = qs({ conferenceDataVersion, sendUpdates });
      return request(`${cal}/calendars/${encodeURIComponent(calendarId)}/events${query}`, {
        method: "POST",
        body,
      });
    },
    patchEvent(calendarId, eventId, body, { conferenceDataVersion, sendUpdates } = {}) {
      const query = qs({ conferenceDataVersion, sendUpdates });
      return request(`${cal}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${query}`, {
        method: "PATCH",
        body,
      });
    },
    deleteEvent(calendarId, eventId, { sendUpdates } = {}) {
      const query = qs({ sendUpdates });
      return request(`${cal}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${query}`, {
        method: "DELETE",
      });
    },
    moveEvent(calendarId, eventId, destination, { sendUpdates } = {}) {
      const query = qs({ destination, sendUpdates });
      return request(`${cal}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move${query}`, {
        method: "POST",
      });
    },
    patchCalendarList(calendarId, body) {
      return request(`${cal}/users/me/calendarList/${encodeURIComponent(calendarId)}`, {
        method: "PATCH",
        body,
      });
    },
    async listConnections() {
      const people = [];
      let pageToken;
      for (let i = 0; i < 8; i++) {
        const query = qs({
          pageSize: 1000,
          personFields: "names,emailAddresses,addresses",
          sortOrder: "LAST_MODIFIED_DESC",
          pageToken,
        });
        const page = await request(`https://people.googleapis.com/v1/people/me/connections${query}`);
        people.push(...(page.connections || []));
        pageToken = page.nextPageToken;
        if (!pageToken) break;
      }
      return people;
    },
  };
}
