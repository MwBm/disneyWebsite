import { prisma } from "@/lib/db";

export const describeWithDatabase = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const APP_TABLES = ["WaitTimeRecord", "DailyForecast", "HourlyWaitSummary", "CollectRun", "Prediction", "DateContext"];

export async function truncateAppTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE ${APP_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

/** A UTC instant from a Pacific wall-clock time, with the offset stated explicitly. */
export function pacific(isoLocal: string, offsetHours: -7 | -8): Date {
  const sign = offsetHours < 0 ? "-" : "+";
  return new Date(`${isoLocal}${sign}${String(Math.abs(offsetHours)).padStart(2, "0")}:00`);
}
