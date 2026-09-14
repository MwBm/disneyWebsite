import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: resolve(process.cwd(), ".env.local") });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
// The Prisma CLI uses the session-mode pooler (5432); the transaction pooler (6543) breaks prepared statements.
const directUrl = databaseUrl
  ?.replace("pooler.supabase.com:6543", "pooler.supabase.com:5432")
  ?.replace("?pgbouncer=true", "");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: directUrl,
  },
});