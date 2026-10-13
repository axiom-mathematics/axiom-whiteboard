# Axiom Calendar setup

The app is a static page. It talks to Google Calendar from the browser. There is no server. Steve signs in as **stephen.kaminskie@gmail.com**.

After this pull request is merged, open:

**https://axiom-mathematics.github.io/axiom-whiteboard/calendar/**

The OAuth origin is the site host, without the `/axiom-whiteboard/calendar/` path.

## 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (or pick one you already use). Name it something like `Axiom Calendar`.
3. Go to **APIs & Services → Library**.
4. Search for **Google Calendar API** and click **Enable**.

## 2. Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**.
2. User type: **External** (use Internal only if this is a Workspace org that owns the account).
3. App name: `Axiom Calendar`.
4. User support email: `stephen.kaminskie@gmail.com`.
5. Add the scope `https://www.googleapis.com/auth/calendar`  
   (the consent screen shows it as permission to see and edit calendars you can access).
6. Add test user: `stephen.kaminskie@gmail.com`.
7. Leave publishing status on **Testing**. That is enough for one person. In Testing, only listed test users can sign in, and Google may ask you to sign in again after about a week. You do not need to submit the app for verification.

## 3. Create a Web OAuth client

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Name: `Axiom Calendar Web`.
4. **Authorized JavaScript origins** — add this origin exactly, with `https`, and with no path and no trailing slash:

   `https://axiom-mathematics.github.io`

5. Optional, only if you open the folder on your own computer: also add

   `http://localhost:8080`  
   `http://127.0.0.1:8080`

6. **Authorized redirect URIs:** leave this empty. Sign-in uses the Google Identity Services token popup, which does not use a redirect URI.
7. Create the client and copy the client ID. It ends with `.apps.googleusercontent.com`.

## 4. Paste the client ID into the app

1. Open the calendar.
2. Paste the client ID into the field on the sign-in card (or in Settings).
3. Click **Sign in with Google** and choose `stephen.kaminskie@gmail.com`.
4. Allow calendar access.

The client ID is saved in this browser’s `localStorage` only. The access token stays in `sessionStorage` for the tab and expires in about an hour. Nothing is sent to Axiom or to GitHub.

## What the app reads and writes

Sign-in requests the Calendar scope, then the app calls Google Calendar API v3 directly:

- `calendarList.list` so every calendar can be shown or hidden (Wyzant import, Google Classroom, invited calendars).
- `events.list`, `insert`, `patch`, `delete`, and `move` on calendars Google marks as writer or owner.
- RSVP patches your own attendee response.

Google remains the source of truth. Hiding a calendar here does not change it on Google. Event and calendar colors are shown the way Google sends them. The app does not send `colorId` unless you pick a color in the edit dialog.

## Wyzant times

The import calendar

`jpk68n5f9dhntavi9oc0hsmh7tpu0bm6@import.calendar.google.com`

shows lesson times about two hours later than Wyzant. The app shifts that calendar **−2 hours for display only**, with the badge “Wyzant times adjusted -2h”. Change or turn off the shift in **Settings**. The feed is read-only; the app will not try to write to it.

## Install on iPhone

Open the page in Safari, tap Share, then **Add to Home Screen**. The icon and full-screen window come from the web app manifest.
