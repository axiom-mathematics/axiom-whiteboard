import { HOME_TZ } from "../config.js";
import { pad } from "./util.js";

export { HOME_TZ };

const DOW = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parts(date, timeZone = HOME_TZ) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  });
  const bag = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
    weekday: bag.weekday,
  };
}

/** Convert a civil date/time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone = HOME_TZ) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(utc), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const diff = desired - asUtc;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

export function ymd(y, m, d) {
  return { y, m, d };
}

export function fromYmd(str) {
  const [y, m, d] = String(str).split("-").map(Number);
  return { y, m, d };
}

export function ymdStr(v) {
  return `${v.y}-${pad(v.m)}-${pad(v.d)}`;
}

export function ymdFromDate(date, timeZone = HOME_TZ) {
  const p = parts(date, timeZone);
  return { y: p.year, m: p.month, d: p.day };
}

export function todayYmd(now = new Date(), timeZone = HOME_TZ) {
  return ymdFromDate(now, timeZone);
}

export function cmpYmd(a, b) {
  if (a.y !== b.y) return a.y - b.y;
  if (a.m !== b.m) return a.m - b.m;
  return a.d - b.d;
}

export function addDays(v, n) {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d));
  t.setUTCDate(t.getUTCDate() + n);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function weekdayIndex(v) {
  return new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();
}

export function startOfWeek(v, weekStart = 0) {
  const dow = weekdayIndex(v);
  const delta = (dow - weekStart + 7) % 7;
  return addDays(v, -delta);
}

export function addMonths(v, n) {
  const m0 = v.m - 1 + n;
  const y = v.y + Math.floor(m0 / 12);
  const m = ((m0 % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { y, m: m + 1, d: Math.min(v.d, last) };
}

export function monthGrid(year, month, weekStart = 0) {
  const first = { y: year, m: month, d: 1 };
  const start = startOfWeek(first, weekStart);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(addDays(start, i));
  return days;
}

export function zonedDate(v, minutes, timeZone = HOME_TZ) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return zonedTimeToUtc(v.y, v.m, v.d, hh, mm, timeZone);
}

export function minutesSinceMidnight(date, timeZone = HOME_TZ) {
  const p = parts(date, timeZone);
  return p.hour * 60 + p.minute;
}

export function shiftHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000);
}

export function isValidTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function formatTime(date, timeZone = HOME_TZ) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatCompactTime(date, timeZone = HOME_TZ) {
  const p = parts(date, timeZone);
  const h = p.hour % 12 || 12;
  const ap = p.hour < 12 ? "am" : "pm";
  return `${h}:${pad(p.minute)}${ap}`;
}

export function zoneAbbrev(date, timeZone = HOME_TZ) {
  const bits = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "short",
  }).formatToParts(date);
  return bits.find((p) => p.type === "timeZoneName")?.value || "";
}

export function formatRange(start, end, timeZone = HOME_TZ) {
  const same = cmpYmd(ymdFromDate(start, timeZone), ymdFromDate(end, timeZone)) === 0;
  const a = formatTime(start, timeZone);
  const b = formatTime(end, timeZone);
  if (same) return `${a} – ${b}`;
  const endDay = DOW_SHORT[weekdayIndex(ymdFromDate(end, timeZone))];
  return `${a} – ${b} ${endDay}`;
}

export function formatDayHeading(v) {
  const dt = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dt);
}

export function formatFullDate(v) {
  const dt = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}

export function formatMonthTitle(v) {
  const dt = new Date(Date.UTC(v.y, v.m - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(dt);
}

export function formatHourLabel(hour) {
  if (hour === 0 || hour === 24) return "";
  const h = hour % 12 || 12;
  const ap = hour < 12 ? "AM" : "PM";
  return `${h} ${ap}`;
}

export function gcalDateTime(date, timeZone = HOME_TZ) {
  const p = parts(date, timeZone);
  const dateTime = `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00`;
  return { dateTime, timeZone };
}

export function gcalAllDay(startYmd, endExclusiveYmd) {
  return {
    start: { date: ymdStr(startYmd) },
    end: { date: ymdStr(endExclusiveYmd) },
  };
}

/**
 * Raw Google event → absolute bounds.
 * All-day end is exclusive, matching the API.
 * Timed dates are absolute instants (offset is applied later, for display only).
 */
export function rawBounds(event) {
  if (event.start?.date) {
    return {
      allDay: true,
      startYmd: fromYmd(event.start.date),
      endYmd: fromYmd(event.end.date),
      start: null,
      end: null,
    };
  }
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  return { allDay: false, start, end, startYmd: null, endYmd: null };
}

export function displayBounds(event, offsetHours = 0, timeZone = HOME_TZ) {
  const raw = rawBounds(event);
  if (raw.allDay || !offsetHours) {
    if (!raw.allDay) {
      return {
        ...raw,
        startYmd: ymdFromDate(raw.start, timeZone),
        endYmd: ymdFromDate(raw.end, timeZone),
      };
    }
    return raw;
  }
  const start = shiftHours(raw.start, offsetHours);
  const end = shiftHours(raw.end, offsetHours);
  return {
    allDay: false,
    start,
    end,
    startYmd: ymdFromDate(start, timeZone),
    endYmd: ymdFromDate(end, timeZone),
  };
}

export function dayWindow(v, timeZone = HOME_TZ) {
  return {
    start: zonedDate(v, 0, timeZone),
    end: zonedDate(addDays(v, 1), 0, timeZone),
  };
}

export function eventCoversDay(bounds, v, timeZone = HOME_TZ) {
  if (bounds.allDay) return cmpYmd(bounds.startYmd, v) <= 0 && cmpYmd(v, bounds.endYmd) < 0;
  const w = dayWindow(v, timeZone);
  return bounds.start < w.end && bounds.end > w.start;
}

export function clipToDay(bounds, v, timeZone = HOME_TZ) {
  const w = dayWindow(v, timeZone);
  const start = bounds.start < w.start ? w.start : bounds.start;
  const end = bounds.end > w.end ? w.end : bounds.end;
  const startMin = bounds.start <= w.start ? 0 : minutesSinceMidnight(bounds.start, timeZone);
  let endMin = bounds.end >= w.end ? 24 * 60 : minutesSinceMidnight(bounds.end, timeZone);
  if (endMin <= startMin) endMin = Math.min(24 * 60, startMin + 15);
  return { start, end, startMin, endMin };
}

export function rangeLabel(view, anchor, weekStart = 0) {
  if (view === "day") return formatFullDate(anchor);
  if (view === "week") {
    const s = startOfWeek(anchor, weekStart);
    const e = addDays(s, 6);
    if (s.y === e.y && s.m === e.m) {
      const month = formatMonthTitle(s).replace(` ${s.y}`, "");
      return `${month} ${s.d} – ${e.d}, ${s.y}`;
    }
    const a = formatDayHeading(s);
    const b = formatDayHeading(e);
    return `${a} – ${b}, ${e.y}`;
  }
  if (view === "agenda") return formatMonthTitle(anchor);
  return formatMonthTitle(anchor);
}

export function viewDays(view, anchor, weekStart = 0) {
  if (view === "day") return [anchor];
  if (view === "week") {
    const s = startOfWeek(anchor, weekStart);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }
  return [];
}

export function shiftAnchor(view, anchor, dir, weekStart = 0) {
  if (view === "day" || view === "agenda") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, dir * 7);
  return addMonths({ ...anchor, d: 1 }, dir).d ? addMonths(anchor, dir) : addMonths(anchor, dir);
}

export function untilStamp(date) {
  const t = new Date(date.getTime() - 1000);
  return t.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function dowCode(index) {
  return DOW[index];
}

export function listTimeZones() {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [HOME_TZ, "America/New_York", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Pacific/Honolulu", "Europe/Zurich", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney"];
  }
}
