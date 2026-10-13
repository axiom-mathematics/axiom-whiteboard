import { HOME_TZ } from "../config.js";
import { nearestEventColorId, normalizeHex } from "./colors.js";
import { addDays, gcalDateTime, parts, ymdFromDate, ymdStr, zonedDate, zonedTimeToUtc } from "./time.js";
import { uid } from "./util.js";

function timeFields(draft) {
  const tz = draft.timeZone || HOME_TZ;
  if (draft.allDay) {
    return {
      start: { date: ymdStr(ymdFromDate(draft.start, tz)) },
      end: { date: ymdStr(ymdFromDate(draft.end, tz)) },
    };
  }
  return {
    start: gcalDateTime(draft.start, tz),
    end: gcalDateTime(draft.end, tz),
  };
}

function slimAttendee(a) {
  const out = { email: a.email };
  if (a.displayName) out.displayName = a.displayName;
  if (a.responseStatus) out.responseStatus = a.responseStatus;
  if (a.optional) out.optional = true;
  if (a.organizer) out.organizer = true;
  if (a.self) out.self = true;
  return out;
}

export function meetAction(draft) {
  const had = !!draft.hadMeet;
  const want = !!draft.addMeet;
  if (had && want) return "keep";
  if (!had && want) return "add";
  if (had && !want) return "remove";
  return "keep";
}

function applyColor(body, draft, original) {
  const previous = { ...(original?.extendedProperties?.private || {}) };
  const hadCustom = !!normalizeHex(original?.extendedProperties?.private?.axiomColor);

  if (draft.copyExactColor) {
    if (draft.colorId) body.colorId = String(draft.colorId);
    const hex = normalizeHex(draft.axiomColor);
    if (hex) {
      body.extendedProperties = { private: { ...previous, axiomColor: hex } };
    }
    return;
  }

  if (draft.colorMode === "custom") {
    const hex = normalizeHex(draft.axiomColor);
    if (!hex) return;
    body.colorId = nearestEventColorId(hex, draft.palette);
    body.extendedProperties = { private: { ...previous, axiomColor: hex } };
    return;
  }

  if (draft.colorMode === "palette" && draft.colorId) {
    body.colorId = String(draft.colorId);
    if (hadCustom) {
      body.extendedProperties = { private: { ...previous, axiomColor: null } };
    }
    return;
  }

  body.colorId = null;
  if (hadCustom) {
    body.extendedProperties = { private: { ...previous, axiomColor: null } };
  }
}

function contentFields(draft, original) {
  const body = {
    summary: draft.summary || "",
    location: draft.location || "",
    description: draft.description || "",
    transparency: draft.transparency === "transparent" ? "transparent" : "opaque",
    ...timeFields(draft),
  };
  const nextGuests = draft.attendees || [];
  const prevGuests = original?.attendees || [];
  if (nextGuests.length || prevGuests.length) {
    body.attendees = nextGuests.filter((a) => a.email).map(slimAttendee);
    body.guestsCanModify = !!draft.guestsCanModify;
    body.guestsCanInviteOthers = draft.guestsCanInviteOthers !== false;
    body.guestsCanSeeOtherGuests = draft.guestsCanSeeOtherGuests !== false;
  }
  if (draft.reminders) body.reminders = draft.reminders;
  if (draft.recurrenceTouched) body.recurrence = draft.recurrenceLines || [];
  return body;
}

/** Fields for a normal edit. Colors and Meet are included only when Steve changed them. */
export function buildPatchBody(draft, original = {}) {
  const body = contentFields(draft, original);
  if (draft.colorTouched) applyColor(body, draft, original);
  const meet = meetAction(draft);
  if (meet === "add") {
    body.conferenceData = {
      createRequest: {
        requestId: draft.meetRequestId || uid(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  } else if (meet === "remove") {
    body.conferenceData = null;
  }
  return body;
}

export function buildInsertBody(draft) {
  const body = contentFields(draft, {});
  if (draft.colorTouched) applyColor(body, draft, {});
  if (draft.addMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: draft.meetRequestId || uid(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  if (draft.recurrenceLines?.length) body.recurrence = draft.recurrenceLines;
  return body;
}

/** Drag / resize. Times only — never colorId, extended properties, or conference data. */
export function buildTimePatch(start, end, allDay, timeZone = HOME_TZ) {
  return timeFields({ start, end, allDay, timeZone });
}

export function buildRsvpPatch(attendees) {
  return { attendees: (attendees || []).filter((a) => a.email).map(slimAttendee) };
}

export function conferenceQuery(draft) {
  const meet = meetAction(draft);
  if (meet === "add" || meet === "remove") return 1;
  if (!draft.hadMeet && draft.addMeet) return 1;
  return undefined;
}

/** Put the edited clock time onto the series master's original date. */
export function clockOntoMaster(masterStart, newStart, newEnd, allDay, timeZone = HOME_TZ) {
  if (allDay) {
    const masterDay = ymdFromDate(masterStart, timeZone);
    const span = Math.max(1, Math.round((newEnd.getTime() - newStart.getTime()) / 86400000));
    return {
      start: zonedDate(masterDay, 0, timeZone),
      end: zonedDate(addDays(masterDay, span), 0, timeZone),
    };
  }
  const m = parts(masterStart, timeZone);
  const n = parts(newStart, timeZone);
  const start = zonedTimeToUtc(m.year, m.month, m.day, n.hour, n.minute, timeZone);
  const dur = Math.max(15 * 60000, newEnd.getTime() - newStart.getTime());
  return { start, end: new Date(start.getTime() + dur) };
}

