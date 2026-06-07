# Runbook: UI Components (`src/components/`)

Design tokens: background `#faf7f2`, primary `#c94a1f`, text `#1a1410`. Font: DM Sans.

---

## `Nav.tsx`

Client component. Sticky top nav with backdrop blur. Highlights active route with gold glow ring. Links: Forecast / Calendar / Accuracy / Chat. Mobile hamburger menu with Escape-key dismiss and auto-close on route change.

---

## `DateForecaster.tsx`

Home page main widget.

1. User picks date via `<input type="date">`
2. Fetches `/api/forecast?date=YYYY-MM-DD`
3. Renders `CrowdMeter` with returned `crowdScore`
4. Renders AI narration card below meter
5. Link to `/wait-times?date=...` for per-ride breakdown

Shows skeleton/loading state while fetching.

---

## `CrowdMeter.tsx`

SVG ring gauge. Framer Motion spring animation counts up from 0 to `score` on mount.

**Props:**
```ts
{ score: number }  // 0–100
```

Color pulled from `crowdLabel(score).color`. Displays score number + label in center.

---

## `RidePredictionTable.tsx`

Sortable table of ride predictions. Default sort: predicted wait descending.

Wait time pill colors:
- < 20 min → green
- 20–45 min → yellow  
- > 45 min → red

**Props:**
```ts
{ forecasts: DailyForecast[], date: string }
```

---

## `AccuracyChart.tsx`

Recharts `LineChart`. Two lines:
- Predicted wait (dashed, `#c94a1f`)
- Actual wait (solid, `#1a1410`)

X-axis: `predictedFor` timestamps. Filterable by ride via dropdown.

**Props:**
```ts
{ data: AccuracyRow[], rides: string[] }
```

---

## `ChatAssistant.tsx`

Client component. Streaming chat UI.

- POST to `/api/chat` with message history
- Reads `ReadableStream` chunks, appends to assistant bubble in real time
- Blinking cursor while streaming
- Send button disabled when input empty or streaming in progress

---

## `DisneyDatePicker.tsx`

Client component. Custom date picker styled as a park ticket stub.

- Ticket stub left strip ("ADMIT ONE") with dashed separator
- Previous/next day arrow buttons on either side of the date display
- Click date area → animated calendar popup (Framer Motion `AnimatePresence`)
- Calendar popup: month nav + day grid, today highlighted with ring, selected day filled orange
- Click outside → closes popup
- **Props:** `{ value: string /* yyyy-MM-dd */, onChange: (value: string) => void, label?: string }`

---

## `LoadingScreen.tsx`

Client component. Full-page loading overlay shown on initial app load.

- Animated SVG Ferris wheel (rotating gondolas + counter-rotation to stay level)
- Twinkling star field (80 particles, client-side only to avoid hydration mismatch)
- Progress bar with randomized increment curve, auto-dismisses after 3 seconds
- Rotating Disneyland fun facts (4-second interval)
- Status messages keyed to progress percentage (5 stages)
- Exposes `window.finishLoading()` for early dismiss
- Respects `prefers-reduced-motion`

---

## `PageHeader.tsx`

Server-compatible presentational component. Shared page header with icon + title + subtitle.

**Props:** `{ icon: React.ReactNode, title: string, subtitle: string }`

---

## `SpaceBackground.tsx`

Client component. Canvas-based animated particle background ("Sunlit Kingdom" theme).

- 160 particles in gold/amber/rose/indigo palette floating with sinusoidal drift
- Particles connect with faint gold lines within 130px
- Mouse attraction within 120px radius
- Click ripples propagate outward and scatter nearby particles
- Three ambient radial glows
- Fixed position, full viewport, `pointer-events: none`, `z-index: 0`
- Respects `prefers-reduced-motion` (static render, no animation)
