/** Placeholder until Steve pastes his own OAuth client id in the app. */
export const PLACEHOLDER_CLIENT_ID = "YOUR_CLIENT_ID.apps.googleusercontent.com";

/** Steve's home zone. The grid always renders in this zone. */
export const HOME_TZ = "America/Chicago";

/**
 * Wyzant ICS import. Times on this feed show up about 2 hours later than the
 * real lesson; the app corrects that on screen only and never writes to it.
 */
export const WYZANT_CALENDAR_ID =
  "jpk68n5f9dhntavi9oc0hsmh7tpu0bm6@import.calendar.google.com";

export const WYZANT_DEFAULT_OFFSET_HOURS = -2;

export const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/drive.appdata",
].join(" ");

/** Origin Steve must add on the Web OAuth client. Path is not part of the origin. */
export const AUTHORIZED_JS_ORIGIN = "https://axiom-mathematics.github.io";

export const DRIVE_SETTINGS_NAME = "axiom-calendar-settings.json";

export const LS = {
  clientId: "axiom.calendar.clientId",
  settings: "axiom.calendar.settings",
  view: "axiom.calendar.view",
  anchor: "axiom.calendar.anchor",
  signedIn: "axiom.calendar.signedIn",
};
