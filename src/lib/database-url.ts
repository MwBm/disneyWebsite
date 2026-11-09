type Environment = Record<string, string | undefined>;

const DATABASE_URL_KEYS = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

function normaliseUrl(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value
    .trim()
    .replace(/^DATABASE_URL\s*=\s*/i, "")
    .replace(/^(?:"|')|(?:"|')$/g, "");

  try {
    const { protocol } = new URL(trimmed);
    return protocol === "postgres:" || protocol === "postgresql:" ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * PrismaPg accepts only a raw postgres/postgresql URL. Vercel projects can
 * also expose a direct connection under one of the fallback variable names.
 */
export function resolveDatabaseUrl(environment: Environment = process.env): string {
  for (const key of DATABASE_URL_KEYS) {
    const url = normaliseUrl(environment[key]);
    if (url) return url;
  }

  throw new Error(
    "A valid PostgreSQL DATABASE_URL is required. Set DATABASE_URL or DIRECT_DATABASE_URL to a postgres:// or postgresql:// connection string."
  );
}
