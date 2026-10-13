# Axiom Calendar setup

The app is a static page. It talks to Google Calendar from the browser. There is no server. Steve signs in with `stephen.kaminskie@gmail.com`.

After this repo’s `calendar/` folder is on `main`, the app is:

https://axiom-mathematics.github.io/axiom-whiteboard/calendar/

## 1. Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (for example **Axiom Calendar**) or pick an existing one.
3. **APIs & Services → Library**, and enable:
   - Google Calendar API
   - People API (so a contact’s address can suggest a time zone)
   - Google Drive API (so contact time zones and the Wyzant offset sync across devices, in a private app-data file)

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External**. Create the app.
3. App name: `Axiom Calendar`.
4. User support email and developer contact: `stephen.kaminskie@gmail.com`.
5. Save and continue through scopes. The app asks for these at sign-in:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/contacts.readonly`
   - `https://www.googleapis.com/auth/drive.appdata`
6. **Test users → Add users** → `stephen.kaminskie@gmail.com`.

Leave the app in **Testing**. The Calendar scope is restricted; a personal test user does not need Google’s verification review. If a later sign-in says the app isn’t verified, continue as the test user you added. Testing grants expire after about 7 days, and iPhone Safari often blocks a silent refresh, so if the calendar asks you to sign in again, tap **Sign in with Google**.

## 3. Web OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Axiom Calendar web`.
4. **Authorized JavaScript origins** — add exactly:

   `https://axiom-mathematics.github.io`

   The path (`/axiom-whiteboard/calendar/`) is not part of the origin. Do not put a trailing slash on the origin.

5. **Authorized redirect URIs** — leave this empty. Sign-in uses the Google Identity Services token popup, which does not use a redirect URI. If the form will not save with the field empty, add `https://axiom-mathematics.github.io` there too.

6. Create, and copy the **Client ID**. It ends with `.apps.googleusercontent.com`.

Optional, only if you open the app on your own computer: also add `http://localhost:8080` (the exact port you use) as a JavaScript origin.

## 4. Paste the client ID

1. Open https://axiom-mathematics.github.io/axiom-whiteboard/calendar/
2. Paste the client ID into the field on the sign-in screen.
3. Tap **Sign in with Google** and choose `stephen.kaminskie@gmail.com`.
4. If the browser blocks the popup, allow popups for `axiom-mathematics.github.io` and tap Sign in again.
5. On iPhone, the first sign-in has to be a tap (Safari blocks the Google window otherwise). To install it: Share → **Add to Home Screen**.

The client ID is stored in this browser only (`localStorage`). It is not written into the repo.

## What the app does

- Day, week, month, and agenda, always in **America/Chicago**. `t` jumps to today, `j`/`k` or the arrow keys move, `d` `w` `m` `a` switch views, `c` creates, `/` searches, `?` lists shortcuts, `Cmd/Ctrl-K` opens the command bar.
- Quick add: `Algebra w/ Maya tue 4pm 1h`, `lunch tomorrow noon`. `with meet` or `video call` adds a Meet link.
- Every calendar on the account is listed, with Google’s own color. Uncheck one to hide it (that updates `calendarList.selected`).
- Create, edit, delete, drag to move or resize on a desktop mouse, and RSVP. Recurring edits can be this event, this and following, or all events.
- **Join Meet** uses the event’s `conferenceData` video link, or `hangoutLink`. A camera icon sits on the event; it turns into a Join chip when the event is in progress or starts within 10 minutes. `Shift+J` or the command **Join next meeting** opens Meet in a new tab (on iPhone that hands off to the Meet app). The editor can add or remove a Meet conference. Recording, captions, and breakout rooms stay inside Meet; this app only creates the calendar conference.
- Event color: the wheel and the 11 Google swatches. A custom color is stored as `extendedProperties.private.axiomColor` and the nearest of Google’s 11 `colorId`s is sent so Google’s own apps stay close. Colors are never changed unless you pick one, or you duplicate an event (the copy keeps `colorId` and the custom hex).
- Other people’s local times show next to Chicago time when a zone is already known: from the contact’s address, from an invite they organized (`start.timeZone`, when it isn’t Chicago), or from a clear place in the title or location. Nothing asks you to confirm. Settings → Contact time zones is there if you want to set one yourself.
- The Wyzant feed `jpk68n5f9dhntavi9oc0hsmh7tpu0bm6@import.calendar.google.com` is shown **2 hours earlier** than Google stored it, with the badge “Wyzant times adjusted -2h”. Change or turn off that shift in Settings. The app never writes to that calendar, and it never writes to any calendar that has a display offset, so the correction cannot be saved back onto the feed.

Contact zones and offsets are cached in the browser and, when the Drive app-data scope is granted, in a private file named `axiom-calendar-settings.json`. Settings can export or import that JSON.
