-- Lock the public schema away from Supabase's Data API roles.
--
-- Supabase serves every table in `public` through its Data API (PostgREST) as
-- the `anon` and `authenticated` roles, and its default privileges grant those
-- roles full access to every table, sequence and function `postgres` creates.
-- On 2026-09-13 all seven tables here, _prisma_migrations included, had row
-- level security off and `anon` could SELECT, INSERT and DELETE. Anyone holding
-- the project URL and the anon key, which Supabase treats as public, could dump
-- or wipe the data, and every dump counts against the egress quota.
--
-- The app never uses the Data API. Prisma and the ml-service jobs connect as
-- `postgres`, which owns these tables and has BYPASSRLS, so neither step below
-- changes anything for them. On a plain Postgres without Supabase's roles (CI,
-- local development) step 2 is skipped.

-- 1. Row level security on every table, with no policies: roles that don't
--    bypass RLS see no rows even if a grant is added back later.
DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl.tablename);
    END LOOP;
END
$$;

-- 2. Remove the grants, now and for objects `postgres` creates later.
DO $$
DECLARE
    api_role text;
BEGIN
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
            EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
            EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', api_role);
            EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', api_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', api_role);
            EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', api_role);
        END IF;
    END LOOP;
END
$$;
