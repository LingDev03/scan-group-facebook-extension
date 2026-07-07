# FB Group Scanner

Chrome/Edge Manifest V3 extension that scans Facebook group posts for configured keywords, filters by a "scan after" date, and forwards matches to Telegram or exports them as JSON/CSV.

## Features

- Scan multiple Facebook groups for keyword matches
- **Parallel scanning** — open 1–4 group tabs at once (configurable)
- **Keyword rules** — AND within each rule, OR between rules (case-insensitive)
- Filter posts by "scan after" date (only posts on or after that date)
- Manual scan from popup (current group or all configured groups)
- **Stop scan** button while a scan is running
- Scheduled background scans via `chrome.alarms` (while Chrome is running)
- Send matches to a Telegram bot (HTML formatting, images when available)
- Export matches as JSON or CSV
- **Settings backup** — import/export configuration as JSON
- Deduplication via stored post IDs (no repeat Telegram/export for the same post)

## Requirements

- Node.js 18+
- Chrome or Edge browser
- Logged into Facebook in the same browser profile

## Install (development)

```bash
npm install
npm run build
```

Load the extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

For development with auto-rebuild:

```bash
npm run dev
```

Reload the extension in `chrome://extensions` after changes. Refresh open Facebook group tabs so the content script picks up updates.

## Configuration

Open the extension **Options** page (right-click extension icon → Options, or link from popup):

1. **Groups** — One group per line: full URL, numeric ID, or slug
2. **Keyword rules** — Comma-separated keywords per rule (all must match). Multiple rules are OR'd
3. **Scan posts after** — Optional date; only posts on or after this date are included
4. **Scan behavior**
   - **Max scrolls** / **Scroll delay** — how deep and how fast to scroll each group feed
   - **Parallel groups** (1–4, default 2) — how many groups to scan at the same time. Higher is faster but uses more RAM; Facebook may rate-limit aggressive scanning
5. **Schedule** — Enable automatic scans at 30/60/120/240 minute intervals
6. **Telegram** — Bot token + chat ID (optional)
7. **Export** — Download JSON or CSV when matches are found
8. **Backup settings** — Export/import full configuration as JSON

## Telegram setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → copy the bot token
2. Start a chat with your bot (send any message)
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser
4. Find `"chat":{"id":...}` in the JSON response — that's your chat ID
5. Paste token + chat ID in Options → click **Test connection** → **Save**

Telegram messages use HTML formatting. Post content is parsed from the Facebook DOM when possible (bold, links, line breaks). Posts with images may be sent as `sendPhoto` with a caption.

## Usage

- **Scan current group** — Scans the active tab if it's a Facebook group page (always one tab)
- **Scan all groups** — Scans configured groups in parallel batches, then sends new matches to Telegram/export
- **Stop scan** — Stops the active scan, closes owned background tabs, and cancels in-progress content scripts
- Progress and completion are shown in the popup; a notification appears when the full run finishes

## How it works

### Content script (`facebook.com/groups/*`)

1. Intercepts Facebook GraphQL responses to extract post data
2. Falls back to DOM parsing; expands **See more** when present
3. Parses message DOM → Telegram HTML (`textHtml`) for richer notifications
4. Auto-scrolls the feed to load more posts
5. Applies date and keyword filters after collection
6. Stops scrolling early when consecutive posts are older than the scan-after date

### Background service worker

1. Queues groups and processes them in **batches** (`scanConcurrency` tabs in parallel)
2. After each group in a batch: dedup → Telegram → export → close tab
3. Uses an offscreen document + alarms to keep the service worker alive during long multi-group scans
4. Persists scan queue to `chrome.storage` and can **resume** after a service worker restart

### Debugging

Filter console logs with `[FB Scanner]`:

- **Facebook tab** (F12) — scroll, DOM/GraphQL capture, filter
- **Service worker** (`chrome://extensions` → Inspect) — queue steps, parallel batches, Telegram, resume

## Tests

```bash
npm test
```

## Limitations

- **No official Facebook API** — Scraping requires you to be logged in; may break if Facebook changes their UI/API
- **Scheduled scans** only run while Chrome is open (`chrome.alarms` does not wake a closed browser)
- **Terms of service** — Automated scraping may violate Facebook ToS; use at your own risk
- **Private groups** — You must be a member; the extension cannot access groups you haven't joined
- **Rate limiting** — Use reasonable scroll delays and parallel group count; Facebook may throttle or challenge heavy use
- **Telegram images** — Facebook image URLs are sometimes rejected by Telegram; text is still sent
- **Formatting** — DOM-based HTML improves readability but is not pixel-perfect vs the Facebook UI
- **Scan scope** — Only loads posts visible while scrolling the feed; not full group history

## Project structure

```
src/
├── background/
│   ├── service-worker.ts    # Scan queue, parallel batches, alarms, Telegram/export
│   └── keep-alive.ts        # Offscreen document during long scans
├── content/
│   └── facebook-scraper.ts  # GraphQL intercept, scroll, DOM parse, filter
├── popup/                   # Scan / stop UI
├── options/                 # Configuration page
└── shared/
    ├── scan-queue.ts        # Persistent multi-group scan queue
    ├── dom-to-telegram-html.ts
    ├── telegram-client.ts
    ├── keyword-matcher.ts
    └── ...
public/
└── offscreen.html           # Keep-alive page for MV3 service worker
```

## License

MIT — use responsibly.
