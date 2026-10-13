/** Axiom Calendar configuration. The client id is a placeholder until Steve pastes his own. */

export const TIMEZONE = "America/Chicago";

/** Replaced in the browser by the value Steve saves in localStorage. */
export const DEFAULT_CLIENT_ID = "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Wyzant ICS import. Times in Google land about 2 hours later than the real lesson. */
export const WYZANT_CALENDAR_ID = "jpk68n5f9dhntavi9oc0hsmh7tpu0bm6@import.calendar.google.com";
export const WYZANT_DEFAULT_OFFSET_MINUTES = -120;

export const STORAGE_CLIENT_ID = "axiom-cal-client-id";
export const STORAGE_OFFSETS = "axiom-cal-offsets";
export const STORAGE_HIDDEN = "axiom-cal-hidden";
export const STORAGE_VIEW = "axiom-cal-view";
export const TOKEN_SESSION_KEY = "axiom-cal-token";

/**
 * Official Google Calendar event palette from the Calendar API colors resource.
 * Used only when the colors endpoint hasn't loaded yet. These are Google's colors,
 * displayed as-is — never invented replacements.
 */
export const GOOGLE_EVENT_COLORS = {
  1: { background: "#a4bdfc", foreground: "#1d1d1d" },
  2: { background: "#7ae7bf", foreground: "#1d1d1d" },
  3: { background: "#dbadff", foreground: "#1d1d1d" },
  4: { background: "#ff887c", foreground: "#1d1d1d" },
  5: { background: "#fbd75b", foreground: "#1d1d1d" },
  6: { background: "#ffb878", foreground: "#1d1d1d" },
  7: { background: "#46d6db", foreground: "#1d1d1d" },
  8: { background: "#e1e1e1", foreground: "#1d1d1d" },
  9: { background: "#5484ed", foreground: "#1d1d1d" },
  10: { background: "#51b749", foreground: "#1d1d1d" },
  11: { background: "#dc2127", foreground: "#1d1d1d" },
};

export const GOOGLE_EVENT_COLOR_NAMES = {
  1: "Lavender",
  2: "Sage",
  3: "Grape",
  4: "Flamingo",
  5: "Banana",
  6: "Tangerine",
  7: "Peacock",
  8: "Graphite",
  9: "Blueberry",
  10: "Basil",
  11: "Tomato",
};

export function isPlaceholderClientId(id) {
  if (!id) return true;
  const trimmed = String(id).trim();
  if (!trimmed.endsWith(".apps.googleusercontent.com")) return true;
  if (trimmed.includes("YOUR_GOOGLE_OAUTH_CLIENT_ID")) return true;
  return false;
}

/** Display-only shift. Missing key → −2h for the Wyzant feed, 0 for everyone else. */
export function resolveOffsetMinutes(calendarId, stored) {
  if (stored && Object.prototype.hasOwnProperty.call(stored, calendarId)) {
    const n = Number(stored[calendarId]);
    return Number.isFinite(n) ? n : 0;
  }
  if (calendarId === WYZANT_CALENDAR_ID) return WYZANT_DEFAULT_OFFSET_MINUTES;
  return 0;
}

/** Import feed is never written, even if Google reports a broader access role. */
export function calendarWritable(cal) {
  if (!cal) return false;
  if (cal.id === WYZANT_CALENDAR_ID) return false;
  return cal.accessRole === "owner" || cal.accessRole === "writer";
}

export function offsetAdjustment(calendarId, minutes, summary) {
  const n = Number(minutes) || 0;
  if (!n) return null;
  const hours = Math.abs(n) / 60;
  const text = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
  const ascii = `${n < 0 ? "-" : "+"}${text}h`;
  const label = `${n < 0 ? "−" : "+"}${text}h`;
  const name = calendarId === WYZANT_CALENDAR_ID ? "Wyzant" : (summary || "Calendar");
  return { label, tooltip: `${name} times adjusted ${ascii}` };
}
