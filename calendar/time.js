/** America/Chicago wall-clock helpers. Device timezone is never trusted. */

import { TIMEZONE } from "./config.js";

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function pad(n) {
  return String(n).padStart(2, "0");
}

export function zonedParts(date, timeZone = TIMEZONE) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
    weekdayIndex: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

/** Minutes to add to UTC to get the wall clock in `timeZone` (ISO offset). */
export function tzOffsetMinutes(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/** Interpret a wall-clock time in America/Chicago as a UTC instant. */
export function zonedToUtc(y, m, d, h = 0, mi = 0, s = 0, timeZone = TIMEZONE) {
  const wall = Date.UTC(y, m - 1, d, h, mi, s);
  let utc = wall;
  for (let i = 0; i < 4; i++) {
    const offset = tzOffsetMinutes(new Date(utc), timeZone);
    const next = wall - offset * 60000;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function shiftMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

export function addDays(date, n, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  const utcDate = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return zonedToUtc(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
    p.hour,
    p.minute,
    p.second,
    timeZone,
  );
}

export function addMonths(date, n, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  const utcDate = new Date(Date.UTC(p.year, p.month - 1 + n, 1));
  const dim = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(p.day, dim);
  return zonedToUtc(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    day,
    p.hour,
    p.minute,
    p.second,
    timeZone,
  );
}

export function startOfDay(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

export function startOfWeek(date, timeZone = TIMEZONE) {
  const sod = startOfDay(date, timeZone);
  const dow = zonedParts(sod, timeZone).weekdayIndex;
  return addDays(sod, -dow, timeZone);
}

export function startOfMonth(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return zonedToUtc(p.year, p.month, 1, 0, 0, 0, timeZone);
}

export function dayKey(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function parseDayKey(key, timeZone = TIMEZONE) {
  const [y, m, d] = key.split("-").map(Number);
  return zonedToUtc(y, m, d, 0, 0, 0, timeZone);
}

export function isSameDay(a, b, timeZone = TIMEZONE) {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}

export function minutesSinceMidnight(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return p.hour * 60 + p.minute + p.second / 60;
}

export function calendarDayNumber(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86400000);
}

export function formatChicagoDateTime(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  const offset = tzOffsetMinutes(date, timeZone);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const hh = pad(Math.floor(abs / 60));
  const mm = pad(abs % 60);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${hh}:${mm}`;
}

export function formatTime(date, timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatTimeRange(start, end, timeZone = TIMEZONE) {
  const same = dayKey(start, timeZone) === dayKey(end, timeZone);
  if (same) return `${formatTime(start, timeZone)} – ${formatTime(end, timeZone)}`;
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  return `${day.format(start)}, ${formatTime(start, timeZone)} – ${day.format(end)}, ${formatTime(end, timeZone)}`;
}

export function formatMonthYear(date, timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "long", year: "numeric" }).format(date);
}

export function formatWeekday(date, style = "short", timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: style }).format(date);
}

export function formatLongDate(date, timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatMediumDate(date, timeZone = TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function visibleRange(anchor, view, timeZone = TIMEZONE) {
  if (view === "month") {
    const start = startOfWeek(startOfMonth(anchor, timeZone), timeZone);
    return { start, end: addDays(start, 42, timeZone) };
  }
  if (view === "day") {
    const start = startOfDay(anchor, timeZone);
    return { start, end: addDays(start, 1, timeZone) };
  }
  if (view === "agenda") {
    const start = startOfDay(anchor, timeZone);
    return { start, end: addDays(start, 42, timeZone) };
  }
  const start = startOfWeek(anchor, timeZone);
  return { start, end: addDays(start, 7, timeZone) };
}

/** Wider than the screen so week-to-week moves stay instant, plus a day for offset spill. */
export function fetchWindow(anchor, view, timeZone = TIMEZONE) {
  const { start, end } = visibleRange(anchor, view, timeZone);
  return { start: addDays(start, -14, timeZone), end: addDays(end, 21, timeZone) };
}

export function shiftAnchor(anchor, view, dir, timeZone = TIMEZONE) {
  if (view === "month") return addMonths(anchor, dir, timeZone);
  if (view === "week" || view === "agenda") return addDays(anchor, dir * 7, timeZone);
  return addDays(anchor, dir, timeZone);
}

export function rangeLabel(anchor, view, timeZone = TIMEZONE) {
  if (view === "day") return formatLongDate(anchor, timeZone);
  if (view === "month") return formatMonthYear(anchor, timeZone);
  if (view === "agenda") {
    return `From ${new Intl.DateTimeFormat("en-US", { timeZone, month: "long", day: "numeric" }).format(anchor)}`;
  }
  const start = startOfWeek(anchor, timeZone);
  const end = addDays(start, 6, timeZone);
  const a = zonedParts(start, timeZone);
  const b = zonedParts(end, timeZone);
  const left = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(start);
  if (a.year === b.year && a.month === b.month) {
    return `${left} – ${b.day}, ${b.year}`;
  }
  const right = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(end);
  return `${left} – ${right}`;
}

export function dateInputValue(date, timeZone = TIMEZONE) {
  return dayKey(date, timeZone);
}

export function timeInputValue(date, timeZone = TIMEZONE) {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
