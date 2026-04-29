# Runbook: UI Components (`src/components/`)

Design tokens: background `#faf7f2`, primary `#c94a1f`, text `#1a1410`. Font: DM Sans.

---

## `Nav.tsx`

Client component. Highlights active route in orange (`#c94a1f`). Links: Forecast / Wait Times / Accuracy / Chat.

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
