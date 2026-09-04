# The two QR codes

Both point at the deployment at `business-operator-ivory.vercel.app`. **If that address ever
changes, regenerate them** — the codes contain the address, not a redirect to it.

| File | Scans to | For |
|---|---|---|
| `samaritan-industrial-app.*` | `/download` | Installing the Android app |
| `samaritan-industrial-site.*` | `/` | Opening the system in any browser |

`.png` for messaging and screens, `.svg` for print — the SVG stays sharp at any size, so use it
for anything larger than a business card.

**The app code never goes stale.** It points at `/download`, which looks up whichever build is
current and redirects. Publish a new APK and every printed sticker keeps working untouched.

## Printing

They are generated at the highest error correction, so they still scan with a scuff, a fold or
a shop-counter thumbprint across a corner. Keep them at least 3cm square on paper, leave the
white margin alone, and never print them on a dark background.

## Regenerating

The Settings screen inside the app draws both codes live from whatever address it is being
served on, with a **Save this code as a picture** button under each — that is the easiest way,
and it cannot get the address wrong.

To make them from a terminal instead:

```bash
pip install segno
python3 - <<'PY'
import segno
BASE = "https://your-address-here"
for name, url in [("app", BASE + "/download"), ("site", BASE + "/")]:
    q = segno.make(url, error='h')
    q.save(f"samaritan-industrial-{name}.png", scale=12, border=4, dark="#111111", light="#FFFFFF")
    q.save(f"samaritan-industrial-{name}.svg", scale=12, border=4, dark="#111111", light="#FFFFFF")
PY
```
