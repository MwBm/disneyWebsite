import { NextRequest } from "next/server";
import { GET } from "@/app/api/cron/sync-date-context/route";
import { syncDateContext, syncGroqAdjustments } from "@/lib/date-context";

jest.mock("@/lib/date-context", () => ({
  syncDateContext: jest.fn(),
  syncGroqAdjustments: jest.fn(),
}));

const mockSyncDateContext = syncDateContext as jest.Mock;
const mockSyncGroqAdjustments = syncGroqAdjustments as jest.Mock;
const ORIGINAL_SECRET = process.env.CRON_SECRET;

describe("sync-date-context cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    jest.clearAllMocks();
    mockSyncDateContext.mockResolvedValue({ synced: 20, skipped: 3 });
    mockSyncGroqAdjustments.mockResolvedValue({ adjusted: 12 });
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("refreshes DateContext before calculating adjustments for the ML serving window", async () => {
    const response = await GET(new NextRequest("http://localhost/api/cron/sync-date-context", {
      headers: { authorization: "Bearer cron-test-secret" },
    }));

    expect(response.status).toBe(200);
    expect(mockSyncDateContext).toHaveBeenCalledWith(365);
    expect(mockSyncGroqAdjustments).toHaveBeenCalledWith(30);
    expect(await response.json()).toEqual({ ok: true, synced: 20, skipped: 3, adjusted: 12 });
    expect(mockSyncDateContext.mock.invocationCallOrder[0]).toBeLessThan(mockSyncGroqAdjustments.mock.invocationCallOrder[0]);
  });
});
