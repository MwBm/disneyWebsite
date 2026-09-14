import { NextRequest } from "next/server";
import { requireBearer } from "@/lib/auth";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function makeReq(authorization?: string): NextRequest {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest(new URL("http://localhost/api/cron/sync-date-context"), { headers });
}

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("requireBearer — misconfiguration fails closed", () => {
  it("returns 500 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = requireBearer(makeReq("Bearer anything"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
  });

  it("returns 500 when CRON_SECRET is the empty string", () => {
    process.env.CRON_SECRET = "";
    expect(requireBearer(makeReq("Bearer "))!.status).toBe(500);
  });

  it("does NOT authorize the literal 'Bearer undefined' when the secret is unset", () => {
    // What a plain `header !== \`Bearer ${process.env.CRON_SECRET}\`` check would accept.
    delete process.env.CRON_SECRET;
    const res = requireBearer(makeReq("Bearer undefined"));
    expect(res).not.toBeNull();
    expect(res!.status).not.toBe(200);
    expect(res!.status).toBe(500);
  });
});

describe("requireBearer — rejection", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "s3cret-value";
  });

  it("returns 401 when the authorization header is absent", () => {
    expect(requireBearer(makeReq())!.status).toBe(401);
  });

  it("returns 401 for a wrong secret of the same length", () => {
    expect(requireBearer(makeReq("Bearer s3cret-valuf"))!.status).toBe(401);
  });

  it("returns 401 for a wrong secret of a different length", () => {
    expect(requireBearer(makeReq("Bearer short"))!.status).toBe(401);
  });

  it("returns 401 when the Bearer prefix is missing", () => {
    expect(requireBearer(makeReq("s3cret-value"))!.status).toBe(401);
  });

  it("returns 401 for a value that merely contains the secret", () => {
    expect(requireBearer(makeReq("Bearer s3cret-value-extra"))!.status).toBe(401);
  });

  it("is case-sensitive on the scheme", () => {
    expect(requireBearer(makeReq("bearer s3cret-value"))!.status).toBe(401);
  });

  it("returns a JSON body, not an empty response", async () => {
    const body = await requireBearer(makeReq("Bearer nope"))!.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });
});

describe("requireBearer — acceptance", () => {
  it("returns null for the correct secret", () => {
    process.env.CRON_SECRET = "s3cret-value";
    expect(requireBearer(makeReq("Bearer s3cret-value"))).toBeNull();
  });

  it("accepts a secret containing regex/template metacharacters", () => {
    process.env.CRON_SECRET = "a$b`c${d}e\\f";
    expect(requireBearer(makeReq("Bearer a$b`c${d}e\\f"))).toBeNull();
  });

  it("accepts a long high-entropy secret", () => {
    // Header values are Latin-1 only, so a secret must stay in that range;
    // this is the realistic shape of `openssl rand -hex 32`.
    const secret = "f".repeat(31) + "0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d";
    process.env.CRON_SECRET = secret;
    expect(requireBearer(makeReq(`Bearer ${secret}`))).toBeNull();
  });
});
