import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CLIENT_ID, HOME_TZ, PLACEHOLDER_CLIENT_ID, WYZANT_CALENDAR_ID } from "../calendar/config.js";
import { nearestEventColorId, displayColor, normalizeHex } from "../calendar/js/colors.js";
import { buildInsertBody, buildPatchBody, buildTimePatch, meetAction } from "../calendar/js/eventbody.js";
import { parseQuickAdd } from "../calendar/js/parse.js";
import { offsetBadge, offsetHours, calendarLocked } from "../calendar/js/policy.js";
import {
  displayBounds,
  parts,
  shiftHours,
  zonedTimeToUtc,
  todayYmd,
} from "../calendar/js/time.js";
import {
  applyUpdates,
  clocksForEvent,
  indexPeople,
  inferUpdates,
  partnerNames,
  zoneFromAddress,
  zoneFromText,
} from "../calendar/js/zones.js";
import { mergeSettings, resolveClientId, withOffsetDefaults } from "../calendar/js/store.js";
import {
  axiomRoomLinkOf,
  iceServers,
  newRoomCode,
  PEER_ID_RE,
  placeRoom,
  screenShareAvailable,
  stripRoomText,
} from "../calendar/js/roomlink.js";

const now = zonedTimeToUtc(2026, 10, 13, 9, 0, HOME_TZ);

test("Tuesday morning quick add keeps Algebra with Maya at 4pm for 1 hour", () => {
  const parsed = parseQuickAdd("Algebra w/ Maya tue 4pm 1h", now, HOME_TZ);
  assert.equal(parsed.title, "Algebra w/ Maya");
  assert.equal(parsed.addMeet, false);
  assert.equal(parsed.allDay, false);
  const start = parts(parsed.start, HOME_TZ);
  const end = parts(parsed.end, HOME_TZ);
  assert.deepEqual([start.year, start.month, start.day, start.hour, start.minute], [2026, 10, 13, 16, 0]);
  assert.equal(end.hour, 17);
});

test("lunch tomorrow noon", () => {
  const parsed = parseQuickAdd("lunch tomorrow noon", now, HOME_TZ);
  assert.equal(parsed.title, "lunch");
  const start = parts(parsed.start, HOME_TZ);
  assert.deepEqual([start.month, start.day, start.hour, start.minute], [10, 14, 12, 0]);
  assert.equal(parsed.end.getTime() - parsed.start.getTime(), 60 * 60000);
});

test("video call turns Meet on and stays in the title", () => {
  const parsed = parseQuickAdd("video call Fri 3pm", now, HOME_TZ);
  assert.equal(parsed.addMeet, true);
  assert.equal(parsed.title, "video call");
  const start = parts(parsed.start, HOME_TZ);
  assert.equal(start.day, 16);
  assert.equal(start.hour, 15);
});

test("with meet is removed from the title", () => {
  const parsed = parseQuickAdd("dentist next monday 9am with meet", now, HOME_TZ);
  assert.equal(parsed.addMeet, true);
  assert.equal(parsed.title, "dentist");
  const start = parts(parsed.start, HOME_TZ);
  assert.equal(start.hour, 9);
  assert.equal(start.day, 19);
});

test("time range and all-day date", () => {
  const range = parseQuickAdd("Call 4-5pm tomorrow", now, HOME_TZ);
  assert.equal(range.title, "Call");
  assert.equal(parts(range.end, HOME_TZ).hour, 17);
  const allDay = parseQuickAdd("Conference Oct 20", now, HOME_TZ);
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.title, "Conference");
  assert.equal(parts(allDay.start, HOME_TZ).day, 20);
});

test("nearest Google event color and exact custom display", () => {
  assert.equal(nearestEventColorId("#ff0000"), "11");
  assert.equal(nearestEventColorId("#a4bdfc"), "1");
  assert.equal(nearestEventColorId("#0000ff"), "9");
  const shown = displayColor({
    colorId: "9",
    extendedProperties: { private: { axiomColor: "#112233" } },
  }, { backgroundColor: "#ffffff" });
  assert.equal(shown, "#112233");
  assert.equal(normalizeHex("#abc"), "#aabbcc");
});

test("patch omits color and conference unless Steve edits them", () => {
  const draft = {
    summary: "Lesson",
    location: "Library",
    description: "",
    allDay: false,
    start: zonedTimeToUtc(2026, 10, 13, 16, 0, HOME_TZ),
    end: zonedTimeToUtc(2026, 10, 13, 17, 0, HOME_TZ),
    attendees: [],
    reminders: { useDefault: true },
    hadMeet: true,
    addMeet: true,
    colorTouched: false,
  };
  const original = {
    colorId: "5",
    extendedProperties: { private: { axiomColor: "#123456" } },
    conferenceData: { conferenceId: "abc" },
  };
  const body = buildPatchBody(draft, original);
  assert.equal("colorId" in body, false);
  assert.equal("extendedProperties" in body, false);
  assert.equal("conferenceData" in body, false);
  assert.equal(meetAction(draft), "keep");
});

test("custom color sends nearest colorId plus the exact hex", () => {
  const draft = {
    summary: "Lesson",
    allDay: false,
    start: now,
    end: new Date(now.getTime() + 3600000),
    attendees: [],
    colorTouched: true,
    colorMode: "custom",
    axiomColor: "#ff0000",
    hadMeet: false,
    addMeet: false,
  };
  const body = buildPatchBody(draft, { extendedProperties: { private: { other: "keep" } } });
  assert.equal(body.colorId, "11");
  assert.equal(body.extendedProperties.private.axiomColor, "#ff0000");
  assert.equal(body.extendedProperties.private.other, "keep");
});

test("duplicate copies colorId and custom hex exactly", () => {
  const draft = {
    summary: "Lesson",
    allDay: false,
    start: now,
    end: new Date(now.getTime() + 3600000),
    attendees: [],
    colorTouched: true,
    copyExactColor: true,
    colorId: "4",
    axiomColor: "#010203",
    addMeet: true,
    hadMeet: false,
    meetRequestId: "req-1",
  };
  const body = buildInsertBody(draft);
  assert.equal(body.colorId, "4");
  assert.equal(body.extendedProperties.private.axiomColor, "#010203");
  assert.notEqual(body.colorId, nearestEventColorId("#010203"));
  assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(body.conferenceData.createRequest.requestId, "req-1");
});

test("removing Meet sends null conferenceData and adding sends createRequest", () => {
  const base = {
    summary: "Lesson",
    allDay: false,
    start: now,
    end: new Date(now.getTime() + 3600000),
    attendees: [],
    colorTouched: false,
  };
  const removed = buildPatchBody({ ...base, hadMeet: true, addMeet: false }, {});
  assert.equal(removed.conferenceData, null);
  assert.equal(JSON.stringify(removed).includes('"conferenceData":null'), true);
  const added = buildPatchBody({ ...base, hadMeet: false, addMeet: true, meetRequestId: "abc" }, {});
  assert.equal(added.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
});

test("time patch is only start and end", () => {
  const body = buildTimePatch(now, new Date(now.getTime() + 3600000), false, HOME_TZ);
  assert.deepEqual(Object.keys(body).sort(), ["end", "start"]);
  assert.equal(body.start.timeZone, HOME_TZ);
});

test("Wyzant offset defaults to -2, can be disabled, and that calendar is never writable", () => {
  assert.equal(offsetHours({ offsets: {} }, WYZANT_CALENDAR_ID), -2);
  assert.equal(offsetBadge(WYZANT_CALENDAR_ID, -2), "Wyzant times adjusted -2h");
  const disabled = offsetHours({
    offsets: { [WYZANT_CALENDAR_ID]: { hours: -2, enabled: false } },
  }, WYZANT_CALENDAR_ID);
  assert.equal(disabled, 0);
  assert.equal(calendarLocked({ id: WYZANT_CALENDAR_ID, accessRole: "owner" }, { offsets: {} }), true);
  assert.equal(calendarLocked({ id: "primary", accessRole: "owner" }, { offsets: {} }), false);
  const shifted = shiftHours(zonedTimeToUtc(2026, 10, 14, 18, 0, HOME_TZ), -2);
  assert.equal(parts(shifted, HOME_TZ).hour, 16);
  const bounds = displayBounds({
    start: { dateTime: zonedTimeToUtc(2026, 10, 14, 18, 0, HOME_TZ).toISOString() },
    end: { dateTime: zonedTimeToUtc(2026, 10, 14, 19, 0, HOME_TZ).toISOString() },
  }, -2, HOME_TZ);
  assert.equal(parts(bounds.start, HOME_TZ).hour, 16);
});

test("places and addresses resolve only when confident", () => {
  assert.equal(zoneFromText("123 Main, Houston, TX", { field: "location" }).timeZone, "America/Chicago");
  assert.equal(zoneFromText("Zurich", { field: "location" }).timeZone, "Europe/Zurich");
  assert.equal(zoneFromText("Geneva, Switzerland", { field: "location" }).timeZone, "Europe/Zurich");
  assert.equal(zoneFromText("San Francisco, CA", { field: "location" }).timeZone, "America/Los_Angeles");
  assert.equal(zoneFromText("El Paso, TX", { field: "location" }).timeZone, "America/Denver");
  assert.equal(zoneFromText("Paris, France", { field: "location" }).timeZone, "Europe/Paris");
  assert.equal(zoneFromText("Paris, TX", { field: "location" }).timeZone, "America/Chicago");
  assert.equal(zoneFromText("Portland", { field: "location" }), null);
  assert.equal(zoneFromText("Reading club", { field: "title" }), null);
  assert.equal(zoneFromText("Lesson in Zurich", { field: "title" }).timeZone, "Europe/Zurich");
  assert.equal(zoneFromAddress({ city: "Geneva", countryCode: "CH" }), "Europe/Zurich");
  assert.equal(zoneFromAddress({ region: "California", countryCode: "US" }), "America/Los_Angeles");
  assert.equal(zoneFromAddress({ region: "Texas", countryCode: "US" }), null);
  assert.equal(zoneFromAddress({ city: "Houston", region: "TX", countryCode: "US" }), "America/Chicago");
  assert.equal(zoneFromAddress({ city: "El Paso", region: "TX", countryCode: "US" }), "America/Denver");
  assert.equal(zoneFromAddress({ countryCode: "US" }), null);
});

test("people, invites, and names fill the directory without nagging unknowns", () => {
  const people = indexPeople([{
    names: [{ displayName: "Maya Keller", givenName: "Maya", familyName: "Keller", metadata: { primary: true } }],
    emailAddresses: [{ value: "maya@example.com" }],
    addresses: [{ city: "Zurich", countryCode: "CH" }],
  }, {
    names: [{ displayName: "Maya Other", givenName: "Maya" }],
    emailAddresses: [{ value: "maya2@example.com" }],
    addresses: [{ city: "Houston", region: "TX", countryCode: "US" }],
  }]);
  assert.equal(people.byEmail.get("maya@example.com").timeZone, "Europe/Zurich");
  const invite = {
    summary: "Algebra",
    start: { dateTime: now.toISOString(), timeZone: "America/Los_Angeles" },
    end: { dateTime: new Date(now.getTime() + 3600000).toISOString(), timeZone: "America/Los_Angeles" },
    organizer: { email: "luis@example.com" },
    attendees: [{ email: "luis@example.com", displayName: "Luis" }, { email: "stephen.kaminskie@gmail.com", self: true }],
  };
  const updates = inferUpdates([invite], {
    selfEmail: "stephen.kaminskie@gmail.com",
    peopleIndex: people,
  });
  assert.equal(updates[0].email, "luis@example.com");
  assert.equal(updates[0].timeZone, "America/Los_Angeles");
  assert.equal(updates[0].source, "invite");

  const settings = { contacts: {} };
  const applied = applyUpdates(settings, updates, "2026-10-13T00:00:00Z");
  assert.equal(applied.changed, true);
  const manual = applyUpdates({
    contacts: { "luis@example.com": { timeZone: "Europe/Zurich", source: "manual", name: "Luis", updated: "2020-01-01T00:00:00Z" } },
  }, updates);
  assert.equal(manual.changed, false);
  assert.equal(manual.contacts["luis@example.com"].timeZone, "Europe/Zurich");

  const clocks = clocksForEvent(invite, {
    selfEmail: "stephen.kaminskie@gmail.com",
    settings: { contacts: applied.contacts },
    peopleIndex: people,
    homeTz: HOME_TZ,
  });
  assert.equal(clocks.length, 1);
  assert.equal(clocks[0].timeZone, "America/Los_Angeles");

  const sameZone = clocksForEvent({
    summary: "Houston parent",
    location: "Houston, TX",
    attendees: [{ email: "sam@example.com", displayName: "Sam" }],
  }, {
    selfEmail: "stephen.kaminskie@gmail.com",
    settings: { contacts: { "sam@example.com": { timeZone: HOME_TZ, source: "people", name: "Sam" } } },
    peopleIndex: { byEmail: new Map(), byName: new Map() },
    homeTz: HOME_TZ,
  });
  assert.equal(sameZone.length, 0);
  assert.deepEqual(partnerNames("Algebra w/ Maya"), ["Maya"]);
});

test("settings merge keeps manual zones and the Wyzant default", () => {
  const merged = mergeSettings({
    updated: "2026-10-01T00:00:00Z",
    contacts: { "maya@example.com": { timeZone: "Europe/Zurich", source: "manual", name: "Maya", updated: "2026-10-02T00:00:00Z" } },
    offsets: {},
  }, {
    updated: "2026-10-03T00:00:00Z",
    contacts: { "maya@example.com": { timeZone: "America/Chicago", source: "city", name: "Maya", updated: "2026-10-03T00:00:00Z" } },
    offsets: {},
  });
  assert.equal(merged.contacts["maya@example.com"].timeZone, "Europe/Zurich");
  const defaults = withOffsetDefaults({ offsets: {}, contacts: {} });
  assert.equal(defaults.offsets[WYZANT_CALENDAR_ID].hours, -2);
  assert.equal(defaults.offsets[WYZANT_CALENDAR_ID].enabled, true);
});

test("a saved client id overrides the built-in one", () => {
  assert.equal(resolveClientId(""), DEFAULT_CLIENT_ID);
  assert.equal(resolveClientId(PLACEHOLDER_CLIENT_ID), DEFAULT_CLIENT_ID);
  assert.equal(resolveClientId("YOUR_CLIENT_ID.apps.googleusercontent.com"), DEFAULT_CLIENT_ID);
  assert.equal(resolveClientId(DEFAULT_CLIENT_ID), DEFAULT_CLIENT_ID);
  const custom = "111-custom.apps.googleusercontent.com";
  assert.equal(resolveClientId(custom), custom);
  assert.equal(DEFAULT_CLIENT_ID.endsWith(".apps.googleusercontent.com"), true);
});

test("Axiom room links stay out of conferenceData", () => {
  const code = newRoomCode();
  assert.match(code, PEER_ID_RE);
  const url = `https://axiom-mathematics.github.io/axiom-whiteboard/calendar/room.html?id=${code}`;
  const placed = placeRoom("Library", "Bring the worksheet.", url);
  assert.equal(placed.location, "Library");
  assert.match(placed.description, /Axiom video room:/);
  assert.equal(axiomRoomLinkOf(placed), url);
  const emptyPlace = placeRoom("", "", url);
  assert.equal(emptyPlace.location, url);
  const cleared = stripRoomText(`${placed.location}\n${placed.description}`);
  assert.equal(cleared, "Library\nBring the worksheet.");
  const body = buildInsertBody({
    summary: "Lesson",
    location: placed.location,
    description: placed.description,
    allDay: false,
    start: now,
    end: new Date(now.getTime() + 3600000),
    attendees: [],
    colorTouched: false,
    addMeet: false,
    hadMeet: false,
  });
  assert.equal(body.conferenceData, undefined);
  assert.equal(body.location, "Library");
  assert.equal(axiomRoomLinkOf({ hangoutLink: "https://meet.google.com/abc-defg-hij", location: "Library" }), null);
  const servers = iceServers({ urls: "turn:relay.example.com:443 javascript:alert(1)", username: "u", credential: "p" });
  assert.equal(servers.length, 3);
  assert.deepEqual(servers[2].urls, ["turn:relay.example.com:443"]);
  assert.equal(iceServers({}).length, 2);
  assert.equal(screenShareAvailable({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    platform: "iPhone",
    maxTouchPoints: 5,
    mediaDevices: { getDisplayMedia() {} },
  }), false);
  assert.equal(screenShareAvailable({
    userAgent: "Mozilla/5.0",
    platform: "MacIntel",
    maxTouchPoints: 0,
    mediaDevices: { getDisplayMedia() {} },
  }), true);
});

test("round-trip Chicago civil time across DST", () => {
  const summer = zonedTimeToUtc(2026, 7, 15, 16, 30, HOME_TZ);
  const winter = zonedTimeToUtc(2026, 1, 15, 16, 30, HOME_TZ);
  assert.equal(parts(summer, HOME_TZ).hour, 16);
  assert.equal(parts(winter, HOME_TZ).hour, 16);
  assert.notEqual(summer.getUTCHours(), winter.getUTCHours());
  assert.equal(todayYmd(now, HOME_TZ).d, 13);
});
