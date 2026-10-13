import { HOME_TZ } from "../config.js";
import { EVENT_PALETTE, displayColor, nearestEventColorId, normalizeHex, textOn } from "./colors.js";
import { describeRecurrence, reminderLabel } from "./parse.js";
import { calendarLocked, offsetBadge, offsetHours } from "./policy.js";
import {
  DOW_SHORT,
  addDays,
  cmpYmd,
  clipToDay,
  displayBounds,
  eventCoversDay,
  formatCompactTime,
  formatDayHeading,
  formatFullDate,
  formatHourLabel,
  formatMonthTitle,
  formatRange,
  formatTime,
  minutesSinceMidnight,
  monthGrid,
  rangeLabel,
  startOfWeek,
  todayYmd,
  viewDays,
  weekdayIndex,
  ymdFromDate,
  ymdStr,
  zoneAbbrev,
} from "./time.js";
import { clocksForEvent } from "./zones.js";
import { axiomRoomLinkOf } from "./roomlink.js";
import { dialInText, esc, googleEventUrl, meetLinkOf, phoneEntryOf, safeHttpUrl, safeTel, videoIcon } from "./util.js";

export const HOUR_PX = 48;

export function zoneCtx(state) {
  return {
    settings: state.settings,
    peopleIndex: state.peopleIndex,
    selfEmail: state.me,
    homeTz: HOME_TZ,
  };
}

export function activeEvents(state) {
  const on = new Set(state.calendars.filter((c) => c.selected !== false).map((c) => c.id));
  return state.events.filter((e) => on.has(e.calendarId) && e.status !== "cancelled" && e.eventType !== "workingLocation");
}

export function calOf(state, id) {
  return state.calendars.find((c) => c.id === id);
}

export function boundsOf(state, event) {
  return displayBounds(event, offsetHours(state.settings, event.calendarId), HOME_TZ);
}

export function colorOf(state, event) {
  const cal = calOf(state, event.calendarId);
  return displayColor(event, cal, state.palette || EVENT_PALETTE);
}

function isToday(v, state) {
  return cmpYmd(v, todayYmd(state.now, HOME_TZ)) === 0;
}

function isSoon(bounds, state) {
  if (!bounds || bounds.allDay) return false;
  const t = state.now.getTime();
  return t >= bounds.start.getTime() - 10 * 60000 && t <= bounds.end.getTime();
}

function videoJoins(event, soon, compact) {
  const meet = meetLinkOf(event);
  const room = axiomRoomLinkOf(event);
  const bits = [];
  if (meet) bits.push(`<a class="ev-join${soon ? " hot" : ""}" href="${esc(meet)}" target="_blank" rel="noopener noreferrer" aria-label="Join Meet">${videoIcon("tiny")}${!compact && soon ? "<span>Meet</span>" : ""}</a>`);
  if (room) bits.push(`<a class="ev-join room${soon ? " hot" : ""}" href="${esc(room)}" target="_blank" rel="noopener noreferrer" aria-label="Join Axiom room">${videoIcon("tiny")}${!compact && soon ? "<span>Room</span>" : ""}</a>`);
  return bits.length ? `<span class="ev-joins">${bits.join("")}</span>` : "";
}

function clockLine(start, clock) {
  const home = ymdStr(ymdFromDate(start, HOME_TZ));
  const there = ymdStr(ymdFromDate(start, clock.timeZone));
  const extra = home === there ? "" : ` ${DOW_SHORT[weekdayIndex(ymdFromDate(start, clock.timeZone))]}`;
  return `${clock.label} ${formatCompactTime(start, clock.timeZone)}${extra}`;
}

function whenText(state, event) {
  const b = boundsOf(state, event);
  if (b.allDay) {
    const last = addDays(b.endYmd, -1);
    if (cmpYmd(b.startYmd, last) === 0) return `${formatFullDate(b.startYmd)} · all day`;
    return `${formatDayHeading(b.startYmd)} – ${formatDayHeading(last)} · all day`;
  }
  const day = formatFullDate(ymdFromDate(b.start, HOME_TZ));
  return `${day} · ${formatRange(b.start, b.end, HOME_TZ)}`;
}

export function miniHtml(state) {
  const cursor = state.mini || { y: state.anchor.y, m: state.anchor.m };
  const days = monthGrid(cursor.y, cursor.m, state.settings.weekStart || 0);
  const today = todayYmd(state.now, HOME_TZ);
  const week = new Set(viewDays(state.view === "month" || state.view === "agenda" ? "week" : state.view, state.anchor, state.settings.weekStart || 0).map(ymdStr));
  const dots = new Set();
  for (const ev of activeEvents(state)) {
    const b = boundsOf(state, ev);
    for (const d of days) {
      if (eventCoversDay(b, d, HOME_TZ)) dots.add(ymdStr(d));
    }
  }
  const labels = DOW_SHORT.map((_, i) => DOW_SHORT[(i + (state.settings.weekStart || 0)) % 7]);
  return `
    <div class="mini-bar">
      <button type="button" data-action="mini-move" data-dir="-1" aria-label="Previous month">‹</button>
      <div class="mini-title">${esc(formatMonthTitle(cursor))}</div>
      <button type="button" data-action="mini-move" data-dir="1" aria-label="Next month">›</button>
    </div>
    <div class="mini-grid" role="grid" aria-label="Mini calendar">
      ${labels.map((d) => `<div class="mini-dow">${d[0]}</div>`).join("")}
      ${days.map((d) => {
        const key = ymdStr(d);
        const cls = [
          "mini-day",
          d.m !== cursor.m ? "out" : "",
          isToday(d, state) ? "today" : "",
          cmpYmd(d, state.anchor) === 0 ? "selected" : "",
          week.has(key) && state.view === "week" ? "inweek" : "",
        ].filter(Boolean).join(" ");
        return `<button type="button" class="${cls}" data-action="mini-day" data-date="${key}" ${cmpYmd(d, today) === 0 ? 'aria-current="date"' : ""}>${d.d}${dots.has(key) ? '<i class="dot"></i>' : ""}</button>`;
      }).join("")}
    </div>`;
}

export function calListHtml(state) {
  if (!state.calendars.length) return `<p class="empty">No calendars yet.</p>`;
  return state.calendars.map((cal) => {
    const hours = offsetHours(state.settings, cal.id);
    const badge = offsetBadge(cal.id, hours);
    const locked = calendarLocked(cal, state.settings);
    return `<label class="cal-row">
      <input type="checkbox" data-action="toggle-cal" data-id="${esc(cal.id)}" ${cal.selected === false ? "" : "checked"}>
      <span class="swatch" style="background:${esc(cal.backgroundColor || "#039be5")}"></span>
      <span class="cal-name">${esc(cal.summary || cal.id)}</span>
      ${locked ? '<span class="tag">read-only</span>' : ""}
      ${badge ? `<span class="tag adjust" title="${esc(badge)}">${esc(hours > 0 ? "+" : "")}${hours}h</span>` : ""}
    </label>`;
  }).join("");
}

export function mainHtml(state) {
  if (state.search && state.search.trim()) return searchHtml(state);
  if (state.view === "month") return monthHtml(state);
  if (state.view === "agenda") return agendaHtml(state);
  return gridHtml(state);
}

function searchHtml(state) {
  const q = state.search.trim().toLowerCase();
  const hits = activeEvents(state).filter((e) => blob(e).includes(q)).sort((a, b) => startMs(state, a) - startMs(state, b));
  return `<div class="agenda"><h2 class="result-h">${hits.length} result${hits.length === 1 ? "" : "s"}</h2>${hits.length ? hits.map((e) => agendaRow(state, e)).join("") : `<p class="empty">No matching events in the loaded range.</p>`}</div>`;
}

function blob(e) {
  const who = (e.attendees || []).map((a) => `${a.email || ""} ${a.displayName || ""}`).join(" ");
  return `${e.summary || ""} ${e.location || ""} ${e.description || ""} ${who}`.toLowerCase();
}

function startMs(state, event) {
  const b = boundsOf(state, event);
  if (b.allDay) return Date.UTC(b.startYmd.y, b.startYmd.m - 1, b.startYmd.d);
  return b.start.getTime();
}

function gridHtml(state) {
  const days = viewDays(state.view, state.anchor, state.settings.weekStart || 0);
  const events = activeEvents(state);
  const head = days.map((d) => {
    const cls = isToday(d, state) ? "day-head today" : "day-head";
    return `<button type="button" class="${cls}" data-action="mini-day" data-date="${ymdStr(d)}"><span class="dow">${DOW_SHORT[weekdayIndex(d)]}</span><span class="num">${d.d}</span></button>`;
  }).join("");
  const allDay = allDayHtml(state, days, events);
  const cols = days.map((d) => columnHtml(state, d, events)).join("");
  const hours = Array.from({ length: 24 }, (_, h) => `<div class="hour-label" style="height:${HOUR_PX}px">${h === 0 ? "" : esc(formatHourLabel(h))}</div>`).join("");
  return `<div class="week ${state.view}">
    <div class="week-head"><div class="gutter"></div><div class="day-heads" style="--days:${days.length}">${head}</div></div>
    ${allDay}
    <div class="grid-scroll">
      <div class="grid" style="--days:${days.length}">
        <div class="gutter-hours">${hours}</div>
        <div class="cols">${cols}</div>
      </div>
    </div>
  </div>`;
}

function allDayHtml(state, days, events) {
  const bars = [];
  for (const ev of events) {
    const b = boundsOf(state, ev);
    if (!b.allDay) continue;
    let startCol = -1;
    let endCol = -1;
    days.forEach((d, i) => {
      if (eventCoversDay(b, d, HOME_TZ)) {
        if (startCol < 0) startCol = i;
        endCol = i + 1;
      }
    });
    if (startCol < 0) continue;
    bars.push({ ev, startCol, endCol });
  }
  const lanes = [];
  for (const bar of bars) {
    let lane = lanes.findIndex((laneBars) => laneBars.every((o) => o.endCol <= bar.startCol || bar.endCol <= o.startCol));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(bar);
    bar.lane = lane;
  }
  const laneCount = Math.max(1, lanes.length);
  const chips = bars.map((bar) => {
    const color = colorOf(state, bar.ev);
    const left = (bar.startCol / days.length) * 100;
    const width = ((bar.endCol - bar.startCol) / days.length) * 100;
    return `<div role="button" tabindex="0" class="aday" data-action="open-event" data-cal="${esc(bar.ev.calendarId)}" data-id="${esc(bar.ev.id)}" style="top:${bar.lane * 22}px;left:${left}%;width:calc(${width}% - 4px);background:${esc(color)};color:${textOn(color)}">${esc(bar.ev.summary || "(No title)")}${videoJoins(bar.ev, false, true)}</div>`;
  }).join("");
  return `<div class="allday"><div class="gutter">all-day</div><div class="allday-cols" style="height:${laneCount * 22 + 6}px">${chips}</div></div>`;
}

function columnHtml(state, day, events) {
  const timed = [];
  for (const ev of events) {
    const b = boundsOf(state, ev);
    if (b.allDay || !eventCoversDay(b, day, HOME_TZ)) continue;
    const clip = clipToDay(b, day, HOME_TZ);
    timed.push({ ev, b, ...clip });
  }
  pack(timed);
  const lines = Array.from({ length: 24 }, (_, h) => `<div class="hline" style="top:${h * HOUR_PX}px"></div><div class="hline half" style="top:${h * HOUR_PX + HOUR_PX / 2}px"></div>`).join("");
  const now = isToday(day, state) ? `<div class="now-line" style="top:${(minutesSinceMidnight(state.now, HOME_TZ) / 60) * HOUR_PX}px"><span></span></div>` : "";
  const blocks = timed.map((item) => eventBlock(state, item)).join("");
  return `<div class="col" data-date="${ymdStr(day)}">${lines}${now}${blocks}</div>`;
}

function pack(items) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const clusters = [];
  let cluster = [];
  let end = -1;
  for (const item of sorted) {
    if (!cluster.length || item.startMin < end) {
      cluster.push(item);
      end = Math.max(end, item.endMin);
    } else {
      clusters.push(cluster);
      cluster = [item];
      end = item.endMin;
    }
  }
  if (cluster.length) clusters.push(cluster);
  for (const group of clusters) {
    const cols = [];
    for (const item of group) {
      let c = 0;
      while (cols[c]?.some((o) => o.endMin > item.startMin && o.startMin < item.endMin)) c += 1;
      (cols[c] ||= []).push(item);
      item.col = c;
    }
    for (const item of group) item.cols = cols.length;
  }
}

function eventBlock(state, item) {
  const color = colorOf(state, item.ev);
  const top = (item.startMin / 60) * HOUR_PX;
  const height = Math.max(18, ((item.endMin - item.startMin) / 60) * HOUR_PX - 2);
  const width = 100 / item.cols;
  const left = item.col * width;
  const soon = isSoon(item.b, state);
  const badge = offsetBadge(item.ev.calendarId, offsetHours(state.settings, item.ev.calendarId));
  const clocks = clocksForEvent(item.ev, zoneCtx(state));
  const secondary = clocks.map((c) => clockLine(item.b.start, c)).join(" · ");
  const locked = calendarLocked(calOf(state, item.ev.calendarId), state.settings);
  const time = `${formatTime(item.b.start)} – ${formatTime(item.b.end)}`;
  return `<div role="button" tabindex="0" class="event${soon ? " is-soon" : ""}${item.ev.transparency === "transparent" ? " free" : ""}" data-action="open-event" data-cal="${esc(item.ev.calendarId)}" data-id="${esc(item.ev.id)}" style="top:${top}px;height:${height}px;left:calc(${left}% + 1px);width:calc(${width}% - 4px);background:${esc(color)};color:${textOn(color)}">
    ${locked ? "" : `<i class="resize n" data-edge="start"></i><i class="resize s" data-edge="end"></i>`}
    <span class="ev-title">${esc(item.ev.summary || "(No title)")}</span>
    ${height > 32 ? `<span class="ev-time">${esc(time)}</span>` : ""}
    ${height > 52 && secondary ? `<span class="ev-zone">${esc(secondary)}</span>` : ""}
    ${badge ? `<span class="ev-flag" title="${esc(badge)}">${esc(badge)}</span>` : ""}
    ${videoJoins(item.ev, soon, false)}
  </div>`;
}

function monthHtml(state) {
  const days = monthGrid(state.anchor.y, state.anchor.m, state.settings.weekStart || 0);
  const labels = Array.from({ length: 7 }, (_, i) => DOW_SHORT[(i + (state.settings.weekStart || 0)) % 7]);
  const events = activeEvents(state);
  const max = 4;
  const cells = days.map((d) => {
    const covering = events.filter((e) => eventCoversDay(boundsOf(state, e), d, HOME_TZ))
      .sort((a, b) => {
        const ba = boundsOf(state, a);
        const bb = boundsOf(state, b);
        if (ba.allDay !== bb.allDay) return ba.allDay ? -1 : 1;
        return startMs(state, a) - startMs(state, b);
      });
    const shown = covering.slice(0, max);
    const more = covering.length - shown.length;
    const chips = shown.map((ev) => {
      const color = colorOf(state, ev);
      const b = boundsOf(state, ev);
      const soon = isSoon(b, state);
      const label = b.allDay ? "" : `${formatCompactTime(b.start)} `;
      return `<div role="button" tabindex="0" class="chip${soon ? " is-soon" : ""}" data-action="open-event" data-cal="${esc(ev.calendarId)}" data-id="${esc(ev.id)}" style="background:${esc(color)};color:${textOn(color)}"><span>${esc(label + (ev.summary || "(No title)"))}</span>${videoJoins(ev, soon, true)}</div>`;
    }).join("");
    return `<div class="mcell${d.m !== state.anchor.m ? " out" : ""}${isToday(d, state) ? " today" : ""}">
      <button type="button" class="mnum" data-action="open-day" data-date="${ymdStr(d)}">${d.d}</button>
      <div class="chips">${chips}</div>
      ${more > 0 ? `<button type="button" class="more" data-action="more-day" data-date="${ymdStr(d)}">${more} more</button>` : ""}
    </div>`;
  }).join("");
  return `<div class="month"><div class="mhead">${labels.map((d) => `<div>${d}</div>`).join("")}</div><div class="mgrid">${cells}</div></div>`;
}

function agendaHtml(state) {
  const events = activeEvents(state);
  const start = state.anchor;
  const days = Array.from({ length: 45 }, (_, i) => addDays(start, i));
  const groups = days.map((d) => {
    const list = events.filter((e) => eventCoversDay(boundsOf(state, e), d, HOME_TZ))
      .sort((a, b) => startMs(state, a) - startMs(state, b));
    if (!list.length) return "";
    return `<section class="ag-day"><h2>${esc(formatFullDate(d))}</h2>${list.map((e) => agendaRow(state, e)).join("")}</section>`;
  }).join("");
  return `<div class="agenda">${groups || `<p class="empty">Nothing scheduled.</p>`}</div>`;
}

function agendaRow(state, event) {
  const b = boundsOf(state, event);
  const color = colorOf(state, event);
  const clocks = b.allDay ? [] : clocksForEvent(event, zoneCtx(state));
  const secondary = clocks.map((c) => clockLine(b.start, c)).join(" · ");
  const badge = offsetBadge(event.calendarId, offsetHours(state.settings, event.calendarId));
  const soon = isSoon(b, state);
  const when = b.allDay ? "All day" : formatRange(b.start, b.end);
  return `<div role="button" tabindex="0" class="ag-row${soon ? " is-soon" : ""}" data-action="open-event" data-cal="${esc(event.calendarId)}" data-id="${esc(event.id)}">
    <i style="background:${esc(color)}"></i>
    <span class="ag-when">${esc(when)}</span>
    <span class="ag-title">${esc(event.summary || "(No title)")}</span>
    ${secondary ? `<span class="ag-zone">${esc(secondary)}</span>` : ""}
    ${event.location ? `<span class="ag-loc">${esc(event.location)}</span>` : ""}
    ${badge ? `<span class="tag adjust" title="${esc(badge)}">${esc(badge)}</span>` : ""}
    ${videoJoins(event, soon, false)}
  </div>`;
}

export function popoverHtml(state, event) {
  const cal = calOf(state, event.calendarId);
  const b = boundsOf(state, event);
  const color = colorOf(state, event);
  const link = meetLinkOf(event);
  const room = axiomRoomLinkOf(event);
  const soon = isSoon(b, state);
  const clocks = b.allDay ? [] : clocksForEvent(event, zoneCtx(state));
  const badge = offsetBadge(event.calendarId, offsetHours(state.settings, event.calendarId));
  const locked = calendarLocked(cal, state.settings);
  const self = (event.attendees || []).find((a) => a.self || String(a.email || "").toLowerCase() === String(state.me || "").toLowerCase());
  const organizerSelf = event.organizer?.self || String(event.organizer?.email || "").toLowerCase() === String(state.me || "").toLowerCase();
  const phone = phoneEntryOf(event);
  const tel = safeTel(phone?.uri);
  const dial = dialInText(event);
  const guests = (event.attendees || []).map((a) => {
    const zone = clocks.find((c) => c.label && (a.displayName || "").startsWith(c.label));
    return `<li><span class="rs ${esc(a.responseStatus || "needsAction")}"></span><span>${esc(a.displayName || a.email)}</span>${a.organizer ? " · organizer" : ""}${zone ? ` · ${esc(formatTime(b.start, zone.timeZone))} ${esc(zoneAbbrev(b.start, zone.timeZone))}` : ""}</li>`;
  }).join("");
  const reminders = event.reminders?.useDefault !== false && !event.reminders?.overrides?.length
    ? "Calendar default"
    : (event.reminders?.overrides || []).map((r) => `${r.method === "email" ? "Email" : "Notification"} · ${reminderLabel(r.minutes)}`).join(", ") || "None";
  const locationText = event.location && event.location.trim() !== room ? event.location : "";
  const map = locationText ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationText)}` : "";
  return `<div class="pop" role="dialog" aria-label="${esc(event.summary || "Event")}">
    <div class="pop-color" style="background:${esc(color)}"></div>
    <div class="pop-body">
      <div class="pop-top">
        <h2>${esc(event.summary || "(No title)")}</h2>
        <button type="button" class="icon-btn" data-action="close-pop" aria-label="Close">×</button>
      </div>
      <p class="when">${esc(whenText(state, event))} <span class="zone-name">${esc(zoneAbbrev(b.allDay ? state.now : b.start, HOME_TZ))}</span></p>
      ${clocks.map((c) => `<p class="guest-time">${esc(clockLine(b.start, c))} · ${esc(zoneAbbrev(b.start, c.timeZone))}</p>`).join("")}
      ${badge ? `<p class="adjust-note" title="${esc(badge)}">${esc(badge)}</p>` : ""}
      ${link ? `<a class="join${soon ? " hot" : ""}" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${videoIcon()} Join Meet</a>` : ""}
      ${room ? `<a class="join room${soon && !link ? " hot" : ""}" href="${esc(room)}" target="_blank" rel="noopener noreferrer">${videoIcon()} Join Axiom room</a>` : ""}
      <div class="pop-actions">
        ${link ? `<button type="button" data-action="copy-link" data-url="${esc(link)}">Copy link</button>` : ""}
        ${room ? `<button type="button" data-action="copy-link" data-url="${esc(room)}">Copy room link</button>` : ""}
        ${tel ? `<a href="${esc(tel)}">Call</a>` : ""}
        ${dial ? `<button type="button" data-action="copy-dial" data-text="${esc(dial).replace(/\n/g, "&#10;")}">Share dial-in</button>` : ""}
      </div>
      ${locationText ? `<p class="loc"><a href="${esc(map)}" target="_blank" rel="noopener noreferrer">${esc(locationText)}</a></p>` : ""}
      ${event.description ? `<div class="desc">${linkify(event.description)}</div>` : ""}
      ${guests ? `<ul class="guests">${guests}</ul>` : ""}
      ${self && !organizerSelf ? `<div class="rsvp" role="group" aria-label="RSVP">
        ${["accepted", "tentative", "declined"].map((s) => `<button type="button" data-action="rsvp" data-status="${s}" class="${self.responseStatus === s ? "on" : ""}">${s === "accepted" ? "Yes" : s === "declined" ? "No" : "Maybe"}</button>`).join("")}
      </div>` : ""}
      <p class="meta">${esc(cal?.summary || "")} · ${esc(reminders)}${event.recurrence || event.recurringEventId ? ` · ${esc(describeRecurrence(event.recurrence))}` : ""}</p>
      <div class="pop-actions">
        ${locked ? "" : `<button type="button" data-action="edit-event">Edit</button>`}
        <button type="button" data-action="dup-event">Duplicate</button>
        ${locked ? "" : `<button type="button" data-action="del-event" class="danger">Delete</button>`}
        <a href="${esc(googleEventUrl(event.id, event.calendarId))}" target="_blank" rel="noopener noreferrer">Open in Google Calendar</a>
      </div>
    </div>
  </div>`;
}

function linkify(text) {
  const re = /https?:\/\/[^\s]+/g;
  let out = "";
  let last = 0;
  for (const m of String(text).matchAll(re)) {
    out += esc(text.slice(last, m.index));
    const href = safeHttpUrl(m[0].replace(/[),.;]+$/, ""));
    out += href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(m[0])}</a>` : esc(m[0]);
    last = m.index + m[0].length;
  }
  out += esc(String(text).slice(last));
  return out.replace(/\n/g, "<br>");
}

export function editorHtml(state, draft) {
  const writable = state.calendars.filter((c) => !calendarLocked(c, state.settings));
  const palette = state.palette || EVENT_PALETTE;
  const swatches = Object.entries(palette).map(([id, entry]) => {
    const on = draft.colorMode === "palette" && String(draft.colorId) === id;
    return `<button type="button" class="swatch-btn${on ? " on" : ""}" data-action="pick-color" data-color="${id}" style="background:${esc(entry.background)}" title="${esc(entry.name || id)}" aria-label="${esc(entry.name || `Color ${id}`)}"></button>`;
  }).join("");
  const startDay = ymdStr(ymdFromDate(draft.start, HOME_TZ));
  const endForInput = draft.allDay ? ymdStr(addDays(ymdFromDate(draft.end, HOME_TZ), -1)) : ymdStr(ymdFromDate(draft.end, HOME_TZ));
  const startTime = hhmm(draft.start);
  const endTime = hhmm(draft.end);
  const rec = draft.recModel || { preset: "none" };
  const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  const lockedCal = draft.mode === "edit" && calendarLocked(calOf(state, draft.originalCalendarId), state.settings);
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">
    <header class="sheet-bar">
      <button type="button" data-action="close-editor">Cancel</button>
      <h2 id="ed-title">${draft.mode === "create" ? "New event" : "Edit event"}</h2>
      <button type="button" class="primary" data-action="save-event" ${lockedCal ? "disabled" : ""}>Save</button>
    </header>
    <div class="sheet-body">
      <input id="ed-summary" class="title-input" placeholder="Add title" value="${esc(draft.summary)}" autocomplete="off">
      <section class="color-block">
        <div class="color-tools">
          <canvas id="wheel" width="168" height="168" aria-label="Color wheel"></canvas>
          <div>
            <label class="inline">Brightness <input id="wheel-v" type="range" min="0.15" max="1" step="0.01" value="${draft.wheelV || 1}"></label>
            <label class="inline">Hex <input id="wheel-hex" value="${esc(draft.axiomColor || "")}" placeholder="#c026d3" autocomplete="off"></label>
            <p id="nearest-note" class="hint"></p>
          </div>
        </div>
        <div class="swatches">
          <button type="button" class="swatch-btn def${draft.colorMode === "default" ? " on" : ""}" data-action="pick-color" data-color="default" title="Calendar default" aria-label="Calendar default"></button>
          ${swatches}
        </div>
      </section>
      <label>Calendar
        <select id="ed-cal" ${draft.recurringEventId ? "disabled" : ""}>
          ${(draft.mode === "edit" ? state.calendars : writable).map((c) => `<option value="${esc(c.id)}" ${c.id === draft.calendarId ? "selected" : ""} ${calendarLocked(c, state.settings) && c.id !== draft.calendarId ? "disabled" : ""}>${esc(c.summary || c.id)}</option>`).join("")}
        </select>
      </label>
      <label class="check"><input id="ed-allday" type="checkbox" ${draft.allDay ? "checked" : ""}> All day</label>
      <div class="when-grid">
        <label>Start <input id="ed-start-date" type="date" value="${startDay}"></label>
        <label class="time-field">Time <input id="ed-start-time" type="time" value="${startTime}"></label>
        <label>End <input id="ed-end-date" type="date" value="${endForInput}"></label>
        <label class="time-field">Time <input id="ed-end-time" type="time" value="${endTime}"></label>
      </div>
      <div id="tz-readout"></div>
      ${draft.recurringEventId ? `<fieldset class="scope"><legend>Edit</legend>
        ${[["instance", "This event"], ["following", "This and following"], ["series", "All events"]].map(([v, label]) => `<label class="check"><input type="radio" name="scope" value="${v}" ${draft.scope === v ? "checked" : ""}> ${label}</label>`).join("")}
      </fieldset>` : ""}
      <label>Repeat
        <select id="ed-repeat">
          ${[["none", "Does not repeat"], ["daily", "Daily"], ["weekly", "Weekly"], ["weekdays", "Every weekday"], ["monthly", "Monthly"], ["yearly", "Yearly"], ["custom", "Custom"]].map(([v, label]) => `<option value="${v}" ${rec.preset === v ? "selected" : ""}>${label}</option>`).join("")}
          ${rec.preset === "raw" ? `<option value="raw" selected>Custom rule (kept as-is)</option>` : ""}
        </select>
      </label>
      <div id="ed-custom" class="${rec.preset === "weekly" || rec.preset === "custom" ? "" : "hide"}">
        <div class="dow-picks">${days.map((d, i) => `<label class="check"><input type="checkbox" data-dow="${d}" ${(rec.byDay || []).includes(d) ? "checked" : ""}> ${DOW_SHORT[i]}</label>`).join("")}</div>
        <label class="inline">Every <input id="ed-interval" type="number" min="1" max="30" value="${rec.interval || 1}"> <span id="ed-interval-unit">weeks</span></label>
        <label>Ends
          <select id="ed-end-type">
            <option value="never" ${rec.endType === "never" ? "selected" : ""}>Never</option>
            <option value="on" ${rec.endType === "on" ? "selected" : ""}>On date</option>
            <option value="count" ${rec.endType === "count" ? "selected" : ""}>After</option>
          </select>
        </label>
        <input id="ed-end-date" type="date" value="${esc(rec.endDate || "")}">
        <label class="inline">Times <input id="ed-count" type="number" min="1" max="365" value="${rec.count || 10}"></label>
      </div>
      <label>Location <input id="ed-location" value="${esc(draft.location || "")}" placeholder="Add location"></label>
      ${meetEditorHtml(draft)}
      ${roomEditorHtml(draft)}
      <label>Guests <input id="ed-guest" type="email" placeholder="name@email.com" autocomplete="off"></label>
      <ul id="ed-guests" class="guest-edit"></ul>
      <label class="check"><input id="ed-notify" type="checkbox" ${draft.notify !== false ? "checked" : ""}> Email guests about changes</label>
      <label>Description <textarea id="ed-desc" rows="4">${esc(draft.description || "")}</textarea></label>
      <section>
        <label class="check"><input id="ed-rem-default" type="checkbox" ${draft.reminders?.useDefault !== false ? "checked" : ""}> Use calendar default reminders</label>
        <div id="ed-rems"></div>
        <button type="button" id="ed-add-rem" class="textish">Add reminder</button>
      </section>
      <label>Show as
        <select id="ed-show">
          <option value="opaque" ${draft.transparency !== "transparent" ? "selected" : ""}>Busy</option>
          <option value="transparent" ${draft.transparency === "transparent" ? "selected" : ""}>Free</option>
        </select>
      </label>
      <p id="ed-error" class="error" hidden></p>
    </div>
  </div>`;
}

function meetEditorHtml(draft) {
  const link = draft.existingLink || "";
  const source = draft.raw || {};
  const tel = safeTel(phoneEntryOf(source)?.uri);
  const dial = dialInText(source);
  if (draft.hadMeet && link && draft.addMeet) {
    return `<section class="meet-box">
      <p class="meet-current"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${videoIcon()} Current Meet</a></p>
      <div class="pop-actions">
        <button type="button" data-action="copy-link" data-url="${esc(link)}">Copy link</button>
        ${tel ? `<a href="${esc(tel)}">Call</a>` : ""}
        ${dial ? `<button type="button" data-action="copy-dial" data-text="${esc(dial).replace(/\n/g, "&#10;")}">Share dial-in</button>` : ""}
        <button type="button" data-action="remove-meet">Remove Meet</button>
      </div>
      <p class="hint">This Meet link stays on unrelated edits. In-call tools (recording, captions, breakout rooms) open in Meet itself.</p>
    </section>`;
  }
  if (draft.hadMeet && !draft.addMeet) {
    return `<section class="meet-box">
      <p>Meet will be removed when you save.</p>
      <button type="button" class="textish" data-action="keep-meet">Keep Meet</button>
    </section>`;
  }
  return `<section class="meet-box">
    <label class="check"><input id="ed-meet" type="checkbox" ${draft.addMeet ? "checked" : ""}> Add Google Meet video conferencing</label>
    <p class="hint">A new Meet link is created when you save. In-call tools (recording, captions, breakout rooms) open in Meet itself.</p>
  </section>`;
}

function roomEditorHtml(draft) {
  const link = axiomRoomLinkOf(draft) || "";
  if (link) {
    return `<section class="meet-box">
      <p class="meet-current"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Join Axiom video room</a></p>
      <div class="pop-actions">
        <button type="button" data-action="copy-link" data-url="${esc(link)}">Copy invite link</button>
        <button type="button" data-action="remove-room">Remove Axiom room</button>
      </div>
      <p class="hint">The link is written into the location and description, not into Google Meet, so guests see it on the invite. Peer-to-peer works best 1:1, and the first open tab has to stay open.</p>
    </section>`;
  }
  return `<section class="meet-box">
    <button type="button" data-action="add-room">Add Axiom video room</button>
    <p class="hint">Creates a camera, mic, and chat room in this app. Google Meet above is unchanged. The room link goes in the location and description.</p>
  </section>`;
}

function hhmm(date) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: HOME_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const bag = Object.fromEntries(p.map((x) => [x.type, x.value]));
  let h = bag.hour;
  if (h === "24") h = "00";
  return `${h}:${bag.minute}`;
}

export function readoutHtml(draft, clocks) {
  const primary = draft.allDay
    ? "All day"
    : `${formatRange(draft.start, draft.end, HOME_TZ)} ${zoneAbbrev(draft.start, HOME_TZ)}`;
  const extra = (clocks || []).map((c) => `<li><span>${esc(c.label)}</span> ${esc(formatRange(draft.start, draft.end, c.timeZone))} ${esc(zoneAbbrev(draft.start, c.timeZone))}</li>`).join("");
  return `<p class="you-time">Chicago · ${esc(primary)}</p>${extra ? `<ul class="tz-list">${extra}</ul>` : ""}`;
}

export function guestListHtml(draft, ctx) {
  return (draft.attendees || []).map((a, i) => {
    const fake = { summary: draft.summary, location: draft.location, attendees: [a] };
    const clocks = clocksForEvent({ ...fake, start: { dateTime: draft.start.toISOString(), timeZone: HOME_TZ } }, ctx);
    const clock = clocks[0];
    const when = clock && !draft.allDay ? `${formatTime(draft.start, clock.timeZone)} ${zoneAbbrev(draft.start, clock.timeZone)}` : "";
    return `<li><span>${esc(a.displayName || a.email)}</span>${when ? `<em>${esc(when)}</em>` : ""}<button type="button" data-action="remove-guest" data-index="${i}" aria-label="Remove ${esc(a.email)}">×</button></li>`;
  }).join("");
}

export function reminderEditorHtml(draft) {
  const overrides = draft.reminders?.overrides || [];
  const options = [0, 5, 10, 15, 30, 60, 120, 1440, 10080];
  return overrides.map((r, i) => `<div class="rem-row">
    <select data-rem="method" data-index="${i}">
      <option value="popup" ${r.method !== "email" ? "selected" : ""}>Notification</option>
      <option value="email" ${r.method === "email" ? "selected" : ""}>Email</option>
    </select>
    <select data-rem="minutes" data-index="${i}">
      ${options.map((m) => `<option value="${m}" ${Number(r.minutes) === m ? "selected" : ""}>${esc(reminderLabel(m))}</option>`).join("")}
    </select>
    <button type="button" data-action="remove-rem" data-index="${i}" aria-label="Remove reminder">×</button>
  </div>`).join("");
}

export function settingsHtml(state) {
  const contacts = Object.entries(state.settings.contacts || {}).sort((a, b) => (a[1].name || a[0]).localeCompare(b[1].name || b[0]));
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="set-title">
    <header class="sheet-bar">
      <button type="button" data-action="close-settings">Close</button>
      <h2 id="set-title">Settings</h2>
      <span></span>
    </header>
    <div class="sheet-body">
      <h3>Google sign-in</h3>
      <label>OAuth client ID
        <input id="set-client" value="${esc(state.clientId || "")}" placeholder="….apps.googleusercontent.com" autocomplete="off" spellcheck="false">
      </label>
      <p class="hint">Authorized JavaScript origin: <code>https://axiom-mathematics.github.io</code>. Details are in SETUP.md.</p>
      <button type="button" id="set-save-client" class="primary">Save client ID</button>
      <button type="button" id="set-signout" class="textish">Sign out</button>
      <h3>Week</h3>
      <label>Starts on
        <select id="set-week">
          <option value="0" ${state.settings.weekStart !== 1 ? "selected" : ""}>Sunday</option>
          <option value="1" ${state.settings.weekStart === 1 ? "selected" : ""}>Monday</option>
        </select>
      </label>
      <h3>Display time offsets</h3>
      <p class="hint">The Wyzant import feed shows lessons about 2 hours later than the real Wyzant times. This shifts that calendar on screen only. Calendars with an offset are not written to, so the correction is never saved back to Google.</p>
      <div id="set-offsets">
        ${state.calendars.map((c) => {
          const row = state.settings.offsets?.[c.id];
          const hours = row == null ? 0 : Number(row.hours) || 0;
          const enabled = !!row && row.enabled !== false && hours !== 0;
          return `<div class="offset-row">
            <span class="swatch" style="background:${esc(c.backgroundColor || "#999")}"></span>
            <span class="cal-name">${esc(c.summary || c.id)}</span>
            <label class="check"><input type="checkbox" data-offset-enabled="${esc(c.id)}" ${enabled ? "checked" : ""}> Adjust</label>
            <input data-offset-hours="${esc(c.id)}" type="number" step="0.5" value="${hours}">
            <span>hours</span>
          </div>`;
        }).join("")}
      </div>
      <button type="button" id="set-save-offsets" class="primary">Save offsets</button>
      <h3>Contact time zones</h3>
      <p class="hint">Filled in automatically from contacts, invites, and place names. Edit one here if you want. Nothing asks you to confirm a zone.</p>
      <label>Find a contact <input id="set-contact-q" placeholder="Name or email" autocomplete="off"></label>
      <ul id="set-contacts" class="contact-list">
        ${contacts.filter(([, c]) => c.timeZone).map(([email, c]) => contactRow(email, c)).join("") || `<li class="empty">No saved zones yet.</li>`}
      </ul>
      <h3>Axiom video rooms</h3>
      <p class="hint">Rooms use public STUN, the same idea as the whiteboard. If a student’s network blocks the call, paste a TURN relay. <a href="https://www.metered.ca/tools/openrelay/" target="_blank" rel="noopener noreferrer">Metered Open Relay</a> has a free tier. Leave the URL empty to stay on STUN only. This is stored with the other settings.</p>
      <label>TURN URL <input id="set-turn-urls" value="${esc(state.settings.turn?.urls || "")}" placeholder="turn:example.com:443" autocomplete="off"></label>
      <label>Username <input id="set-turn-user" value="${esc(state.settings.turn?.username || "")}" autocomplete="off"></label>
      <label>Credential <input id="set-turn-cred" type="password" value="${esc(state.settings.turn?.credential || "")}" autocomplete="off"></label>
      <button type="button" id="set-save-turn" class="primary">Save relay</button>
      <h3>Sync</h3>
      <p class="hint" id="set-sync">${esc(state.driveNote || "Contact zones and offsets are stored in this browser and, when Drive app data is allowed, in a private file on your Google account.")}</p>
      <div class="pop-actions">
        <button type="button" id="set-export">Export JSON</button>
        <label class="textish file">Import JSON <input id="set-import" type="file" accept="application/json"></label>
      </div>
    </div>
  </div>`;
}

function contactRow(email, c) {
  const source = { manual: "Set by you", people: "From contacts", invite: "From an invite", city: "From a place name" }[c.source] || "";
  return `<li data-email="${esc(email)}"><div><strong>${esc(c.name || email)}</strong><br><span class="hint">${esc(email)} · ${esc(source)}</span></div><input data-zone-email="${esc(email)}" value="${esc(c.timeZone || "")}" list="tz-list" aria-label="Time zone for ${esc(email)}"></li>`;
}

export function helpHtml() {
  const rows = [
    ["t", "Today"],
    ["j / k or arrows", "Next / previous"],
    ["d w m a", "Day, week, month, agenda"],
    ["c", "Create"],
    ["/", "Search"],
    ["⌘K or Ctrl K", "Command bar"],
    ["Shift J", "Join next meeting"],
    ["?", "This help"],
    ["Esc", "Close"],
  ];
  return `<div class="sheet help" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <header class="sheet-bar"><button type="button" data-action="close-help">Close</button><h2 id="help-title">Shortcuts</h2><span></span></header>
    <div class="sheet-body"><table>${rows.map(([k, v]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(v)}</td></tr>`).join("")}</table>
    <p class="hint">Quick add understands phrases like “Algebra w/ Maya tue 4pm 1h”, “lunch tomorrow noon”, and “video call Friday 3pm”. Axiom video rooms are separate from Google Meet: the editor writes the room link into the invite.</p></div>
  </div>`;
}

export function nearestCaption(hex, palette) {
  const custom = normalizeHex(hex);
  if (!custom) return "";
  const id = nearestEventColorId(custom, palette);
  const name = (palette || EVENT_PALETTE)[id]?.name || "a standard color";
  const googleHex = (palette || EVENT_PALETTE)[id]?.background;
  if (googleHex && googleHex.toLowerCase() === custom) return "";
  return `Google Calendar’s own apps will show ${name}, the closest of its 11 colors. This app keeps ${custom}.`;
}
