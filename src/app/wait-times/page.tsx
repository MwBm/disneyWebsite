import PageHeader from "@/components/PageHeader";
import WaitTimesView from "@/components/WaitTimesView";
import { parkDateKey } from "@/lib/park-time";

const HourglassIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
  </svg>
);

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve the initial date from ?date=, falling back to today in park time.
 *
 * Today is computed in America/Los_Angeles rather than the server's timezone:
 * on a UTC host, `new Date()` is already tomorrow for most of the evening in
 * California, which would land the visitor on the wrong day.
 */
function resolveInitialDate(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value === "string" && DATE_KEY.test(value)) {
    // Reject a well-formed but impossible date such as 2026-02-31, which
    // Date.UTC silently rolls forward to March 3rd. Compare in UTC only: a
    // local-timezone round trip would reject valid dates on a UTC host.
    const [y, m, d] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (
      parsed.getUTCFullYear() === y &&
      parsed.getUTCMonth() === m - 1 &&
      parsed.getUTCDate() === d
    ) {
      return value;
    }
  }
  return parkDateKey(new Date());
}

export default async function WaitTimesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { date } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<HourglassIcon />}
        title="Wait Time Predictions"
        subtitle="Per-ride predicted waits for a selected date, from the XGBoost model."
      />
      <WaitTimesView initialDate={resolveInitialDate(date)} />
    </div>
  );
}
