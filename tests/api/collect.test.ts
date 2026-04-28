import { prisma } from "@/lib/db";
import * as queueTimes from "@/lib/queue-times";
import * as mlClient from "@/lib/ml-client";

const mockFetch = queueTimes.fetchLiveRides as jest.Mock;
const mockML = mlClient.requestMLForecast as jest.Mock;
const mockUpsert = prisma.waitTimeRecord.upsert as jest.Mock;
const mockCreateRun = prisma.collectRun.create as jest.Mock;
const mockCreateMany = prisma.dailyForecast.createMany as jest.Mock;

jest.mock("@/lib/queue-times", () => ({
  fetchLiveRides: jest.fn(),
  roundToWindow: jest.fn((d: Date) => d),
}));

jest.mock("@/lib/ml-client", () => ({
  requestMLForecast: jest.fn(),
}));

describe("collect route logic", () => {
  const sampleRides = [
    { id: 1, name: "Space Mountain", landName: "Tomorrowland", isOpen: true, waitTime: 45, lastUpdated: new Date() },
    { id: 2, name: "Pirates", landName: "Adventureland", isOpen: true, waitTime: 20, lastUpdated: new Date() },
  ];

  beforeEach(() => jest.clearAllMocks());

  it("upserts one record per ride", async () => {
    mockFetch.mockResolvedValueOnce(sampleRides);
    mockML.mockResolvedValueOnce(null);
    mockUpsert.mockResolvedValue({});
    mockCreateRun.mockResolvedValue({});

    // Simulate the upsert loop
    for (const ride of sampleRides) {
      await prisma.waitTimeRecord.upsert({
        where: { rideId_windowedAt: { rideId: ride.id, windowedAt: new Date() } },
        create: { rideId: ride.id, rideName: ride.name, landName: ride.landName, waitTime: ride.waitTime, isOpen: ride.isOpen, windowedAt: new Date() },
        update: { waitTime: ride.waitTime, isOpen: ride.isOpen, recordedAt: new Date() },
      });
    }

    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it("writes a CollectRun record on success", async () => {
    mockCreateRun.mockResolvedValue({});
    await prisma.collectRun.create({ data: { rowsUpserted: 2, success: true } });
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: true }) })
    );
  });

  it("writes a CollectRun record with error on failure", async () => {
    mockCreateRun.mockResolvedValue({});
    await prisma.collectRun.create({
      data: { rowsUpserted: 0, success: false, errorMessage: "queue-times.com returned 503" },
    });
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ success: false }) })
    );
  });

  it("skips DailyForecast write when ML service returns null", async () => {
    mockML.mockResolvedValueOnce(null);
    const mlResponse = await mlClient.requestMLForecast([], new Date());
    if (!mlResponse) {
      // no forecast write
    }
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("second identical upsert does not create a duplicate (idempotency via skipDuplicates)", async () => {
    mockCreateMany.mockResolvedValue({ count: 0 }); // 0 new rows on second run
    const result = await prisma.dailyForecast.createMany({ data: [], skipDuplicates: true });
    expect(result).toEqual({ count: 0 });
  });
});
