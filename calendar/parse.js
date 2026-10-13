/** Natural-language quick add. Times are America/Chicago wall clocks. */

import { addDays, dayKey, zonedParts, zonedToUtc } from "./time.js";

const WEEKDAYS = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTHS = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const MERIDIAN = "a\\.?m\\.?|p\\.?m\\.?";

function cleanMeridian(value) {
  if (!value) return null;
  const v = value.toLowerCase().replace(/\./g, "");
  if (v.startsWith("a")) return "am";
  if (v.startsWith("p")) return "pm";
  return null;
}

function toMinutes(h, mi, mer) {
  if (!Number.isFinite(h) || !Number.isFinite(mi) || mi < 0 || mi > 59 || h < 0) return null;
  if (!mer) {
    if (h > 23) return null;
    return h * 60 + mi;
  }
  if (h < 1 || h > 12) return null;
  let hour = h % 12;
  if (mer === "pm") hour += 12;
  return hour * 60 + mi;
}

function namedTime(word) {
  switch (word.toLowerCase()) {
    case "midnight": return 0;
    case "morning": return 9 * 60;
    case "noon":
    case "midday": return 12 * 60;
    case "afternoon": return 15 * 60;
    case "evening": return 18 * 60;
    case "tonight": return 19 * 60;
    case "night": return 20 * 60;
    default: return null;
  }
}

function parseRangeMatch(m) {
  let mer1 = cleanMeridian(m[3]);
  let mer2 = cleanMeridian(m[6]);
  const h1 = +m[1];
  const mi1 = m[2] ? +m[2] : 0;
  const h2 = +m[4];
  const mi2 = m[5] ? +m[5] : 0;
  const startHasMin = m[2] != null && m[2] !== "";
  const endHasMin = m[5] != null && m[5] !== "";
  if (!mer1 && !mer2 && !(startHasMin && endHasMin)) return null;

  if (!mer1 && mer2) {
    mer1 = h1 > h2 && mer2 === "pm" && h1 !== 12 ? "am" : mer2;
    const s = toMinutes(h1, mi1, mer1);
    const e = toMinutes(h2, mi2, mer2);
    if (s != null && e != null && s >= e && mer1 === "pm") mer1 = "am";
  } else if (mer1 && !mer2) {
    mer2 = mer1;
    const s = toMinutes(h1, mi1, mer1);
    let e = toMinutes(h2, mi2, mer2);
    if (s != null && e != null && e <= s && mer1 === "am") {
      mer2 = "pm";
      e = toMinutes(h2, mi2, mer2);
    }
  }
  const start = toMinutes(h1, mi1, mer1);
  const end = toMinutes(h2, mi2, mer2);
  if (start == null || end == null) return null;
  return { start, end };
}

function consume(text, re) {
  const m = text.match(re);
  if (!m) return { text, match: null };
  return { text: text.replace(m[0], " "), match: m };
}

/**
 * Parse a quick-add phrase.
 * Returns null for empty input, otherwise
 * { title, start, end, allDay, hasExplicitDate, hasExplicitTime, hasExplicitDuration }.
 */
export function parseQuickAdd(input, now = new Date()) {
  let text = String(input || "").trim().replace(/\s+/g, " ");
  if (!text) return null;

  const result = {
    title: "",
    start: null,
    end: null,
    allDay: false,
    hasExplicitDate: false,
    hasExplicitTime: false,
    hasExplicitDuration: false,
    rollIfPast: false,
    rollDays: 1,
  };

  if (/\ball[\s-]?day\b/i.test(text)) {
    result.allDay = true;
    text = text.replace(/\ball[\s-]?day\b/ig, " ");
  }

  let durationMin = null;
  const durPatterns = [
    /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(\d+)\s*(?:minutes?|mins?|m)\b/i,
    /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i,
    /\b(?:for\s+)?(\d+)\s*(?:minutes?|mins?|m)\b/i,
    /\bhalf an hour\b/i,
    /\b(?:for\s+)?an hour\b/i,
  ];
  for (const re of durPatterns) {
    const m = text.match(re);
    if (!m) continue;
    if (m[1] != null && m[2] != null && /h/i.test(m[0]) && /m/i.test(m[0])) {
      durationMin = Math.round(parseFloat(m[1]) * 60 + parseInt(m[2], 10));
    } else if (m[1] != null && /h/i.test(m[0])) {
      durationMin = Math.round(parseFloat(m[1]) * 60);
    } else if (m[1] != null) {
      durationMin = parseInt(m[1], 10);
    } else if (/half/i.test(m[0])) {
      durationMin = 30;
    } else {
      durationMin = 60;
    }
    result.hasExplicitDuration = true;
    text = text.replace(m[0], " ");
    break;
  }

  let relativeMin = null;
  {
    const rel = text.match(/\bin\s+(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
    if (rel) {
      const n = parseInt(rel[1], 10);
      relativeMin = /h/i.test(rel[2]) ? n * 60 : n;
      text = text.replace(rel[0], " ");
      result.hasExplicitTime = true;
    }
  }

  let startMin = null;
  let endMin = null;
  const rangeRe = new RegExp(
    `\\b(\\d{1,2})(?::(\\d{2}))?\\s*(${MERIDIAN})?\\s*(?:-|–|—|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(${MERIDIAN})?\\b`,
    "i",
  );
  {
    const hit = consume(text, rangeRe);
    if (hit.match) {
      const parsed = parseRangeMatch(hit.match);
      if (parsed) {
        startMin = parsed.start;
        endMin = parsed.end;
        result.hasExplicitTime = true;
        text = hit.text;
      }
    }
  }

  if (startMin == null && relativeMin == null) {
    const namedRe = /\b(noon|midday|midnight|morning|afternoon|evening|tonight|night)\b/i;
    const clockRe = new RegExp(`\\b(\\d{1,2})(?::(\\d{2}))?\\s*(${MERIDIAN})\\b`, "i");
    const colonRe = /\b(\d{1,2}):(\d{2})\b/;
    const named = text.match(namedRe);
    const clock = text.match(clockRe);
    const colon = text.match(colonRe);
    if (named) {
      startMin = namedTime(named[1]);
      result.hasExplicitTime = true;
      if (named[1].toLowerCase() === "tonight") result.tonight = true;
      text = text.replace(named[0], " ");
    } else if (clock) {
      startMin = toMinutes(+clock[1], clock[2] ? +clock[2] : 0, cleanMeridian(clock[3]));
      if (startMin != null) {
        result.hasExplicitTime = true;
        text = text.replace(clock[0], " ");
      }
    } else if (colon) {
      const h = +colon[1];
      const mi = +colon[2];
      if (h <= 23 && mi <= 59) {
        startMin = h * 60 + mi;
        result.hasExplicitTime = true;
        text = text.replace(colon[0], " ");
      }
    }
  }

  let dateParts = null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const monthRe = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i;
  const month = text.match(monthRe);
  const weekdayRe = /\b(next|this)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i;
  const wd = text.match(weekdayRe);
  const relDay = text.match(/\b(today|tomorrow|tonight|tmrw|tmr)\b/i);
  const nowP = zonedParts(now);

  if (iso) {
    dateParts = { y: +iso[1], m: +iso[2], d: +iso[3] };
    text = text.replace(iso[0], " ");
    result.hasExplicitDate = true;
  } else if (month) {
    dateParts = { y: month[3] ? +month[3] : nowP.year, m: MONTHS[month[1].toLowerCase()], d: +month[2] };
    text = text.replace(month[0], " ");
    result.hasExplicitDate = true;
    if (!month[3]) {
      const candidate = zonedToUtc(dateParts.y, dateParts.m, dateParts.d, 12, 0);
      if (candidate.getTime() < now.getTime() - 36 * 3600000) dateParts.y += 1;
    }
  } else if (slash) {
    let y = slash[3] ? +slash[3] : nowP.year;
    if (y < 100) y += 2000;
    dateParts = { y, m: +slash[1], d: +slash[2] };
    text = text.replace(slash[0], " ");
    result.hasExplicitDate = true;
  } else if (relDay) {
    const word = relDay[1].toLowerCase();
    let add = 0;
    if (word === "tomorrow" || word === "tmrw" || word === "tmr") add = 1;
    if (word === "tonight") result.tonight = true;
    const dt = addDays(zonedToUtc(nowP.year, nowP.month, nowP.day, 12, 0), add);
    const p = zonedParts(dt);
    dateParts = { y: p.year, m: p.month, d: p.day };
    text = text.replace(relDay[0], " ");
    result.hasExplicitDate = true;
  } else if (wd) {
    const force = (wd[1] || "").toLowerCase();
    const target = WEEKDAYS[wd[2].toLowerCase()];
    let delta = (target - nowP.weekdayIndex + 7) % 7;
    if (force === "next") delta = delta === 0 ? 7 : delta + 7;
    const dt = addDays(zonedToUtc(nowP.year, nowP.month, nowP.day, 12, 0), delta);
    const p = zonedParts(dt);
    dateParts = { y: p.year, m: p.month, d: p.day };
    text = text.replace(wd[0], " ");
    result.hasExplicitDate = true;
    if (!force && delta === 0) {
      result.rollIfPast = true;
      result.rollDays = 7;
    }
  } else if (result.tonight) {
    dateParts = { y: nowP.year, m: nowP.month, d: nowP.day };
    result.hasExplicitDate = true;
  } else {
    dateParts = { y: nowP.year, m: nowP.month, d: nowP.day };
    result.rollIfPast = true;
    result.rollDays = 1;
  }

  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(/^(?:at|on|from)\s+/i, "").replace(/\s+(?:at|on|from)$/i, "").trim();
  text = text.replace(/^[-–—:,]+|[-–—:,]+$/g, "").trim();
  result.title = text;

  if (result.allDay) {
    result.start = zonedToUtc(dateParts.y, dateParts.m, dateParts.d, 0, 0);
    result.end = addDays(result.start, 1);
    delete result.rollIfPast;
    delete result.rollDays;
    delete result.tonight;
    return result;
  }

  if (relativeMin != null && startMin == null) {
    const dur = durationMin ?? 60;
    result.start = new Date(now.getTime() + relativeMin * 60000);
    result.end = new Date(result.start.getTime() + dur * 60000);
    delete result.rollIfPast;
    delete result.rollDays;
    delete result.tonight;
    return result;
  }

  if (startMin == null) {
    if (result.hasExplicitDate) {
      startMin = result.tonight ? 19 * 60 : 9 * 60;
    } else {
      let hour = nowP.minute === 0 && nowP.second === 0 ? nowP.hour : nowP.hour + 1;
      if (hour >= 24) {
        hour = 9;
        const dt = addDays(zonedToUtc(dateParts.y, dateParts.m, dateParts.d, 12, 0), 1);
        const p = zonedParts(dt);
        dateParts = { y: p.year, m: p.month, d: p.day };
      }
      startMin = hour * 60;
    }
  } else if (result.rollIfPast && result.hasExplicitTime) {
    const candidate = zonedToUtc(dateParts.y, dateParts.m, dateParts.d, Math.floor(startMin / 60), startMin % 60);
    if (candidate.getTime() <= now.getTime() - 60000) {
      const dt = addDays(zonedToUtc(dateParts.y, dateParts.m, dateParts.d, 12, 0), result.rollDays);
      const p = zonedParts(dt);
      dateParts = { y: p.year, m: p.month, d: p.day };
    }
  }

  const sh = Math.floor(startMin / 60);
  const sm = startMin % 60;
  result.start = zonedToUtc(dateParts.y, dateParts.m, dateParts.d, sh, sm);

  if (endMin != null) {
    let endParts = dateParts;
    if (endMin <= startMin) {
      const dt = addDays(zonedToUtc(dateParts.y, dateParts.m, dateParts.d, 12, 0), 1);
      const p = zonedParts(dt);
      endParts = { y: p.year, m: p.month, d: p.day };
    }
    result.end = zonedToUtc(endParts.y, endParts.m, endParts.d, Math.floor(endMin / 60), endMin % 60);
  } else {
    result.end = new Date(result.start.getTime() + (durationMin ?? 60) * 60000);
  }

  delete result.rollIfPast;
  delete result.rollDays;
  delete result.tonight;
  return result;
}

export function describeParsed(parsed) {
  if (!parsed) return "";
  if (parsed.allDay) {
    const endInclusive = addDays(parsed.end, -1);
    const same = dayKey(parsed.start) === dayKey(endInclusive);
    const when = same
      ? `${new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "short", day: "numeric" }).format(parsed.start)} · all day`
      : `${dayKey(parsed.start)} – ${dayKey(endInclusive)} · all day`;
    return parsed.title ? `${parsed.title} · ${when}` : when;
  }
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed.start);
  const end = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed.end);
  const title = parsed.title || "Untitled";
  return `${title} · ${when} – ${end}`;
}
