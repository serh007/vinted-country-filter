# Vinted.lt Country Badge & Filter

A lightweight, zero-dependency Tampermonkey / Violentmonkey userscript for **Vinted.lt** (Lithuania) that shows each seller's country right on item cards and provides a compact client-side country filter bar.

## Features

- **Country badges with crisp inline SVG flags** — Renders consistently on Windows, Linux, and macOS without loading external images. Local Lithuania (`LT`) listings are highlighted in green so they stand out immediately from `LV`, `EE`, `PL`, `FI`, `SE`, etc.
- **One-click country filter bar** — Compact floating bar at the bottom of catalog/feed pages:
  - **Click** a country chip to show items only from that country (click again or click **All** to reset).
  - **`Ctrl + Click`** (or `Shift + Click`) to select multiple countries at once (e.g., `LT + LV + EE`).
  - **Hide (`🚫`) or Dim (`👁️`) mode** — Hide mode removes non-matching grid cells cleanly so matching items reflow with zero gaps.
  - **Collapsible (`−`)** — Minimizes to a tiny corner pill; filter preferences persist across pages and reloads.
- **No Cloudflare 403 captcha popups & no login required** — Uses `/api/v2/users/{userId}` with `Accept: application/json` instead of the heavily challenge-gated `/api/v2/items/{itemId}/details` endpoint.
- **Works with any Vinted language** — Reads canonical ISO-2 country codes (`country_iso_code`) and formats names via `Intl.DisplayNames` (no need to switch Vinted to English).
- **Seller-level LRU caching** — Caches by `userId` (not `itemId`) for 14 days in a single bounded `localStorage` key (up to 5,000 sellers). Seeing a seller once resolves all their other listings instantly with zero extra requests.
- **Gentle, rate-limit-friendly pacing** — Viewport-first lazy loading via `IntersectionObserver`, single-stream sequential requests (`800–1200 ms` with random jitter), automatic pause when the browser tab is hidden, and automatic `429` / `Retry-After` backoff.

## How It Works

1. Every rendered Vinted item card already contains the seller's `user.id` inside its React Fiber props (`__reactFiber$...`). The script extracts this ID locally with **0 network requests**.
2. It checks the local seller cache (`vlt_seller_country_cache_v1`). Cached sellers are labeled immediately.
3. For uncached visible cards (or remaining page cards when a country filter is active), it fetches `/api/v2/users/{userId}` with `Accept: application/json`, caches the seller's `country_iso_code` and `city`, and updates all cards belonging to that seller at once.

> **Note on server-side filtering:** Vinted ignores `country_ids[]` query parameters on `vinted.lt` and does not include seller country in catalog search payloads or expose a batch user lookup endpoint. Fetching once per unique seller and caching by seller ID minimizes total requests.

## Installation

1. Install a userscript manager in your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Firefox, Edge, Safari)
   - [Violentmonkey](https://violentmonkey.github.io/) (Chrome, Firefox, Edge)
2. Create a new userscript and paste the contents of [`vinted-lt-country.user.js`](./vinted-lt-country.user.js) (or open its Raw URL directly on GitHub to install in one click).
3. Visit `https://www.vinted.lt/` and browse normally.

## Configuration

All options live in the `CONFIG` object at the top of [`vinted-lt-country.user.js`](./vinted-lt-country.user.js):

| Option | Default | Description |
|---|---|---|
| `DISPLAY_LOCALE` | `'en'` | Language for UI & country names: `'en'`, `'lt'`, `'uk'`, or `'auto'` (follows Vinted's page language) |
| `SHOW_CITY` | `false` | Show seller city alongside country on item badges (e.g., `Lithuania · Vilnius`) |
| `SHORT_CODE` | `false` | Show 2-letter ISO code (`LT`, `PL`, `FI`) instead of full country name on badges |
| `HIGHLIGHT_LOCAL` | `true` | Highlight Lithuania (`LT`) badges in green |
| `SHOW_FILTER_BAR` | `true` | Show the floating bottom country filter bar (`false` for badges-only mode) |
| `DEFAULT_FILTER_COUNTRIES` | `['LT', 'LV', 'EE', 'PL', 'FI', 'SE']` | Core country chips always shown in the filter bar (other detected countries are added automatically) |
| `CONCURRENCY` | `1` | Parallel API requests (keep `1` for gentlest pacing) |
| `REQUEST_DELAY_MS` | `800` | Base delay between requests in milliseconds |
| `REQUEST_JITTER_MS` | `400` | Random extra delay (`0..N` ms) added between requests |
| `CACHE_TTL_DAYS` | `14` | Days to retain cached seller locations |
| `CACHE_MAX_USERS` | `5000` | Maximum sellers stored in the `localStorage` LRU cache |

## Privacy & Disclaimer

- **100% client-side & read-only:** No data is sent to any third-party server, no tracking, no analytics, and no automated actions (no buying, messaging, or favoriting).
- **Unofficial tool:** This project is not affiliated with or endorsed by Vinted. Use responsibly and avoid excessive rapid pagination while filtering.

## License

MIT
