import DateForecaster from "@/components/DateForecaster";
import Link from "next/link";

// Ticket / entry pass — Forecast
const TicketIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 9a1 1 0 0 1 1-1h18a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 0 0 5V17a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1.5a2.5 2.5 0 0 0 0-5V9z"/>
    <line x1="9" y1="8" x2="9" y2="16" strokeDasharray="2 2.5" strokeWidth="1.2"/>
  </svg>
);

// Hourglass — Wait Times
const HourglassIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 2h14"/>
    <path d="M5 22h14"/>
    <path d="M6 2C6 2 7.5 7 12 12C7.5 17 6 22 6 22"/>
    <path d="M18 2C18 2 16.5 7 12 12C16.5 17 18 22 18 22"/>
    <path d="M9 16.5h6" strokeWidth="1.4"/>
  </svg>
);

// Compass — Trip Advisor
const CompassIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" fillOpacity="0.25"/>
    <circle cx="12" cy="12" r="1" fill="currentColor"/>
  </svg>
);

// Hero sparkle
const HeroSparkle = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1.5C12 1.5 13.1 8.2 15.2 10.3C17.2 12.1 23 12 23 12C23 12 17.2 11.9 15.2 13.7C13.1 15.8 12 22.5 12 22.5C12 22.5 10.9 15.8 8.8 13.7C6.8 11.9 1 12 1 12C1 12 6.8 12.1 8.8 10.3C10.9 8.2 12 1.5 12 1.5Z" />
  </svg>
);

const features = [
  {
    Icon: TicketIcon,
    title: "Crowd Forecast",
    description: "See how busy the park will be on any date — before you book.",
    href: "/",
    cta: "Pick a date above",
    neon: "neon-gold",
  },
  {
    Icon: HourglassIcon,
    title: "Wait Time Predictions",
    description: "Per-ride predicted waits by hour, powered by our ML model.",
    href: "/wait-times",
    cta: "View predictions",
    neon: "neon-amber",
  },
  {
    Icon: CompassIcon,
    title: "Trip Advisor",
    description: "Ask anything — best days, ride tips, itinerary help.",
    href: "/chat",
    cta: "Start chatting",
    neon: "neon-gold",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16">
      <div className="text-center flex flex-col items-center gap-5 pt-8">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center text-orange-400"
          style={{
            background: "rgba(240,192,96,0.06)",
            border: "1px solid rgba(240,192,96,0.2)",
            boxShadow: "0 0 24px rgba(240,192,96,0.12)",
          }}
        >
          <HeroSparkle />
        </div>
        <div>
          <h1 className="font-display text-4xl font-light italic text-warm-900 tracking-tight text-balance leading-tight">
            Plan the perfect<br />
            <span className="text-orange-400 not-italic font-normal">Disneyland</span> day
          </h1>
          <p className="text-warm-700 mt-3 text-base max-w-md mx-auto text-balance font-light">
            ML-powered crowd forecasts and per-ride wait predictions — spend more time on rides, less time in lines.
          </p>
        </div>
      </div>

      <DateForecaster />

      <div className="flex flex-col gap-4">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.2em] text-warm-500 text-center">
          What you can do
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {features.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className={`group bg-space-card border border-space-700 rounded-2xl p-5 neon ${f.neon} flex flex-col gap-3`}
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-orange-400"
                style={{
                  background: "rgba(240,192,96,0.07)",
                  border: "1px solid rgba(240,192,96,0.14)",
                }}
              >
                <f.Icon />
              </div>
              <div>
                <h3 className="font-medium text-warm-900">{f.title}</h3>
                <p className="text-sm text-warm-700 leading-relaxed mt-0.5 font-light">{f.description}</p>
              </div>
              <span className="text-xs font-medium text-orange-400 group-hover:text-orange-500 mt-auto flex items-center gap-1 transition-colors">
                {f.cta}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
