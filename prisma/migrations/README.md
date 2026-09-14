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

After that, `npx prisma migrate deploy` is the normal path and
`npx prisma migrate dev --name <change>` is how new changes get recorded.

## Why `indexes.sql` is not a migration

[`../indexes.sql`](../indexes.sql) uses `CREATE INDEX CONCURRENTLY`, which
Postgres refuses to run inside a transaction block — and Prisma wraps each
migration in one. It stays a separate, manually-applied script so the index
build doesn't lock writes:

```bash
psql $DATABASE_URL -f prisma/indexes.sql
```
