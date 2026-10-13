# Axiom Calendar setup

The Google client is already configured. Open the app and tap **Sign in with Google**. Choose `stephen.kaminskie@gmail.com`. There is no client ID to paste.

https://axiom-mathematics.github.io/axiom-whiteboard/calendar/

- Google Cloud project: `secret-canyon-511520-b7`
- OAuth consent screen: **Testing**
- Test user: `stephen.kaminskie@gmail.com`
- The public client ID lives in `calendar/config.js`. It is not a secret. A different ID saved in this browser (`localStorage`, key `axiom.calendar.clientId`) overrides it. Settings → OAuth client ID override. Leave that blank to use the built-in client.

The app is a static page. It talks to Google Calendar from the browser. There is no server.

If Google says the app isn’t verified, continue as the test user above. Testing grants expire after about 7 days, and iPhone Safari often blocks a silent refresh, so if the calendar asks you to sign in again, tap **Sign in with Google**.

If the browser blocks the popup, allow popups for `axiom-mathematics.github.io` and tap Sign in again. On iPhone, the first sign-in has to be a tap. To install it: Share → **Add to Home Screen**.

The authorized JavaScript origin on the Web client is exactly `https://axiom-mathematics.github.io` (no path, no trailing slash). Sign-in uses the Google Identity Services token popup, so no redirect URI is required.

## If the client has to be recreated

1. Open [Google Cloud Console](https://console.cloud.google.com/) in project `secret-canyon-511520-b7`.
2. Enable the Calendar API, People API, and Drive API.
3. OAuth consent screen: External, **Testing**, test user `stephen.kaminskie@gmail.com`. Scopes used at sign-in:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/contacts.readonly`
   - `https://www.googleapis.com/auth/drive.appdata`
4. Create a **Web application** OAuth client. Authorized JavaScript origin: `https://axiom-mathematics.github.io`. Leave redirect URIs empty.
5. Put the new client ID in `calendar/config.js` as `DEFAULT_CLIENT_ID`, or paste it into Settings on a single browser to override the built-in one.

## What the app does

- Day, week, month, and agenda, always in **America/Chicago**. `t` jumps to today, `j`/`k` or the arrow keys move, `d` `w` `m` `a` switch views, `c` creates, `/` searches, `?` lists shortcuts, `Cmd/Ctrl-K` opens the command bar.
- Quick add: `Algebra w/ Maya tue 4pm 1h`, `lunch tomorrow noon`. `with meet` or `video call` adds a Meet link.
- Every calendar on the account is listed, with Google’s own color. Uncheck one to hide it (that updates `calendarList.selected`).
- Create, edit, delete, drag to move or resize on a desktop mouse, and RSVP. Recurring edits can be this event, this and following, or all events.
- **Join Meet** uses the event’s `conferenceData` video link, or `hangoutLink`. A camera icon sits on the event; it turns into a Join chip when the event is in progress or starts within 10 minutes. `Shift+J` or the command **Join next meeting** opens Meet in a new tab (on iPhone that hands off to the Meet app). The editor can add or remove a Meet conference. Recording, captions, and breakout rooms stay inside Meet; this app only creates the calendar conference.
- **Axiom video room** is separate from Google Meet. In the editor, **Add Axiom video room** writes a `room.html?id=` link into the event location (or the description, if the location already has a place). Guests get that link on the invite. The room is peer-to-peer with [PeerJS 1.5.5](https://peerjs.com/), the same library the whiteboard Share button uses, and the same public STUN servers (`stun.l.google.com` and `stun1.l.google.com`). Signaling goes through PeerJS’s free cloud (`0.peerjs.com`); there is no server in this repo. The first person to open the room is the host, and that tab has to stay open. It is meant for a 1:1 lesson. iPhone and iPad Safari can use camera, mic, and chat, but not screen share. **Open whiteboard** on the room page goes to https://axiom-mathematics.github.io/axiom-whiteboard/ — tap Share on the board for the drawing link.
- Some school and mobile networks block peer-to-peer. Settings (and the room’s join screen) can store a TURN relay. A free tier is [Metered Open Relay](https://www.metered.ca/tools/openrelay/): paste the TURN URL, username, and credential they give you. Leave it blank to keep STUN only. The relay is saved in this browser with the other settings. Both sides need a path through; a guest on a strict network may need the same relay saved in their browser.
- Event color: the wheel and the 11 Google swatches. A custom color is stored as `extendedProperties.private.axiomColor` and the nearest of Google’s 11 `colorId`s is sent so Google’s own apps stay close. Colors are never changed unless you pick one, or you duplicate an event (the copy keeps `colorId` and the custom hex).
- Other people’s local times show next to Chicago time when a zone is already known: from the contact’s address, from an invite they organized (`start.timeZone`, when it isn’t Chicago), or from a clear place in the title or location. Nothing asks you to confirm. Settings → Contact time zones is there if you want to set one yourself.
- The Wyzant feed `jpk68n5f9dhntavi9oc0hsmh7tpu0bm6@import.calendar.google.com` is shown **2 hours earlier** than Google stored it, with the badge “Wyzant times adjusted -2h”. Change or turn off that shift in Settings. The app never writes to that calendar, and it never writes to any calendar that has a display offset, so the correction cannot be saved back onto the feed.

Contact zones and offsets are cached in the browser and, when the Drive app-data scope is granted, in a private file named `axiom-calendar-settings.json`. Settings can export or import that JSON.
