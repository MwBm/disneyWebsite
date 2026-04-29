import DateForecaster from "@/components/DateForecaster";
import Link from "next/link";

const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <path d="M16 2v4M8 2v4M3 10h18"/>
  </svg>
);
const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v5l3 3"/>
  </svg>
);
const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const features = [
  {
    Icon: CalendarIcon,
    title: "Crowd Forecast",
    description: "See how busy the park will be on any date — before you book.",
    href: "/",
    cta: "Pick a date above",
    neon: "neon-blue",
  },
  {
    Icon: ClockIcon,
    title: "Wait Time Predictions",
    description: "Per-ride predicted waits by hour, powered by our ML model.",
    href: "/wait-times",
    cta: "View predictions",
    neon: "neon-purple",
  },
  {
    Icon: ChatIcon,
    title: "Trip Advisor",
    description: "Ask anything — best days, ride tips, itinerary help.",
    href: "/chat",
    cta: "Start chatting",
    neon: "neon-cyan",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-16">
      <div className="text-center flex flex-col items-center gap-5 pt-8">
        <div className="w-16 h-16 rounded-full border border-orange-500/30 flex items-center justify-center text-orange-500"
          style={{ background: "rgba(59,130,246,0.08)" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div>
          <h1 className="text-4xl font-semibold text-warm-900 tracking-tight text-balance leading-tight">
            Plan the perfect<br />Disneyland day
          </h1>
          <p className="text-warm-700 mt-3 text-base max-w-md mx-auto text-balance">
            ML-powered crowd forecasts and per-ride wait predictions — spend more time on rides, less time in lines.
          </p>
        </div>
      </div>

      <DateForecaster />

      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium uppercase tracking-widest text-warm-500 text-center">
          What you can do
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {features.map((f) => (
            <Link
              key={f.title}
              href={f.href}
              className={`group bg-space-card border border-space-700 rounded-2xl p-5 neon ${f.neon} flex flex-col gap-3`}
            >
              <div className="w-9 h-9 rounded-lg border border-space-600 flex items-center justify-center text-orange-400"
                style={{ background: "rgba(59,130,246,0.08)" }}>
                <f.Icon />
              </div>
              <div>
                <h3 className="font-medium text-warm-900">{f.title}</h3>
                <p className="text-sm text-warm-700 leading-relaxed mt-0.5">{f.description}</p>
              </div>
              <span className="text-xs font-medium text-orange-400 group-hover:text-orange-500 mt-auto flex items-center gap-1">
                {f.cta}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
