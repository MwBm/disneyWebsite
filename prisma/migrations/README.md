# Migrations

`0_init` is a baseline generated from `schema.prisma` with:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  --output prisma/migrations/0_init/migration.sql
```

Always use `--output`, never a shell `>` redirect. `prisma.config.ts` loads dotenv, which prints `◇ injected env …` banners to stdout, and a redirect writes them into the SQL. `ml-service/tests/integration/test_migrations_db.py` fails on any migration whose first line isn't a SQL comment.

The production database was originally built with `prisma db push`, so its tables already existed and `0_init` must **not** be applied there. It was marked as applied on 2026-09-13, after `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` reported no drift. For any other database built with `db push`, do the same:

```bash
npx prisma migrate resolve --applied 0_init
```

After that, `npx prisma migrate deploy` is the normal path. Write new migrations against a disposable local database, never with `migrate dev` or `migrate reset` pointed at Supabase: see "Schema Changes" in [docs/runbook-database.md](../../docs/runbook-database.md#schema-changes). Never edit a migration that has been applied anywhere.

Every new table must enable row-level security in its migration; see "Data API lockdown (RLS)" in the database runbook.

## Indexes

- **When:** add an index only in a migration, and only when `EXPLAIN` against realistic data shows a query needs one.
- **Expression indexes:** match the query's expression exactly. On Postgres 17 `EXTRACT(...)` returns `numeric`, so an index on `EXTRACT(...)::int` is never used by a query filtering on plain `EXTRACT(...)`.
- **No `CONCURRENTLY`:** Prisma runs a migration's statements in one transaction, so a migration cannot use `CREATE INDEX CONCURRENTLY`. At this project's table sizes a plain `CREATE INDEX` locks writes for well under a second. If that stops being true, run the concurrent build by hand and record it with `prisma migrate resolve --applied`.
