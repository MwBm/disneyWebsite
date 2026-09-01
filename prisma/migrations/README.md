# Migrations

`0_init` is a baseline generated from `schema.prisma` with:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script \
  > prisma/migrations/0_init/migration.sql
```

The production database predates this directory — it was built with
`prisma db push`, so its tables already exist and `0_init` must **not** be
re-applied there. Mark it as already-applied once:

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
