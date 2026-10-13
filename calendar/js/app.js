import {
  AUTHORIZED_JS_ORIGIN,
  HOME_TZ,
  LS,
  PLACEHOLDER_CLIENT_ID,
  SCOPES,
} from "../config.js";
import { createApi } from "./api.js";
import { EVENT_PALETTE, hsvToRgb, mergePalette, rgbToHex, rgbToHsv } from "./colors.js";
import { buildDemo } from "./demo.js";
import {
  buildInsertBody,
  buildPatchBody,
  buildRsvpPatch,
  buildTimePatch,
  clockOntoMaster,
  conferenceQuery,
} from "./eventbody.js";
import { buildRecurrence, capRruleUntil, parseQuickAdd, parseRecurrence } from "./parse.js";
import { calendarLocked, offsetHours } from "./policy.js";
import { axiomRoomLinkOf, newRoomCode, normalizeTurn, placeRoom, roomUrlForCode, stripRoomText } from "./roomlink.js";
import {
  loadClientId,
  loadLocalSettings,
  mergeSettings,
  pullDriveSettings,
  pushDriveSettings,
  saveClientId,
  saveLocalSettings,
  clientIdConfigured,
  withOffsetDefaults,
} from "./store.js";
import {
  addDays,
  formatFullDate,
  formatRange,
  formatTime,
  fromYmd,
  minutesSinceMidnight,
  parts,
  rangeLabel,
  shiftAnchor,
  todayYmd,
  untilStamp,
  viewDays,
  weekdayIndex,
  ymdFromDate,
  ymdStr,
  zoneAbbrev,
  zonedDate,
  zonedTimeToUtc,
  listTimeZones,
  dowCode,
} from "./time.js";
import { applyUpdates, clocksForEvent, emptyPeopleIndex, indexPeople, inferUpdates } from "./zones.js";
import { copyText, dialInText, esc, eventKey, isTypingTarget, meetLinkOf, safeHttpUrl, uid } from "./util.js";
import {
  HOUR_PX,
  activeEvents,
  boundsOf,
  calListHtml,
  calOf,
  editorHtml,
  guestListHtml,
  helpHtml,
  mainHtml,
  miniHtml,
  nearestCaption,
  popoverHtml,
  readoutHtml,
  reminderEditorHtml,
  settingsHtml,
  zoneCtx,
} from "./view.js";

const state = {
  mode: "gate",
  demo: false,
  token: "",
  tokenExpires: 0,
  clientId: "",
  me: "",
  calendars: [],
  events: [],
  covered: new Map(),
  settings: withOffsetDefaults(loadLocalSettings()),
  peopleIndex: emptyPeopleIndex(),
  palette: EVENT_PALETTE,
  view: "week",
  anchor: todayYmd(),
  mini: null,
  now: new Date(),
  loading: false,
  popover: null,
  search: "",
  draft: null,
  layer: null,
  drag: null,
  driveFileId: null,
  driveNote: "",
  api: null,
  forceScroll: true,
};

let tokenWait = null;
let tokenClient = null;
let driveTimer = 0;
let toastTimer = 0;
let lastPointer = "mouse";
let suppressClick = false;

const $ = (id) => document.getElementById(id);

function boot() {
  state.clientId = loadClientId();
  state.settings = withOffsetDefaults(loadLocalSettings());
  const savedView = localStorage.getItem(LS.view);
  state.view = ["day", "week", "month", "agenda"].includes(savedView)
    ? savedView
    : (window.innerWidth < 860 ? "day" : "week");
  const savedAnchor = localStorage.getItem(LS.anchor);
  state.anchor = savedAnchor && /^\d{4}-\d{2}-\d{2}$/.test(savedAnchor) ? fromYmd(savedAnchor) : todayYmd();
  state.mini = { y: state.anchor.y, m: state.anchor.m };
  const gateInput = $("gate-client");
  if (gateInput) gateInput.value = state.clientId && state.clientId !== PLACEHOLDER_CLIENT_ID ? state.clientId : "";
  bind();
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  if (new URLSearchParams(location.search).get("demo") === "1") {
    enterDemo();
    return;
  }
  showGate();
  setInterval(tick, 30000);
}

function showGate() {
  state.mode = "gate";
  $("gate").hidden = false;
  $("shell").hidden = true;
}

function showShell() {
  $("gate").hidden = true;
  $("shell").hidden = false;
  state.forceScroll = true;
  render();
}

function bind() {
  $("gate-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("gate-client").value.trim();
    state.clientId = id;
    saveClientId(id);
    signIn();
  });
  $("preview-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    history.replaceState(null, "", "?demo=1");
    enterDemo();
  });
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("pointerdown", onPointerDown, true);
  document.body.addEventListener("pointermove", onPointerMove);
  document.body.addEventListener("pointerup", onPointerUp);
  document.addEventListener("keydown", onKey);
  $("quick-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const shift = e.submitter?.dataset?.edit === "1";
    const text = $("quick-input").value;
    if (shift) openQuickEditor(text);
    else quickAdd(text);
  });
  $("quick-input")?.addEventListener("input", () => {
    const parsed = parseQuickAdd($("quick-input").value, state.now, HOME_TZ);
    const el = $("quick-preview");
    if (!el) return;
    el.textContent = parsed
      ? `${parsed.allDay ? "All day" : formatRange(parsed.start, parsed.end)} · ${parsed.title}${parsed.addMeet ? " · Meet" : ""}`
      : "";
  });
  $("quick-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      openQuickEditor($("quick-input").value);
    }
  });
  $("search-input")?.addEventListener("input", () => {
    state.search = $("search-input").value;
    renderMain();
  });
  $("nav-toggle")?.addEventListener("click", toggleSidebar);
  $("scrim")?.addEventListener("click", closeSidebar);
}

function enterDemo() {
  const demo = buildDemo(state.now);
  state.demo = true;
  state.mode = "app";
  state.me = demo.me;
  state.calendars = demo.calendars;
  state.peopleIndex = indexPeople(demo.people);
  state.events = demo.events.map((e) => ({ ...e, calendarId: e.calendarId }));
  learn();
  showShell();
  toast("Previewing sample events. Nothing here is written to Google.");
}

async function signIn() {
  const id = ($("gate-client")?.value || state.clientId || "").trim();
  state.clientId = id;
  saveClientId(id);
  if (!clientIdConfigured(id)) {
    toast("Paste the OAuth client ID from Google Cloud first.");
    $("gate-error").hidden = false;
    $("gate-error").textContent = `The client ID looks empty or still the placeholder. Create a Web client and add ${AUTHORIZED_JS_ORIGIN} as an authorized JavaScript origin.`;
    return;
  }
  try {
    await waitForGis();
    ensureTokenClient();
    await requestToken("select_account");
    localStorage.setItem(LS.signedIn, "1");
    await enterApp();
  } catch (err) {
    if (err?.message && !/popup_closed|user_cancel/i.test(err.message)) {
      $("gate-error").hidden = false;
      $("gate-error").textContent = err.message;
    }
  }
}

function waitForGis() {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tickGis = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else if (++n > 50) reject(new Error("Google sign-in didn’t load. Check the connection and reload."));
      else setTimeout(tickGis, 100);
    };
    tickGis();
  });
}

function ensureTokenClient() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: state.clientId,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        tokenWait?.reject(new Error(resp.error_description || resp.error));
        tokenWait = null;
        return;
      }
      state.token = resp.access_token;
      state.tokenExpires = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      tokenWait?.resolve(state.token);
      tokenWait = null;
    },
    error_callback: (err) => {
      tokenWait?.reject(new Error(err?.message || err?.type || "Sign-in failed"));
      tokenWait = null;
    },
  });
}

function requestToken(prompt) {
  ensureTokenClient();
  return new Promise((resolve, reject) => {
    tokenWait = { resolve, reject };
    tokenClient.requestAccessToken({ prompt });
  });
}

async function getToken() {
  if (state.token && Date.now() < state.tokenExpires - 60000) return state.token;
  try {
    await requestToken("");
  } catch {
    $("banner").hidden = false;
    $("banner").innerHTML = `Session paused. <button type="button" id="reauth">Continue</button>`;
    $("reauth").onclick = () => requestToken("select_account").then(() => { $("banner").hidden = true; refresh(); });
    throw new Error("Sign-in needed");
  }
  return state.token;
}

async function enterApp() {
  state.demo = false;
  state.mode = "app";
  state.api = createApi(getToken);
  showShell();
  await reloadCalendars();
  await fetchEvents(true);
  learn();
  render();
  loadPeople();
  syncDrive();
}

async function reloadCalendars() {
  state.loading = true;
  paintProgress();
  try {
    const [cals, colors] = await Promise.all([
      state.api.listCalendars(),
      state.api.listColors().catch(() => null),
    ]);
    state.palette = mergePalette(colors);
    state.calendars = cals.slice().sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return (a.summary || "").localeCompare(b.summary || "");
    });
    const primary = state.calendars.find((c) => c.primary);
    state.me = primary?.id?.includes("@") ? primary.id : state.me;
    state.settings = withOffsetDefaults(state.settings);
  } finally {
    state.loading = false;
    paintProgress();
  }
}

function windowFor(anchor = state.anchor, view = state.view) {
  let start = addDays(anchor, -14);
  let end = addDays(anchor, 45);
  if (view === "month") {
    start = addDays({ y: anchor.y, m: anchor.m, d: 1 }, -7);
    end = addDays({ y: anchor.y, m: anchor.m, d: 1 }, 45);
  }
  if (view === "agenda") {
    start = addDays(anchor, -3);
    end = addDays(anchor, 60);
  }
  return { start, end, timeMin: zonedDate(start, 0).toISOString(), timeMax: zonedDate(end, 0).toISOString() };
}

async function fetchEvents(force = false) {
  if (state.demo) return;
  const win = windowFor();
  const selected = state.calendars.filter((c) => c.selected !== false);
  const todo = selected.filter((c) => {
    if (force) return true;
    const cov = state.covered.get(c.id);
    if (!cov) return true;
    const s = zonedDate(win.start, 0).getTime();
    const e = zonedDate(win.end, 0).getTime();
    return s < cov.start || e > cov.end;
  });
  if (!todo.length) return;
  state.loading = true;
  paintProgress();
  await Promise.all(todo.map(async (cal) => {
    try {
      const items = await state.api.listEvents(cal.id, { timeMin: win.timeMin, timeMax: win.timeMax });
      const fresh = items.map((item) => ({ ...item, calendarId: cal.id }));
      const cov = state.covered.get(cal.id);
      const startMs = zonedDate(win.start, 0).getTime();
      const endMs = zonedDate(win.end, 0).getTime();
      const overlaps = cov && startMs <= cov.end + 86400000 && endMs >= cov.start - 86400000;
      const prev = state.events.filter((e) => e.calendarId !== cal.id);
      const kept = state.events.filter((e) => e.calendarId === cal.id && !eventInWindow(e, startMs, endMs));
      state.events = prev.concat(mergeById(kept, fresh));
      state.covered.set(cal.id, overlaps && cov
        ? { start: Math.min(cov.start, startMs), end: Math.max(cov.end, endMs) }
        : { start: startMs, end: endMs });
    } catch (err) {
      toast(`${cal.summary || "Calendar"}: ${err.message}`);
    }
  }));
  state.loading = false;
  paintProgress();
  learn();
}

function mergeById(prev, fresh) {
  const map = new Map(prev.map((e) => [e.id, e]));
  for (const e of fresh) map.set(e.id, e);
  return [...map.values()];
}

function eventInWindow(event, startMs, endMs) {
  const b = boundsOf(state, event);
  const t = b.allDay ? Date.UTC(b.startYmd.y, b.startYmd.m - 1, b.startYmd.d) : b.start.getTime();
  return t >= startMs && t < endMs;
}

async function loadPeople() {
  if (state.demo || !state.api) return;
  try {
    const people = await state.api.listConnections();
    state.peopleIndex = indexPeople(people);
    learn();
    render();
  } catch {
    state.driveNote = state.driveNote || "Contacts lookup isn’t available. Zones can still come from invites and place names.";
  }
}

function learn() {
  const { contacts, changed } = applyUpdates(state.settings, inferUpdates(state.events, {
    selfEmail: state.me,
    peopleIndex: state.peopleIndex,
  }));
  if (!changed) return;
  state.settings = { ...state.settings, contacts, updated: new Date().toISOString() };
  persistSettings();
}

function persistSettings() {
  state.settings.updated = new Date().toISOString();
  saveLocalSettings(state.settings);
  if (state.demo || !state.token) return;
  clearTimeout(driveTimer);
  driveTimer = setTimeout(() => {
    pushDriveSettings(state.token, state.settings, state.driveFileId).then((id) => {
      state.driveFileId = id || state.driveFileId;
      state.driveNote = "Saved to this browser and your private Google Drive app data.";
    }).catch(() => {
      state.driveNote = "Saved in this browser. Drive app data isn’t available, so export the JSON if you want a copy on another device.";
    });
  }, 800);
}

async function syncDrive() {
  if (!state.token) return;
  try {
    const { settings, fileId } = await pullDriveSettings(state.token);
    state.driveFileId = fileId;
    if (settings) {
      state.settings = mergeSettings(state.settings, settings);
      saveLocalSettings(state.settings);
      state.driveNote = "Contact zones and offsets are synced with your private Google Drive app data.";
      render();
      if (fileId) pushDriveSettings(state.token, state.settings, fileId).catch(() => {});
    } else {
      state.driveFileId = await pushDriveSettings(state.token, state.settings, null);
      state.driveNote = "Contact zones and offsets will sync through your private Google Drive app data.";
    }
  } catch {
    state.driveNote = "Saved in this browser. Drive app data isn’t available, so use export if you switch devices.";
  }
}

function render() {
  if (state.mode !== "app") return;
  updateChrome();
  $("mini").innerHTML = miniHtml(state);
  $("cal-list").innerHTML = calListHtml(state);
  renderMain();
  const clock = $("now-readout");
  if (clock) clock.textContent = `${formatTime(state.now)} ${zoneAbbrev(state.now)}`;
}

function renderMain() {
  const scroller = document.querySelector(".grid-scroll");
  const prev = scroller?.scrollTop;
  $("main").innerHTML = mainHtml(state);
  const next = document.querySelector(".grid-scroll");
  if (next) {
    if (state.forceScroll) {
      const hour = Math.max(0, parts(state.now, HOME_TZ).hour - 1);
      next.scrollTop = hour * HOUR_PX;
      state.forceScroll = false;
    } else if (prev != null) next.scrollTop = prev;
  }
}

function updateChrome() {
  const label = $("range-label");
  if (label) label.textContent = rangeLabel(state.view, state.anchor, state.settings.weekStart || 0);
  document.querySelectorAll("[data-set-view]").forEach((btn) => {
    btn.classList.toggle("on", btn.dataset.setView === state.view);
    btn.setAttribute("aria-pressed", btn.dataset.setView === state.view ? "true" : "false");
  });
  try {
    localStorage.setItem(LS.view, state.view);
    localStorage.setItem(LS.anchor, ymdStr(state.anchor));
  } catch { /* ignore */ }
}

function paintProgress() {
  const bar = $("progress");
  if (bar) bar.hidden = !state.loading;
}

function tick() {
  state.now = new Date();
  const line = document.querySelector(".now-line");
  if (line) line.style.top = `${(minutesSinceMidnight(state.now, HOME_TZ) / 60) * HOUR_PX}px`;
  const clock = $("now-readout");
  if (clock) clock.textContent = `${formatTime(state.now)} ${zoneAbbrev(state.now)}`;
  for (const el of document.querySelectorAll(".event, .chip, .ag-row")) {
    const ev = findEvent(el.dataset.cal, el.dataset.id);
    if (!ev) continue;
    const b = boundsOf(state, ev);
    const soon = !b.allDay && state.now >= new Date(b.start.getTime() - 10 * 60000) && state.now <= b.end;
    el.classList.toggle("is-soon", soon);
    el.querySelector(".ev-join")?.classList.toggle("hot", soon);
  }
}

function setView(view) {
  state.view = view;
  state.search = "";
  const input = $("search-input");
  if (input) input.value = "";
  $("search-bar").hidden = true;
  state.forceScroll = view === "day" || view === "week";
  closeSidebar();
  ensureFetched();
  render();
}

function move(dir) {
  state.anchor = shiftAnchor(state.view, state.anchor, dir, state.settings.weekStart || 0);
  state.mini = { y: state.anchor.y, m: state.anchor.m };
  ensureFetched();
  render();
}

function goToday() {
  state.anchor = todayYmd(state.now);
  state.mini = { y: state.anchor.y, m: state.anchor.m };
  state.forceScroll = true;
  ensureFetched();
  render();
}

function goTo(ymd) {
  state.anchor = ymd;
  state.mini = { y: ymd.y, m: ymd.m };
  ensureFetched();
  render();
}

function ensureFetched() {
  fetchEvents(false).then(() => render()).catch(() => {});
}

function findEvent(cal, id) {
  return state.events.find((e) => e.calendarId === cal && e.id === id);
}

function writableCalendar() {
  return state.calendars.find((c) => c.primary && !calendarLocked(c, state.settings))
    || state.calendars.find((c) => !calendarLocked(c, state.settings));
}

function onClick(e) {
  if (suppressClick) { suppressClick = false; return; }
  if (e.target.closest("a[href]")) return;
  const btn = e.target.closest("[data-action], [data-set-view]");
  if (!btn) {
    if (state.popover && !e.target.closest("#popover")) closePopover();
    return;
  }
  const action = btn.dataset.action || (btn.dataset.setView ? "set-view" : "");
  if (action === "set-view") setView(btn.dataset.setView);
  else if (action === "nav") move(Number(btn.dataset.dir));
  else if (action === "today") goToday();
  else if (action === "create") openCreate();
  else if (action === "mini-day") goTo(fromYmd(btn.dataset.date));
  else if (action === "open-day") { state.view = "day"; goTo(fromYmd(btn.dataset.date)); }
  else if (action === "mini-move") {
    const m0 = state.mini.m - 1 + Number(btn.dataset.dir);
    const y = state.mini.y + Math.floor(m0 / 12);
    const m = ((m0 % 12) + 12) % 12;
    state.mini = { y, m: m + 1 };
    $("mini").innerHTML = miniHtml(state);
  } else if (action === "toggle-cal") {
    e.preventDefault();
    toggleCal(btn.dataset.id);
  } else if (action === "open-event") openEvent(findEvent(btn.dataset.cal, btn.dataset.id), e.clientX, e.clientY);
  else if (action === "more-day") { state.view = "agenda"; goTo(fromYmd(btn.dataset.date)); }
  else if (action === "close-pop") closePopover();
  else if (action === "edit-event") editCurrent();
  else if (action === "dup-event") duplicateCurrent();
  else if (action === "del-event") deleteCurrent();
  else if (action === "rsvp") rsvpCurrent(btn.dataset.status);
  else if (action === "copy-link") copyText(btn.dataset.url).then((ok) => toast(ok ? "Meet link copied" : "Couldn’t copy"));
  else if (action === "copy-dial") copyText(btn.dataset.text).then((ok) => toast(ok ? "Dial-in copied" : "Couldn’t copy"));
  else if (action === "remove-meet") setMeetWanted(false);
  else if (action === "keep-meet") setMeetWanted(true);
  else if (action === "add-room") addAxiomRoom();
  else if (action === "remove-room") removeAxiomRoom();
  else if (action === "close-editor") closeEditor();
  else if (action === "save-event") saveDraft();
  else if (action === "pick-color") pickColor(btn.dataset.color);
  else if (action === "remove-guest") removeGuest(Number(btn.dataset.index));
  else if (action === "remove-rem") removeReminder(Number(btn.dataset.index));
  else if (action === "close-settings") closeSettings();
  else if (action === "close-help") closeHelp();
  else if (action === "close-command") closeCommand();
  else if (action === "cmd-run") runCommand(Number(btn.dataset.index));
  else if (action === "search-toggle") toggleSearch();
  else if (action === "refresh") refresh();
  else if (action === "settings") openSettings();
  else if (action === "command") openCommand();
  else if (action === "help") openHelp();
}

function toggleSidebar() {
  $("sidebar").classList.toggle("open");
  $("scrim").hidden = !$("sidebar").classList.contains("open");
}
function closeSidebar() {
  $("sidebar")?.classList.remove("open");
  if ($("scrim")) $("scrim").hidden = true;
}

async function toggleCal(id) {
  const cal = calOf(state, id);
  if (!cal) return;
  cal.selected = cal.selected === false;
  render();
  if (state.demo) return;
  try {
    await state.api.patchCalendarList(id, { selected: cal.selected !== false });
    if (cal.selected !== false) await fetchEvents(true);
    render();
  } catch (err) {
    toast(err.message);
  }
}

function openEvent(event, x, y) {
  if (!event) return;
  state.popover = { cal: event.calendarId, id: event.id };
  const root = $("popover");
  root.hidden = false;
  root.innerHTML = popoverHtml(state, event);
  if (window.innerWidth > 860) {
    root.style.left = "0px";
    root.style.top = "0px";
    const rect = root.getBoundingClientRect();
    let left = (x || 80) + 8;
    let top = (y || 80) + 8;
    if (left + rect.width > innerWidth - 8) left = innerWidth - rect.width - 8;
    if (top + rect.height > innerHeight - 8) top = Math.max(8, (y || 80) - rect.height - 8);
    root.style.left = `${Math.max(8, left)}px`;
    root.style.top = `${Math.max(8, top)}px`;
  } else {
    root.style.left = "";
    root.style.top = "";
  }
}
function closePopover() {
  state.popover = null;
  $("popover").hidden = true;
  $("popover").innerHTML = "";
}
function currentEvent() {
  if (!state.popover) return null;
  return findEvent(state.popover.cal, state.popover.id);
}

function blankDraft(partial = {}) {
  const start = partial.start || zonedDate(state.anchor, 9 * 60);
  const end = partial.end || new Date(start.getTime() + 3600000);
  return {
    mode: "create",
    calendarId: writableCalendar()?.id || state.calendars[0]?.id,
    originalCalendarId: partial.calendarId,
    eventId: null,
    recurringEventId: null,
    scope: "instance",
    summary: "",
    location: "",
    description: "",
    allDay: false,
    start,
    end,
    originalStart: start,
    attendees: [],
    reminders: { useDefault: true },
    transparency: "opaque",
    recurrenceLines: null,
    recModel: { preset: "none", interval: 1, byDay: [], endType: "never", count: 10, endDate: "", rest: [] },
    recurrenceTouched: false,
    addMeet: false,
    hadMeet: false,
    existingLink: "",
    meetRequestId: uid(),
    colorTouched: false,
    copyExactColor: false,
    colorMode: "default",
    colorId: "",
    axiomColor: "",
    guestsCanModify: false,
    guestsCanInviteOthers: true,
    guestsCanSeeOtherGuests: true,
    notify: true,
    wheelV: 1,
    ...partial,
  };
}

function draftFromEvent(event, { duplicate = false } = {}) {
  const b = boundsOf(state, event);
  let start;
  let end;
  if (b.allDay) {
    start = zonedDate(b.startYmd, 0);
    end = zonedDate(b.endYmd, 0);
  } else {
    start = new Date(b.start);
    end = new Date(b.end);
  }
  const hex = event.extendedProperties?.private?.axiomColor || "";
  const recLines = event.recurrence || null;
  const draft = blankDraft({
    mode: duplicate ? "create" : "edit",
    calendarId: duplicate && calendarLocked(calOf(state, event.calendarId), state.settings)
      ? writableCalendar()?.id
      : event.calendarId,
    originalCalendarId: event.calendarId,
    eventId: duplicate ? null : event.id,
    recurringEventId: duplicate ? null : (event.recurringEventId || null),
    summary: event.summary || "",
    location: event.location || "",
    description: event.description || "",
    allDay: b.allDay,
    start,
    end,
    originalStart: start,
    attendees: (event.attendees || []).map((a) => ({ ...a })),
    reminders: event.reminders ? structuredClone(event.reminders) : { useDefault: true },
    transparency: event.transparency || "opaque",
    recurrenceLines: recLines,
    recModel: parseRecurrence(recLines || []),
    hadMeet: duplicate ? false : !!meetLinkOf(event),
    addMeet: !!meetLinkOf(event),
    existingLink: duplicate ? "" : (meetLinkOf(event) || ""),
    colorTouched: duplicate,
    copyExactColor: duplicate,
    colorMode: hex ? "custom" : event.colorId ? "palette" : "default",
    colorId: event.colorId || "",
    axiomColor: hex || "",
    guestsCanModify: !!event.guestsCanModify,
    guestsCanInviteOthers: event.guestsCanInviteOthers !== false,
    guestsCanSeeOtherGuests: event.guestsCanSeeOtherGuests !== false,
    raw: event,
  });
  return draft;
}

function openCreate(partial = {}) {
  if (!writableCalendar()) {
    toast("There’s no calendar this app can write to.");
    return;
  }
  openEditor(blankDraft(partial));
}

function openEditor(draft) {
  closePopover();
  closeCommand();
  state.draft = draft;
  state.layer = "editor";
  const root = $("editor");
  root.hidden = false;
  root.innerHTML = editorHtml(state, draft);
  bindEditor(root);
  updateEditorBits();
  drawWheel();
  $("ed-summary")?.focus();
}

function closeEditor() {
  state.draft = null;
  state.layer = null;
  $("editor").hidden = true;
  $("editor").innerHTML = "";
}

function refreshEditor() {
  if (!state.draft) return;
  const root = $("editor");
  root.innerHTML = editorHtml(state, state.draft);
  bindEditor(root);
  updateEditorBits();
  drawWheel();
}

function setMeetWanted(want) {
  if (!state.draft) return;
  readEditor();
  state.draft.addMeet = want;
  refreshEditor();
}

function calendarBase() {
  if (typeof location !== "undefined" && /^https?:$/.test(location.protocol)) {
    return location.origin + location.pathname.replace(/[^/]*$/, "");
  }
  return undefined;
}

function addAxiomRoom() {
  if (!state.draft) return;
  readEditor();
  if (axiomRoomLinkOf(state.draft)) {
    refreshEditor();
    return;
  }
  const url = roomUrlForCode(newRoomCode(), calendarBase());
  const placed = placeRoom(state.draft.location, state.draft.description, url);
  state.draft.location = placed.location;
  state.draft.description = placed.description;
  refreshEditor();
}

function removeAxiomRoom() {
  if (!state.draft) return;
  readEditor();
  state.draft.location = stripRoomText(state.draft.location);
  state.draft.description = stripRoomText(state.draft.description);
  refreshEditor();
}

function bindEditor(root) {
  const sync = () => { readEditor(); updateEditorBits(); };
  root.querySelectorAll("input, textarea, select").forEach((el) => {
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
  });
  $("ed-guest")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitGuest();
    }
  });
  $("ed-guest")?.addEventListener("blur", () => { if ($("ed-guest").value.includes("@")) commitGuest(); });
  $("ed-add-rem")?.addEventListener("click", () => {
    readEditor();
    state.draft.reminders = state.draft.reminders?.useDefault === false
      ? state.draft.reminders
      : { useDefault: false, overrides: [] };
    state.draft.reminders.useDefault = false;
    state.draft.reminders.overrides = [...(state.draft.reminders.overrides || []), { method: "popup", minutes: 10 }];
    updateEditorBits();
  });
  $("wheel")?.addEventListener("pointerdown", (e) => { pickWheel(e); e.currentTarget.setPointerCapture(e.pointerId); });
  $("wheel")?.addEventListener("pointermove", (e) => { if (e.buttons) pickWheel(e); });
  $("wheel-hex")?.addEventListener("change", () => {
    const value = $("wheel-hex").value.trim();
    if (!value) return;
    applyHex(value.startsWith("#") ? value : `#${value}`);
  });
}

function readEditor() {
  const draft = state.draft;
  if (!draft || !$("ed-summary")) return;
  draft.summary = $("ed-summary").value;
  draft.location = $("ed-location").value;
  draft.description = $("ed-desc").value;
  draft.allDay = $("ed-allday").checked;
  draft.calendarId = $("ed-cal").value || draft.calendarId;
  const meetBox = $("ed-meet");
  if (meetBox) draft.addMeet = meetBox.checked;
  draft.notify = $("ed-notify").checked;
  draft.transparency = $("ed-show").value;
  const startDay = fromYmd($("ed-start-date").value);
  const endDay = fromYmd($("ed-end-date").value);
  if (draft.allDay) {
    draft.start = zonedDate(startDay, 0);
    draft.end = zonedDate(addDays(endDay, 1), 0);
  } else {
    const [sh, sm] = ($("ed-start-time").value || "09:00").split(":").map(Number);
    const [eh, em] = ($("ed-end-time").value || "10:00").split(":").map(Number);
    draft.start = zonedDate(startDay, sh * 60 + (sm || 0));
    draft.end = zonedDate(endDay, eh * 60 + (em || 0));
  }
  const scope = document.querySelector('input[name="scope"]:checked');
  if (scope) draft.scope = scope.value;
  const repeat = $("ed-repeat");
  if (repeat && repeat.value !== (draft.recModel?.preset || "none")) draft.recurrenceTouched = true;
  if (repeat && draft.recurrenceTouched && repeat.value !== "raw") {
    const byDay = [...document.querySelectorAll("[data-dow]:checked")].map((el) => el.dataset.dow);
    const model = {
      preset: repeat.value,
      interval: Number($("ed-interval")?.value || 1),
      byDay,
      endType: $("ed-end-type")?.value || "never",
      endDate: $("ed-end-date")?.value || "",
      count: Number($("ed-count")?.value || 10),
      rest: draft.recModel?.rest || [],
    };
    if ((model.preset === "weekly" || model.preset === "custom") && !model.byDay.length) {
      model.byDay = [dowCode(weekdayIndex(ymdFromDate(draft.start)))];
    }
    draft.recModel = model;
    draft.recurrenceLines = model.preset === "none" ? [] : buildRecurrence(model, ymdFromDate(draft.start), draft.allDay);
  }
  const useDefault = $("ed-rem-default")?.checked;
  if (useDefault) draft.reminders = { useDefault: true };
  else if (draft.reminders) {
    draft.reminders.useDefault = false;
    draft.reminders.overrides = (draft.reminders.overrides || []).map((r, i) => {
      const method = document.querySelector(`[data-rem="method"][data-index="${i}"]`)?.value || r.method;
      const minutes = Number(document.querySelector(`[data-rem="minutes"][data-index="${i}"]`)?.value ?? r.minutes);
      return { method, minutes };
    });
  }
  document.querySelectorAll(".time-field").forEach((el) => { el.hidden = draft.allDay; });
  const custom = $("ed-custom");
  if (custom) custom.classList.toggle("hide", !["weekly", "custom"].includes($("ed-repeat")?.value));
}

function updateEditorBits() {
  const draft = state.draft;
  if (!draft) return;
  const ctx = zoneCtx(state);
  const fake = {
    summary: draft.summary,
    location: draft.location,
    attendees: draft.attendees,
    start: { dateTime: draft.start.toISOString(), timeZone: HOME_TZ },
    end: { dateTime: draft.end.toISOString(), timeZone: HOME_TZ },
    organizer: draft.raw?.organizer,
    creator: draft.raw?.creator,
  };
  const updates = inferUpdates([fake], { ...ctx, selfEmail: state.me });
  const applied = applyUpdates(state.settings, updates);
  if (applied.changed) {
    state.settings = { ...state.settings, contacts: applied.contacts };
    persistSettings();
  }
  const clocks = clocksForEvent(fake, zoneCtx(state));
  const readout = $("tz-readout");
  if (readout) readout.innerHTML = readoutHtml(draft, clocks);
  const active = document.activeElement;
  const guests = $("ed-guests");
  if (guests && !guests.contains(active)) guests.innerHTML = guestListHtml(draft, zoneCtx(state));
  const rems = $("ed-rems");
  if (rems && !rems.contains(active)) rems.innerHTML = reminderEditorHtml(draft);
  const note = $("nearest-note");
  if (note) note.textContent = draft.colorMode === "custom" ? nearestCaption(draft.axiomColor, state.palette) : "";
}

function commitGuest() {
  const input = $("ed-guest");
  const email = input.value.trim().replace(/,$/, "").toLowerCase();
  if (!email.includes("@")) return;
  readEditor();
  if (state.draft.attendees.some((a) => a.email.toLowerCase() === email)) { input.value = ""; return; }
  const known = state.peopleIndex.byEmail.get(email);
  state.draft.attendees.push({ email, displayName: known?.name || "", responseStatus: "needsAction" });
  input.value = "";
  updateEditorBits();
}

function removeGuest(index) {
  readEditor();
  state.draft.attendees.splice(index, 1);
  updateEditorBits();
}

function removeReminder(index) {
  readEditor();
  state.draft.reminders.overrides.splice(index, 1);
  updateEditorBits();
}

function pickColor(id) {
  const draft = state.draft;
  if (!draft) return;
  draft.colorTouched = true;
  draft.copyExactColor = false;
  if (id === "default") {
    draft.colorMode = "default";
    draft.colorId = "";
    draft.axiomColor = "";
  } else {
    draft.colorMode = "palette";
    draft.colorId = id;
    draft.axiomColor = "";
  }
  document.querySelectorAll(".swatch-btn").forEach((btn) => {
    const on = (id === "default" && btn.dataset.color === "default") || btn.dataset.color === id;
    btn.classList.toggle("on", on);
  });
  updateEditorBits();
}

function drawWheel() {
  const canvas = $("wheel");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const cx = w / 2;
  const r = w / 2 - 1;
  const img = ctx.createImageData(w, w);
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cx;
      const dist = Math.hypot(dx, dy);
      const i = (y * w + x) * 4;
      if (dist > r) { img.data[i + 3] = 0; continue; }
      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const [R, G, B] = hsvToRgb(hue, dist / r, 1);
      img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function pickWheel(e) {
  const canvas = $("wheel");
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  const cx = canvas.width / 2;
  const dx = x - cx;
  const dy = y - cx;
  const dist = Math.hypot(dx, dy);
  const radius = cx - 1;
  if (dist > radius) return;
  const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
  const sat = dist / radius;
  const v = Number($("wheel-v")?.value || 1);
  state.draft.wheelV = v;
  const [R, G, B] = hsvToRgb(hue, sat, v);
  applyHex(rgbToHex(R, G, B));
}

function applyHex(hex) {
  const draft = state.draft;
  const norm = hex.toLowerCase();
  const match = Object.entries(state.palette).find(([, entry]) => entry.background.toLowerCase() === norm);
  draft.colorTouched = true;
  draft.copyExactColor = false;
  if (match) {
    draft.colorMode = "palette";
    draft.colorId = match[0];
    draft.axiomColor = "";
  } else {
    draft.colorMode = "custom";
    draft.axiomColor = norm;
    draft.colorId = "";
  }
  document.querySelectorAll(".swatch-btn").forEach((btn) => btn.classList.toggle("on", btn.dataset.color === draft.colorId));
  if ($("wheel-hex") && document.activeElement !== $("wheel-hex")) $("wheel-hex").value = draft.axiomColor || norm;
  updateEditorBits();
}

function editCurrent() {
  const event = currentEvent();
  if (!event || calendarLocked(calOf(state, event.calendarId), state.settings)) {
    toast("This calendar is read-only here.");
    return;
  }
  openEditor(draftFromEvent(event));
}

function duplicateCurrent() {
  const event = currentEvent();
  if (!event) return;
  if (!writableCalendar()) { toast("There’s no calendar this app can write to."); return; }
  openEditor(draftFromEvent(event, { duplicate: true }));
}

async function deleteCurrent() {
  const event = currentEvent();
  if (!event) return;
  if (calendarLocked(calOf(state, event.calendarId), state.settings)) {
    toast("This calendar is read-only here.");
    return;
  }
  let scope = "instance";
  if (event.recurringEventId) {
    scope = await ask({
      title: "Delete recurring event",
      actions: [
        ["instance", "This event"],
        ["following", "This and following"],
        ["series", "All events"],
        ["cancel", "Cancel"],
      ],
    });
    if (!scope || scope === "cancel") return;
  } else {
    const ok = await ask({ title: "Delete this event?", actions: [["yes", "Delete"], ["cancel", "Cancel"]] });
    if (ok !== "yes") return;
  }
  try {
    if (!state.demo) await deleteOnServer(event, scope);
    removeLocal(event, scope);
    closePopover();
    render();
    toast("Event deleted");
  } catch (err) {
    toast(err.message);
  }
}

async function deleteOnServer(event, scope) {
  const send = event.attendees?.length ? "all" : "none";
  if (scope === "series") {
    await state.api.deleteEvent(event.calendarId, event.recurringEventId, { sendUpdates: send });
    return;
  }
  if (scope === "following") {
    const master = await state.api.getEvent(event.calendarId, event.recurringEventId);
    const until = new Date((event.start?.dateTime ? new Date(event.start.dateTime) : zonedDate(fromYmd(event.start.date), 0)).getTime() - 1000);
    await state.api.patchEvent(event.calendarId, master.id, {
      recurrence: capRruleUntil(master.recurrence, until),
    }, { sendUpdates: "none" });
  }
  await state.api.deleteEvent(event.calendarId, event.id, { sendUpdates: send });
}

function removeLocal(event, scope) {
  if (scope === "series" && event.recurringEventId) {
    state.events = state.events.filter((e) => e.recurringEventId !== event.recurringEventId && e.id !== event.recurringEventId);
  } else state.events = state.events.filter((e) => !(e.calendarId === event.calendarId && e.id === event.id));
}

async function rsvpCurrent(status) {
  const event = currentEvent();
  if (!event) return;
  if (calendarLocked(calOf(state, event.calendarId), state.settings)) {
    toast("This calendar is read-only here.");
    return;
  }
  const attendees = (event.attendees || []).map((a) => (
    a.self || String(a.email || "").toLowerCase() === String(state.me).toLowerCase()
      ? { ...a, responseStatus: status }
      : a
  ));
  try {
    if (state.demo) {
      event.attendees = attendees;
    } else {
      const updated = await state.api.patchEvent(event.calendarId, event.id, buildRsvpPatch(attendees), { sendUpdates: "all" });
      replaceEvent(updated, event.calendarId);
    }
    openEvent(findEvent(event.calendarId, event.id) || event);
    toast(status === "accepted" ? "Yes" : status === "declined" ? "No" : "Maybe");
  } catch (err) {
    toast(err.message);
  }
}

function replaceEvent(raw, calendarId) {
  const event = { ...raw, calendarId: raw.calendarId || calendarId };
  const idx = state.events.findIndex((e) => e.calendarId === event.calendarId && e.id === event.id);
  if (idx >= 0) state.events[idx] = event;
  else state.events.push(event);
}

async function saveDraft() {
  const draft = state.draft;
  if (!draft || draft.saving) return;
  readEditor();
  if (draft.end <= draft.start) {
    const err = $("ed-error");
    err.hidden = false;
    err.textContent = "The end must be after the start.";
    return;
  }
  const cal = calOf(state, draft.calendarId);
  if (calendarLocked(cal, state.settings)) {
    toast("This calendar is read-only here, so nothing was written.");
    return;
  }
  draft.saving = true;
  try {
    if (state.demo) {
      saveDemo(draft);
      closeEditor();
      render();
      toast("Saved in the preview");
      return;
    }
    const send = draft.notify && draft.attendees.length ? "all" : "none";
    if (draft.mode === "create") {
      const created = await state.api.insertEvent(draft.calendarId, buildInsertBody(draft), {
        conferenceDataVersion: draft.addMeet ? 1 : undefined,
        sendUpdates: send,
      });
      replaceEvent(await maybeRefreshMeet(draft.calendarId, created), draft.calendarId);
      closeEditor();
      render();
      toast("Event created", { label: "Undo", run: () => undoCreate(created, draft.calendarId) });
      return;
    }
    if (draft.scope === "series" && draft.recurringEventId) {
      const master = await state.api.getEvent(draft.originalCalendarId, draft.recurringEventId);
      const masterStart = master.start.dateTime
        ? new Date(master.start.dateTime)
        : zonedDate(fromYmd(master.start.date), 0);
      const times = clockOntoMaster(masterStart, draft.start, draft.end, draft.allDay);
      const seriesDraft = { ...draft, start: times.start, end: times.end, calendarId: draft.originalCalendarId };
      const updated = await state.api.patchEvent(draft.originalCalendarId, master.id, buildPatchBody(seriesDraft, master), {
        conferenceDataVersion: conferenceQuery(seriesDraft),
        sendUpdates: send,
      });
      await fetchEvents(true);
      closeEditor();
      render();
      toast("Series updated");
      return updated;
    }
    if (draft.scope === "following" && draft.recurringEventId) {
      const master = await state.api.getEvent(draft.originalCalendarId, draft.recurringEventId);
      const until = new Date(draft.originalStart.getTime() - 1000);
      await state.api.patchEvent(draft.originalCalendarId, master.id, {
        recurrence: capRruleUntil(master.recurrence, until),
      }, { sendUpdates: "none" });
      const created = await state.api.insertEvent(draft.calendarId, buildInsertBody({
        ...draft,
        recurrenceLines: draft.recurrenceTouched ? draft.recurrenceLines : master.recurrence,
      }), { conferenceDataVersion: draft.addMeet ? 1 : undefined, sendUpdates: send });
      await fetchEvents(true);
      closeEditor();
      render();
      toast("This and following events were updated");
      return created;
    }
    let calendarId = draft.originalCalendarId;
    if (draft.calendarId !== calendarId && !draft.recurringEventId) {
      await state.api.moveEvent(calendarId, draft.eventId, draft.calendarId, { sendUpdates: send });
      calendarId = draft.calendarId;
    }
    const original = draft.raw || findEvent(calendarId, draft.eventId) || {};
    const updated = await state.api.patchEvent(calendarId, draft.eventId, buildPatchBody(draft, original), {
      conferenceDataVersion: conferenceQuery(draft),
      sendUpdates: send,
    });
    replaceEvent(await maybeRefreshMeet(calendarId, updated), calendarId);
    closeEditor();
    render();
    toast("Saved");
  } catch (err) {
    const box = $("ed-error");
    if (box) { box.hidden = false; box.textContent = err.message; }
    else toast(err.message);
  } finally {
    if (state.draft) state.draft.saving = false;
  }
}

async function maybeRefreshMeet(calendarId, event) {
  if (!event?.conferenceData?.createRequest || meetLinkOf(event)) return event;
  await new Promise((r) => setTimeout(r, 800));
  try { return await state.api.getEvent(calendarId, event.id); } catch { return event; }
}

async function undoCreate(event, calendarId) {
  try {
    if (!state.demo) await state.api.deleteEvent(calendarId || writableCalendar()?.id, event.id, { sendUpdates: "none" });
    state.events = state.events.filter((e) => e.id !== event.id);
    render();
    toast("Undone");
  } catch (err) {
    toast(err.message);
  }
}

function saveDemo(draft) {
  const body = draft.mode === "create" ? buildInsertBody(draft) : buildPatchBody(draft, draft.raw || {});
  const event = {
    id: draft.eventId || `demo-${uid()}`,
    calendarId: draft.calendarId,
    ...body,
    extendedProperties: body.extendedProperties,
    hangoutLink: body.conferenceData ? "https://meet.google.com/new-demo-link" : draft.existingLink,
    conferenceData: body.conferenceData
      ? { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/new-demo-link" }] }
      : (draft.addMeet ? draft.raw?.conferenceData : undefined),
  };
  if (body.conferenceData === null) {
    event.hangoutLink = undefined;
    event.conferenceData = undefined;
  } else if (draft.hadMeet && draft.addMeet) {
    event.hangoutLink = draft.existingLink;
    event.conferenceData = draft.raw?.conferenceData;
  }
  replaceEvent(event, draft.calendarId);
}

async function quickAdd(text) {
  const parsed = parseQuickAdd(text, state.now, HOME_TZ);
  if (!parsed) return;
  const cal = writableCalendar();
  if (!cal) { toast("There’s no calendar this app can write to."); return; }
  const draft = blankDraft({
    calendarId: cal.id,
    summary: parsed.title,
    allDay: parsed.allDay,
    start: parsed.start,
    end: parsed.end,
    addMeet: parsed.addMeet,
    recurrenceLines: parsed.recurrence,
    recurrenceTouched: !!parsed.recurrence,
  });
  state.draft = draft;
  await saveDraft();
  const input = $("quick-input");
  if (input) input.value = "";
  const preview = $("quick-preview");
  if (preview) preview.textContent = "";
}

function openQuickEditor(text) {
  const parsed = parseQuickAdd(text, state.now, HOME_TZ);
  if (!parsed) { openCreate({ summary: text }); return; }
  openCreate({
    summary: parsed.title,
    allDay: parsed.allDay,
    start: parsed.start,
    end: parsed.end,
    addMeet: parsed.addMeet,
    recurrenceLines: parsed.recurrence,
    recModel: parseRecurrence(parsed.recurrence || []),
    recurrenceTouched: !!parsed.recurrence,
  });
}

function ask({ title, actions }) {
  return new Promise((resolve) => {
    const root = $("confirm");
    root.hidden = false;
    root.innerHTML = `<div class="sheet confirm" role="dialog"><h2>${esc(title)}</h2><div class="pop-actions">${actions.map(([id, label]) => `<button type="button" data-act="${esc(id)}" class="${id === "cancel" ? "" : id === "yes" ? "danger" : "primary"}">${esc(label)}</button>`).join("")}</div></div>`;
    root.onclick = (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      root.hidden = true;
      root.innerHTML = "";
      resolve(b.dataset.act);
    };
  });
}

function toast(message, action) {
  const el = $("toast");
  el.hidden = false;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" id="toast-action">${esc(action.label)}</button>` : ""}`;
  if (action) $("toast-action").onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3200);
}

function toggleSearch() {
  const bar = $("search-bar");
  bar.hidden = !bar.hidden;
  if (!bar.hidden) $("search-input").focus();
  else { state.search = ""; $("search-input").value = ""; renderMain(); }
}

async function refresh() {
  if (state.demo) { render(); return; }
  try {
    await reloadCalendars();
    await fetchEvents(true);
    learn();
    render();
  } catch (err) {
    toast(err.message);
  }
}

function openCommand() {
  state.layer = "command";
  state.commands = commandItems("");
  const root = $("command");
  root.hidden = false;
  root.innerHTML = `<div class="cmd" role="dialog" aria-label="Command bar"><input id="cmd-input" placeholder="Jump to a date, create, search, toggle a calendar…" autocomplete="off"><div id="cmd-list"></div></div>`;
  const input = $("cmd-input");
  input.focus();
  paintCommands("");
  input.addEventListener("input", () => paintCommands(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveCommand(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const on = document.querySelector(".cmd-item.on") || document.querySelector(".cmd-item");
      on?.click();
    } else if (e.key === "Escape") closeCommand();
  });
}

function commandItems(query) {
  const items = [];
  const add = (item) => {
    const hay = `${item.label} ${item.hint || ""}`.toLowerCase();
    if (!query || query.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) items.push(item);
  };
  const meeting = nextMeeting();
  add({ label: "Join next meeting", hint: meeting?.summary || "Nothing with a video link", run: joinNext });
  add({
    label: "New Axiom video room",
    hint: "Camera, mic, and chat",
    run: () => {
      const url = roomUrlForCode(newRoomCode(), calendarBase());
      window.open(url, "_blank", "noopener");
    },
  });
  add({ label: "Create event", hint: "c", run: () => openCreate() });
  add({ label: "Today", hint: "t", run: goToday });
  add({ label: "Day view", hint: "d", run: () => setView("day") });
  add({ label: "Week view", hint: "w", run: () => setView("week") });
  add({ label: "Month view", hint: "m", run: () => setView("month") });
  add({ label: "Agenda view", hint: "a", run: () => setView("agenda") });
  add({ label: "Settings", run: openSettings });
  add({ label: "Keyboard shortcuts", hint: "?", run: openHelp });
  for (const cal of state.calendars) {
    add({ label: `${cal.selected === false ? "Show" : "Hide"} ${cal.summary}`, hint: "Calendar", run: () => toggleCal(cal.id) });
  }
  if (query) {
    const parsed = parseQuickAdd(query, state.now, HOME_TZ);
    if (parsed) {
      items.unshift({
        label: `Go to ${formatFullDate(ymdFromDate(parsed.start))}`,
        hint: "Date",
        run: () => goTo(ymdFromDate(parsed.start)),
      });
      items.unshift({
        label: `Create “${parsed.title}”`,
        hint: `${parsed.allDay ? "All day" : formatRange(parsed.start, parsed.end)}${parsed.addMeet ? " · Meet" : ""}`,
        run: () => quickAdd(query),
      });
    }
    for (const ev of activeEvents(state).filter((e) => `${e.summary || ""} ${e.location || ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6)) {
      const b = boundsOf(state, ev);
      const day = b.allDay ? b.startYmd : ymdFromDate(b.start);
      items.push({
        label: ev.summary || "(No title)",
        hint: b.allDay ? "All day" : formatTime(b.start),
        run: () => { goTo(day); openEvent(ev, 120, 120); },
      });
    }
  }
  return items.slice(0, 14);
}

function paintCommands(query) {
  state.commands = commandItems(query);
  const list = $("cmd-list");
  if (!list) return;
  list.innerHTML = state.commands.map((item, i) => `<button type="button" class="cmd-item${i === 0 ? " on" : ""}" data-action="cmd-run" data-index="${i}"><span>${esc(item.label)}</span><em>${esc(item.hint || "")}</em></button>`).join("") || `<p class="empty">No matches</p>`;
}

function moveCommand(dir) {
  const items = [...document.querySelectorAll(".cmd-item")];
  const idx = items.findIndex((el) => el.classList.contains("on"));
  const next = items[Math.max(0, Math.min(items.length - 1, idx + dir))];
  items.forEach((el) => el.classList.remove("on"));
  next?.classList.add("on");
  next?.scrollIntoView({ block: "nearest" });
}

function runCommand(index) {
  const item = state.commands?.[index];
  closeCommand();
  item?.run();
}

function closeCommand() {
  if (state.layer === "command") state.layer = null;
  $("command").hidden = true;
  $("command").innerHTML = "";
}

function nextMeeting() {
  const now = state.now.getTime();
  const cands = activeEvents(state).filter((e) => {
    if (!meetLinkOf(e) && !axiomRoomLinkOf(e)) return false;
    const b = boundsOf(state, e);
    if (b.allDay) return false;
    return b.end.getTime() > now;
  }).sort((a, b) => boundsOf(state, a).start - boundsOf(state, b).start);
  return cands.find((e) => boundsOf(state, e).start.getTime() <= now) || cands[0] || null;
}

function joinNext() {
  const event = nextMeeting();
  if (!event) { toast("No upcoming meeting with a video link."); return; }
  const url = meetLinkOf(event) || axiomRoomLinkOf(event);
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function openHelp() {
  state.layer = "help";
  $("help").hidden = false;
  $("help").innerHTML = helpHtml();
}
function closeHelp() {
  if (state.layer === "help") state.layer = null;
  $("help").hidden = true;
}

function openSettings() {
  state.layer = "settings";
  $("settings").hidden = false;
  $("settings").innerHTML = settingsHtml(state);
  ensureTzList();
  $("set-save-client")?.addEventListener("click", () => {
    state.clientId = $("set-client").value.trim();
    saveClientId(state.clientId);
    toast("Client ID saved. Sign in again to use it.");
  });
  $("set-signout")?.addEventListener("click", () => {
    state.token = "";
    try { localStorage.removeItem(LS.signedIn); } catch { /* ignore */ }
    closeSettings();
    showGate();
  });
  $("set-week")?.addEventListener("change", () => {
    state.settings.weekStart = Number($("set-week").value) === 1 ? 1 : 0;
    persistSettings();
    render();
    openSettings();
  });
  $("set-save-offsets")?.addEventListener("click", saveOffsets);
  $("set-save-turn")?.addEventListener("click", () => {
    state.settings.turn = normalizeTurn({
      urls: $("set-turn-urls").value,
      username: $("set-turn-user").value,
      credential: $("set-turn-cred").value,
    });
    persistSettings();
    toast(state.settings.turn.urls ? "Relay saved in this browser" : "Relay cleared. STUN only.");
  });
  $("set-export")?.addEventListener("click", exportSettings);
  $("set-import")?.addEventListener("change", importSettings);
  $("set-contacts")?.addEventListener("change", (e) => {
    const input = e.target.closest("[data-zone-email]");
    if (!input) return;
    const email = input.dataset.zoneEmail;
    const prev = state.settings.contacts[email] || {};
    const timeZone = input.value.trim();
    state.settings.contacts[email] = { ...prev, timeZone, source: "manual", name: prev.name || email, updated: new Date().toISOString() };
    persistSettings();
    renderMain();
  });
  $("set-contact-q")?.addEventListener("input", filterContacts);
}

function filterContacts() {
  const q = ($("set-contact-q").value || "").trim().toLowerCase();
  const list = $("set-contacts");
  const rows = [];
  const seen = new Set();
  const push = (email, row) => {
    if (!email || seen.has(email)) return;
    if (q && !`${email} ${row.name || ""} ${row.timeZone || ""}`.toLowerCase().includes(q)) return;
    seen.add(email);
    rows.push([email, row]);
  };
  for (const [email, row] of Object.entries(state.settings.contacts || {})) push(email, row);
  if (q) {
    for (const [email, rec] of state.peopleIndex.byEmail) {
      push(email, state.settings.contacts[email] || { name: rec.name, timeZone: rec.timeZone || "", source: rec.timeZone ? "people" : "" });
    }
    for (const ev of state.events) {
      for (const a of ev.attendees || []) {
        const email = String(a.email || "").toLowerCase();
        push(email, state.settings.contacts[email] || { name: a.displayName || email, timeZone: "" });
      }
    }
  }
  list.innerHTML = rows.slice(0, 40).map(([email, c]) => `<li><div><strong>${esc(c.name || email)}</strong><br><span class="hint">${esc(email)}</span></div><input data-zone-email="${esc(email)}" value="${esc(c.timeZone || "")}" list="tz-list" aria-label="Time zone for ${esc(email)}"></li>`).join("") || `<li class="empty">No matches.</li>`;
}

function saveOffsets() {
  const offsets = { ...state.settings.offsets };
  for (const input of document.querySelectorAll("[data-offset-hours]")) {
    const id = input.dataset.offsetHours;
    const hours = Number(input.value);
    const enabled = document.querySelector(`[data-offset-enabled="${CSS.escape(id)}"]`)?.checked && hours !== 0;
    offsets[id] = { hours: Number.isFinite(hours) ? hours : 0, enabled: !!enabled, updated: new Date().toISOString() };
  }
  state.settings = { ...state.settings, offsets };
  persistSettings();
  render();
  toast("Display offsets saved");
  openSettings();
}

function exportSettings() {
  const blob = new Blob([JSON.stringify(state.settings, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "axiom-calendar-settings.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function importSettings(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.settings = mergeSettings(state.settings, JSON.parse(String(reader.result)));
      persistSettings();
      render();
      openSettings();
      toast("Settings imported");
    } catch {
      toast("That file isn’t valid JSON.");
    }
  };
  reader.readAsText(file);
}

function closeSettings() {
  if (state.layer === "settings") state.layer = null;
  $("settings").hidden = true;
  $("settings").innerHTML = "";
}

function ensureTzList() {
  if ($("tz-list")) return;
  const list = document.createElement("datalist");
  list.id = "tz-list";
  for (const tz of listTimeZones()) {
    const opt = document.createElement("option");
    opt.value = tz;
    list.appendChild(opt);
  }
  document.body.appendChild(list);
}

function onPointerDown(e) {
  lastPointer = e.pointerType || "mouse";
  if (e.button !== 0 && e.pointerType === "mouse") return;
  if (lastPointer !== "mouse") return;
  if (state.layer) return;
  const resize = e.target.closest(".resize");
  const block = e.target.closest(".event, .aday");
  if (block && !e.target.closest("a")) {
    const event = findEvent(block.dataset.cal, block.dataset.id);
    if (!event || calendarLocked(calOf(state, event.calendarId), state.settings)) return;
    const b = boundsOf(state, event);
    state.drag = {
      mode: resize?.dataset.edge || (block.classList.contains("aday") ? "allday" : "move"),
      id: event.id,
      cal: event.calendarId,
      x: e.clientX,
      y: e.clientY,
      start: b.allDay ? zonedDate(b.startYmd, 0) : new Date(b.start),
      end: b.allDay ? zonedDate(b.endYmd, 0) : new Date(b.end),
      allDay: b.allDay,
      el: block,
      moved: false,
    };
    return;
  }
  const col = e.target.closest(".col");
  if (!col || e.target.closest(".event")) return;
  const rect = col.getBoundingClientRect();
  const minutes = Math.max(0, Math.min(24 * 60 - 15, Math.round(((e.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15));
  state.drag = { mode: "create", date: col.dataset.date, anchor: minutes, current: minutes, el: col, moved: false, x: e.clientX, y: e.clientY };
}

function onPointerMove(e) {
  const d = state.drag;
  if (!d) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4 && !d.moved) return;
  d.moved = true;
  if (d.mode === "create") {
    const rect = d.el.getBoundingClientRect();
    d.current = Math.max(0, Math.min(24 * 60, Math.round(((e.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15));
    paintGhost(d);
    return;
  }
  const colWidth = document.querySelector(".col")?.getBoundingClientRect().width || 80;
  const dayDelta = Math.round((e.clientX - d.x) / colWidth);
  const minDelta = Math.round((((e.clientY - d.y) / HOUR_PX) * 60) / 15) * 15;
  if (d.allDay || d.mode === "allday") {
    d.el.style.transform = `translateX(${dayDelta * colWidth}px)`;
    d.dayDelta = dayDelta;
    return;
  }
  if (d.mode === "move") {
    d.el.style.transform = `translate(${dayDelta * colWidth}px, ${(minDelta / 60) * HOUR_PX}px)`;
    d.dayDelta = dayDelta;
    d.minDelta = minDelta;
  } else if (d.mode === "end") {
    d.el.style.height = `${Math.max(18, ((durationMin(d) + minDelta) / 60) * HOUR_PX)}px`;
    d.minDelta = minDelta;
  } else if (d.mode === "start") {
    d.el.style.transform = `translateY(${(minDelta / 60) * HOUR_PX}px)`;
    d.el.style.height = `${Math.max(18, ((durationMin(d) - minDelta) / 60) * HOUR_PX)}px`;
    d.minDelta = minDelta;
  }
}

function durationMin(d) {
  return Math.max(15, Math.round((d.end - d.start) / 60000));
}

function paintGhost(d) {
  let ghost = d.el.querySelector(".ghost");
  if (!ghost) {
    ghost = document.createElement("div");
    ghost.className = "ghost";
    d.el.appendChild(ghost);
  }
  const a = Math.min(d.anchor, d.current);
  const b = Math.max(d.anchor, d.current, a + 15);
  ghost.style.top = `${(a / 60) * HOUR_PX}px`;
  ghost.style.height = `${((b - a) / 60) * HOUR_PX}px`;
}

async function onPointerUp(e) {
  const d = state.drag;
  if (!d) return;
  state.drag = null;
  d.el?.querySelector(".ghost")?.remove();
  if (d.el) d.el.style.transform = "";
  if (!d.moved) {
    if (d.mode === "create") {
      const day = fromYmd(d.date);
      const start = zonedDate(day, d.anchor);
      openCreate({ start, end: new Date(start.getTime() + 3600000), calendarId: writableCalendar()?.id });
    }
    return;
  }
  suppressClick = true;
  if (d.mode === "create") {
    const day = fromYmd(d.date);
    const a = Math.min(d.anchor, d.current);
    const b = Math.max(a + 15, Math.max(d.anchor, d.current));
    openCreate({ start: zonedDate(day, a), end: zonedDate(day, b), calendarId: writableCalendar()?.id });
    return;
  }
  const event = findEvent(d.cal, d.id);
  if (!event) return;
  let start = new Date(d.start);
  let end = new Date(d.end);
  const dayDelta = d.dayDelta || 0;
  const minDelta = d.minDelta || 0;
  if (d.allDay || d.mode === "allday") {
    const s = addDays(ymdFromDate(d.start), dayDelta);
    const span = Math.max(1, Math.round((Date.UTC(ymdFromDate(d.end).y, ymdFromDate(d.end).m - 1, ymdFromDate(d.end).d) - Date.UTC(ymdFromDate(d.start).y, ymdFromDate(d.start).m - 1, ymdFromDate(d.start).d)) / 86400000));
    start = zonedDate(s, 0);
    end = zonedDate(addDays(s, span), 0);
  } else if (d.mode === "move") {
    const p = parts(d.start, HOME_TZ);
    const day = addDays({ y: p.year, m: p.month, d: p.day }, dayDelta);
    const mins = p.hour * 60 + p.minute + minDelta;
    const day2 = addDays(day, Math.floor(mins / (24 * 60)));
    const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    start = zonedDate(day2, m);
    end = new Date(start.getTime() + (d.end - d.start));
  } else if (d.mode === "end") {
    end = new Date(d.end.getTime() + minDelta * 60000);
    if (end - start < 15 * 60000) end = new Date(start.getTime() + 15 * 60000);
  } else if (d.mode === "start") {
    start = new Date(d.start.getTime() + minDelta * 60000);
    if (end - start < 15 * 60000) start = new Date(end.getTime() - 15 * 60000);
  }
  const allDay = d.allDay || d.mode === "allday";
  try {
    if (state.demo) {
      if (allDay) {
        event.start = { date: ymdStr(ymdFromDate(start)) };
        event.end = { date: ymdStr(ymdFromDate(end)) };
        delete event.start.dateTime;
        delete event.end.dateTime;
      } else {
        event.start = { dateTime: start.toISOString(), timeZone: HOME_TZ };
        event.end = { dateTime: end.toISOString(), timeZone: HOME_TZ };
      }
    } else {
      const id = event.recurringEventId ? event.id : event.id;
      const updated = await state.api.patchEvent(event.calendarId, id, buildTimePatch(start, end, allDay), { sendUpdates: event.attendees?.length ? "all" : "none" });
      replaceEvent(updated, event.calendarId);
    }
    render();
    toast(event.recurringEventId ? "Moved this event" : "Updated");
  } catch (err) {
    render();
    toast(err.message);
  }
}

function onKey(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (state.layer === "command") closeCommand();
    else openCommand();
    return;
  }
  if (e.key === "Escape") {
    if (state.layer === "command") closeCommand();
    else if (state.layer === "help") closeHelp();
    else if (state.layer === "settings") closeSettings();
    else if (state.layer === "editor") closeEditor();
    else if (state.popover) closePopover();
    else closeSidebar();
    return;
  }
  if (state.layer || isTypingTarget(e.target)) return;
  if (meta || e.altKey) return;
  const key = e.key;
  if (key === "t") goToday();
  else if (key === "j" || key === "ArrowRight" || key === "ArrowDown") { e.preventDefault(); move(1); }
  else if (key === "k" || key === "ArrowLeft" || key === "ArrowUp") { e.preventDefault(); move(-1); }
  else if (key === "d") setView("day");
  else if (key === "w") setView("week");
  else if (key === "m") setView("month");
  else if (key === "a") setView("agenda");
  else if (key === "c") openCreate();
  else if (key === "/") { e.preventDefault(); toggleSearch(); }
  else if (key === "?" || (key === "/" && e.shiftKey)) openHelp();
  else if (key === "J") { e.preventDefault(); joinNext(); }
}

boot();
