import DateForecaster from "@/components/DateForecaster";
import Link from "next/link";

const tools = [
  {
    number: "01",
    title: "Wait time predictions",
    description: "Compare the expected wait at every ride, hour by hour.",
    href: "/wait-times",
  },
  {
    number: "02",
    title: "Crowd calendar",
    description: "Find the quieter days in a month before you commit to a date.",
    href: "/calendar",
  },
  {
    number: "03",
    title: "Planning help",
    description: "Ask a practical question about rides, waits, or your visit.",
    href: "/chat",
  },
];

const Arrow = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14 sm:gap-20">
      <section className="grid gap-10 pt-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)] lg:items-end">
        <div className="max-w-2xl">
          <p className="eyebrow mb-5">Disneyland resort · Planning desk</p>
          <h1 className="max-w-xl text-balance text-4xl font-medium leading-[1.04] tracking-[-0.045em] text-warm-900 sm:text-6xl">
            Crowd forecasts for your park day.
          </h1>
          <p className="mt-5 max-w-lg text-[0.98rem] leading-7 text-warm-700">
            Crowd forecasts and ride predictions for Disneyland and Disney California Adventure, built to make the tradeoffs clearer before you arrive.
          </p>
        </div>

        <aside className="border-l border-space-700 pl-5 sm:pl-6 lg:mb-1" aria-label="Planner coverage">
          <p className="eyebrow mb-4">At a glance</p>
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-warm-500">Parks</dt>
              <dd className="text-right text-warm-900">Disneyland · DCA</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-warm-500">Forecasts</dt>
              <dd className="text-right text-warm-900">Crowds &amp; waits</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-warm-500">Timezone</dt>
              <dd className="text-right text-warm-900">Pacific</dd>
            </div>
          </dl>
        </aside>
      </section>

      <DateForecaster />

      <section aria-labelledby="planner-tools-heading" className="border-t border-space-700 pt-5">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h2 id="planner-tools-heading" className="eyebrow">Continue planning</h2>
          <span className="text-xs text-warm-500">Three useful places to start</span>
        </div>
        <div>
          {tools.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-space-700 py-5 transition-colors hover:border-warm-500"
            >
              <span className="text-xs tabular-nums text-warm-500">{tool.number}</span>
              <span>
                <span className="block text-[0.95rem] font-medium text-warm-900">{tool.title}</span>
                <span className="mt-1 block text-sm leading-6 text-warm-700">{tool.description}</span>
              </span>
              <span className="text-warm-500 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-warm-900">
                <Arrow />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
