# SingStar Party – setup from your phone

Everything below works in Safari on an iPhone. Never paste passwords anywhere except the official login pages.
Tip: on github.com, use **aA → Request Desktop Website** if a settings page is missing.

## What's in this repo
- `docs/` – the web apps (hosted free on GitHub Pages)
  - `tv.html` – TV screen: lyrics, scores, pitch lines, QR code to join
  - `mic.html` – phone microphone (any phone, no install)
- `app/` – optional iOS app (Expo) that wraps the mic page; built in the cloud and delivered via TestFlight
- `.github/workflows/ios-build.yml` – cloud build → TestFlight

---

## Part 1 – Web apps (required, ~10 min)

1. **Turn on GitHub Pages**: repo → Settings → Pages → Source: *Deploy from a branch* → Branch `main`, folder `/docs` → Save.
   After ~1 min your site is at `https://<github-user>.github.io/<repo>/`.
2. **Create a Spotify app**: open <https://developer.spotify.com/dashboard> (log in with your **Premium** account) → *Create app*
   - Name/description: anything, e.g. "SingStar Party"
   - Redirect URIs – add both:
     - `https://<github-user>.github.io/<repo>/tv.html`
     - `https://<github-user>.github.io/<repo>/mic.html`
   - API: tick **Web API** → Save
   - Copy the **Client ID** (not the secret). Put it in `docs/config.js`, or just send it to Claude.
3. **Play**
   - On the TV browser open `https://<github-user>.github.io/<repo>/tv.html`
   - Scan the QR code with each phone → enter name → *Join & start microphone*
   - Tap **Connect Spotify** on one phone (or on the TV) once – the login is remembered on the TV
   - Open Spotify on a speaker / phone / TV app (Spotify Connect) so there is an active device
   - Search a song on a phone → **Sing**

Lyrics timing off? Use *Earlier/Later* on a phone, or ◀ ▶ on the TV remote.

---

## Part 2 – iOS app via TestFlight (optional, ~20 min)

All values go into the repo: **Settings → Secrets and variables → Actions**.

| Where to get it | Add as | Name |
|---|---|---|
| expo.dev → sign up → *Create project* named `singstar-mic` → copy **Project ID** | Variable | `EAS_PROJECT_ID` |
| your expo.dev username | Variable | `EXPO_OWNER` |
| expo.dev → Account settings → *Access tokens* → Create | Secret | `EXPO_TOKEN` |
| developer.apple.com/account → Membership details → **Team ID** | Secret | `APPLE_TEAM_ID` |
| App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys → **+** (access: *Admin*) → **Key ID** | Secret | `ASC_KEY_ID` |
| same page → **Issuer ID** | Secret | `ASC_ISSUER_ID` |
| same key → *Download* (.p8, only possible once) → open in Files, copy the whole text incl. BEGIN/END lines | Secret | `ASC_API_KEY_P8` |

Then create the app record:
1. developer.apple.com → Certificates, IDs & Profiles → Identifiers → **+** → App IDs → App → Bundle ID (explicit) `de.sascha.singstarmic`
   (want a different ID? also add Variable `BUNDLE_ID` with that value)
2. appstoreconnect.apple.com → Apps → **+ New App** → iOS, name "SingStar Mic", pick that bundle ID, SKU `singstarmic`
3. In the new app → App Information → copy **Apple ID** (a number) → Variable `ASC_APP_ID`
4. If your developer account is a company account, add Variable `APPLE_TEAM_TYPE` = `COMPANY_OR_ORGANIZATION`

Build: repo → **Actions** → *iOS build → TestFlight* → **Run workflow**. It takes ~20–30 min, then Apple processes the build (another ~10–30 min).
Install the **TestFlight** app and accept the build (you're automatically an internal tester as account owner).

---

## How scoring works
Spotify doesn't provide melody data, so this isn't note-by-note SingStar scoring. Each sung lyric line is scored on
**how much of the line you actually sing** (timing) and **how steady your pitch is**. 10,000 points per song max.

## Known limits
- Spotify **Premium** is required; the Spotify app runs in Development Mode (only you need to log in – guests don't).
- Lyrics come from LRCLIB (free community database). Some songs have no synced lyrics → no scoring for those.
- Phones connect to the TV via a free public relay (PeerJS) and WebRTC; phones and TV should be on the same Wi-Fi.
- Keep music on a speaker/TV, not on a singer's phone – the mic would pick it up. Adjust *Mic sensitivity* if the
  pitch line reacts to the music.
