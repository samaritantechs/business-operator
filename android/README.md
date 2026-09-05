# The Android app

A WebView onto the live site, and deliberately nothing else.

**You almost never need to build this.** Everything the shops use is the website, so a fix or a
feature is on every phone the moment it is deployed. Nobody is sent an APK for an ordinary
change, and there is no update to chase. The app exists to put an icon on a phone's home screen
and to open full-screen without a browser bar.

Rebuild only when one of these changes:

- `APP_URL` in `MainActivity.java` — the web address the app opens
- `IN_APP_HOSTS` in the same file — the domains allowed to open inside the app

---

## Before the first build: check APP_URL

`MainActivity.java` currently opens:

    https://business-operator-ivory.vercel.app/

**If that is not the address your shops actually use, change it before you build.** It is
compiled into the APK. Getting it wrong means an app that opens the wrong site, and the only
fix is another APK on every handset.

## Making your signing key

Skip this if you already have `samaritan-industrial.jks` somewhere. **There is only ever one.**

Every APK you ever publish must be signed with the same key. Android identifies an app by its
signature, so an update signed with a different key is not an update — it is a stranger, and the
phone refuses it. There is no recovery, no reset, no support line. If the key is lost, every
handset has to uninstall and reinstall by hand.

`keytool` comes with the JDK; if you have Android Studio you already have it. Run this **once**,
from a folder that is **not inside this repository** — your Documents, not the checkout:

```
keytool -genkeypair -v -storetype PKCS12 \
  -keystore samaritan-industrial.jks \
  -alias businessoperator \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Samaritan Techs, O=Samaritan Techs, L=Dar es Salaam, C=TZ"
```

It asks for a password and asks you to confirm it. **That is all it asks.** With PKCS12 there is
no separate key password — the one you type is both.

**Choose a long password with letters and digits only.** No `% $ ^ & | !`. Those characters are
eaten or rewritten by Windows `cmd` and by PowerShell, and the result is a password that looks
right on screen and is not the one that was stored. That failure surfaces weeks later as
"cannot recover key", and the obvious next move — making a new keystore — is the one
irreversible thing on this page.

Then, immediately:

1. **Back up the `.jks` file** somewhere that is not that laptop. It is not replaceable.
2. **Write down the password** with it.
3. Record the fingerprint, so you can always tell whether an APK is really yours:
   `keytool -list -v -keystore samaritan-industrial.jks` — keep the SHA-256 line.

Then copy `keystore.properties.example` to `android/keystore.properties` and fill it in. That
file is git-ignored, and so is `*.jks`.

## Building one

Easiest, and the one to use if you have not done this before: **open the `android/` folder in
Android Studio** and let it finish syncing (the first sync downloads a few hundred MB and takes
a while — it has not hung). Then **Build → Generate Signed App Bundle / APK → APK**, pick your
`.jks`, and choose the **release** variant.

The wizard writes to the *Destination Folder* shown on its own page — by default
`android/app/release/app-release.apk`, which is **not** the same place the command line puts it.
Read that field.

From a terminal instead, with `android/keystore.properties` filled in:

```
cd android
./gradlew assembleRelease            # macOS / Linux
gradlew.bat assembleRelease          # Windows
# -> app/build/outputs/apk/release/app-release.apk
```

You need **JDK 17 or 21**. Android Studio ships one — on Windows
`C:\Program Files\Android\Android Studio\jbr`, on macOS
`/Applications/Android Studio.app/Contents/jbr/Contents/Home`. Do not install the newest JDK you
can find: Gradle 8.14 does not run on the very latest, and the error when it doesn't is
unreadable.

Gradle and the Android plugin are pinned by the files in this folder (`gradlew` +
`gradle/wrapper/` + `build.gradle`), so the build does not depend on what is installed on the
machine. Do not "upgrade Gradle" because something suggests it — AGP 8.7.3 runs on Gradle 8.9 up
to but not including 9.0, and a machine that installs "latest Gradle" gets 9.

**On Windows, keep the checkout out of OneDrive.** Gradle builds inside a synced folder fail
with file-locking errors that look like build bugs.

### Check what you built

Before it goes anywhere near a shop phone:

```
./gradlew signingReport      # what key WOULD be used, in seconds, without building
apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk
```

`apksigner` is in `<Android SDK>/build-tools/<version>/`. The certificate it prints must match
the SHA-256 you recorded when you made the key. **If it prints `CN=Android Debug, O=Android,
C=US`, stop** — that is the throwaway debug key, and handing that APK out is the mistake with no
way back.

A file named `app-release-unsigned.apk` means no keystore was found at all; the build warns
about that too. But a *wrongly*-signed APK is named `app-release.apk` and the build says
BUILD SUCCESSFUL, so the filename is not the check. `apksigner` is.

## The two numbers

| | |
|---|---|
| `versionCode` | a whole number, up by at least one on every build you hand out. Android refuses to install over an equal or higher code, and to a shopkeeper that looks like a broken download. |
| `versionName` | what a person reads: `1.0`, `1.1` |

Both live in `app/build.gradle`. **They currently say `1` and `"1.0"`, because nothing has ever
been published** — the first build is version 1, and there is no rule that it must be higher
than anything.

**Type the same numbers into the publish form.** The app reports its own `versionCode` to the
site, and the site shows its "a newer app is available" bar whenever the published code is
higher than the running one. If the APK says 1 and the release row says 4, every phone is told
it is out of date, forever.

## Publishing it — the automatic way

**You do not have to do any of this by hand.** `.github/workflows/android-apk.yml` builds the
app, signs it, checks what it signed, uploads it and writes the release row. When it finishes,
`/download` hands out the new build and the marketplace button appears on its own.

It runs when anything under `android/` lands on `main`, and on demand from the Actions tab. It
does **not** run when the rest of the system changes, because the app is a window onto the
website and those changes are already on every phone — rebuilding for them would push a
re-install to three hundred handsets for nothing.

`versionCode` is the workflow's run number, so it goes up every time and cannot be forgotten,
and the same number is used for the build and for the release row — they cannot drift apart.

### The one-time setup

Four repository secrets (**Settings → Secrets and variables → Actions**), added once:

| secret | what to paste |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 samaritan-industrial.jks` on Linux, or `base64 -i samaritan-industrial.jks \| pbcopy` on macOS, or `certutil -encode` on Windows |
| `ANDROID_KEYSTORE_PASSWORD` | the password you set above |
| `SUPABASE_URL` | the same value the site uses |
| `SUPABASE_SERVICE_ROLE_KEY` | the same value the site uses |

The keystore never enters the repository — the workflow writes it to a temp file, uses it, and
deletes it whether the build passed or failed. Until the secrets exist the workflow still runs
and still leaves a signed APK on the Actions → Artifacts tab; it just says it could not publish.

You also need a **public** Storage bucket named `app-releases` in Supabase, and
`db/RUN-ME-003-app-releases.sql` run. The script says so plainly if either is missing.

## Publishing it — by hand, if you ever want to

Sign in as the manager → **Settings → Android app** → enter the version name and code, choose
the `.apk`, press **Upload & publish**.

The file goes from your browser straight to storage (it is far too big to pass through the API),
and the release row is written only once the file has actually landed. If the screen says the
`app_releases` table is missing, run `db/RUN-ME-003-app-releases.sql` first.

From then on `/download` hands out that build. The printed QR code points at `/download` and
never at a version, so **the sticker on a shop counter is printed once and keeps working**.

Until something is published, the marketplace simply shows no download button and `/download`
answers a polite "not published yet" page. Nothing is broken by not having an APK.

### Prove the key works before you need it to

After the first APK is installed on **one** phone, and before the other handsets get it: close
the terminal, come back later, bump `versionCode` to 2, build again from your backed-up
keystore, and check that the new APK installs *over* the old one.

That five-minute dry run is the only thing that proves the file, the password and the alias are
all recoverable — while the cost of finding out otherwise is still zero.

## How the update notice works

The app exposes `window.SamaritanApp.versionCode`. The site compares it against the published
release and shows its own update bar when the phone is behind. A browser has no such object, so
a browser is never nagged. If you rename that bridge, the update notice goes silent — the web
side looks for exactly that name.

## What is in this folder

| | |
|---|---|
| `settings.gradle` | makes this a Gradle build at all, and names where dependencies come from |
| `build.gradle` | pins the Android Gradle Plugin version, once |
| `gradle.properties` | AndroidX on, and a daemon heap big enough for a release build |
| `gradlew`, `gradlew.bat`, `gradle/wrapper/` | the pinned Gradle, so the build does not depend on the machine |
| `local.properties.example` | where your Android SDK is — copy, edit, never commit |
| `keystore.properties.example` | where your signing key is — copy, edit, never commit |
| `app/` | the app itself: one activity, one layout's worth of WebView |
