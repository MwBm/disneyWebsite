# Runbook: UI Components (`src/components/`)

**Theme:** the "Sunlit Kingdom" palette is defined as CSS variables in `src/app/globals.css` (warm parchment background, deep navy text, gold/amber accents) and mapped onto Tailwind color names in `tailwind.config.ts`. **Fonts:** Outfit (body) and Fraunces (`.font-display`), both from Google Fonts. Crowd and wait-time colors come from `src/lib/crowd.ts`.

| Component | Used by |
|---|---|
| `Nav`, `SpaceBackground`, `LoadingScreenMount` → `LoadingScreen` | `src/app/layout.tsx` (every page) |
| `DateForecaster` → `DisneyDatePicker`, `CrowdMeter` | `/` |
| `WaitTimesView` → `DisneyDatePicker`, `RidePredictionTable` | `/wait-times` |
| `AccuracyChart` | `/accuracy` |
| `ChatAssistant` | `/chat` |
| `PageHeader` | `/wait-times`, `/accuracy`, `/chat` |

---

## `Nav.tsx`

A client component: sticky top nav with backdrop blur, and a gold glow on the active route.
- **Links:** Forecast, Wait Times, Calendar, Accuracy, Chat.
- **Mobile:** a hamburger menu that closes on Escape and on route change.

## `DateForecaster.tsx`

The home page widget:
1. Pick a date with `DisneyDatePicker` (defaults to today)
2. Fetch `/api/forecast?date=YYYY-MM-DD`
3. Render `CrowdMeter` with `crowdScore`, the AI narration when present, and a link to `/wait-times?date=…`

Shows a loading state while fetching and the API's error message on failure.

## `CrowdMeter.tsx`

An SVG ring gauge. A Framer Motion spring counts up from 0 to `score` on mount, and the label and color come from `crowdLabel(score)`.

**Props:** `{ score: number }` (0–100).

## `WaitTimesView.tsx`

The `/wait-times` client view.
- **Props:** `{ initialDate: string }`, resolved by the page from `?date=`, falling back to today in park time.
- **Fetching:** it fetches `/api/forecast` for the chosen date and aborts any in-flight request when the date changes, so a slow earlier response can't overwrite the current one.
- **URL:** kept in sync with `history.replaceState`.
- **Display:** a one-line note says how the numbers were produced (`ml`, `historical` or `groq`), then `RidePredictionTable`. There are also empty and error states.

## `RidePredictionTable.tsx`

A sortable table with one row per ride.
- **Columns:** Ride, Land, Avg Wait, Peak Wait, Confidence. The wait headers have tooltips explaining the averaging; Confidence isn't sortable.
- **Sorting:** peak wait descending by default; clicking a header sorts by it, and clicking again reverses. Rows are keyed by `rideId`.
- **Wait pills:** colored with `waitColor` (≤20, ≤45, ≤75, above).

**Props:** `{ rides: RideDayForecast[] }`.

## `AccuracyChart.tsx`

A Recharts `LineChart` of predicted (dashed) vs. actual wait for one ride. It fetches `/api/accuracy/rides/[rideId]` itself, 48 points by default, and aborts a stale request when the selected ride changes.

**Props:** `{ rideId: number, rideName: string }`.

## `ChatAssistant.tsx`

A client component: the streaming chat UI.
- POSTs the message history to `/api/chat` and appends stream chunks to the assistant bubble as they arrive, with a blinking cursor while streaming
- The send button is disabled when the input is empty or a reply is streaming
- Shows an error message on failure
- Exports `SUGGESTIONS` and a `ChatAssistantHandle` ref, so the chat page can send a suggested prompt

## `DisneyDatePicker.tsx`

A client component: a date picker styled as a park ticket stub ("ADMIT ONE").
- Previous- and next-day arrows on either side of the date
- Clicking the date opens an animated calendar popup (Framer Motion `AnimatePresence`) with month navigation, today ringed and the selected day filled
- Closes on an outside click

**Props:** `{ value: string /* yyyy-MM-dd */, onChange: (value: string) => void, label?: string }`.

## `LoadingScreenMount.tsx` / `LoadingScreen.tsx`

`LoadingScreenMount` loads the overlay with `dynamic(..., { ssr: false })`. `LoadingScreen` seeds random values, so a server render would never match the client's.

`LoadingScreen` is the full-page overlay on first load:
- **Visuals:** an animated SVG Ferris wheel (gondolas counter-rotate to stay level), an 80-star twinkling field, a progress bar, Disneyland facts rotating every 4 s, and status messages keyed to progress.
- **Timing:** it dismisses `MIN_VISIBLE_MS` (450 ms) after mount, then fades over `FADE_MS` (300 ms). `window.finishLoading()` dismisses it early.
- **Reduced motion:** respects `prefers-reduced-motion`.

## `PageHeader.tsx`

A presentational component: an icon, title and subtitle.

**Props:** `{ icon: React.ReactNode, title: string, subtitle: string }`.

## `SpaceBackground.tsx`

A client component: a fixed, full-viewport canvas behind everything (`pointer-events: none`).
- **Particles:** 160 in gold, amber, rose and indigo drift sinusoidally and link with faint lines within 130 px.
- **Interaction:** particles are attracted to the mouse within 120 px, and clicks send out ripples that scatter nearby particles.
- **Glows:** three ambient radial glows.
- **Reduced motion:** with `prefers-reduced-motion`, it draws one static frame.
