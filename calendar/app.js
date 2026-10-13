import {
  deleteEvent,
  getColors,
  insertEvent,
  listCalendarList,
  listEvents,
  moveEvent,
  patchEvent,
  searchEvents,
  updateEvent,
} from "./api.js";
import {
  CALENDAR_SCOPE,
  DEFAULT_CLIENT_ID,
  GOOGLE_EVENT_COLOR_NAMES,
  GOOGLE_EVENT_COLORS,
  STORAGE_CLIENT_ID,
  STORAGE_HIDDEN,
  STORAGE_OFFSETS,
  STORAGE_VIEW,
  TIMEZONE,
  TOKEN_SESSION_KEY,
  WYZANT_CALENDAR_ID,
  calendarWritable,
  isPlaceholderClientId,
  offsetAdjustment,
  resolveOffsetMinutes,
} from "./config.js";
import { layoutOverlaps } from "./layout.js";
import { describeParsed, parseQuickAdd } from "./parse.js";
import {
  addDays,
  addMonths,
  calendarDayNumber,
  dateInputValue,
  dayKey,
  fetchWindow,
  formatChicagoDateTime,
  formatLongDate,
  formatMediumDate,
  formatMonthYear,
  formatTimeRange,
  formatWeekday,
  isSameDay,
  minutesSinceMidnight,
  parseDayKey,
  rangeLabel,
  shiftAnchor,
  shiftMinutes,
  startOfDay,
  startOfMonth,
  startOfWeek,
  timeInputValue,
  zonedParts,
  zonedToUtc,
} from "./time.js";

const VIEWS = ["day", "week", "month", "agenda"];
const state = {
  token: "",
  expires: 0,
  demo: false,
  account: "",
  calendars: [],
  buckets: new Map(),
  events: [],
  hidden: {},
  offsets: {},
  view: "week",
  anchor: new Date(),
  palette: null,
  loading: false,
  fetchedAt: 0,
  scrollKey: "",
  overlay: null,
  remoteHits: [],
};

const drag = {
  active: false,
  pointerId: null,
  type: "",
  moved: false,
  key: "",
  originCol: null,
  grabMin: 0,
  anchorMin: 0,
  displayStart: null,
  displayEnd: null,
  durationMs: 0,
  span: 1,
  color: null,
  title: "",
  draftDay: "",
  draftStartMin: 0,
  draftEndMin: 0,
};
let suppressClick = false;
let tokenClient = null;
let tokenClientId = "";
let gisPromise = null;
let searchSeq = 0;
let sawDay = dayKey(new Date());

const $ = (id) => document.getElementById(id);

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = String(value);
      else if (key === "hidden") node.hidden = Boolean(value);
      else if (key === "checked") node.checked = Boolean(value);
      else if (key === "disabled") node.disabled = Boolean(value);
      else if (key === "value" && "value" in node) node.value = value;
      else if (key === "dataset" && value) Object.assign(node.dataset, value);
      else if (key === "style") node.setAttribute("style", value);
      else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) node.setAttribute(key, "");
      else node.setAttribute(key, String(value));
    }
  }
  const add = (kid) => {
    if (Array.isArray(kid)) kid.forEach(add);
    else if (kid == null || kid === false) return;
    else node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  };
  kids.forEach(add);
  return node;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : fallback;
  } catch {
    return fallback;
  }
}

function toast(message) {
  const node = h("div", { class: "toast", text: message });
  $("toasts").append(node);
  setTimeout(() => node.remove(), 4200);
}

function cssColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

function persistOffsets() {
  localStorage.setItem(STORAGE_OFFSETS, JSON.stringify(state.offsets));
}

function isShown(cal) {
  if (Object.prototype.hasOwnProperty.call(state.hidden, cal.id)) return !state.hidden[cal.id];
  return cal.selected !== false;
}

function calendarById(id) {
  return state.calendars.find((cal) => cal.id === id) || null;
}

function defaultCalendar() {
  const shown = state.calendars.filter((cal) => isShown(cal) && calendarWritable(cal));
  return shown.find((cal) => cal.primary) || shown[0] || null;
}

function persistRemote() {
  return Boolean(state.token) && !state.demo;
}

function canEditLocally() {
  return Boolean(state.token) || state.demo;
}

function storedClientId() {
  return (localStorage.getItem(STORAGE_CLIENT_ID) || "").trim();
}

function colorsFor(raw, cal) {
  const id = raw.colorId ? String(raw.colorId) : "";
  const apiColor = id && state.palette?.event?.[id];
  if (apiColor?.background) {
    return { background: apiColor.background, foreground: apiColor.foreground || "#1d1d1d" };
  }
  if (id && GOOGLE_EVENT_COLORS[id]) return GOOGLE_EVENT_COLORS[id];
  return {
    background: cal.backgroundColor || "#5484ed",
    foreground: cal.foregroundColor || "#1d1d1d",
  };
}

function normalize(raw, cal) {
  if (!raw || raw.status === "cancelled" || !raw.start) return null;
  const allDay = Boolean(raw.start.date && !raw.start.dateTime);
  const offset = allDay ? 0 : resolveOffsetMinutes(cal.id, state.offsets);
  let actualStart;
  let actualEnd;
  if (allDay) {
    actualStart = parseDayKey(raw.start.date);
    actualEnd = raw.end?.date ? parseDayKey(raw.end.date) : addDays(actualStart, 1);
  } else if (raw.start.dateTime) {
    actualStart = new Date(raw.start.dateTime);
    actualEnd = new Date(raw.end?.dateTime || raw.start.dateTime);
  } else return null;
  if (Number.isNaN(actualStart.getTime()) || Number.isNaN(actualEnd.getTime())) return null;
  const start = shiftMinutes(actualStart, offset);
  let end = shiftMinutes(actualEnd, offset);
  if (end <= start) end = new Date(start.getTime() + (allDay ? 86400000 : 15 * 60000));
  const selfAttendee = (raw.attendees || []).find((attendee) => attendee.self) || null;
  return {
    key: `${cal.id}\u001f${raw.id}`,
    id: raw.id,
    calendarId: cal.id,
    calendarSummary: cal.summary || cal.id,
    primary: Boolean(cal.primary),
    title: raw.summary || "(No title)",
    allDay,
    start,
    end,
    offsetMinutes: offset,
    location: raw.location || "",
    description: raw.description || "",
    status: raw.status || "confirmed",
    color: colorsFor(raw, cal),
    colorId: raw.colorId ? String(raw.colorId) : "",
    readOnly: !calendarWritable(cal),
    attendees: raw.attendees || [],
    selfAttendee,
    htmlLink: raw.htmlLink || "",
    hangoutLink: raw.hangoutLink || raw.conferenceData?.entryPoints?.find((point) => point.uri)?.uri || "",
    recurringEventId: raw.recurringEventId || "",
    iCalUID: raw.iCalUID || "",
    raw,
  };
}

function rank(ev) {
  return (ev.selfAttendee ? 4 : 0) + (ev.primary ? 2 : 0) + (ev.readOnly ? 0 : 1);
}

function recomputeEvents() {
  const list = [];
  for (const cal of state.calendars) {
    if (!isShown(cal)) continue;
    const bucket = state.buckets.get(cal.id);
    if (!bucket) continue;
    for (const raw of bucket.events) {
      const ev = normalize(raw, cal);
      if (ev) list.push(ev);
    }
  }
  const best = new Map();
  for (const ev of list) {
    const stamp = ev.raw.start?.dateTime || ev.raw.start?.date || "";
    const id = `${ev.iCalUID || ev.key}@${stamp}`;
    const prev = best.get(id);
    if (!prev || rank(ev) > rank(prev)) best.set(id, ev);
  }
  state.events = [...best.values()];
}

function findEvent(key) {
  return state.events.find((ev) => ev.key === key) || null;
}

function replaceRaw(calendarId, raw) {
  const bucket = state.buckets.get(calendarId);
  if (!bucket) state.buckets.set(calendarId, { start: -1e15, end: 1e15, events: [raw] });
  else {
    const index = bucket.events.findIndex((item) => item.id === raw.id);
    if (index >= 0) bucket.events[index] = raw;
    else bucket.events.push(raw);
  }
  recomputeEvents();
  render();
}

function removeRaw(calendarId, eventId) {
  const bucket = state.buckets.get(calendarId);
  if (!bucket) return;
  bucket.events = bucket.events.filter((item) => item.id !== eventId);
  recomputeEvents();
  render();
}

function setLoading(on) {
  state.loading = on;
  const bar = $("progress");
  if (bar) bar.hidden = !on;
}

function setSidebar(open) {
  $("sidebar").classList.toggle("open", open);
  $("scrim").hidden = !open;
}

function closeModal() {
  state.overlay = null;
  $("modal-root").replaceChildren();
}

function goTo(date, view) {
  state.anchor = date;
  if (view && VIEWS.includes(view)) {
    state.view = view;
    localStorage.setItem(STORAGE_VIEW, view);
  }
  if (window.matchMedia("(max-width: 960px)").matches) setSidebar(false);
  render();
  ensureEvents();
}

function setView(view) {
  goTo(state.anchor, view);
}

function goToday() {
  goTo(new Date());
}

function shift(dir) {
  goTo(shiftAnchor(state.anchor, state.view, dir));
}

function toggleCalendar(id) {
  const cal = calendarById(id);
  if (!cal) return;
  state.hidden[id] = isShown(cal);
  localStorage.setItem(STORAGE_HIDDEN, JSON.stringify(state.hidden));
  recomputeEvents();
  render();
  ensureEvents();
}

function render() {
  renderChrome();
  if (!drag.active) renderView();
  positionNowLines();
}

function renderChrome() {
  const label = rangeLabel(state.anchor, state.view);
  $("range-label").textContent = label;
  document.title = `${label} · Axiom Calendar`;
  $("brand-day").textContent = String(zonedParts(new Date()).day);
  for (const button of document.querySelectorAll("[data-view]")) {
    button.setAttribute("aria-selected", button.dataset.view === state.view ? "true" : "false");
  }
  const signedIn = Boolean(state.token) || state.demo;
  $("gate").hidden = signedIn;
  $("banner").hidden = !state.demo;
  $("signout-btn").hidden = !signedIn;
  $("account").textContent = state.demo ? "Sample preview" : (state.account || "Not signed in");
  const client = $("client-id");
  if (client && document.activeElement !== client) {
    const stored = storedClientId();
    client.value = isPlaceholderClientId(stored) ? "" : stored;
    client.placeholder = DEFAULT_CLIENT_ID;
  }
  renderMini();
  renderCalendarList();
}

function renderMini() {
  const label = $("mini-label");
  label.textContent = formatMonthYear(state.anchor);
  const grid = $("mini");
  const start = startOfWeek(startOfMonth(state.anchor));
  const today = new Date();
  const nodes = ["S", "M", "T", "W", "T", "F", "S"].map((letter) => h("div", { class: "dow", text: letter }));
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const parts = zonedParts(day);
    const outside = parts.month !== zonedParts(state.anchor).month;
    const classes = [
      outside ? "outside" : "",
      isSameDay(day, today) ? "today" : "",
      isSameDay(day, state.anchor) ? "anchor" : "",
    ].filter(Boolean).join(" ");
    nodes.push(h("button", {
      type: "button",
      class: classes,
      text: String(parts.day),
      "aria-label": formatLongDate(day),
      onClick: () => goTo(day),
    }));
  }
  grid.replaceChildren(...nodes);
}

function renderCalendarList() {
  const list = $("calendar-list");
  if (!state.calendars.length) {
    list.replaceChildren(h("p", { class: "cal-role", text: "Sign in to load calendars." }));
    return;
  }
  list.replaceChildren(...state.calendars.map((cal) => {
    const shown = isShown(cal);
    const name = cal.summary || cal.id;
    const adj = offsetAdjustment(cal.id, resolveOffsetMinutes(cal.id, state.offsets), name);
    const meta = h("div", {}, h("div", { class: "cal-name", text: name }));
    if (!calendarWritable(cal)) meta.append(h("div", { class: "cal-role", text: "Read-only" }));
    if (adj) {
      meta.append(h("button", {
        type: "button",
        class: "cal-offset",
        title: adj.tooltip,
        text: adj.tooltip,
        onClick: () => openSettings(cal.id),
      }));
    }
    return h("div", { class: "cal-row" },
      h("span", { class: "cal-dot", style: `background:${cssColor(cal.backgroundColor, "#5484ed")}` }),
      meta,
      h("button", {
        type: "button",
        class: "switch",
        role: "switch",
        "aria-checked": shown ? "true" : "false",
        "aria-label": `${shown ? "Hide" : "Show"} ${name}`,
        onClick: () => toggleCalendar(cal.id),
      }),
    );
  }));
}

function renderView() {
  const view = $("view");
  const scroller = view.querySelector(".time-scroll");
  const prevTop = scroller ? scroller.scrollTop : null;
  const key = `${state.view}|${dayKey(state.anchor)}`;
  const preserve = key === state.scrollKey && prevTop != null;
  view.replaceChildren(buildView());
  const next = view.querySelector(".time-scroll");
  state.scrollKey = key;
  if (!next) return;
  if (preserve) next.scrollTop = prevTop;
  else {
    const showsToday = viewShowsToday();
    const hour = showsToday ? Math.max(0, zonedParts(new Date()).hour - 1) : 7;
    next.scrollTop = hour * hourPx();
  }
}

function hourPx() {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour"));
  return Number.isFinite(n) ? n : 52;
}

function viewShowsToday() {
  const today = new Date();
  if (state.view === "day") return isSameDay(state.anchor, today);
  if (state.view === "week") {
    const start = startOfWeek(state.anchor);
    return today >= start && today < addDays(start, 7);
  }
  return false;
}

function buildView() {
  if (state.view === "month") return buildMonth();
  if (state.view === "agenda") return buildAgenda();
  return buildTimeGrid(state.view === "day" ? 1 : 7);
}

function daySpan(count) {
  const start = count === 1 ? startOfDay(state.anchor) : startOfWeek(state.anchor);
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

function eventsTouching(start, end) {
  return state.events
    .filter((ev) => ev.start < end && ev.end > start)
    .sort((a, b) => (a.allDay === b.allDay ? a.start - b.start : a.allDay ? -1 : 1) || a.title.localeCompare(b.title));
}

function buildTimeGrid(count) {
  const days = daySpan(count);
  const rangeEnd = addDays(days[0], count);
  const events = eventsTouching(days[0], rangeEnd);
  const root = h("section", { class: "week", style: `--days:${count}` });
  root.append(buildWeekHead(days), buildAllDay(days, events.filter((ev) => ev.allDay)), buildCanvas(days, events.filter((ev) => !ev.allDay)));
  if (!state.calendars.some(isShown) && (state.token || state.demo)) {
    root.append(h("p", { class: "empty", text: "All calendars are hidden." }));
  }
  return root;
}

function buildWeekHead(days) {
  const row = h("div", { class: "week-head", style: `--days:${days.length}` });
  row.append(h("div"));
  for (const day of days) {
    const weekend = [0, 6].includes(zonedParts(day).weekdayIndex);
    const classes = ["day-head", isSameDay(day, new Date()) ? "today" : "", weekend ? "weekend" : ""].filter(Boolean).join(" ");
    row.append(h("button", { type: "button", class: classes, onClick: () => goTo(day, "day") },
      h("span", { class: "dow", text: formatWeekday(day) }),
      h("span", { class: "dom", text: String(zonedParts(day).day) }),
    ));
  }
  return row;
}

function buildAllDay(days, events) {
  const row = h("div", { class: "allday", style: `--days:${days.length}` });
  row.append(h("div", { class: "allday-label", text: "all-day" }));
  for (const day of days) {
    const dayEnd = addDays(day, 1);
    const mine = events.filter((ev) => ev.start < dayEnd && ev.end > day);
    const col = h("div", { class: "allday-col", dataset: { day: dayKey(day) } });
    const shown = mine.slice(0, 4);
    for (const ev of shown) col.append(eventBlock(ev, "allday-event", blockColor(ev)));
    if (mine.length > shown.length) {
      col.append(h("button", {
        type: "button",
        class: "more",
        text: `+${mine.length - shown.length} more`,
        onClick: () => goTo(day, "day"),
      }));
    }
    row.append(col);
  }
  return row;
}

function buildCanvas(days, events) {
  const scroll = h("div", { class: "time-scroll" });
  const canvas = h("div", { class: "time-canvas", style: `--days:${days.length}` });
  const gutter = h("div", { class: "gutter" });
  for (let hour = 1; hour < 24; hour++) {
    const label = hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
    gutter.append(h("div", { class: "hour-label", style: `top:${(hour / 24) * 100}%`, text: label }));
  }
  if (days.some((day) => isSameDay(day, new Date()))) {
    gutter.append(h("div", { class: "now-tick", style: `top:${(minutesSinceMidnight(new Date()) / 1440) * 100}%` }));
  }
  canvas.append(gutter);
  for (const day of days) {
    const dayEnd = addDays(day, 1);
    const col = h("div", {
      class: `day-col${isSameDay(day, new Date()) ? " today" : ""}`,
      dataset: { day: dayKey(day) },
    });
    const segments = [];
    for (const ev of events) {
      if (ev.end <= day || ev.start >= dayEnd) continue;
      const startMin = ev.start <= day ? 0 : minutesSinceMidnight(ev.start);
      const endMin = ev.end >= dayEnd ? 1440 : minutesSinceMidnight(ev.end);
      const layoutEnd = Math.max(endMin, startMin + 15);
      segments.push({ ev, startMin, endMin: layoutEnd, displayEndMin: endMin });
    }
    for (const item of layoutOverlaps(segments)) {
      const style = blockStyle(item.startMin, item.endMin, item.col, item.cols, item.ev.color);
      col.append(eventBlock(item.ev, "", style));
    }
    if (isSameDay(day, new Date())) {
      col.append(h("div", { class: "now-line", style: `top:${(minutesSinceMidnight(new Date()) / 1440) * 100}%` }));
    }
    canvas.append(col);
  }
  scroll.append(canvas);
  return scroll;
}

function blockColor(ev) {
  return `background:${cssColor(ev.color.background, "#5484ed")};color:${cssColor(ev.color.foreground, "#1d1d1d")}`;
}

function blockStyle(startMin, endMin, col, cols, color) {
  const top = (startMin / 1440) * 100;
  const height = ((endMin - startMin) / 1440) * 100;
  return `top:${top}%;height:${height}%;left:calc(${(col / cols) * 100}% + 2px);width:calc(${(1 / cols) * 100}% - 4px);${blockColor({ color })}`;
}

function eventBlock(ev, extra, style) {
  const adj = offsetAdjustment(ev.calendarId, ev.offsetMinutes, ev.calendarSummary);
  const declined = ev.selfAttendee?.responseStatus === "declined";
  const classes = ["event", extra, ev.readOnly ? "" : "can-drag", ev.status === "tentative" ? "tentative" : "", declined ? "declined" : "", adj ? "has-offset" : ""].filter(Boolean).join(" ");
  const when = ev.allDay ? "All day" : formatTimeRange(ev.start, ev.end);
  const btn = h("button", {
    type: "button",
    class: classes,
    style,
    dataset: { key: ev.key, readonly: ev.readOnly ? "1" : "0", allday: ev.allDay ? "1" : "0" },
    title: [ev.title, when, ev.calendarSummary, adj?.tooltip, ev.location].filter(Boolean).join("\n"),
  },
    h("span", { class: "event-title", text: ev.title }),
    ev.allDay ? null : h("span", { class: "event-meta", text: when }),
  );
  if (adj) btn.append(h("span", { class: "offset-badge", title: adj.tooltip, "aria-label": adj.tooltip, text: adj.label }));
  if (!ev.readOnly && !ev.allDay) btn.append(h("span", { class: "resize-handle", "aria-hidden": "true" }));
  return btn;
}

function buildMonth() {
  const start = startOfWeek(startOfMonth(state.anchor));
  const root = h("section", { class: "month" });
  root.append(h("div", { class: "month-dow" }, ...["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => h("div", { text: day }))));
  const grid = h("div", { class: "month-grid" });
  const maxChips = window.matchMedia("(max-width: 720px)").matches ? 2 : 3;
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const dayEnd = addDays(day, 1);
    const outside = zonedParts(day).month !== zonedParts(state.anchor).month;
    const classes = ["cell", outside ? "outside" : "", isSameDay(day, new Date()) ? "today" : "", isSameDay(day, state.anchor) ? "anchor" : ""].filter(Boolean).join(" ");
    const cell = h("div", { class: classes });
    cell.append(h("button", {
      type: "button",
      class: "cell-day",
      text: String(zonedParts(day).day),
      "aria-label": formatLongDate(day),
      onClick: () => goTo(day, "day"),
    }));
    const mine = eventsTouching(day, dayEnd);
    for (const ev of mine.slice(0, maxChips)) {
      const time = ev.allDay ? "" : `${formatTimeRange(ev.start, ev.end).split("–")[0].trim()} `;
      const adj = offsetAdjustment(ev.calendarId, ev.offsetMinutes, ev.calendarSummary);
      cell.append(h("button", {
        type: "button",
        class: "chip",
        style: blockColor(ev),
        title: [ev.title, ev.allDay ? "All day" : formatTimeRange(ev.start, ev.end), adj?.tooltip].filter(Boolean).join("\n"),
        onClick: () => openEditor(ev),
        text: `${time}${ev.title}${adj ? ` ${adj.label}` : ""}`,
      }));
    }
    if (mine.length > maxChips) {
      cell.append(h("button", { type: "button", class: "more", text: `+${mine.length - maxChips} more`, onClick: () => goTo(day, "agenda") }));
    }
    grid.append(cell);
  }
  root.append(grid);
  return root;
}

function buildAgenda() {
  const start = startOfDay(state.anchor);
  const end = addDays(start, 42);
  const events = state.events.filter((ev) => ev.end > start && ev.start < end).sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  const groups = new Map();
  if (isSameDay(start, new Date())) groups.set(dayKey(start), []);
  for (const ev of events) {
    const key = dayKey(ev.start < start ? start : ev.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  const root = h("section", { class: "agenda" });
  if (!groups.size) {
    root.append(h("p", { class: "empty", text: "Nothing scheduled. Use quick add, or press c." }));
    return root;
  }
  const todayKey = dayKey(new Date());
  const tomorrowKey = dayKey(addDays(startOfDay(new Date()), 1));
  for (const [key, items] of groups) {
    const day = parseDayKey(key);
    const heading = key === todayKey ? "Today" : key === tomorrowKey ? "Tomorrow" : formatLongDate(day);
    const section = h("section", { class: "agenda-day" }, h("h2", { text: heading }));
    if (!items.length) section.append(h("p", { class: "agenda-empty", text: "Nothing scheduled." }));
    for (const ev of items) {
      const adj = offsetAdjustment(ev.calendarId, ev.offsetMinutes, ev.calendarSummary);
      const card = h("button", {
        type: "button",
        class: `agenda-card${ev.selfAttendee?.responseStatus === "declined" ? " declined" : ""}`,
        style: blockColor(ev),
        onClick: () => openEditor(ev),
      },
        h("div", { class: "when", text: ev.allDay ? "All day" : formatTimeRange(ev.start, ev.end) }),
        h("div", { class: "title", text: ev.title }),
        h("div", { class: "meta", text: [ev.calendarSummary, ev.location].filter(Boolean).join(" · ") }),
      );
      if (adj) card.append(h("span", { class: "offset-badge", title: adj.tooltip, "aria-label": adj.tooltip, text: adj.label }));
      section.append(card);
    }
    root.append(section);
  }
  return root;
}

function positionNowLines() {
  const top = `${(minutesSinceMidnight(new Date()) / 1440) * 100}%`;
  document.querySelectorAll(".now-line, .now-tick").forEach((line) => { line.style.top = top; });
}

function requireSession() {
  if (canEditLocally()) return true;
  toast("Sign in to change events");
  const input = $("client-id");
  if (input) input.focus();
  return false;
}

function defaultSeed() {
  const now = new Date();
  const parts = zonedParts(now);
  let hour = parts.minute === 0 && parts.second === 0 ? parts.hour : parts.hour + 1;
  let day = startOfDay(now);
  if (hour >= 24) {
    hour = 9;
    day = addDays(day, 1);
  }
  const start = shiftMinutes(day, hour * 60);
  return { start, end: new Date(start.getTime() + 60 * 60000), allDay: false, summary: "" };
}

function looksLikeHtml(value) {
  return /<[a-z][\s\S]*>/i.test(value || "");
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.href;
  } catch { /* ignore */ }
  return "";
}

function openEditor(event, seed) {
  if (!event && !requireSession()) return;
  closeModal();
  state.overlay = "event";
  const creating = !event;
  const source = creating ? { ...defaultSeed(), ...seed } : event;
  const allDayInitial = Boolean(source.allDay);
  const start = source.start;
  const exclusiveEnd = source.end;
  const inclusiveEnd = allDayInitial ? addDays(exclusiveEnd, -1) : exclusiveEnd;
  const endForInput = allDayInitial && inclusiveEnd < start ? start : inclusiveEnd;
  const target = creating ? defaultCalendar() : calendarById(event.calendarId);
  const locked = !target || !calendarWritable(target);
  let attendees = (event?.attendees || []).map((attendee) => ({ ...attendee }));
  let attendeesTouched = false;
  let colorTouched = false;
  let selectedColor = event?.colorId || "";
  const descriptionValue = event ? (looksLikeHtml(event.description) ? htmlToText(event.description) : event.description) : "";
  const preserveHtml = Boolean(event && looksLikeHtml(event.description));
  const writableCals = state.calendars.filter((cal) => calendarWritable(cal) || cal.id === event?.calendarId);

  const form = h("form", { class: "stack", id: "event-form" });
  const title = h("input", { id: "event-title", required: true, value: event?.title && event.title !== "(No title)" ? event.title : (seed?.summary || ""), disabled: locked });
  const allDayBox = h("input", { type: "checkbox", id: "event-all-day", checked: allDayInitial, disabled: locked });
  const startDate = h("input", { type: "date", required: true, value: dateInputValue(start), disabled: locked });
  const endDate = h("input", { type: "date", required: true, value: dateInputValue(endForInput), disabled: locked });
  const startTime = h("input", { type: "time", required: true, value: allDayInitial ? "09:00" : timeInputValue(start), disabled: locked });
  const endTime = h("input", { type: "time", required: true, value: allDayInitial ? "10:00" : timeInputValue(exclusiveEnd), disabled: locked });
  const timeFields = h("div", { class: "times time-fields", hidden: allDayInitial },
    h("label", { class: "field" }, "Start", startTime),
    h("label", { class: "field" }, "End", endTime),
  );
  allDayBox.addEventListener("change", () => { timeFields.hidden = allDayBox.checked; });
  const calendarSelect = h("select", { id: "event-calendar", disabled: locked || (!creating && event.readOnly) });
  for (const cal of writableCals) {
    const option = h("option", { value: cal.id, text: cal.summary || cal.id });
    if (cal.id === (event?.calendarId || target?.id)) option.selected = true;
    calendarSelect.append(option);
  }
  if (!writableCals.length && target) {
    calendarSelect.append(h("option", { value: target.id, text: target.summary || target.id }));
  }
  const location = h("input", { value: event?.location || "", disabled: locked });
  const description = h("textarea", { rows: "4", disabled: locked, text: descriptionValue });
  const notify = h("input", { type: "checkbox", checked: (event?.attendees || []).some((attendee) => !attendee.self) });
  const guestInput = h("input", { type: "email", placeholder: "name@email.com", disabled: locked });
  const guestList = h("div");

  function paintGuests() {
    guestList.replaceChildren(...attendees.map((attendee, index) => h("div", { class: "guest" },
      h("span", { text: `${attendee.displayName || attendee.email} · ${attendee.responseStatus || "needsAction"}` }),
      !locked && !attendee.self ? h("button", { type: "button", class: "btn", text: "Remove", onClick: () => { attendees.splice(index, 1); attendeesTouched = true; paintGuests(); } }) : null,
    )));
  }
  paintGuests();

  const swatchRow = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Event color" });
  function paintSwatches() {
    swatchRow.replaceChildren(h("button", {
      type: "button",
      class: "btn",
      role: "radio",
      "aria-checked": selectedColor ? "false" : "true",
      text: "Default",
      disabled: locked,
      onClick: () => { if (locked) return; colorTouched = true; selectedColor = ""; paintSwatches(); },
    }));
    for (let id = 1; id <= 11; id++) {
      const color = (state.palette?.event?.[id]) || GOOGLE_EVENT_COLORS[id];
      swatchRow.append(h("button", {
        type: "button",
        class: "swatch",
        role: "radio",
        "aria-checked": String(selectedColor) === String(id) ? "true" : "false",
        "aria-label": GOOGLE_EVENT_COLOR_NAMES[id],
        disabled: locked,
        onClick: () => { if (locked) return; colorTouched = true; selectedColor = String(id); paintSwatches(); },
      }, h("i", { style: `background:${cssColor(color.background, "#5484ed")}` })));
    }
  }
  paintSwatches();

  const rsvpRow = h("div", { class: "rsvp" });
  if (event?.selfAttendee) {
    for (const [status, label] of [["accepted", "Yes"], ["tentative", "Maybe"], ["declined", "No"]]) {
      rsvpRow.append(h("button", {
        type: "button",
        class: "btn",
        "data-rsvp": status,
        "aria-pressed": event.selfAttendee.responseStatus === status ? "true" : "false",
        text: label,
        onClick: () => rsvp(event, status, rsvpRow),
      }));
    }
  }

  const offset = resolveOffsetMinutes((event?.calendarId || target?.id), state.offsets);
  const notes = [];
  if (event?.recurringEventId) notes.push("This is one occurrence. Changes apply only to this occurrence.");
  if (offset && event) {
    const adj = offsetAdjustment(event.calendarId, offset, event.calendarSummary);
    notes.push(locked
      ? `${adj.tooltip}. This calendar is read-only, so nothing is written back.`
      : `${adj.tooltip}. The times here are adjusted for display. Saving writes the un-shifted time to Google.`);
  }
  if (event?.calendarId === WYZANT_CALENDAR_ID) {
    notes.push("The Wyzant import feed is read-only. Display times are shifted so lessons match Central time.");
  }
  if (preserveHtml) notes.push("This description came from Google with formatting. Leave it unchanged to keep the original.");

  form.append(
    h("label", { class: "field" }, "Title", title),
    h("label", { class: "check" }, allDayBox, "All day"),
    h("div", { class: "times" },
      h("label", { class: "field" }, "Starts", startDate),
      h("label", { class: "field" }, "Ends", endDate),
    ),
    timeFields,
    h("label", { class: "field" }, "Calendar", calendarSelect),
    h("label", { class: "field" }, "Location", location),
    h("label", { class: "field" }, "Description", description),
    h("div", { class: "field" }, "Color", swatchRow),
    event?.selfAttendee ? h("div", { class: "field" }, "Going?", rsvpRow) : null,
    h("div", { class: "field" }, "Guests", guestList, h("div", { class: "times" }, guestInput, h("button", {
      type: "button",
      class: "btn",
      text: "Add",
      disabled: locked,
      onClick: () => {
        const email = guestInput.value.trim();
        if (!email.includes("@")) { toast("Enter an email address"); return; }
        if (attendees.some((attendee) => attendee.email?.toLowerCase() === email.toLowerCase())) return;
        attendees.push({ email, responseStatus: "needsAction" });
        attendeesTouched = true;
        guestInput.value = "";
        paintGuests();
      },
    }))),
    locked ? null : h("label", { class: "check" }, notify, "Email guests"),
    ...notes.map((text) => h("p", { class: "note", text })),
  );

  const links = h("div", { class: "gate-links" });
  const external = safeUrl(event?.htmlLink);
  const join = safeUrl(event?.hangoutLink);
  if (external) links.append(h("a", { href: external, target: "_blank", rel: "noopener", text: "Open in Google Calendar" }));
  if (join) links.append(h("a", { href: join, target: "_blank", rel: "noopener", text: "Join meeting" }));

  const saveBtn = h("button", { type: "submit", class: "btn primary", text: creating ? "Create" : "Save", disabled: locked });
  const deleteBtn = h("button", { type: "button", class: "btn danger", text: "Delete", hidden: creating || locked });
  let confirmDelete = false;
  deleteBtn.addEventListener("click", () => deleteCurrent());
  form.append(links, h("div", { class: "dialog-actions" },
    deleteBtn,
    h("button", { type: "button", class: "btn", text: "Cancel", onClick: closeModal }),
    saveBtn,
  ));
  form.addEventListener("submit", (e) => { e.preventDefault(); saveCurrent(); });

  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "dialog-title" },
    h("div", { class: "dialog-head" },
      h("h2", { id: "dialog-title", text: creating ? "New event" : (locked ? "Event" : "Edit event") }),
      h("button", { type: "button", class: "icon-btn", "aria-label": "Close", text: "×", onClick: closeModal }),
    ),
    form,
  );
  $("modal-root").replaceChildren(h("div", { class: "modal-back", onClick: (e) => { if (e.target === e.currentTarget) closeModal(); } }, card));
  (locked ? card.querySelector("[aria-label='Close']") : title).focus();

  function readRange() {
    const startParts = startDate.value.split("-").map(Number);
    const endParts = endDate.value.split("-").map(Number);
    if (startParts.length !== 3 || endParts.length !== 3 || startParts.some((n) => !n) || endParts.some((n) => !n)) return null;
    if (allDayBox.checked) {
      const displayStart = zonedToUtc(startParts[0], startParts[1], startParts[2], 0, 0);
      const inclusive = zonedToUtc(endParts[0], endParts[1], endParts[2], 0, 0);
      if (inclusive < displayStart) return { error: "End date is before the start" };
      return { allDay: true, displayStart, displayEnd: addDays(inclusive, 1) };
    }
    const [sh, sm] = startTime.value.split(":").map(Number);
    const [eh, em] = endTime.value.split(":").map(Number);
    if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return { error: "Add a start and end time" };
    const displayStart = zonedToUtc(startParts[0], startParts[1], startParts[2], sh, sm);
    const displayEnd = zonedToUtc(endParts[0], endParts[1], endParts[2], eh, em);
    if (displayEnd <= displayStart) return { error: "End time is before the start" };
    return { allDay: false, displayStart, displayEnd };
  }

  async function saveCurrent() {
    if (locked) return;
    const summary = title.value.trim();
    if (!summary) { title.focus(); toast("Add a title"); return; }
    const range = readRange();
    if (!range || range.error) { toast(range?.error || "Check the date"); return; }
    const calendarId = calendarSelect.value;
    const cal = calendarById(calendarId);
    if (!cal || !calendarWritable(cal)) { toast("That calendar is read-only"); return; }
    const offset = range.allDay ? 0 : resolveOffsetMinutes(cal.id, state.offsets);
    const actualStart = shiftMinutes(range.displayStart, -offset);
    const actualEnd = shiftMinutes(range.displayEnd, -offset);
    const when = range.allDay
      ? { start: { date: dayKey(actualStart) }, end: { date: dayKey(actualEnd) } }
      : {
        start: { dateTime: formatChicagoDateTime(actualStart), timeZone: TIMEZONE },
        end: { dateTime: formatChicagoDateTime(actualEnd), timeZone: TIMEZONE },
      };
    const body = { summary, ...when };
    if (event || location.value) body.location = location.value;
    const nextDescription = description.value;
    if (!(preserveHtml && nextDescription === descriptionValue)) body.description = nextDescription;
    if (attendeesTouched) {
      body.attendees = attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus,
        optional: attendee.optional,
      }));
    }
    // Only an explicit swatch click may send colorId. Drag, RSVP, and ordinary saves omit it.
    if (colorTouched && selectedColor) body.colorId = selectedColor;
    const sendUpdates = notify.checked ? "all" : "none";
    saveBtn.disabled = true;
    try {
      if (!persistRemote()) {
        const raw = {
          ...(event?.raw || {}),
          id: event?.id || `demo-${Date.now()}`,
          iCalUID: event?.iCalUID || `demo-${Date.now()}@axiom`,
          summary,
          location: body.location || "",
          description: body.description ?? event?.description ?? "",
          status: "confirmed",
          ...when,
          attendees: body.attendees || event?.attendees || [],
        };
        if (colorTouched && selectedColor) raw.colorId = selectedColor;
        if (colorTouched && !selectedColor) delete raw.colorId;
        if (event && event.calendarId !== calendarId) removeRaw(event.calendarId, event.id);
        replaceRaw(calendarId, raw);
        toast("Preview only — not saved to Google");
        closeModal();
        return;
      }
      let saved;
      let writeCalendar = event?.calendarId || calendarId;
      let writeId = event?.id;
      if (event && event.calendarId !== calendarId) {
        const moved = await moveEvent(state.token, event.calendarId, event.id, calendarId, sendUpdates);
        removeRaw(event.calendarId, event.id);
        replaceRaw(calendarId, moved);
        writeCalendar = calendarId;
        writeId = moved.id;
      }
      if (event) {
        saved = await patchEvent(state.token, writeCalendar, writeId, body, sendUpdates);
        if (colorTouched && !selectedColor && event.colorId) {
          const cleared = writableBody(saved, true);
          saved = await updateEvent(state.token, writeCalendar, writeId, cleared, sendUpdates);
        }
        replaceRaw(writeCalendar, saved);
        toast("Saved");
      } else {
        saved = await insertEvent(state.token, calendarId, body, sendUpdates);
        replaceRaw(calendarId, saved);
        toast("Event created");
      }
      closeModal();
    } catch (err) {
      saveBtn.disabled = false;
      if (err.status === 401) sessionExpired();
      else toast(err.message || "Couldn't save");
    }
  }

  async function deleteCurrent() {
    if (!confirmDelete) {
      confirmDelete = true;
      deleteBtn.textContent = event.recurringEventId ? "Delete this occurrence?" : "Delete event?";
      return;
    }
    deleteBtn.disabled = true;
    try {
      if (!persistRemote()) {
        removeRaw(event.calendarId, event.id);
        toast("Preview only — not deleted on Google");
        closeModal();
        return;
      }
      await deleteEvent(state.token, event.calendarId, event.id, notify.checked ? "all" : "none");
      removeRaw(event.calendarId, event.id);
      toast("Deleted");
      closeModal();
    } catch (err) {
      deleteBtn.disabled = false;
      if (err.status === 401) sessionExpired();
      else toast(err.message || "Couldn't delete");
    }
  }
}

function writableBody(raw, dropColor) {
  const body = {};
  for (const key of ["summary", "description", "location", "start", "end", "attendees", "reminders", "recurrence", "transparency", "visibility", "guestsCanInviteOthers", "guestsCanModify", "guestsCanSeeOtherGuests", "anyoneCanAddSelf", "status", "extendedProperties", "attachments", "source", "eventType", "conferenceData"]) {
    if (raw[key] !== undefined) body[key] = structuredClone(raw[key]);
  }
  if (!dropColor && raw.colorId) body.colorId = raw.colorId;
  if (raw.recurringEventId) delete body.recurrence;
  return body;
}

async function rsvp(event, responseStatus, row) {
  if (!event.selfAttendee) return;
  const previous = event.raw;
  const attendees = (previous.attendees || []).map((attendee) => (
    attendee.self ? { ...attendee, responseStatus } : attendee
  ));
  const optimistic = { ...previous, attendees };
  replaceRaw(event.calendarId, optimistic);
  if (row) {
    row.querySelectorAll("[data-rsvp]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.rsvp === responseStatus ? "true" : "false");
    });
  }
  if (!persistRemote()) {
    toast(state.demo ? "Preview only — response not sent" : "Sign in to respond");
    return;
  }
  try {
    const updated = await patchEvent(state.token, event.calendarId, event.id, {
      attendees: attendees.map((attendee) => ({
        email: attendee.email,
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus,
        optional: attendee.optional,
      })),
    }, "all");
    replaceRaw(event.calendarId, updated);
    toast(responseStatus === "accepted" ? "Accepted" : responseStatus === "declined" ? "Declined" : "Marked maybe");
  } catch (err) {
    replaceRaw(event.calendarId, previous);
    if (err.status === 401) sessionExpired();
    else toast(err.message || "Couldn't update your response");
  }
}

async function createFromParsed(parsed) {
  if (!parsed.title) {
    openEditor(null, parsed);
    return;
  }
  if (!requireSession()) return;
  const cal = defaultCalendar();
  if (!cal) { toast("No writable calendar is visible"); return; }
  const offset = parsed.allDay ? 0 : resolveOffsetMinutes(cal.id, state.offsets);
  const actualStart = shiftMinutes(parsed.start, -offset);
  const actualEnd = shiftMinutes(parsed.end, -offset);
  const when = parsed.allDay
    ? { start: { date: dayKey(parsed.start) }, end: { date: dayKey(parsed.end) } }
    : {
      start: { dateTime: formatChicagoDateTime(actualStart), timeZone: TIMEZONE },
      end: { dateTime: formatChicagoDateTime(actualEnd), timeZone: TIMEZONE },
    };
  const body = { summary: parsed.title, ...when };
  if (!persistRemote()) {
    replaceRaw(cal.id, { id: `demo-${Date.now()}`, iCalUID: `demo-${Date.now()}@axiom`, status: "confirmed", ...body });
    toast("Preview only — not saved to Google");
    return;
  }
  try {
    const saved = await insertEvent(state.token, cal.id, body, "all");
    replaceRaw(cal.id, saved);
    toast(`Added ${parsed.title}`);
    goTo(parsed.start);
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else toast(err.message || "Couldn't create the event");
  }
}

function onQuickInput() {
  const preview = $("quick-preview");
  const parsed = parseQuickAdd($("quick-input").value, new Date());
  if (!$("quick-input").value.trim() || !parsed) {
    preview.hidden = true;
    preview.replaceChildren();
    return;
  }
  const cal = defaultCalendar();
  preview.hidden = false;
  preview.replaceChildren(
    h("div", { text: describeParsed(parsed) }),
    h("div", { class: "quick-cal", text: cal ? `on ${cal.summary}` : "Sign in to choose a calendar" }),
  );
}

function onQuickSubmit(e) {
  e.preventDefault();
  const parsed = parseQuickAdd($("quick-input").value, new Date());
  if (!parsed) return;
  $("quick-input").value = "";
  onQuickInput();
  if (!parsed.title && parsed.hasExplicitDate && !parsed.hasExplicitTime) {
    goTo(parsed.start);
    return;
  }
  createFromParsed(parsed);
}

function openCommand() {
  closeModal();
  state.overlay = "command";
  state.remoteHits = [];
  let index = 0;
  let items = [];
  const input = h("input", { type: "text", placeholder: "Search events, jump to a date, or create…", "aria-label": "Command" });
  const list = h("div", { class: "cmd-list", role: "listbox" });
  function paint() {
    items = commandItems(input.value);
    if (index >= items.length) index = 0;
    list.replaceChildren(...items.map((item, itemIndex) => h("button", {
      type: "button",
      class: "cmd-item",
      role: "option",
      "aria-selected": itemIndex === index ? "true" : "false",
      onClick: () => runCommand(item),
      onMouseenter: () => { index = itemIndex; paintSelection(); },
    }, h("span", { text: item.title }), item.subtitle ? h("small", { text: item.subtitle }) : null)));
  }
  function paintSelection() {
    [...list.children].forEach((child, childIndex) => child.setAttribute("aria-selected", childIndex === index ? "true" : "false"));
  }
  input.addEventListener("input", () => {
    index = 0;
    paint();
    scheduleRemoteSearch(input.value, paint);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); index = Math.min(index + 1, items.length - 1); paintSelection(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); index = Math.max(index - 1, 0); paintSelection(); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[index]) runCommand(items[index]); }
  });
  const card = h("div", { class: "cmd-card", role: "dialog", "aria-modal": "true", "aria-label": "Commands" }, input, list);
  $("modal-root").replaceChildren(h("div", { class: "modal-back cmd-back", onClick: (e) => { if (e.target === e.currentTarget) closeModal(); } }, card));
  paint();
  input.focus();
}

function runCommand(item) {
  closeModal();
  item.run();
}

function commandItems(query) {
  const q = query.trim();
  const ql = q.toLowerCase();
  const items = [];
  const parsed = q ? parseQuickAdd(q, new Date()) : null;
  const actionNames = ["today", "day", "week", "month", "agenda", "settings", "help", "refresh", "new event", "shortcuts"];
  const looksLikeEvent = Boolean(parsed && (parsed.hasExplicitTime || parsed.hasExplicitDate || parsed.hasExplicitDuration));
  const looksLikeCommand = actionNames.some((name) => name === ql || (ql.length >= 3 && name.startsWith(ql)));
  if (parsed && parsed.title && (looksLikeEvent || (parsed.title.length > 2 && !looksLikeCommand))) {
    items.push({ title: `Create “${parsed.title}”`, subtitle: describeParsed(parsed), run: () => createFromParsed(parsed) });
  }
  if (parsed?.hasExplicitDate) {
    items.push({ title: `Jump to ${formatMediumDate(parsed.start)}`, subtitle: "Date", run: () => goTo(parsed.start) });
  }
  const actions = [
    ["Today", "t", goToday],
    ["Day view", "d", () => setView("day")],
    ["Week view", "w", () => setView("week")],
    ["Month view", "m", () => setView("month")],
    ["Agenda view", "a", () => setView("agenda")],
    ["New event", "c", () => openEditor(null, defaultSeed())],
    ["Settings", "", () => openSettings()],
    ["Keyboard shortcuts", "?", openHelp],
    ["Refresh", "", () => refresh(true)],
  ];
  for (const [title, key, run] of actions) {
    if (!ql || title.toLowerCase().includes(ql)) items.push({ title, subtitle: key ? `Shortcut ${key}` : "Action", run });
  }
  if (ql) {
    for (const cal of state.calendars) {
      const name = cal.summary || cal.id;
      if (!name.toLowerCase().includes(ql)) continue;
      const shown = isShown(cal);
      items.push({ title: `${shown ? "Hide" : "Show"} ${name}`, subtitle: "Calendar", run: () => toggleCalendar(cal.id) });
    }
    const local = state.events.filter((ev) => `${ev.title} ${ev.location} ${htmlToText(ev.description)}`.toLowerCase().includes(ql)).slice(0, 8);
    for (const ev of local) {
      items.push({
        title: ev.title,
        subtitle: `${formatMediumDate(ev.start)} · ${ev.allDay ? "All day" : formatTimeRange(ev.start, ev.end)} · ${ev.calendarSummary}`,
        run: () => { goTo(ev.start, state.view === "month" ? "day" : undefined); openEditor(ev); },
      });
    }
    for (const ev of state.remoteHits) {
      if (local.some((item) => item.key === ev.key)) continue;
      items.push({
        title: ev.title,
        subtitle: `${formatMediumDate(ev.start)} · ${ev.calendarSummary}`,
        run: () => openEditor(ev),
      });
    }
  }
  return items.slice(0, 24);
}

function scheduleRemoteSearch(query, paint) {
  const seq = ++searchSeq;
  const q = query.trim();
  if (!state.token || q.length < 2) { state.remoteHits = []; return; }
  setTimeout(async () => {
    if (seq !== searchSeq) return;
    try {
      const groups = await Promise.all(state.calendars.filter(isShown).slice(0, 12).map(async (cal) => {
        try {
          const raws = await searchEvents(state.token, cal.id, q);
          return raws.map((raw) => normalize(raw, cal)).filter(Boolean);
        } catch {
          return [];
        }
      }));
      if (seq !== searchSeq) return;
      state.remoteHits = groups.flat().slice(0, 8);
      if (state.overlay === "command") paint();
    } catch { /* search is best-effort */ }
  }, 220);
}

function openHelp() {
  closeModal();
  state.overlay = "help";
  const shortcuts = [
    ["t", "Today"],
    ["j or →", "Next day, week, or month"],
    ["k or ←", "Previous"],
    ["d w m a", "Day, week, month, agenda"],
    ["c", "Create event"],
    ["/", "Search and commands"],
    ["⌘K or Ctrl K", "Command bar"],
    ["?", "This help"],
    ["esc", "Close"],
  ];
  const list = h("dl", { class: "help-list" });
  for (const [key, meaning] of shortcuts) list.append(h("dt", {}, h("kbd", { text: key })), h("dd", { text: meaning }));
  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "help-title" },
    h("div", { class: "dialog-head" }, h("h2", { id: "help-title", text: "Shortcuts" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", text: "×", onClick: closeModal })),
    h("p", { text: "On a phone, use the buttons along the top. Swipe sideways to move between days or weeks. Tap an empty slot or an event. Drag and resize are for a mouse." }),
    list,
  );
  $("modal-root").replaceChildren(h("div", { class: "modal-back", onClick: (e) => { if (e.target === e.currentTarget) closeModal(); } }, card));
}

function openSetup() {
  closeModal();
  state.overlay = "setup";
  const origin = "https://axiom-mathematics.github.io";
  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "setup-title" },
    h("div", { class: "dialog-head" }, h("h2", { id: "setup-title", text: "Google sign-in setup" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", text: "×", onClick: closeModal })),
    h("ol", { class: "setup-steps" },
      h("li", {}, "In Google Cloud Console, create a project and enable the Google Calendar API."),
      h("li", {}, "On the OAuth consent screen, add the calendar scope and add stephen.kaminskie@gmail.com as a test user. Testing mode is enough; verification is not required."),
      h("li", {}, "Create an OAuth client ID of type Web application."),
      h("li", {}, "Authorized JavaScript origin, exactly, with no path:", h("div", { class: "mono", text: origin }), h("button", { type: "button", class: "btn", text: "Copy origin", onClick: async () => { try { await navigator.clipboard.writeText(origin); toast("Copied"); } catch { toast(origin); } } })),
      h("li", {}, "Leave Authorized redirect URIs empty. This app uses the Google sign-in popup."),
      h("li", {}, "Paste the client ID (it ends in .apps.googleusercontent.com) into the sign-in field or Settings. It stays in this browser only."),
    ),
    h("p", {}, h("a", { href: "./SETUP.md", text: "Full steps in SETUP.md" })),
  );
  $("modal-root").replaceChildren(h("div", { class: "modal-back", onClick: (e) => { if (e.target === e.currentTarget) closeModal(); } }, card));
}

function openSettings(focusId) {
  closeModal();
  state.overlay = "settings";
  const client = h("input", {
    value: isPlaceholderClientId(storedClientId()) ? "" : storedClientId(),
    placeholder: DEFAULT_CLIENT_ID,
    spellcheck: "false",
    autocomplete: "off",
  });
  const rows = state.calendars.map((cal) => {
    const minutes = resolveOffsetMinutes(cal.id, state.offsets);
    const input = h("input", {
      class: "inline-input",
      type: "number",
      step: "0.5",
      min: "-12",
      max: "12",
      value: String(minutes / 60),
      "aria-label": `Display offset in hours for ${cal.summary || cal.id}`,
    });
    input.addEventListener("change", () => {
      const hours = Number(input.value);
      if (!Number.isFinite(hours)) return;
      state.offsets[cal.id] = Math.max(-12 * 60, Math.min(12 * 60, Math.round(hours * 2) / 2 * 60));
      persistOffsets();
      recomputeEvents();
      render();
      toast(state.offsets[cal.id] === 0 ? `${cal.summary} uses Google's times` : "Display offset saved");
    });
    const controls = [
      h("span", { class: "cal-dot", style: `background:${cssColor(cal.backgroundColor, "#5484ed")}` }),
      h("div", {},
        h("strong", { text: cal.summary || cal.id }),
        cal.id === WYZANT_CALENDAR_ID ? h("p", { class: "note", text: "This imported feed shows lesson times about 2 hours later than Wyzant. The default display shift is −2 hours. The feed is read-only, so nothing is written back to Google." }) : null,
        h("label", { class: "field" }, "Display offset (hours). 0 turns the adjustment off.", input),
      ),
    ];
    const buttons = h("div", { class: "side-actions" },
      h("button", { type: "button", class: "btn", text: "No adjustment", onClick: () => { state.offsets[cal.id] = 0; input.value = "0"; persistOffsets(); recomputeEvents(); render(); toast("Adjustment off"); } }),
    );
    if (cal.id === WYZANT_CALENDAR_ID) {
      buttons.append(h("button", { type: "button", class: "btn", text: "Use −2h default", onClick: () => { delete state.offsets[cal.id]; input.value = "-2"; persistOffsets(); recomputeEvents(); render(); toast("Wyzant default restored"); } }));
    }
    const row = h("div", { class: "stack", id: `offset-${cssId(cal.id)}`, style: "padding:10px 0;border-top:1px solid var(--line)" }, ...controls, buttons);
    return row;
  });
  const card = h("div", { class: "modal-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "settings-title" },
    h("div", { class: "dialog-head" }, h("h2", { id: "settings-title", text: "Settings" }), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", text: "×", onClick: closeModal })),
    h("p", { class: "note", text: "Times are shown in America/Chicago. Offsets change only what you see. Event and calendar colors stay as Google sent them." }),
    h("label", { class: "field" }, "Google OAuth client ID", client),
    h("button", {
      type: "button",
      class: "btn primary",
      text: "Save client ID",
      onClick: () => {
        const value = client.value.trim();
        if (isPlaceholderClientId(value)) { toast("Paste the client ID from Google Cloud"); return; }
        localStorage.setItem(STORAGE_CLIENT_ID, value);
        toast("Client ID saved in this browser");
      },
    }),
    h("button", { type: "button", class: "btn", text: "Setup steps", onClick: openSetup }),
    ...rows,
    (state.token || state.demo) ? h("button", { type: "button", class: "btn", text: "Sign out", onClick: signOut }) : null,
  );
  $("modal-root").replaceChildren(h("div", { class: "modal-back", onClick: (e) => { if (e.target === e.currentTarget) closeModal(); } }, card));
  if (focusId) document.getElementById(`offset-${cssId(focusId)}`)?.scrollIntoView({ block: "center" });
}

function cssId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Couldn't load Google sign-in"));
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

async function signIn() {
  const typed = $("client-id")?.value.trim();
  const fromSettings = document.querySelector("#modal-root input")?.value.trim();
  const candidate = typed || (state.overlay === "settings" ? fromSettings : "") || storedClientId();
  if (candidate && !isPlaceholderClientId(candidate)) localStorage.setItem(STORAGE_CLIENT_ID, candidate);
  const clientId = storedClientId();
  if (isPlaceholderClientId(clientId)) {
    toast("Add your Google OAuth client ID first");
    openSetup();
    return;
  }
  try {
    await loadGis();
    if (!tokenClient || tokenClientId !== clientId) {
      tokenClientId = clientId;
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: CALENDAR_SCOPE,
        callback: onToken,
        error_callback: (err) => toast(err.message || "Sign-in cancelled"),
      });
    }
    tokenClient.requestAccessToken({ prompt: "select_account" });
  } catch (err) {
    toast(err.message || "Google sign-in didn't start");
  }
}

function onToken(resp) {
  if (resp.error) { toast(resp.error_description || resp.error); return; }
  state.token = resp.access_token;
  state.expires = Date.now() + Math.max(60, (resp.expires_in || 3600) - 90) * 1000;
  sessionStorage.setItem(TOKEN_SESSION_KEY, JSON.stringify({ token: state.token, exp: state.expires }));
  state.demo = false;
  state.buckets.clear();
  bootData();
}

function signOut() {
  const token = state.token;
  state.token = "";
  state.demo = false;
  state.calendars = [];
  state.buckets = new Map();
  state.events = [];
  state.account = "";
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  if (token && window.google?.accounts?.oauth2?.revoke) window.google.accounts.oauth2.revoke(token, () => {});
  closeModal();
  render();
}

function sessionExpired() {
  state.token = "";
  sessionStorage.removeItem(TOKEN_SESSION_KEY);
  closeModal();
  render();
  toast("Session expired. Sign in again.");
}

async function bootData() {
  if (!state.token) return;
  setLoading(true);
  try {
    const [calendars, colors] = await Promise.all([
      listCalendarList(state.token),
      getColors(state.token).catch(() => null),
    ]);
    state.calendars = calendars;
    if (colors?.event) state.palette = colors;
    state.account = calendars.find((cal) => cal.primary)?.id || calendars[0]?.id || "";
    state.demo = false;
    await ensureEvents();
    state.fetchedAt = Date.now();
  } catch (err) {
    if (err.status === 401) sessionExpired();
    else toast(err.message || "Couldn't load calendars");
  } finally {
    setLoading(false);
    render();
  }
}

async function ensureEvents() {
  if (!state.token || state.demo) return;
  const windowRange = fetchWindow(state.anchor, state.view);
  const needed = state.calendars.filter(isShown).filter((cal) => {
    const bucket = state.buckets.get(cal.id);
    return !bucket || bucket.start > windowRange.start.getTime() || bucket.end < windowRange.end.getTime();
  });
  if (!needed.length) return;
  setLoading(true);
  const results = await Promise.allSettled(needed.map(async (cal) => {
    const events = await listEvents(state.token, cal.id, windowRange.start, windowRange.end);
    state.buckets.set(cal.id, { start: windowRange.start.getTime(), end: windowRange.end.getTime(), events });
  }));
  state.fetchedAt = Date.now();
  setLoading(false);
  recomputeEvents();
  render();
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") continue;
    if (result.reason?.status === 401) { sessionExpired(); return; }
    toast(`${needed[i].summary || "Calendar"}: ${result.reason.message || "Couldn't load events"}`);
  }
}

async function refresh(force) {
  if (!persistRemote()) {
    if (state.demo) { loadDemo(); render(); toast("Sample events reloaded"); }
    else toast("Sign in to refresh");
    return;
  }
  if (force) state.buckets.clear();
  await bootData();
}

function loadDemo() {
  const primary = {
    id: "stephen.kaminskie@gmail.com",
    summary: "Stephen Kaminskie",
    primary: true,
    backgroundColor: "#16a765",
    foregroundColor: "#000000",
    accessRole: "owner",
    selected: true,
  };
  const wyzant = {
    id: WYZANT_CALENDAR_ID,
    summary: "Wyzant",
    backgroundColor: "#fad165",
    foregroundColor: "#000000",
    accessRole: "reader",
    selected: true,
  };
  const classroom = {
    id: "algebra.class@group.calendar.google.com",
    summary: "Algebra — Classroom",
    backgroundColor: "#4986e7",
    foregroundColor: "#000000",
    accessRole: "reader",
    selected: true,
  };
  state.demo = true;
  state.token = "";
  state.calendars = [primary, wyzant, classroom];
  state.account = primary.id;
  const events = [
    [primary.id, [
      rawTimed("maya", 0, 16, 0, 60, "Algebra w/ Maya", "Library table 2"),
      rawTimed("office", 0, 16, 30, 60, "Office hours"),
      rawTimed("noah", -1, 15, 0, 60, "Chemistry w/ Noah"),
      rawTimed("lunch", 1, 12, 0, 60, "Lunch"),
      rawTimed("invite", 1, 15, 0, 45, "College counseling — Alex", "", {
        attendees: [
          { email: "alex@example.com", displayName: "Alex", responseStatus: "accepted" },
          { email: primary.id, displayName: "Stephen Kaminskie", self: true, responseStatus: "needsAction" },
        ],
      }),
      rawTimed("staff", 2, 11, 0, 60, "Staff meeting", "Room 210", { colorId: "9" }),
      rawAllDay("plan", 3, "Lesson planning block"),
    ]],
    [wyzant.id, [
      rawTimed("luis", 0, 19, 0, 60, "Geometry with Luis"),
      rawTimed("priya", 2, 18, 30, 90, "SAT prep — Priya"),
    ]],
    [classroom.id, [rawAllDay("quiz", 1, "Quiz 4 review")]],
  ];
  state.buckets = new Map(events.map(([id, list]) => [id, { start: -1e15, end: 1e15, events: list }]));
  recomputeEvents();
}

function rawTimed(id, dayOffset, hour, minute, durationMin, summary, location = "", extra = {}) {
  const day = addDays(startOfDay(new Date()), dayOffset);
  const parts = zonedParts(day);
  const start = zonedToUtc(parts.year, parts.month, parts.day, hour, minute);
  const end = new Date(start.getTime() + durationMin * 60000);
  return {
    id: `demo-${id}`,
    iCalUID: `demo-${id}@axiom`,
    summary,
    location,
    status: "confirmed",
    start: { dateTime: formatChicagoDateTime(start), timeZone: TIMEZONE },
    end: { dateTime: formatChicagoDateTime(end), timeZone: TIMEZONE },
    ...extra,
  };
}

function rawAllDay(id, dayOffset, summary) {
  const start = addDays(startOfDay(new Date()), dayOffset);
  return {
    id: `demo-${id}`,
    iCalUID: `demo-${id}@axiom`,
    summary,
    status: "confirmed",
    start: { date: dayKey(start) },
    end: { date: dayKey(addDays(start, 1)) },
  };
}

function snapMin(mins) {
  return Math.round(mins / 15) * 15;
}

function minutesInCol(e, col) {
  const rect = col.getBoundingClientRect();
  const y = Math.min(Math.max(e.clientY - rect.top, 0), rect.height);
  return (y / Math.max(rect.height, 1)) * 1440;
}

function colFromPoint(e, selector) {
  const cols = [...document.querySelectorAll(selector)];
  return cols.find((col) => {
    const rect = col.getBoundingClientRect();
    return e.clientX >= rect.left && e.clientX <= rect.right;
  }) || null;
}

function clearGhosts() {
  document.querySelectorAll(".ghost").forEach((node) => node.remove());
  document.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
  document.querySelectorAll(".event.dragging").forEach((node) => node.classList.remove("dragging"));
}

function placeGhost(col, startMin, endMin, color, title) {
  document.querySelectorAll(".ghost").forEach((node) => { if (node.parentElement !== col) node.remove(); });
  let ghost = col.querySelector(":scope > .ghost");
  if (!ghost) {
    ghost = h("div", { class: "ghost" });
    col.append(ghost);
  }
  ghost.style.top = `${(startMin / 1440) * 100}%`;
  ghost.style.height = `${((Math.max(endMin, startMin + 15) - startMin) / 1440) * 100}%`;
  if (color) {
    ghost.style.background = cssColor(color.background, "#16a765");
    ghost.style.color = cssColor(color.foreground, "#1d1d1d");
    ghost.style.border = "0";
  }
  ghost.textContent = title || "";
}

function onPointerDown(e) {
  if (e.pointerType !== "mouse" || e.button !== 0 || state.overlay) return;
  const col = e.target.closest(".day-col, .allday-col");
  if (!col || !$("view").contains(col)) return;
  const eventEl = e.target.closest(".event");
  if (eventEl?.dataset.readonly === "1") return;
  if (!canEditLocally()) return;
  if (eventEl && !findEvent(eventEl.dataset.key)) return;
  if (eventEl && findEvent(eventEl.dataset.key).readOnly) return;
  suppressClick = true;
  drag.active = true;
  drag.pointerId = e.pointerId;
  drag.moved = false;
  drag.originCol = col;
  drag.key = eventEl?.dataset.key || "";
  const ev = drag.key ? findEvent(drag.key) : null;
  if (eventEl && ev?.allDay) drag.type = "allday";
  else if (eventEl && e.target.closest(".resize-handle")) drag.type = "resize";
  else if (eventEl) drag.type = "move";
  else if (col.classList.contains("allday-col")) drag.type = "create-allday";
  else drag.type = "create";
  if (ev) {
    drag.displayStart = ev.start;
    drag.displayEnd = ev.end;
    drag.durationMs = ev.end.getTime() - ev.start.getTime();
    drag.span = Math.max(1, calendarDayNumber(ev.end) - calendarDayNumber(ev.start));
    drag.color = ev.color;
    drag.title = ev.title;
    const pointerMin = col.classList.contains("day-col") ? minutesInCol(e, col) : 0;
    const eventStartMin = !ev.allDay && dayKey(ev.start) === col.dataset.day ? minutesSinceMidnight(ev.start) : 0;
    drag.grabMin = pointerMin - eventStartMin;
  } else if (drag.type === "create") {
    drag.anchorMin = snapMin(minutesInCol(e, col));
    drag.draftDay = col.dataset.day;
  }
  drag.startX = e.clientX;
  drag.startY = e.clientY;
  e.preventDefault();
  $("view").setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!drag.active || e.pointerId !== drag.pointerId) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
  drag.moved = true;
  if (drag.key) {
    document.querySelectorAll(".event").forEach((node) => {
      if (node.dataset.key === drag.key) node.classList.add("dragging");
    });
  }
  if (drag.type === "allday" || drag.type === "create-allday") {
    document.querySelectorAll(".drop-target").forEach((node) => node.classList.remove("drop-target"));
    const col = colFromPoint(e, ".allday-col");
    col?.classList.add("drop-target");
    if (col) drag.draftDay = col.dataset.day;
    return;
  }
  const col = colFromPoint(e, ".day-col") || drag.originCol;
  if (drag.type === "create") {
    const mins = snapMin(minutesInCol(e, col));
    const startMin = Math.max(0, Math.min(drag.anchorMin, mins));
    const endMin = Math.min(1440, Math.max(drag.anchorMin, mins, startMin + 15));
    drag.draftDay = col.dataset.day;
    drag.draftStartMin = Math.min(startMin, endMin - 15);
    drag.draftEndMin = Math.max(endMin, drag.draftStartMin + 15);
    placeGhost(col, drag.draftStartMin, drag.draftEndMin, null, "");
    return;
  }
  if (drag.type === "resize") {
    const originStart = dayKey(drag.displayStart) === drag.originCol.dataset.day ? minutesSinceMidnight(drag.displayStart) : 0;
    const endMin = Math.max(originStart + 15, Math.min(1440, snapMin(minutesInCol(e, drag.originCol))));
    drag.draftDay = drag.originCol.dataset.day;
    drag.draftStartMin = originStart;
    drag.draftEndMin = endMin;
    placeGhost(drag.originCol, originStart, endMin, drag.color, drag.title);
    return;
  }
  let startMin = snapMin(minutesInCol(e, col) - drag.grabMin);
  startMin = Math.max(0, Math.min(startMin, 1440 - 15));
  const durationMin = Math.max(15, drag.durationMs / 60000);
  drag.draftDay = col.dataset.day;
  drag.draftStartMin = startMin;
  drag.draftEndMin = startMin + durationMin;
  placeGhost(col, startMin, startMin + durationMin, drag.color, drag.title);
}

function onPointerUp(e) {
  if (!drag.active || (e.pointerId != null && drag.pointerId !== e.pointerId)) return;
  const snapshot = { ...drag };
  drag.active = false;
  clearGhosts();
  if (!snapshot.moved) {
    if (snapshot.key) openEditor(findEvent(snapshot.key));
    else if (snapshot.type === "create-allday") {
      const day = parseDayKey(snapshot.originCol.dataset.day);
      openEditor(null, { start: day, end: addDays(day, 1), allDay: true, summary: "" });
    } else if (snapshot.originCol?.classList.contains("day-col")) {
      const day = parseDayKey(snapshot.originCol.dataset.day);
      const mins = Math.max(0, Math.min(snapMin(minutesInCol(e, snapshot.originCol)), 23 * 60));
      const start = shiftMinutes(day, mins);
      openEditor(null, { start, end: new Date(start.getTime() + 60 * 60000), allDay: false, summary: "" });
    }
    return;
  }
  if (snapshot.type === "create") {
    const day = parseDayKey(snapshot.draftDay || snapshot.originCol.dataset.day);
    const start = shiftMinutes(day, snapshot.draftStartMin);
    const end = shiftMinutes(day, Math.min(1440, snapshot.draftEndMin));
    openEditor(null, { start, end: end > start ? end : new Date(start.getTime() + 60 * 60000), allDay: false, summary: "" });
    return;
  }
  if (snapshot.type === "create-allday" && snapshot.draftDay) {
    const day = parseDayKey(snapshot.draftDay);
    openEditor(null, { start: day, end: addDays(day, 1), allDay: true, summary: "" });
    return;
  }
  const ev = findEvent(snapshot.key);
  if (!ev || ev.readOnly) return;
  if (snapshot.type === "allday" && snapshot.draftDay) {
    const newStart = parseDayKey(snapshot.draftDay);
    const newEnd = addDays(newStart, snapshot.span);
    commitTimes(ev, newStart, newEnd, true);
    return;
  }
  if (snapshot.type === "resize") {
    const day = parseDayKey(snapshot.originCol.dataset.day);
    const newEnd = snapshot.draftEndMin >= 1440 ? addDays(day, 1) : shiftMinutes(day, snapshot.draftEndMin);
    commitTimes(ev, ev.start, newEnd, false);
    return;
  }
  if (snapshot.type === "move" && snapshot.draftDay) {
    const day = parseDayKey(snapshot.draftDay);
    const newStart = shiftMinutes(day, snapshot.draftStartMin);
    const newEnd = new Date(newStart.getTime() + snapshot.durationMs);
    commitTimes(ev, newStart, newEnd, false);
  }
}

async function commitTimes(ev, displayStart, displayEnd, allDay) {
  const offset = allDay ? 0 : (ev.offsetMinutes || 0);
  const actualStart = shiftMinutes(displayStart, -offset);
  const actualEnd = shiftMinutes(displayEnd, -offset);
  const when = allDay
    ? { start: { date: dayKey(actualStart) }, end: { date: dayKey(actualEnd) } }
    : {
      start: { dateTime: formatChicagoDateTime(actualStart), timeZone: TIMEZONE },
      end: { dateTime: formatChicagoDateTime(actualEnd), timeZone: TIMEZONE },
    };
  const previous = ev.raw;
  replaceRaw(ev.calendarId, { ...previous, ...when });
  if (!persistRemote()) {
    toast("Preview only — not saved to Google");
    return;
  }
  try {
    const updated = await patchEvent(state.token, ev.calendarId, ev.id, when, "none");
    replaceRaw(ev.calendarId, updated);
    toast(allDay ? "Moved" : "Updated");
  } catch (err) {
    replaceRaw(ev.calendarId, previous);
    if (err.status === 401) sessionExpired();
    else toast(err.message || "Couldn't update the event");
  }
}

let touchStart = null;
function onTouchStart(e) {
  if (e.touches.length !== 1) return;
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onTouchEnd(e) {
  if (!touchStart) return;
  const touch = e.changedTouches[0];
  const dx = touch.clientX - touchStart.x;
  const dy = touch.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) shift(dx < 0 ? 1 : -1);
}

function onKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (state.overlay === "command") closeModal();
    else openCommand();
    return;
  }
  if (meta || e.altKey) return;
  if (e.key === "Escape") {
    if (state.overlay) closeModal();
    else setSidebar(false);
    return;
  }
  if (state.overlay) return;
  const tag = e.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
  if (e.key === "t") goToday();
  else if (e.key === "j" || e.key === "ArrowRight") { e.preventDefault(); shift(1); }
  else if (e.key === "k" || e.key === "ArrowLeft") { e.preventDefault(); shift(-1); }
  else if (e.key === "d") setView("day");
  else if (e.key === "w") setView("week");
  else if (e.key === "m") setView("month");
  else if (e.key === "a") setView("agenda");
  else if (e.key === "c") openEditor(null, defaultSeed());
  else if (e.key === "/") { e.preventDefault(); openCommand(); }
  else if (e.key === "?") openHelp();
}

function onViewClick(e) {
  if (suppressClick) { suppressClick = false; return; }
  const eventEl = e.target.closest(".event");
  if (eventEl?.dataset.key) { openEditor(findEvent(eventEl.dataset.key)); return; }
  const allDay = e.target.closest(".allday-col");
  if (allDay && e.target === allDay) {
    const day = parseDayKey(allDay.dataset.day);
    openEditor(null, { start: day, end: addDays(day, 1), allDay: true, summary: "" });
    return;
  }
  const col = e.target.closest(".day-col");
  if (col && (e.target === col || e.target.classList.contains("day-col"))) {
    if (!requireSession()) return;
    const day = parseDayKey(col.dataset.day);
    const mins = Math.max(0, Math.min(snapMin(minutesInCol(e, col)), 23 * 60));
    const start = shiftMinutes(day, mins);
    openEditor(null, { start, end: new Date(start.getTime() + 60 * 60000), allDay: false, summary: "" });
  }
}

function bind() {
  $("prev-btn").addEventListener("click", () => shift(-1));
  $("next-btn").addEventListener("click", () => shift(1));
  $("today-btn").addEventListener("click", goToday);
  $("menu-btn").addEventListener("click", () => setSidebar(!$("sidebar").classList.contains("open")));
  $("scrim").addEventListener("click", () => setSidebar(false));
  $("mini-prev").addEventListener("click", () => goTo(addMonths(state.anchor, -1)));
  $("mini-next").addEventListener("click", () => goTo(addMonths(state.anchor, 1)));
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
  }
  $("quick-form").addEventListener("submit", onQuickSubmit);
  $("quick-input").addEventListener("input", onQuickInput);
  $("cmd-btn").addEventListener("click", openCommand);
  $("create-btn").addEventListener("click", () => openEditor(null, defaultSeed()));
  $("settings-btn").addEventListener("click", () => openSettings());
  $("help-btn").addEventListener("click", openHelp);
  $("refresh-btn").addEventListener("click", () => refresh(true));
  $("signout-btn").addEventListener("click", signOut);
  $("gate-form").addEventListener("submit", (e) => { e.preventDefault(); signIn(); });
  $("preview-btn").addEventListener("click", () => { loadDemo(); render(); });
  $("setup-btn").addEventListener("click", openSetup);
  $("banner-signin").addEventListener("click", () => {
    if (isPlaceholderClientId(storedClientId())) {
      state.demo = false;
      render();
      openSetup();
      return;
    }
    signIn();
  });
  const view = $("view");
  view.addEventListener("click", onViewClick);
  view.addEventListener("pointerdown", onPointerDown);
  view.addEventListener("pointermove", onPointerMove);
  view.addEventListener("pointerup", onPointerUp);
  view.addEventListener("pointercancel", onPointerUp);
  view.addEventListener("touchstart", onTouchStart, { passive: true });
  view.addEventListener("touchend", onTouchEnd, { passive: true });
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.token && Date.now() - state.fetchedAt > 60000) refresh(true);
  });
}

function init() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  $("cmd-kbd").textContent = mac ? "⌘K" : "Ctrl K";
  const savedView = localStorage.getItem(STORAGE_VIEW);
  if (VIEWS.includes(savedView)) state.view = savedView;
  state.hidden = loadJSON(STORAGE_HIDDEN, {});
  state.offsets = loadJSON(STORAGE_OFFSETS, {});
  try {
    const saved = JSON.parse(sessionStorage.getItem(TOKEN_SESSION_KEY) || "null");
    if (saved?.token && saved.exp > Date.now()) {
      state.token = saved.token;
      state.expires = saved.exp;
    }
  } catch { /* ignore */ }
  bind();
  render();
  if (state.token) bootData();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  setInterval(() => {
    positionNowLines();
    const key = dayKey(new Date());
    if (key !== sawDay) { sawDay = key; render(); }
  }, 30000);
}

init();
