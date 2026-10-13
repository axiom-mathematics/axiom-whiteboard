import { HOME_TZ, dowCode } from "./time.js";
import {
  addDays,
  cmpYmd,
  todayYmd,
  weekdayIndex,
  ymdStr,
  zonedDate,
  zonedTimeToUtc,
} from "./time.js";

const WEEKDAYS = [
  ["sunday", 0], ["sun", 0],
  ["monday", 1], ["mon", 1],
  ["tuesday", 2], ["tues", 2], ["tue", 2],
  ["wednesday", 3], ["wed", 3],
  ["thursday", 4], ["thurs", 4], ["thur", 4], ["thu", 4],
  ["friday", 5], ["fri", 5],
  ["saturday", 6], ["sat", 6],
].sort((a, b) => b[0].length - a[0].length);

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");
const WD_ALT = WEEKDAYS.map(([n]) => n).join("|");

function take(text, regex) {
  const m = text.match(regex);
  if (!m || m.index == null) return null;
  const next = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
  return { m, text: next };
}

function parseHourMinute(hStr, minStr, ap) {
  let h = Number(hStr);
  const minute = minStr == null || minStr === "" ? 0 : Number(minStr);
  if (!Number.isFinite(h) || !Number.isFinite(minute) || minute > 59) return null;
  if (ap) {
    const mer = ap.toLowerCase();
    if (h < 1 || h > 12) return null;
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
  } else if (h > 23) return null;
  return h * 60 + minute;
}

function nextWeekday(from, target, { forceNext = false, allowToday = true } = {}) {
  const dow = weekdayIndex(from);
  let delta = (target - dow + 7) % 7;
  if (delta === 0 && !allowToday) delta = 7;
  if (forceNext) {
    if (delta === 0) delta = 7;
    else delta += 7;
  }
  return addDays(from, delta);
}

function cleanTitle(text) {
  let t = text.replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:at|on|from|the)\b[\s,]*/i, "");
  t = t.replace(/[\s,]*(?:at|on|from)$/i, "");
  t = t.replace(/^[,.\-–]+|[,.\-–]+$/g, "").trim();
  return t || "Busy";
}

/**
 * Natural-language quick add.
 * Examples: "Algebra w/ Maya tue 4pm 1h", "lunch tomorrow noon", "video call Fri 3pm".
 */
export function parseQuickAdd(input, now = new Date(), timeZone = HOME_TZ) {
  let text = String(input ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const addMeet = /\b(with meet|google meet|video call|add meet)\b/i.test(text);
  text = text.replace(/\b(with meet|google meet|add meet)\b/ig, " ").replace(/\s+/g, " ").trim();

  let recurrence = null;
  let recurDow = null;

  let got = take(text, new RegExp(`\\bevery\\s+(${WD_ALT})\\b`, "i"));
  if (got) {
    const name = got.m[1].toLowerCase();
    recurDow = WEEKDAYS.find(([n]) => n === name)[1];
    recurrence = [`RRULE:FREQ=WEEKLY;BYDAY=${dowCode(recurDow)}`];
    text = got.text;
  }
  if (!recurrence) {
    got = take(text, /\bevery\s+weekday\b/i) || take(text, /\bweekdays\b/i);
    if (got) {
      recurrence = ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];
      text = got.text;
    }
  }
  if (!recurrence) {
    got = take(text, /\b(every\s+day|daily)\b/i);
    if (got) {
      recurrence = ["RRULE:FREQ=DAILY"];
      text = got.text;
    }
  }
  if (!recurrence) {
    got = take(text, /\b(every\s+week|weekly)\b/i);
    if (got) {
      recurrence = ["RRULE:FREQ=WEEKLY"];
      text = got.text;
    }
  }

  let durationMin = null;
  got = take(text, /\b(?:for\s+)?(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:in(?:ute)?s?)?\b/i);
  if (got) {
    durationMin = Number(got.m[1]) * 60 + Number(got.m[2]);
    text = got.text;
  }
  if (durationMin == null) {
    got = take(text, /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/i);
    if (got) {
      durationMin = Math.round(Number(got.m[1]) * 60);
      text = got.text;
    }
  }
  if (durationMin == null) {
    got = take(text, /\b(?:for\s+)?(\d+)\s*(minutes?|mins?|m)\b/i);
    if (got) {
      durationMin = Number(got.m[1]);
      text = got.text;
    }
  }

  let startMin = null;
  let endMin = null;
  let timeExplicit = false;

  got = take(text, /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (got) {
    const endAp = got.m[6];
    const startAp = got.m[3] || endAp;
    startMin = parseHourMinute(got.m[1], got.m[2], startAp);
    endMin = parseHourMinute(got.m[4], got.m[5], endAp);
    if (startMin != null && endMin != null && endMin <= startMin) endMin += 12 * 60;
    timeExplicit = startMin != null;
    text = got.text;
  }

  if (!timeExplicit) {
    const timeRe = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
    const found = [];
    let guard = text;
    for (let i = 0; i < 2; i++) {
      const m = guard.match(timeRe);
      if (!m) break;
      found.push(m);
      guard = `${guard.slice(0, m.index)} ${guard.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
    }
    if (found[0]) {
      startMin = parseHourMinute(found[0][1], found[0][2], found[0][3]);
      timeExplicit = startMin != null;
      if (found[1]) endMin = parseHourMinute(found[1][1], found[1][2], found[1][3]);
      text = guard;
    }
  }

  if (startMin == null) {
    got = take(text, /\b(\d{1,2}):(\d{2})\b/);
    if (got) {
      startMin = parseHourMinute(got.m[1], got.m[2], null);
      timeExplicit = startMin != null;
      text = got.text;
    }
  }

  let tonight = false;
  if (startMin == null) {
    if (/\bnoon\b/i.test(text)) {
      startMin = 12 * 60;
      timeExplicit = true;
      text = text.replace(/\bnoon\b/i, " ").replace(/\s+/g, " ").trim();
    } else if (/\bmidnight\b/i.test(text)) {
      startMin = 0;
      timeExplicit = true;
      text = text.replace(/\bmidnight\b/i, " ").replace(/\s+/g, " ").trim();
    }
  }

  const today = todayYmd(now, timeZone);
  let date = null;
  let dateExplicit = false;

  const dateCandidates = [];
  const consider = (regex, build) => {
    const m = text.match(regex);
    if (!m) return;
    const built = build(m);
    if (built) dateCandidates.push({ index: m.index, len: m[0].length, ...built });
  };

  consider(/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => ({
    date: { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) },
  }));
  consider(new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "i"), (m) => {
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : today.y;
    if (day < 1 || day > 31) return null;
    return { date: { y: year, m: month, d: day } };
  });
  consider(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})(?:,?\\s*(\\d{4}))?\\b`, "i"), (m) => {
    const day = Number(m[1]);
    const month = MONTHS[m[2].toLowerCase()];
    const year = m[3] ? Number(m[3]) : today.y;
    if (day < 1 || day > 31) return null;
    return { date: { y: year, m: month, d: day } };
  });
  consider(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    let year = today.y;
    if (m[3]) {
      year = Number(m[3]);
      if (year < 100) year += 2000;
    }
    return { date: { y: year, m: month, d: day } };
  });
  consider(/\b(today|tomorrow|tonight|yesterday)\b/i, (m) => {
    const w = m[1].toLowerCase();
    if (w === "tomorrow") return { date: addDays(today, 1) };
    if (w === "yesterday") return { date: addDays(today, -1) };
    if (w === "tonight") return { date: today, tonight: true };
    return { date: today };
  });
  consider(/\bin\s+(\d+)\s+(days?|weeks?)\b/i, (m) => {
    const n = Number(m[1]);
    const days = /week/i.test(m[2]) ? n * 7 : n;
    return { date: addDays(today, days) };
  });
  consider(new RegExp(`\\b(next|this)\\s+(${WD_ALT})\\b`, "i"), (m) => {
    const name = m[2].toLowerCase();
    const target = WEEKDAYS.find(([n]) => n === name)[1];
    if (m[1].toLowerCase() === "this") {
      const delta = target - weekdayIndex(today);
      return { date: addDays(today, delta), weekday: true };
    }
    return { date: nextWeekday(today, target, { allowToday: false }), weekday: true };
  });
  consider(new RegExp(`\\b(${WD_ALT})\\b`, "i"), (m) => {
    const name = m[1].toLowerCase();
    const target = WEEKDAYS.find(([n]) => n === name)[1];
    return { date: null, target, bareWeekday: true };
  });

  dateCandidates.sort((a, b) => a.index - b.index);
  const chosen = dateCandidates[0];
  if (chosen) {
    text = `${text.slice(0, chosen.index)} ${text.slice(chosen.index + chosen.len)}`.replace(/\s+/g, " ").trim();
    if (chosen.tonight) tonight = true;
    if (chosen.bareWeekday) {
      let allowToday = true;
      if (timeExplicit && chosen.target === weekdayIndex(today)) {
        const candidate = zonedDate(today, startMin, timeZone);
        allowToday = candidate.getTime() > now.getTime() + 30 * 1000;
      }
      date = nextWeekday(today, chosen.target, { allowToday });
      dateExplicit = true;
    } else {
      date = chosen.date;
      dateExplicit = true;
    }
  }

  if (!date && recurDow != null) {
    let allowToday = true;
    if (timeExplicit && recurDow === weekdayIndex(today)) {
      const candidate = zonedDate(today, startMin ?? 0, timeZone);
      allowToday = candidate.getTime() > now.getTime() + 30 * 1000;
    }
    date = nextWeekday(today, recurDow, { allowToday });
    dateExplicit = true;
  }

  if (tonight && startMin == null) {
    startMin = 18 * 60;
    timeExplicit = true;
  }

  if (!date) {
    date = today;
    if (timeExplicit) {
      const candidate = zonedDate(today, startMin, timeZone);
      if (candidate.getTime() <= now.getTime() + 30 * 1000) date = addDays(today, 1);
    }
  }

  const allDay = !timeExplicit;
  let start;
  let end;
  if (allDay) {
    start = zonedDate(date, 0, timeZone);
    end = zonedDate(addDays(date, 1), 0, timeZone);
  } else {
    start = zonedDate(date, startMin, timeZone);
    if (endMin != null) {
      let endDate = date;
      if (endMin >= 24 * 60) {
        endMin -= 24 * 60;
        endDate = addDays(date, 1);
      }
      end = zonedDate(endDate, endMin, timeZone);
      if (end <= start) end = zonedDate(addDays(date, 1), endMin, timeZone);
    } else {
      const mins = durationMin == null ? 60 : durationMin;
      end = new Date(start.getTime() + mins * 60000);
    }
  }

  if (cmpYmd(date, { y: 1, m: 1, d: 1 }) < 0) return null;

  return {
    title: cleanTitle(text),
    addMeet,
    allDay,
    start,
    end,
    date,
    dateExplicit,
    recurrence,
  };
}

const DAY_INDEX = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

export function splitRecurrence(lines) {
  const rrules = [];
  const rest = [];
  for (const line of lines || []) {
    if (String(line).toUpperCase().startsWith("RRULE:")) rrules.push(line);
    else rest.push(line);
  }
  return { rrules, rest };
}

export function parseRecurrence(lines) {
  const { rrules, rest } = splitRecurrence(lines);
  if (rrules.length !== 1) return { preset: lines?.length ? "raw" : "none", raw: lines || [], rest };
  const body = rrules[0].replace(/^RRULE:/i, "");
  const map = {};
  for (const part of body.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) map[k.toUpperCase()] = v;
  }
  const freq = map.FREQ;
  if (!freq) return { preset: "raw", raw: lines, rest };
  const interval = Number(map.INTERVAL || 1);
  const byDay = map.BYDAY ? map.BYDAY.split(",").map((d) => d.replace(/^[+-]?\d+/, "")).filter((d) => DAY_INDEX[d] != null) : [];
  let endType = "never";
  let count = 10;
  let endDate = "";
  if (map.COUNT) {
    endType = "count";
    count = Number(map.COUNT);
  } else if (map.UNTIL) {
    endType = "on";
    const u = map.UNTIL;
    endDate = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  }
  const weekdays = ["MO", "TU", "WE", "TH", "FR"];
  const isWeekdays = freq === "WEEKLY" && byDay.length === 5 && weekdays.every((d) => byDay.includes(d)) && interval === 1;
  let preset = "custom";
  if (isWeekdays) preset = "weekdays";
  else if (freq === "DAILY" && interval === 1 && !byDay.length) preset = "daily";
  else if (freq === "WEEKLY" && interval === 1 && byDay.length <= 1) preset = "weekly";
  else if (freq === "MONTHLY" && interval === 1) preset = "monthly";
  else if (freq === "YEARLY" && interval === 1) preset = "yearly";
  else if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) preset = "raw";
  if (preset === "raw") return { preset, raw: lines, rest };
  return {
    preset,
    freq,
    interval,
    byDay,
    endType,
    count,
    endDate,
    rest,
    raw: lines,
  };
}

export function buildRecurrence(model, start, allDay, timeZone = HOME_TZ) {
  if (!model || model.preset === "none") return null;
  if (model.preset === "raw") return model.raw || null;
  const freq = model.preset === "weekdays" ? "WEEKLY"
    : model.preset === "daily" ? "DAILY"
    : model.preset === "weekly" ? "WEEKLY"
    : model.preset === "monthly" ? "MONTHLY"
    : model.preset === "yearly" ? "YEARLY"
    : model.freq || "WEEKLY";
  const bits = [`FREQ=${freq}`];
  const interval = Number(model.interval || 1);
  if (interval > 1) bits.push(`INTERVAL=${interval}`);
  if (model.preset === "weekdays") bits.push("BYDAY=MO,TU,WE,TH,FR");
  else if (freq === "WEEKLY") {
    const days = model.byDay?.length ? model.byDay : [dowCode(weekdayIndex(start))];
    bits.push(`BYDAY=${days.join(",")}`);
  } else if (freq === "MONTHLY") {
    bits.push(`BYMONTHDAY=${start.d}`);
  }
  if (model.endType === "count" && model.count) bits.push(`COUNT=${Number(model.count)}`);
  if (model.endType === "on" && model.endDate) {
    const [y, m, d] = model.endDate.split("-").map(Number);
    if (allDay) bits.push(`UNTIL=${String(y)}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`);
    else {
      const end = zonedTimeToUtc(y, m, d, 23, 59, timeZone);
      const stamp = end.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      bits.push(`UNTIL=${stamp}`);
    }
  }
  const rule = `RRULE:${bits.join(";")}`;
  return [rule, ...(model.rest || []).filter((l) => !String(l).toUpperCase().startsWith("RRULE:"))];
}

export function capRruleUntil(lines, untilDate) {
  const { rrules, rest } = splitRecurrence(lines);
  const base = rrules[0] || "RRULE:FREQ=DAILY";
  const body = base.replace(/^RRULE:/i, "").split(";").filter((p) => {
    const k = p.split("=")[0].toUpperCase();
    return k !== "UNTIL" && k !== "COUNT";
  });
  const stamp = untilDate.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  body.push(`UNTIL=${stamp}`);
  return [`RRULE:${body.join(";")}`, ...rest];
}

export function describeRecurrence(lines) {
  const parsed = parseRecurrence(lines);
  if (parsed.preset === "none") return "Does not repeat";
  if (parsed.preset === "raw") return "Custom repeat";
  const names = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", weekdays: "Every weekday", custom: "Custom" };
  let s = names[parsed.preset] || "Repeats";
  if (parsed.preset === "weekly" && parsed.byDay?.length === 1) {
    const idx = DAY_INDEX[parsed.byDay[0]];
    if (idx != null) s = `Weekly on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][idx]}`;
  }
  if (parsed.interval > 1) s = `Every ${parsed.interval} ${parsed.freq === "WEEKLY" ? "weeks" : parsed.freq === "DAILY" ? "days" : parsed.freq === "MONTHLY" ? "months" : "years"}`;
  if (parsed.endType === "count") s += `, ${parsed.count} times`;
  if (parsed.endType === "on" && parsed.endDate) s += `, until ${parsed.endDate}`;
  return s;
}

export function reminderLabel(minutes) {
  const m = Number(minutes);
  if (m === 0) return "At time of event";
  if (m % 1440 === 0) {
    const d = m / 1440;
    return d === 1 ? "1 day before" : `${d} days before`;
  }
  if (m % 60 === 0) {
    const h = m / 60;
    return h === 1 ? "1 hour before" : `${h} hours before`;
  }
  return m === 1 ? "1 minute before" : `${m} minutes before`;
}
