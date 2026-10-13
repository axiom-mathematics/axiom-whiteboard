import { WYZANT_CALENDAR_ID, HOME_TZ } from "../config.js";
import { addDays, todayYmd, zonedDate } from "./time.js";

const ME = "stephen.kaminskie@gmail.com";

function timed(now, dayOffset, hour, minute, hours) {
  const day = addDays(todayYmd(now, HOME_TZ), dayOffset);
  const start = zonedDate(day, hour * 60 + minute, HOME_TZ);
  const end = new Date(start.getTime() + hours * 3600000);
  return {
    start: { dateTime: start.toISOString(), timeZone: HOME_TZ },
    end: { dateTime: end.toISOString(), timeZone: HOME_TZ },
  };
}

function fromNow(now, startMin, durMin) {
  const start = new Date(now.getTime() + startMin * 60000);
  const end = new Date(start.getTime() + durMin * 60000);
  return {
    start: { dateTime: start.toISOString(), timeZone: HOME_TZ },
    end: { dateTime: end.toISOString(), timeZone: HOME_TZ },
  };
}

const MEET = {
  conferenceId: "demo-meet",
  conferenceSolution: { key: { type: "hangoutsMeet" }, name: "Google Meet" },
  entryPoints: [
    { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij", label: "meet.google.com/abc-defg-hij" },
    { entryPointType: "phone", uri: "tel:+15550100199", label: "+1 555-010-0199", pin: "123456789", regionCode: "US" },
  ],
};

export function buildDemo(now = new Date()) {
  const today = todayYmd(now, HOME_TZ);
  const tomorrow = addDays(today, 1);
  const calendars = [
    {
      id: ME,
      summary: "Stephen Kaminskie",
      backgroundColor: "#4986e7",
      foregroundColor: "#ffffff",
      selected: true,
      primary: true,
      accessRole: "owner",
    },
    {
      id: WYZANT_CALENDAR_ID,
      summary: "Wyzant",
      backgroundColor: "#ff7537",
      foregroundColor: "#1d1d1d",
      selected: true,
      accessRole: "reader",
    },
    {
      id: "classroom-algebra@import.calendar.google.com",
      summary: "Algebra — Classroom",
      backgroundColor: "#16a765",
      foregroundColor: "#1d1d1d",
      selected: true,
      accessRole: "reader",
    },
  ];

  const events = [
    {
      id: "demo-live",
      calendarId: ME,
      summary: "Geometry w/ Luis",
      ...fromNow(now, -20, 70),
      colorId: "9",
      location: "Google Meet",
      description: "Similar triangles. Luis is in San Francisco.\n\nAxiom video room: https://axiom-mathematics.github.io/axiom-whiteboard/calendar/room.html?id=cal-demo1",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      conferenceData: MEET,
      organizer: { email: "luis@example.com", displayName: "Luis Ortega" },
      attendees: [
        { email: "luis@example.com", displayName: "Luis Ortega", responseStatus: "accepted" },
        { email: ME, displayName: "Stephen Kaminskie", self: true, responseStatus: "accepted" },
      ],
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
    },
    {
      id: "demo-soon",
      calendarId: ME,
      summary: "Chemistry check-in",
      ...fromNow(now, 8, 40),
      extendedProperties: { private: { axiomColor: "#7c3aed" } },
      colorId: "3",
      hangoutLink: "https://meet.google.com/xyz-abcd-efg",
      conferenceData: {
        ...MEET,
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xyz-abcd-efg" }],
      },
      attendees: [
        { email: "maya@example.com", displayName: "Maya Keller", responseStatus: "accepted" },
        { email: ME, self: true, responseStatus: "accepted" },
      ],
    },
    {
      id: "demo-algebra",
      calendarId: ME,
      summary: "Algebra w/ Maya",
      ...timed(now, 0, 16, 0, 1),
      colorId: "2",
      location: "Lesson in Zurich",
      description: "Quadratics.",
      attendees: [
        { email: "maya@example.com", displayName: "Maya Keller", responseStatus: "accepted" },
        { email: ME, self: true, organizer: true, responseStatus: "accepted" },
      ],
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    },
    {
      id: "demo-overlap",
      calendarId: ME,
      summary: "Office hour",
      ...timed(now, 0, 16, 30, 1),
      colorId: "6",
    },
    {
      id: "demo-lunch",
      calendarId: ME,
      summary: "Lunch",
      ...timed(now, 1, 12, 0, 1),
      colorId: "5",
      location: "Houston, TX",
    },
    {
      id: "demo-fair",
      calendarId: ME,
      summary: "College fair",
      start: { date: `${tomorrow.y}-${String(tomorrow.m).padStart(2, "0")}-${String(tomorrow.d).padStart(2, "0")}` },
      end: {
        date: (() => {
          const n = addDays(tomorrow, 1);
          return `${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`;
        })(),
      },
    },
    {
      id: "demo-wyzant",
      calendarId: WYZANT_CALENDAR_ID,
      summary: "Wyzant: Maya — Algebra",
      ...timed(now, 1, 18, 0, 1),
      description: "Imported feed. The clock on this event is shifted only on screen.",
    },
    {
      id: "demo-class",
      calendarId: "classroom-algebra@import.calendar.google.com",
      summary: "Algebra homework due",
      start: { date: `${today.y}-${String(today.m).padStart(2, "0")}-${String(today.d).padStart(2, "0")}` },
      end: {
        date: (() => {
          const n = addDays(today, 1);
          return `${n.y}-${String(n.m).padStart(2, "0")}-${String(n.d).padStart(2, "0")}`;
        })(),
      },
    },
    {
      id: "demo-rsvp",
      calendarId: ME,
      summary: "Intro call w/ Priya",
      ...timed(now, 2, 15, 0, 0.5),
      organizer: { email: "priya@example.com", displayName: "Priya Shah" },
      attendees: [
        { email: "priya@example.com", displayName: "Priya Shah", responseStatus: "accepted", organizer: true },
        { email: ME, displayName: "Stephen Kaminskie", self: true, responseStatus: "needsAction" },
      ],
      location: "San Francisco, CA",
      start: { ...timed(now, 2, 15, 0, 0.5).start, timeZone: "America/Los_Angeles" },
      end: { ...timed(now, 2, 15, 0, 0.5).end, timeZone: "America/Los_Angeles" },
    },
    {
      id: "demo-geneva",
      calendarId: ME,
      summary: "Reading group in Geneva",
      ...timed(now, 3, 10, 0, 1),
      colorId: "10",
    },
  ];

  // The RSVP event spread above overwrites start/end; rebuild cleanly.
  const priya = timed(now, 2, 15, 0, 0.5);
  events[8].start = { ...priya.start, timeZone: "America/Los_Angeles" };
  events[8].end = { ...priya.end, timeZone: "America/Los_Angeles" };

  const people = [
    {
      names: [{ displayName: "Maya Keller", givenName: "Maya", familyName: "Keller", metadata: { primary: true } }],
      emailAddresses: [{ value: "maya@example.com" }],
      addresses: [{ city: "Zurich", country: "Switzerland", countryCode: "CH" }],
    },
    {
      names: [{ displayName: "Luis Ortega", givenName: "Luis", familyName: "Ortega", metadata: { primary: true } }],
      emailAddresses: [{ value: "luis@example.com" }],
      addresses: [{ city: "San Francisco", region: "CA", countryCode: "US" }],
    },
    {
      names: [{ displayName: "Priya Shah", givenName: "Priya", familyName: "Shah", metadata: { primary: true } }],
      emailAddresses: [{ value: "priya@example.com" }],
      addresses: [{ city: "San Francisco", region: "California", countryCode: "US" }],
    },
  ];

  return { calendars, events, people, me: ME };
}
