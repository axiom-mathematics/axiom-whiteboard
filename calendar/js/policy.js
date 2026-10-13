import { WYZANT_CALENDAR_ID, WYZANT_DEFAULT_OFFSET_HOURS } from "../config.js";

export function trimNum(n) {
  const x = Math.round(Number(n) * 100) / 100;
  return Number.isInteger(x) ? String(x) : String(x);
}

/** Display-only hour shift. Missing Wyzant entry defaults to -2. */
export function offsetHours(settings, calendarId) {
  const row = settings?.offsets?.[calendarId];
  if (!row) {
    if (calendarId === WYZANT_CALENDAR_ID) return WYZANT_DEFAULT_OFFSET_HOURS;
    return 0;
  }
  if (row.enabled === false) return 0;
  const n = Number(row.hours);
  return Number.isFinite(n) ? n : 0;
}

export function offsetBadge(calendarId, hours) {
  if (!hours) return null;
  const label = `${hours > 0 ? "+" : ""}${trimNum(hours)}h`;
  if (calendarId === WYZANT_CALENDAR_ID) return `Wyzant times adjusted ${label}`;
  return `Times adjusted ${label}`;
}

export function isWyzant(calendarId) {
  return calendarId === WYZANT_CALENDAR_ID;
}

/**
 * Never write the Wyzant import, reader calendars, or any calendar whose times
 * are being visually shifted (writing those times back would bake in the correction).
 */
export function calendarLocked(cal, settings) {
  if (!cal) return true;
  if (isWyzant(cal.id)) return true;
  if (cal.accessRole === "reader" || cal.accessRole === "freeBusyReader") return true;
  if (offsetHours(settings, cal.id)) return true;
  return false;
}
