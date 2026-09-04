# The Android app

A WebView onto the live site, and deliberately nothing else.

**You almost never need to build this.** Everything the shops use is the website, so a fix or a
feature is on every phone the moment it is deployed. Nobody is sent an APK for an ordinary
change, and there is no update to chase.

Rebuild only when one of these changes:

- `APP_URL` in `MainActivity.java` — the web address the app opens
- `IN_APP_HOSTS` in the same file — the domains allowed to open inside the app

## Building one

You need Android Studio (or the command-line SDK) and the permanent keystore. **The keystore
is not in this repository and must never be.** If a build is signed with a different key,
Android will not install it over the app people already have.

```bash
export SAMIND_KEYSTORE=/secure/path/samaritan.keystore
export SAMIND_KEYSTORE_PASSWORD=...
export SAMIND_KEY_ALIAS=businessoperator
export SAMIND_KEY_PASSWORD=...

./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

Before you build, raise **both** numbers in `app/build.gradle`:

| | |
|---|---|
| `versionCode` | up by at least one, every single time. Android refuses to install over an equal or higher code, and to a shopkeeper that looks like a broken download. |
| `versionName` | what a person reads: `1.3`, `1.4` |

## Publishing it

Sign in as the manager → **Settings → Android app** → enter the version name and code, choose
the `.apk`, press **Upload & publish**.

The file goes from your browser straight to storage (it is far too big to pass through the
API), and the release row is written only once the file has actually landed.

From then on `/download` hands out that build. The printed QR code points at `/download` and
never at a version, so **the sticker on a shop counter is printed once and keeps working**.

## How the update notice works

The app exposes `window.SamaritanApp.versionCode`. The site compares it against the published
release and shows its own update bar when the phone is behind. A browser has no such object,
so a browser is never nagged. If you rename that bridge, the update notice goes silent — the
web side looks for exactly that name.
