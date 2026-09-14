# Touchline

Start here: double-click **start-windows.bat** or **start-mac-linux.command**.

A Fantasy Premier League projection model that installs on your phone.

Projections are built from components — clean-sheet probability from expected goals
conceded, defensive contribution from tackles and interceptions, goals and assists
from xG and xA, all adjusted for fixture difficulty — rather than from points already
scored. Points scored reward luck. A defence can keep three clean sheets it had no
business keeping.

---

## Putting it on your phone

## Running it as a website on your own computer

Double-click **start-windows.bat** (Windows) or **start-mac-linux.command**
(Mac, Linux). A window opens and your browser lands on:

    http://localhost:8000

That is a real http address, served by the included `serve.py`. Browsers treat
`localhost` as a secure origin, so the service worker registers, offline mode
works, and Chrome offers to install the app.

No Python? Get it from python.org/downloads — tick "Add Python to PATH" on
Windows.

The window also prints a second address like `http://192.168.1.24:8000`. Any
phone on the same Wi-Fi can open that and use the site. It will **not** offer to
install, because browsers refuse service workers on a plain LAN address. For
that you need a hosted https address.

---

## Putting it on your phone properly

The app needs https before a phone will install it. Pick one.

### GitHub Pages (free, and the data updates itself)

1. Make a new repository and upload every file in this folder, keeping the structure.
2. Settings → Pages → Source: `Deploy from a branch`, branch `main`, folder `/ (root)`.
3. Wait a minute, then open `https://<your-username>.github.io/<repo>/` on your phone.
4. Settings → Actions → General → Workflow permissions → **Read and write**.
   The included action then rebuilds `data.json` every hour, on its own.

### Netlify (easiest, and the team lookup works)

1. Go to app.netlify.com/drop and drag this whole folder onto the page.
2. Open the address it gives you on your phone.
3. `netlify/functions/fpl.js` is picked up automatically, which makes
   **Rate my team** work reliably.

### Vercel

`vercel deploy` from this folder. `api/fpl.js` becomes the proxy.

### Installing once it's open

- **Android / Chrome** — a banner appears at the top of the app. Tap **Install**.
  If you miss it, use the browser menu → *Install app*.
- **iPhone / Safari** — tap **Share**, then **Add to Home Screen**. iOS gives no
  install prompt, so the app tells you this instead.

It then opens full screen with no browser chrome, keeps its own icon, and works
offline on the last data your phone downloaded.

---

## Keeping the data current

`data.json` is what the app reads. Rebuild it from the live FPL API:

```bash
pip install requests
python3 refresh_fpl_data.py data.json
```

Hourly on your own server:

```
0 * * * * cd /srv/touchline && /usr/bin/python3 refresh_fpl_data.py data.json
```

On GitHub Pages the included action already does this — nothing to set up beyond
the write permission above.

The service worker fetches `data.json` network-first, so a new build reaches the
phone as soon as it has signal, while the cached copy keeps the app usable offline.

---

## Files

| File | What it does |
|---|---|
| `index.html` | Markup, install prompt, offline banner. Carries a fallback copy of the data so the file also works opened on its own. |
| `app.js` | Projection engine, optimiser, rating, all six tabs. |
| `styles.css` | Everything visual. |
| `data.json` | The player, club and fixture snapshot the app reads. |
| `sw.js` | Service worker. Shell cached for offline, data fetched network-first. |
| `manifest.webmanifest` | Name, icons, colours, standalone display. |
| `refresh_fpl_data.py` | Rebuilds `data.json` from the FPL API. |
| `api/fpl.js`, `netlify/functions/fpl.js` | Same-origin proxy so team-ID lookups work. |
| `.github/workflows/refresh.yml` | Hourly data rebuild on GitHub. |
| `serve.py` | Serves the folder at `http://localhost:8000`. |
| `start-windows.bat`, `start-mac-linux.command` | Double-click launchers for the server. |
| `netlify.toml`, `vercel.json` | Correct headers and function routing when deployed. |

---

## What the model does not know

Injuries and suspensions announced since the last data pull. Manager changes.
Rotation before European nights. Penalty-taker changes. Early in a season the
per-90 rates are noisy for anyone with few starts — raise the minutes filter on
the Model tab when a name looks wrong.

There is no market-odds layer. Opta and the odds feeds are licensed and can't be
read from here. The xG, xA, xGC and defensive numbers come from FPL's own API,
which is Opta-derived, and that covers most of what the projection needs.

Not affiliated with the Premier League or Fantasy Premier League.
