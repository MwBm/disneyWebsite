# Runbook: UI Components (`src/components/`)

**Theme:** a dark "night sky" palette defined as RGB CSS variables in `src/app/globals.css` (near-black navy background, pale text, cool blue and lavender accents) and mapped onto Tailwind color names (`cream`, `warm`, `space`, `gold`, …) in `tailwind.config.ts`. The names are historical; the values are what count. **Fonts:** Outfit everywhere, loaded by an `@import` in `globals.css` and set as Tailwind's `sans` family. Crowd and wait-time colors come from `src/lib/crowd.ts`.

| Component | Used by |
|---|---|
| `LoadingScreen`, `SpaceBackground`, `Nav` | `src/app/layout.tsx` (every page) |
| `DateForecaster` → `DisneyDatePicker`, `ParkPicker`, `CrowdMeter` | `/` |
| `WaitTimesView` → `DisneyDatePicker`, `ParkPicker`, `RideForecastChart` | `/wait-times` |
| `ParkPicker` | `/calendar` |
| `AccuracyChart` | `/accuracy` |
| `ChatAssistant` → `DisneyDatePicker`, `ChatMarkdown` | `/chat` |
| `PageHeader` | `/wait-times`, `/calendar`, `/accuracy`, `/chat` |

Pages that fetch on load first check `getStartupData(url)` (`src/lib/startup-data.ts`), which the loading screen warms.

---

## `Nav.tsx`

A client component: sticky top nav with a blurred translucent background and the active route highlighted.
- **Links:** Forecast, Wait Times, Calendar, Accuracy, Chat.
- **Mobile:** a menu button (`aria-expanded`) whose menu closes on Escape and on route change.

## `DateForecaster.tsx`

The home page widget:
1. Pick a date with `DisneyDatePicker` (defaults to today in park time) and a park with `ParkPicker`
2. Fetch `/api/forecast?date=YYYY-MM-DD&park=N`, or use the warmed startup response for today
3. Render `CrowdMeter` with `crowdScore`, a stale-data note when `dataQualityOk` is false, an **Add a planning tip** button that fetches `/api/forecast/narration` on demand, and a link to `/wait-times?date=…&park=…`

Shows a loading state while fetching, the API's error message on failure, and a "no forecast data yet" message when the response has no forecasts.

## `CrowdMeter.tsx`

An SVG ring gauge. A Framer Motion spring counts up from 0 to `score`, and the label, color and description come from `crowdLabel(score)`.

**Props:** `{ score: number }` (0–100).

## `ParkPicker.tsx`

A two-button toggle between Disneyland (16) and Disney California Adventure (17), labelled from `PARK_LABELS`; the selected park has `aria-pressed`.

**Props:** `{ value: ParkId, onChange: (parkId: ParkId) => void }`.

## `WaitTimesView.tsx`

The `/wait-times` client view.
- **Props:** `{ initialDate, initialParkId }`, resolved by the page from `?date=` and `?park=`, falling back to today in park time and Disneyland.
- **Fetching:** it fetches `/api/forecast` for the chosen date and park and aborts any in-flight request when either changes, so a slow earlier response can't overwrite the current one.
- **URL:** kept in sync with `history.replaceState`.
- **Display:** a one-line note says how the numbers were produced (`ml`, `historical` or `unavailable`), a stale-data note when `dataQualityOk` is false, a `RideForecastChart` for the selected ride (the highest peak wait by default), and one card per ride sorted by peak wait, each with average and peak waits colored by `waitColor` and its confidence. There are also empty and error states.

## `RideForecastChart.tsx`

Loaded with `next/dynamic` (`ssr: false`). A Recharts `LineChart` of one ride's hourly forecast. It fetches `/api/forecast/rides/[rideId]?date=…&park=…` itself and aborts a stale request when the ride, date or park changes.

**Props:** `{ rideId: number, rideName: string, date: string, parkId: ParkId }`.

## `AccuracyChart.tsx`

A Recharts `LineChart` of predicted (dashed) vs. actual wait for one ride. It fetches `/api/accuracy/rides/[rideId]?park=…` itself (48 points by default), uses the warmed startup response when there is one, and aborts a stale request when the selected ride changes.

**Props:** `{ parkId: number, rideId: number, rideName: string }`.

## `ChatAssistant.tsx`

A client component: the streaming chat UI.
- A `DisneyDatePicker` sets the visit date sent with each message
- POSTs the message history and date to `/api/chat` and replaces the assistant bubble with the accumulated stream text as chunks arrive, rendered through `ChatMarkdown`
- The input is disabled while a reply streams; the send button is also disabled when the input is empty
- Shows an error message on failure; an aborted request is ignored
- Exports `SUGGESTIONS` and a `ChatAssistantHandle` ref (`{ send(text) }`), so the chat page can send a suggested prompt

## `ChatMarkdown.tsx`

Renders the small Markdown subset the chat prompt asks for: `#`–`###` headings (all drawn as one small heading size), paragraphs, ordered and unordered lists, horizontal rules, `**bold**`, `*italic*`, `` `code` `` and links. Links are kept only for `http:` and `https:` URLs. It builds React nodes directly and never sets raw HTML.

**Props:** `{ content: string }`.

## `DisneyDatePicker.tsx`

A client component: a date control with an optional label.
- Previous- and next-day arrows on either side of the date
- Clicking the date (`aria-label` "Change date, currently …") opens an animated calendar popup (Framer Motion `AnimatePresence`) with month navigation
- Closes on an outside click

**Props:** `{ value: string /* yyyy-MM-dd */, onChange: (value: string) => void, label?: string }`.

## `LoadingScreen.tsx`

The full-page overlay on first load, rendered directly by the root layout.
- **Visuals:** 72 light streaks radiating from the center ("Entering hyperspace") over a radial gradient, with a progress bar. Streak values are deterministic, so the overlay renders on the server and covers the page before it paints.
- **Data:** on mount it calls `preloadStartupData()` to warm the client cache.
- **Timing:** it waits at least `MIN_VISIBLE_MS` (1,050 ms) and for the warmup to finish, then fades over `FADE_MS` (350 ms). `window.finishLoading()` dismisses it early.
- **Reduced motion:** respects `prefers-reduced-motion`.

## `PageHeader.tsx`

A presentational component: an icon, title and subtitle.

**Props:** `{ icon: React.ReactNode, title: string, subtitle: string }`.

## `SpaceBackground.tsx`

A client component: a fixed, full-viewport canvas behind everything (`pointer-events: none`).
- **Stars:** a still field (at least 80, scaled to the viewport) in white and pale blues. Stars never move; only their brightness pulses, and larger stars get a soft halo.
- **Reduced motion:** with `prefers-reduced-motion`, it draws one static frame.
