# FB Group Scanner

Chrome/Edge Manifest V3 extension that scans Facebook group posts for configured keywords, filters by a "scan after" date, and forwards matches to Telegram or exports them as JSON/CSV.

## Features

- Scan multiple Facebook groups for keyword matches
- Filter posts by "scan after" date (only posts on or after that date)
- Manual scan from popup (current group or all configured groups)
- Scheduled background scans via `chrome.alarms` (while Chrome is running)
- Send matches to a Telegram bot
- Export matches as JSON or CSV

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

Reload the extension in `chrome://extensions` after changes.

## Configuration

Open the extension **Options** page (right-click extension icon → Options, or link from popup):

1. **Groups** — Add Facebook group URLs (`https://www.facebook.com/groups/{id}`)
2. **Keywords** — Add keywords (case-insensitive, OR match)
3. **Scan posts after** — Optional date; only posts on or after this date are included
4. **Schedule** — Enable automatic scans at 30/60/120/240 minute intervals
5. **Telegram** — Bot token + chat ID (optional)
6. **Export** — Download JSON or CSV when matches are found

## Telegram setup

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → copy the bot token
2. Start a chat with your bot (send any message)
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser
4. Find `"chat":{"id":...}` in the JSON response — that's your chat ID
5. Paste token + chat ID in Options → click **Test connection** → **Save**

## Usage

- **Scan current group** — Scans the active tab if it's a Facebook group page
- **Scan all groups** — Opens each configured group in a background tab, scrolls the feed, and collects matches
- Matched posts are deduplicated via stored post IDs (no repeat Telegram/export for the same post)

## How it works

The content script runs on `facebook.com/groups/*` pages and:

1. Intercepts Facebook GraphQL responses to extract post data
2. Falls back to DOM parsing if GraphQL structure changes
3. Auto-scrolls the feed to load more posts
4. Applies date and keyword filters
5. Stops scrolling early when consecutive posts are older than the scan-after date

## Tests

```bash
npm test
```

## Limitations

- **No official Facebook API** — Scraping requires you to be logged in; may break if Facebook changes their UI/API
- **Scheduled scans** only run while Chrome is open (`chrome.alarms` does not wake a closed browser)
- **Terms of service** — Automated scraping may violate Facebook ToS; use at your own risk
- **Private groups** — You must be a member; the extension cannot access groups you haven't joined
- **Rate limiting** — Default scroll settings include delays to reduce load; adjust in Options if needed

## Project structure

```
src/
├── background/service-worker.ts   # Scan orchestration, alarms, Telegram/export dispatch
├── content/facebook-scraper.ts    # GraphQL intercept, scroll, parse, filter
├── popup/                         # Quick scan UI
├── options/                       # Configuration page
└── shared/                        # Types, storage, matchers, export, Telegram client
```

## License

MIT — use responsibly.
