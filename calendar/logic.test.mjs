import assert from "node:assert/strict";
import {
  WYZANT_CALENDAR_ID,
  calendarWritable,
  offsetAdjustment,
  resolveOffsetMinutes,
} from "./config.js";
import { layoutOverlaps } from "./layout.js";
import { describeParsed, parseQuickAdd } from "./parse.js";
import {
  addDays,
  dayKey,
  formatChicagoDateTime,
  minutesSinceMidnight,
  startOfWeek,
  zonedParts,
  zonedToUtc,
} from "./time.js";

const mondayMorning = zonedToUtc(2026, 10, 12, 10, 0);
const tuesdayMorning = zonedToUtc(2026, 10, 13, 9, 0);
const tuesdayEvening = zonedToUtc(2026, 10, 13, 17, 0);

function at(parsed) {
  const p = zonedParts(parsed.start);
  const e = zonedParts(parsed.end);
  return {
    title: parsed.title,
    day: dayKey(parsed.start),
    start: `${p.hour}:${String(p.minute).padStart(2, "0")}`,
    end: `${e.hour}:${String(e.minute).padStart(2, "0")}`,
    endDay: dayKey(parsed.end),
    allDay: parsed.allDay,
  };
}

const maya = parseQuickAdd("Algebra w/ Maya tue 4pm 1h", mondayMorning);
assert.deepEqual(at(maya), {
  title: "Algebra w/ Maya",
  day: "2026-10-13",
  start: "16:00",
  end: "17:00",
  endDay: "2026-10-13",
  allDay: false,
});

const lunch = parseQuickAdd("lunch tomorrow noon", tuesdayMorning);
assert.deepEqual(at(lunch), {
  title: "lunch",
  day: "2026-10-14",
  start: "12:00",
  end: "13:00",
  endDay: "2026-10-14",
  allDay: false,
});

const algebra2 = parseQuickAdd("Algebra 2 homework", tuesdayMorning);
assert.equal(algebra2.title, "Algebra 2 homework");
assert.equal(algebra2.hasExplicitTime, false);

const dentist = parseQuickAdd("dentist oct 20 9am", tuesdayMorning);
assert.equal(dentist.title, "dentist");
assert.equal(dayKey(dentist.start), "2026-10-20");
assert.equal(zonedParts(dentist.start).hour, 9);

const study = parseQuickAdd("study friday 3:30-4:30pm", tuesdayMorning);
assert.equal(study.title, "study");
assert.equal(dayKey(study.start), "2026-10-16");
assert.equal(zonedParts(study.start).hour, 15);
assert.equal(zonedParts(study.start).minute, 30);
assert.equal(zonedParts(study.end).hour, 16);
assert.equal(zonedParts(study.end).minute, 30);

const rolled = parseQuickAdd("tue 4pm", tuesdayEvening);
assert.equal(dayKey(rolled.start), "2026-10-20");
const stay = parseQuickAdd("this tue 4pm", tuesdayEvening);
assert.equal(dayKey(stay.start), "2026-10-13");

const allDay = parseQuickAdd("conference all day tomorrow", tuesdayMorning);
assert.equal(allDay.allDay, true);
assert.equal(allDay.title, "conference");
assert.equal(dayKey(allDay.start), "2026-10-14");
assert.equal(dayKey(allDay.end), "2026-10-15");

assert.match(describeParsed(maya), /Algebra w\/ Maya/);

const summer = zonedToUtc(2026, 10, 13, 16, 0);
assert.equal(summer.toISOString(), "2026-10-13T21:00:00.000Z");
assert.equal(formatChicagoDateTime(summer), "2026-10-13T16:00:00-05:00");
const winter = zonedToUtc(2026, 1, 15, 16, 0);
assert.equal(winter.toISOString(), "2026-01-15T22:00:00.000Z");
assert.equal(formatChicagoDateTime(winter), "2026-01-15T16:00:00-06:00");
assert.equal(dayKey(startOfWeek(tuesdayMorning)), "2026-10-11");
assert.equal(dayKey(addDays(summer, 1)), "2026-10-14");
assert.equal(minutesSinceMidnight(summer), 16 * 60);

const stored = zonedToUtc(2026, 10, 13, 18, 0);
const displayed = new Date(stored.getTime() - 120 * 60000);
assert.equal(zonedParts(displayed).hour, 16);
assert.equal(new Date(displayed.getTime() + 120 * 60000).getTime(), stored.getTime());

assert.equal(resolveOffsetMinutes(WYZANT_CALENDAR_ID, {}), -120);
assert.equal(resolveOffsetMinutes(WYZANT_CALENDAR_ID, { [WYZANT_CALENDAR_ID]: 0 }), 0);
assert.equal(resolveOffsetMinutes("primary", {}), 0);
assert.equal(resolveOffsetMinutes("primary", { primary: 30 }), 30);
assert.equal(offsetAdjustment(WYZANT_CALENDAR_ID, -120).tooltip, "Wyzant times adjusted -2h");
assert.equal(offsetAdjustment(WYZANT_CALENDAR_ID, -120).label, "−2h");
assert.equal(offsetAdjustment("primary", 0), null);
assert.equal(calendarWritable({ id: WYZANT_CALENDAR_ID, accessRole: "owner" }), false);
assert.equal(calendarWritable({ id: "primary", accessRole: "owner" }), true);
assert.equal(calendarWritable({ id: "class", accessRole: "reader" }), false);

const packed = layoutOverlaps([
  { id: "a", startMin: 600, endMin: 720 },
  { id: "b", startMin: 630, endMin: 660 },
  { id: "c", startMin: 660, endMin: 720 },
]);
const byId = Object.fromEntries(packed.map((item) => [item.id, item]));
assert.equal(byId.a.cols, 2);
assert.equal(byId.b.col, 1);
assert.equal(byId.c.col, 1);
assert.notEqual(byId.a.col, byId.b.col);

const separate = layoutOverlaps([
  { id: "a", startMin: 540, endMin: 600 },
  { id: "b", startMin: 600, endMin: 660 },
]);
assert.equal(separate.every((item) => item.cols === 1), true);

const spring = addDays(zonedToUtc(2026, 3, 7, 12, 0), 1);
assert.equal(dayKey(spring), "2026-03-08");
const fall = addDays(zonedToUtc(2026, 10, 31, 12, 0), 1);
assert.equal(dayKey(fall), "2026-11-01");

console.log("logic tests passed");
