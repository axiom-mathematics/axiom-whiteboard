import { HOME_TZ } from "../config.js";
import { isValidTimeZone } from "./time.js";
import { firstName, fold } from "./util.js";

export const SOURCE_RANK = { manual: 100, people: 30, invite: 20, city: 10 };

/** Single-zone US states. Split states are omitted on purpose. */
const STATE_ZONE = {
  CT: "America/New_York", DE: "America/New_York", GA: "America/New_York",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York",
  NC: "America/New_York", OH: "America/New_York", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", VT: "America/New_York",
  VA: "America/New_York", WV: "America/New_York", DC: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago",
  IA: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", OK: "America/Chicago",
  WI: "America/Chicago",
  CO: "America/Denver", MT: "America/Denver", NM: "America/Denver",
  UT: "America/Denver", WY: "America/Denver",
  CA: "America/Los_Angeles", NV: "America/Los_Angeles", WA: "America/Los_Angeles",
  HI: "Pacific/Honolulu",
  AZ: "America/Phoenix",
};

const STATE_NAME = {
  connecticut: "CT", delaware: "DE", georgia: "GA", maine: "ME", maryland: "MD",
  massachusetts: "MA", "new hampshire": "NH", "new jersey": "NJ", "new york": "NY",
  "north carolina": "NC", ohio: "OH", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", vermont: "VT", virginia: "VA", "west virginia": "WV",
  "district of columbia": "DC", washington: "WA",
  alabama: "AL", arkansas: "AR", illinois: "IL", iowa: "IA", louisiana: "LA",
  minnesota: "MN", mississippi: "MS", missouri: "MO", oklahoma: "OK", wisconsin: "WI",
  colorado: "CO", montana: "MT", "new mexico": "NM", utah: "UT", wyoming: "WY",
  california: "CA", nevada: "NV", hawaii: "HI", arizona: "AZ",
  // Split states — recognized so a city can use them, but they have no single zone.
  florida: "FL", michigan: "MI", indiana: "IN", kentucky: "KY", tennessee: "TN",
  "north dakota": "ND", "south dakota": "SD", nebraska: "NE", kansas: "KS",
  texas: "TX", oregon: "OR", idaho: "ID", alaska: "AK",
};

/** ISO country → zone, only where the country is a single zone for practical purposes. */
const COUNTRY = {
  CH: "Europe/Zurich", DE: "Europe/Berlin", FR: "Europe/Paris", IT: "Europe/Rome",
  GB: "Europe/London", UK: "Europe/London", IE: "Europe/Dublin", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", AT: "Europe/Vienna", SE: "Europe/Stockholm", NO: "Europe/Oslo",
  DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw", CZ: "Europe/Prague",
  HU: "Europe/Budapest", GR: "Europe/Athens", PT: "Europe/Lisbon",
  JP: "Asia/Tokyo", KR: "Asia/Seoul", CN: "Asia/Shanghai", IN: "Asia/Kolkata",
  SG: "Asia/Singapore", HK: "Asia/Hong_Kong", TW: "Asia/Taipei", TH: "Asia/Bangkok",
  VN: "Asia/Ho_Chi_Minh", PH: "Asia/Manila", MY: "Asia/Kuala_Lumpur",
  NZ: "Pacific/Auckland", ZA: "Africa/Johannesburg", IL: "Asia/Jerusalem",
  AE: "Asia/Dubai", TR: "Europe/Istanbul", EG: "Africa/Cairo",
  AR: "America/Argentina/Buenos_Aires", CL: "America/Santiago", CO: "America/Bogota",
  PE: "America/Lima", NG: "Africa/Lagos", KE: "Africa/Nairobi",
};

const COUNTRY_NAME = {
  switzerland: "CH", swiss: "CH", germany: "DE", france: "FR", italy: "IT",
  "united kingdom": "GB", uk: "GB", britain: "GB", england: "GB", scotland: "GB", wales: "GB",
  ireland: "IE", netherlands: "NL", holland: "NL", belgium: "BE", austria: "AT",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", poland: "PL",
  czechia: "CZ", "czech republic": "CZ", hungary: "HU", greece: "GR", portugal: "PT",
  japan: "JP", "south korea": "KR", korea: "KR", china: "CN", india: "IN",
  singapore: "SG", "hong kong": "HK", taiwan: "TW", thailand: "TH", vietnam: "VN",
  philippines: "PH", malaysia: "MY", "new zealand": "NZ", "south africa": "ZA",
  israel: "IL", "united arab emirates": "AE", turkey: "TR", egypt: "EG",
};

/**
 * Unambiguous cities. Keys are folded (lowercase, no accents).
 * Ambiguous names (Paris, Portland, London, Springfield…) live in AMBIGUOUS.
 */
const CITY = {
  zurich: "Europe/Zurich", geneve: "Europe/Zurich", geneva: "Europe/Zurich",
  bern: "Europe/Zurich", basel: "Europe/Zurich", lausanne: "Europe/Zurich",
  lucerne: "Europe/Zurich", luzern: "Europe/Zurich", lugano: "Europe/Zurich",
  winterthur: "Europe/Zurich",
  "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles",
  "san diego": "America/Los_Angeles", "san jose": "America/Los_Angeles",
  sacramento: "America/Los_Angeles", oakland: "America/Los_Angeles",
  berkeley: "America/Los_Angeles", "palo alto": "America/Los_Angeles",
  "mountain view": "America/Los_Angeles", sunnyvale: "America/Los_Angeles",
  "santa monica": "America/Los_Angeles", irvine: "America/Los_Angeles",
  pasadena: "America/Los_Angeles", "long beach": "America/Los_Angeles",
  fresno: "America/Los_Angeles", cupertino: "America/Los_Angeles",
  "redwood city": "America/Los_Angeles", "menlo park": "America/Los_Angeles",
  stanford: "America/Los_Angeles", "santa barbara": "America/Los_Angeles",
  "bay area": "America/Los_Angeles", "silicon valley": "America/Los_Angeles",
  seattle: "America/Los_Angeles", bellevue: "America/Los_Angeles",
  tacoma: "America/Los_Angeles", "las vegas": "America/Los_Angeles",
  reno: "America/Los_Angeles",
  houston: "America/Chicago", dallas: "America/Chicago",
  "san antonio": "America/Chicago", "fort worth": "America/Chicago",
  plano: "America/Chicago", irving: "America/Chicago", katy: "America/Chicago",
  "sugar land": "America/Chicago", "the woodlands": "America/Chicago",
  waco: "America/Chicago", lubbock: "America/Chicago",
  chicago: "America/Chicago", naperville: "America/Chicago", evanston: "America/Chicago",
  "new york": "America/New_York", brooklyn: "America/New_York", manhattan: "America/New_York",
  queens: "America/New_York", boston: "America/New_York", miami: "America/New_York",
  atlanta: "America/New_York", philadelphia: "America/New_York",
  "washington dc": "America/New_York", pittsburgh: "America/New_York",
  detroit: "America/New_York",
  raleigh: "America/New_York", cleveland: "America/New_York",
  denver: "America/Denver", boulder: "America/Denver",
  "salt lake city": "America/Denver", albuquerque: "America/Denver",
  "el paso": "America/Denver", phoenix: "America/Phoenix", tucson: "America/Phoenix",
  honolulu: "Pacific/Honolulu",
  edinburgh: "Europe/London",
  munich: "Europe/Berlin", hamburg: "Europe/Berlin",
  frankfurt: "Europe/Berlin", cologne: "Europe/Berlin",
  lyon: "Europe/Paris", marseille: "Europe/Paris",
  milan: "Europe/Rome",
  madrid: "Europe/Madrid", barcelona: "Europe/Madrid",
  amsterdam: "Europe/Amsterdam", brussels: "Europe/Brussels",
  vienna: "Europe/Vienna", stockholm: "Europe/Stockholm", oslo: "Europe/Oslo",
  copenhagen: "Europe/Copenhagen", helsinki: "Europe/Helsinki",
  warsaw: "Europe/Warsaw", prague: "Europe/Prague", budapest: "Europe/Budapest",
  athens: "Europe/Athens", lisbon: "Europe/Lisbon", dublin: "Europe/Dublin",
  tokyo: "Asia/Tokyo", seoul: "Asia/Seoul", beijing: "Asia/Shanghai",
  shanghai: "Asia/Shanghai", mumbai: "Asia/Kolkata", delhi: "Asia/Kolkata",
  bangalore: "Asia/Kolkata", bengaluru: "Asia/Kolkata", singapore: "Asia/Singapore",
  "hong kong": "Asia/Hong_Kong", taipei: "Asia/Taipei", bangkok: "Asia/Bangkok",
  "ho chi minh": "Asia/Ho_Chi_Minh", manila: "Asia/Manila",
  melbourne: "Australia/Melbourne",
  toronto: "America/Toronto", ottawa: "America/Toronto", montreal: "America/Toronto",
  vancouver: "America/Vancouver", calgary: "America/Edmonton",
};

/**
 * Cities that are also common in more than one zone, or that are common
 * given names. They only count when a region or country in the same text agrees.
 */
const AMBIGUOUS = {
  portland: { or: "America/Los_Angeles", me: "America/New_York" },
  springfield: { il: "America/Chicago", mo: "America/Chicago", ma: "America/New_York" },
  paris: { fr: "Europe/Paris", france: "Europe/Paris", tx: "America/Chicago" },
  london: { gb: "Europe/London", uk: "Europe/London", england: "Europe/London", on: "America/Toronto", ky: "America/New_York" },
  birmingham: { gb: "Europe/London", uk: "Europe/London", al: "America/Chicago" },
  richmond: { va: "America/New_York", bc: "America/Vancouver" },
  columbus: { oh: "America/New_York", ga: "America/New_York" },
  georgetown: {},
  oxford: { gb: "Europe/London", uk: "Europe/London", ms: "America/Chicago" },
  cambridge: { gb: "Europe/London", uk: "Europe/London", ma: "America/New_York" },
  dublin: { ie: "Europe/Dublin", ireland: "Europe/Dublin", oh: "America/New_York" },
  manchester: { gb: "Europe/London", uk: "Europe/London", nh: "America/New_York" },
  sydney: { au: "Australia/Sydney", australia: "Australia/Sydney" },
  florence: { it: "Europe/Rome", italy: "Europe/Rome" },
  naples: { it: "Europe/Rome", italy: "Europe/Rome", fl: "America/New_York" },
  athens: { gr: "Europe/Athens", greece: "Europe/Athens", ga: "America/New_York" },
  berlin: { de: "Europe/Berlin", germany: "Europe/Berlin" },
  rome: { it: "Europe/Rome", italy: "Europe/Rome", ga: "America/New_York" },
  venice: { it: "Europe/Rome", italy: "Europe/Rome" },
  moscow: { ru: "Europe/Moscow", id: "America/Los_Angeles" },
  austin: { tx: "America/Chicago", texas: "America/Chicago" },
  charlotte: { nc: "America/New_York" },
  jordan: {},
  georgia: { country: "Asia/Tbilisi", us: "America/New_York" },
};

const ABBREV = [
  [/\b(PST|PDT)\b/, "America/Los_Angeles"],
  [/\bPacific Time\b/i, "America/Los_Angeles"],
  [/\b(MST|MDT)\b/, "America/Denver"],
  [/\bMountain Time\b/i, "America/Denver"],
  [/\b(CST|CDT)\b/, "America/Chicago"],
  [/\bCentral Time\b/i, "America/Chicago"],
  [/\b(EST|EDT)\b/, "America/New_York"],
  [/\bEastern Time\b/i, "America/New_York"],
  [/\b(CET|CEST)\b/, "Europe/Berlin"],
  [/\b(GMT|BST)\b/, "Europe/London"],
  [/\bHST\b/, "Pacific/Honolulu"],
];

const PHRASES = [
  [/\b(switzerland|swiss|zurich|zuerich|zurich|geneva|geneve|bern|basel|lausanne)\b/i, "Europe/Zurich", "Switzerland"],
  [/\b(california|los angeles|san francisco|bay area|silicon valley)\b/i, "America/Los_Angeles", "California"],
  [/\b(houston)\b/i, "America/Chicago", "Houston"],
  [/\b(new york city|new york)\b/i, "America/New_York", "New York"],
];

function regionKeys(text) {
  const f = ` ${fold(text)} `;
  const keys = new Set();
  for (const [name, abbr] of Object.entries(STATE_NAME)) {
    if (f.includes(` ${name} `)) keys.add(abbr.toLowerCase());
  }
  const abbr = text.match(/\b([A-Z]{2})\b/g) || [];
  for (const a of abbr) keys.add(a.toLowerCase());
  for (const [name, code] of Object.entries(COUNTRY_NAME)) {
    if (f.includes(` ${name} `)) keys.add(code.toLowerCase());
  }
  const countryCode = text.match(/\b([A-Z]{2})\b/g) || [];
  for (const c of countryCode) if (COUNTRY[c]) keys.add(c.toLowerCase());
  return keys;
}

function cityInText(folded, city) {
  const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(folded);
}

function lookupCity(folded, keys) {
  const names = Object.keys(CITY).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (!cityInText(folded, name)) continue;
    if (AMBIGUOUS[name]) {
      const row = AMBIGUOUS[name];
      for (const key of keys) {
        if (row[key]) return { timeZone: row[key], label: titleCase(name) };
      }
      continue;
    }
    return { timeZone: CITY[name], label: titleCase(name) };
  }
  for (const name of Object.keys(AMBIGUOUS)) {
    if (!cityInText(folded, name)) continue;
    const row = AMBIGUOUS[name];
    for (const key of keys) {
      if (row[key]) return { timeZone: row[key], label: titleCase(name) };
    }
  }
  return null;
}

function titleCase(name) {
  return name.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Confident place → zone.
 * Titles only match strong phrases ("in Zurich", "Zurich time", country names,
 * timezone abbreviations). Locations also match unambiguous city names.
 */
export function zoneFromText(text, { field = "location" } = {}) {
  if (!text || !String(text).trim()) return null;
  const original = String(text);

  if (field === "title") {
    for (const [re, timeZone, label] of PHRASES) {
      const contextual = new RegExp(
        `(?:\\b(?:in|at|from)\\s+${re.source.replace(/^\^?\\b/, "").replace(/\\b$/, "")}|${re.source}\\s+time|\\(${re.source}\\))`,
        re.flags.includes("i") ? "i" : "",
      );
      if (contextual.test(original) || re.test(original) && /switzerland|swiss|california|bay area|silicon valley|los angeles|san francisco|new york/i.test(original)) {
        const m = original.match(re);
        if (m && (field === "title")) {
          const strong = /\b(switzerland|swiss|california|los angeles|san francisco|bay area|new york)\b/i.test(m[0])
            || new RegExp(`(?:\\b(?:in|at|from)\\s+${m[0]}|${m[0]}\\s+time)`, "i").test(original);
          if (strong) return { timeZone, label: label || m[0], source: "city" };
        }
      }
    }
    const inPlace = original.match(/\b(?:in|at|from)\s+([A-Z][\p{L}]+(?:\s+[A-Z][\p{L}]+)?)/u);
    if (inPlace) {
      const hit = lookupCity(fold(inPlace[1]), regionKeys(original));
      if (hit) return { ...hit, source: "city" };
    }
    for (const [re, timeZone] of ABBREV) {
      if (re.test(original)) return { timeZone, label: zoneLabel(timeZone), source: "city" };
    }
    return null;
  }

  for (const [re, timeZone] of ABBREV) {
    if (re.test(original)) return { timeZone, label: zoneLabel(timeZone), source: "city" };
  }
  const folded = fold(original);
  for (const [name, code] of Object.entries(COUNTRY_NAME)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(folded)) {
      const zone = COUNTRY[code];
      if (zone) return { timeZone: zone, label: titleCase(name), source: "city" };
    }
  }
  const city = lookupCity(folded, regionKeys(original));
  if (city) return { ...city, source: "city" };
  for (const key of regionKeys(original)) {
    const up = key.toUpperCase();
    if (STATE_ZONE[up]) return { timeZone: STATE_ZONE[up], label: up, source: "city" };
    if (COUNTRY[up]) return { timeZone: COUNTRY[up], label: up, source: "city" };
  }
  return null;
}

function zoneLabel(timeZone) {
  if (timeZone === "America/Los_Angeles") return "Pacific";
  if (timeZone === "America/Denver") return "Mountain";
  if (timeZone === "America/Chicago") return "Central";
  if (timeZone === "America/New_York") return "Eastern";
  if (timeZone === "Europe/Berlin" || timeZone === "Europe/Zurich") return "Central Europe";
  if (timeZone === "Europe/London") return "UK";
  return timeZone.split("/").pop().replace(/_/g, " ");
}

export function zoneFromAddress(address) {
  if (!address) return null;
  const city = fold(address.city || "");
  const region = fold(address.region || "");
  const countryCode = String(address.countryCode || "").toUpperCase();
  const countryName = fold(address.country || "");
  const keys = new Set();
  if (STATE_NAME[region]) keys.add(STATE_NAME[region].toLowerCase());
  if (/^[a-z]{2}$/.test(region)) keys.add(region);
  if (countryCode) keys.add(countryCode.toLowerCase());
  if (COUNTRY_NAME[countryName]) keys.add(COUNTRY_NAME[countryName].toLowerCase());

  if (city) {
    if (AMBIGUOUS[city]) {
      const row = AMBIGUOUS[city];
      for (const key of keys) if (row[key]) return row[key];
    } else if (CITY[city]) {
      return CITY[city];
    } else {
      const hit = lookupCity(city, keys);
      if (hit) return hit.timeZone;
    }
  }
  const abbr = region.length === 2 ? region.toUpperCase() : STATE_NAME[region];
  if (abbr && STATE_ZONE[abbr]) return STATE_ZONE[abbr];
  if (countryCode && COUNTRY[countryCode]) return COUNTRY[countryCode];
  const byName = COUNTRY_NAME[countryName];
  if (byName && COUNTRY[byName]) return COUNTRY[byName];
  return null;
}

const STOP = new Set(["meet", "google", "video", "call", "the", "a", "an", "lesson", "algebra", "math", "maths", "calculus", "geometry", "reading", "science", "english", "history", "physics", "chemistry", "biology", "sat", "act", "homework", "session", "class", "office", "lunch", "dinner", "breakfast", "coffee", "zoom", "team", "group", "parents", "parent", "student", "room", "tutor", "tutoring"]);

export function partnerNames(title) {
  const text = String(title || "");
  const re = /\b(?:w\/|with|tutoring)\s+([\p{Lu}][\p{L}'’-]{1,40}(?:\s+[\p{Lu}][\p{L}'’-]{1,40})?)/gu;
  const names = [];
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    const given = fold(name.split(/\s+/)[0]);
    if (STOP.has(given)) continue;
    names.push(name);
  }
  return names;
}

export function indexPeople(people) {
  const byEmail = new Map();
  const groups = new Map();
  const addName = (key, rec) => {
    const k = fold(key);
    if (!k) return;
    if (!groups.has(k)) groups.set(k, []);
    const list = groups.get(k);
    if (!list.some((r) => r.email === rec.email)) list.push(rec);
  };
  for (const person of people || []) {
    const names = person.names || [];
    const primary = names.find((n) => n.metadata?.primary) || names[0] || {};
    const display = primary.displayName || "";
    const given = primary.givenName || display.split(/\s+/)[0] || "";
    let timeZone = null;
    for (const addr of person.addresses || []) {
      const z = zoneFromAddress(addr);
      if (z) { timeZone = z; break; }
    }
    const emails = person.emailAddresses || person.emails || [];
    for (const em of emails) {
      const email = String(em.value || em.email || "").toLowerCase();
      if (!email || !email.includes("@")) continue;
      const rec = { email, name: display || email, given, timeZone };
      byEmail.set(email, rec);
      addName(display, rec);
      addName(given, rec);
      if (primary.familyName) addName(`${given} ${primary.familyName}`, rec);
    }
  }
  return { byEmail, byName: groups };
}

function organizerEmail(event) {
  return String(event?.organizer?.email || event?.creator?.email || "").toLowerCase();
}

function bestSignal(signals) {
  if (!signals.length) return null;
  const top = Math.max(...signals.map((s) => s.rank));
  const winners = signals.filter((s) => s.rank === top);
  const zones = new Set(winners.map((s) => s.timeZone));
  if (zones.size !== 1) return null;
  return winners[0];
}

export function inferUpdates(events, ctx) {
  const updates = [];
  const self = String(ctx.selfEmail || "").toLowerCase();
  const people = ctx.peopleIndex || { byEmail: new Map(), byName: new Map() };
  for (const event of events || []) {
    if (!event || event.status === "cancelled") continue;
    const attendees = (event.attendees || [])
      .map((a) => ({ ...a, email: String(a.email || "").toLowerCase() }))
      .filter((a) => a.email && a.email !== self && !a.resource);
    const targets = attendees.length
      ? attendees.map((a) => ({ email: a.email, name: a.displayName || a.email }))
      : nameTargets(event.summary, people);

    const place = zoneFromText(event.location, { field: "location" })
      || zoneFromText(event.summary, { field: "title" });
    const org = organizerEmail(event);
    const inviteTz = event.start?.timeZone;

    for (const target of targets) {
      const signals = [];
      const person = people.byEmail.get(target.email);
      if (person?.timeZone && isValidTimeZone(person.timeZone)) {
        signals.push({ source: "people", timeZone: person.timeZone, rank: SOURCE_RANK.people });
      }
      if (org && org === target.email && org !== self && isValidTimeZone(inviteTz) && inviteTz !== HOME_TZ) {
        signals.push({ source: "invite", timeZone: inviteTz, rank: SOURCE_RANK.invite });
      }
      if (targets.length === 1 && place && place.timeZone !== HOME_TZ) {
        signals.push({ source: "city", timeZone: place.timeZone, rank: SOURCE_RANK.city });
      }
      const best = bestSignal(signals);
      if (!best) continue;
      updates.push({
        email: target.email,
        name: person?.name || target.name || target.email,
        timeZone: best.timeZone,
        source: best.source,
      });
    }
  }
  return updates;
}

function nameTargets(title, people) {
  const names = partnerNames(title);
  const found = [];
  for (const name of names) {
    const rec = uniqueByName(name, people.byName);
    if (rec?.email && rec.timeZone) found.push({ email: rec.email, name: rec.name || name });
  }
  return found;
}

function uniqueByName(name, byName) {
  if (!byName) return null;
  const full = byName.get(fold(name)) || [];
  if (full.length === 1) return full[0];
  const given = byName.get(fold(name.split(/\s+/)[0])) || [];
  if (given.length === 1) return given[0];
  return null;
}

export function applyUpdates(settings, updates, nowIso = new Date().toISOString()) {
  let changed = false;
  const contacts = { ...settings.contacts };
  for (const u of updates) {
    if (!u.email || !u.timeZone) continue;
    const prev = contacts[u.email];
    if (prev?.source === "manual") continue;
    if (prev?.timeZone) {
      const pr = SOURCE_RANK[prev.source] || 0;
      const nr = SOURCE_RANK[u.source] || 0;
      if (nr < pr) continue;
      if (nr === pr) continue;
    }
    contacts[u.email] = {
      timeZone: u.timeZone,
      source: u.source,
      name: u.name || prev?.name || "",
      updated: nowIso,
    };
    changed = true;
  }
  return { contacts, changed };
}

export function zoneForEmail(email, ctx) {
  const key = String(email || "").toLowerCase();
  if (!key) return null;
  const saved = ctx.settings?.contacts?.[key];
  if (saved?.source === "manual") {
    return saved.timeZone && isValidTimeZone(saved.timeZone) ? saved.timeZone : null;
  }
  if (saved?.timeZone && isValidTimeZone(saved.timeZone)) return saved.timeZone;
  const person = ctx.peopleIndex?.byEmail?.get(key);
  if (person?.timeZone && isValidTimeZone(person.timeZone)) return person.timeZone;
  return null;
}

export function clocksForEvent(event, ctx) {
  const home = ctx.homeTz || HOME_TZ;
  const self = String(ctx.selfEmail || "").toLowerCase();
  const clocks = [];
  const seen = new Set();
  const push = (label, timeZone) => {
    if (!timeZone || timeZone === home || !isValidTimeZone(timeZone)) return;
    const key = `${label}|${timeZone}`;
    if (seen.has(key)) return;
    seen.add(key);
    clocks.push({ label, timeZone });
  };

  const attendees = (event.attendees || [])
    .filter((a) => a && !a.resource)
    .filter((a) => String(a.email || "").toLowerCase() !== self);
  if (attendees.length) {
    for (const a of attendees) {
      const email = String(a.email || "").toLowerCase();
      const zone = zoneForEmail(email, ctx);
      const saved = ctx.settings?.contacts?.[email];
      const label = firstName(a.displayName) || firstName(saved?.name) || email;
      push(label, zone);
    }
  } else {
    for (const name of partnerNames(event.summary)) {
      const saved = uniqueContactByName(name, ctx.settings);
      const live = uniqueByName(name, ctx.peopleIndex?.byName);
      const zone = saved?.timeZone || live?.timeZone;
      push(firstName(name), zone);
    }
  }
  if (!clocks.length) {
    const place = zoneFromText(event.location, { field: "location" })
      || zoneFromText(event.summary, { field: "title" });
    if (place) push(place.label, place.timeZone);
  }
  return clocks;
}

export function uniqueContactByName(name, settings) {
  const contacts = Object.entries(settings?.contacts || {});
  const full = contacts.filter(([, c]) => fold(c.name) === fold(name) || fold(c.name).startsWith(`${fold(name)} `));
  if (full.length === 1) return { email: full[0][0], ...full[0][1] };
  const given = contacts.filter(([, c]) => fold(firstName(c.name)) === fold(firstName(name)) || fold(c.name) === fold(firstName(name)));
  if (given.length === 1) return { email: given[0][0], ...given[0][1] };
  return null;
}

export function emptyPeopleIndex() {
  return { byEmail: new Map(), byName: new Map() };
}
