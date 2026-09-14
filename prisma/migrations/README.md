# Migrations

`0_init` is a baseline generated from `schema.prisma` with:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  --output prisma/migrations/0_init/migration.sql
```

Use `--output`, not a shell redirect. `prisma.config.ts` loads dotenv, which
prints `◇ injected env …` banners to stdout — a `>` redirect captured two of
them as the first lines of `0_init`, making it invalid SQL on any fresh
database.

The production database predates this directory — it was built with
`prisma db push`, so its tables already exist and `0_init` must **not** be
re-applied there. It was marked as already-applied on 2026-09-13, after
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma`
reported no drift. For any other database built with `db push`, do the same:

```bash
npx prisma migrate resolve --applied 0_init
```

After that, `npx prisma migrate deploy` is the normal path. Write new
migrations against a disposable local database, never with `migrate dev` or
`migrate reset` pointed at Supabase: see "Schema Changes" in
[docs/runbook-database.md](../../docs/runbook-database.md).

## Indexes

Add indexes only in a migration, and only when `EXPLAIN` against realistic data
shows a query needs one. The old hand-run `prisma/indexes.sql` was never applied
to production, and one of its two indexes could never have been used: on
Postgres 17 `EXTRACT(MONTH FROM date)` returns `numeric`, but the index was built
on `EXTRACT(...)::int`, so the planner kept its sequential scan. Its other index
served a query that no longer exists.

Prisma runs a migration's statements in one transaction, so a migration cannot
use `CREATE INDEX CONCURRENTLY`. At this project's table sizes a plain
`CREATE INDEX` locks writes for well under a second; if that stops being true,
run the concurrent build by hand and record it with
`prisma migrate resolve --applied`.
