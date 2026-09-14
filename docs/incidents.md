# Incidents

What went wrong, what fixed it, and what now stops it happening again. The
runbooks describe how things work today; this is why they work that way. Full
detail is in the linked PRs. Dates are UTC.

## Standing rules

These come out of the incidents below. Break one only on purpose.

1. **Size every scheduled read against the 5 GB/month egress cap.** Aggregate in
   SQL and return summaries, not rows. A job that runs 48 times a day must not
   read at all (`ml-service/tests/test_collect.py` enforces this for collect).
2. **Every `schedule:` workflow goes in collect.yml's keepalive list**, and
   outputs are monitored, not just exit codes (`check_freshness.py`).
3. **A row leaves a table only by landing in another.** Archive moves raw rows
   with `DELETE … RETURNING` into the aggregate insert; training reads every
   unarchived row.
4. **Every new table enables RLS in its migration**, and the Supabase Data API
   stays off.
5. **Log failures; never swallow them.** A bare `catch` hid a dead AI provider
   for weeks.
6. **Cache route handlers with `Cache-Control` headers** (`cachedJson`), not
   `export const revalidate`, which Next ignores in dynamic routes.

---

## 2026-09: Supabase egress quota exceeded ([#2](https://github.com/MwBm/disneyWebsite/pull/2))

- **What happened:** in the Aug 28 – Sep 28 2026 billing cycle the project used
  16.5 GB of the Free plan's 5 GB egress, and Supabase restricted it. Database
  size was fine (0.27 of 0.5 GB).
- **Cause:** `collect.py` ran every 30 minutes and, on every run, reloaded the
  full training history (~20–28 MB) and retrained every model to refresh
  today's forecasts. No feature uses same-day data, so the retrain barely changed
  a prediction.
- **Fix:**
  - `collect.py` only writes.
  - `train.py` runs once a day and owns every `DailyForecast` row. Its read
    carries ride IDs only, with names fetched once per ride: ~14 MB, down from 28.
  - The calendar, Groq sync and accuracy routes aggregate in SQL. The calendar
    used to download ~47,000 forecast slots per uncached month.
- **Guard:** `test_main_runs_only_its_two_writes_and_never_reads`; rule 1.

## 2026-08: scheduled workflows disabled for inactivity ([#3](https://github.com/MwBm/disneyWebsite/pull/3))

- **What happened:** GitHub disabled `train.yml`, `archive.yml` and
  `sync-date-context.yml` after 60 days without repository activity. Nothing
  noticed for about three weeks. Collect kept succeeding, since it is dispatched
  by cron-job.org, and dispatches are exempt. Meanwhile the forecast horizon
  shrank to Sep 19, and the last archive ran Aug 23.
- **Fix:** collect.yml's `keep-schedules-enabled` job re-enables every scheduled
  workflow every 30 minutes. Its `check-freshness` job fails once a day when:
  - the last successful train run is older than 24 h;
  - forecasts end less than 27 days ahead;
  - raw rows are more than 38 days old.

  `CollectRun.job` now records which job wrote each row, so a failing train job
  can't hide behind 47 successful collects.
- **Guard:** `ml-service/tests/test_workflows.py`; rule 2.

## 2026-07/08: training data gap, Jul 24 – Aug 14 ([#4](https://github.com/MwBm/disneyWebsite/pull/4))

- **What happened:** training read raw rows from a fixed 30-day window plus the
  hourly archive. With archive stalled, rows older than 30 days that had not been
  archived yet were in neither, so three weeks of data never reached a model.
- **Fix:** training reads every unarchived raw row in one `REPEATABLE READ`
  snapshot. Archive moves rows atomically, so the two tables never overlap or
  leave a gap, however late archive runs. The backlog was archived and the
  models retrained on 2026-09-14.
- **Guard:** `test_training_history_includes_raw_rows_older_than_the_retention_window`; rule 3.

## 2026 (until 09): archive dropped part of an hour every week ([#4](https://github.com/MwBm/disneyWebsite/pull/4))

- **What happened:** the archive cutoff was `now − 30 days` to the second, so
  each weekly run split one hour. The rows before the cutoff became a bucket.
  The next week, `ON CONFLICT DO NOTHING` found that bucket and deleted the rest
  of the hour without counting it. Half-filled buckets on Jun 5, 12 and 19 2026
  (the Friday cutoffs) fit that pattern.
- **Fix:**
  - The cutoff is truncated to the hour.
  - A bucket that already exists is merged (sample-weighted average), not
    skipped. The backfill merged 53 buckets.
  - Buckets are keyed without the ride name, so a rename inside an hour can't
    produce two rows for one key.
- **Guard:** archive tests in `ml-service/tests/integration/test_jobs_db.py`, which
  cover merges, renames, the cutoff and both DST transitions.

## 2026 (until 09): past forecasts never deleted ([#4](https://github.com/MwBm/disneyWebsite/pull/4))

- **What happened:** `DailyForecast` kept every past slot. 96% of the table
  (~240k rows) was slots older than anything the accuracy pages can read, since
  they join to raw rows that only exist for 30 days.
- **Fix:** `archive.py` deletes forecasts older than 35 days. The backlog was
  deleted on 2026-09-14.
- **Guard:** `ml-service/tests/test_common.py` pins the retention constants to the
  accuracy routes' window.

## 2026 (until 09): nightly crash, XGBoost "1 vs. 23" ([#2](https://github.com/MwBm/disneyWebsite/pull/2))

- **What happened:** at 06:30 UTC (23:30 Pacific in summer) no open forecast
  slot was left in the day. An empty slot list reached XGBoost as a `(0,)`-shaped
  array, which it read as one column, and the job crashed every night.
- **Fix:** `predict_for_ride` returns `[]` for no slots, and `generate_forecasts`
  returns before reading anything when there are no slots.

## 2026 (until 09): wait-times table showed an arbitrary time of day ([#5](https://github.com/MwBm/disneyWebsite/pull/5))

- **What happened:**
  - **ML path:** each ride's "Predicted Wait" came from a `DISTINCT ON … ORDER BY
    "mlConfidence"`. Confidence is one value per ride, so every slot tied and
    Postgres returned any one of them: on Sep 15 the 80 rides came from 29
    different times of day.
  - **Historical fallback:** it read `WaitTimeRecord`, which holds 30 days, so
    it averaged 7 Tuesdays instead of 52, and it listed each ride once per hour.
- **Fix:** one row per ride with average and peak wait, computed in SQL. The
  historical path reads `HourlyWaitSummary` over the same hours forecasts cover.
- **Guard:** `tests/integration/forecast-queries.test.ts`.

## 2026-09: database readable through the Supabase Data API ([#4](https://github.com/MwBm/disneyWebsite/pull/4))

- **What happened:** RLS was off on every table, and Supabase's default grants
  gave `anon` and `authenticated` full table privileges. With the project URL and
  the public anon key, anyone could use the REST API. Just before the fix, an
  `anon` SELECT on `WaitTimeRecord` returned 6,563 rows.
- **Fix:** migration `20260914020000_lock_down_data_api` enables RLS with no
  policies and revokes every grant and default privilege from both roles. It is
  applied and verified on production. The app is unaffected: it connects as
  `postgres`.
- **Guard:** `test_every_table_in_the_migrated_database_has_rls`; rule 4.

## 2026-09: prepared statements collided behind the pooler ([#2](https://github.com/MwBm/disneyWebsite/pull/2))

- **What happened:** the first train run on the new code failed with
  `prepared statement "_pg3_0" already exists`. psycopg prepares a statement
  after a few executions, and behind Supabase's pooler another client can
  already hold that name.
- **Fix:** `common.connect()` passes `prepare_threshold=None`.

## 2026-09: `0_init` migration was invalid SQL ([#2](https://github.com/MwBm/disneyWebsite/pull/2))

- **What happened:** the baseline was generated with a shell `>` redirect, which
  also captured two dotenv banner lines printed by `prisma.config.ts`.
- **Fix:** removed the lines. Migrations are generated with `--output`.
- **Guard:** `test_every_migration_is_plain_sql_without_captured_log_output`.

## Found in the architecture review, 2026-09-01 ([#1](https://github.com/MwBm/disneyWebsite/pull/1))

| Problem | Fix |
| --- | --- |
| Groq retired `llama-3.3-70b-versatile` and `llama-3.1-8b-instant`. Every AI feature 404'd, and every error was caught and discarded, so the site just showed no AI output | Model IDs live only in `src/lib/groq-models.ts`; failures are logged (rule 5) |
| `/api/cron/*` compared against `` `Bearer ${process.env.CRON_SECRET}` ``, which authorized the literal header `Bearer undefined` when the secret was unset | `requireBearer` fails closed with 500 |
| `export const revalidate` was ignored in routes that read search params, so `/api/forecast` and `/api/calendar` made an uncached Groq call on every request | `cachedJson` sets `Cache-Control` (rule 6) |
| `Number(score) \|\| 50` turned a real crowd score of 0 into 50 | `clampParsedNumber` checks for a finite number |
| `next build` prerendered `/api/accuracy`, querying production during the build | `export const dynamic = "force-dynamic"` |
| The Groq sync matched forecasts by exact timestamp, finding one slot a day (17:00 Pacific) and defaulting the rest to 50 | Daily mean per park date, in SQL |
