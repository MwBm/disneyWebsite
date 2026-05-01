"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Forecast" },
  { href: "/calendar", label: "Calendar" },
  { href: "/wait-times", label: "Wait Times" },
  { href: "/accuracy", label: "Accuracy" },
  { href: "/chat", label: "Chat" },
  { href: "/admin", label: "Data" },
];

// 4-pointed Disney-style sparkle
const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1.5C12 1.5 13.1 8.2 15.2 10.3C17.2 12.1 23 12 23 12C23 12 17.2 11.9 15.2 13.7C13.1 15.8 12 22.5 12 22.5C12 22.5 10.9 15.8 8.8 13.7C6.8 11.9 1 12 1 12C1 12 6.8 12.1 8.8 10.3C10.9 8.2 12 1.5 12 1.5Z" />
  </svg>
);

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav
      className="sticky top-0 z-10"
      style={{ background: "rgba(13,11,9,0.92)", backdropFilter: "blur(20px)" }}
    >
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="text-orange-400 icon-float">
            <SparkleIcon />
          </span>
          <span className="font-display italic text-orange-400 text-[1.1rem] leading-none tracking-tight">
            Disneyland
          </span>
          <span
            className="text-warm-500 text-[0.65rem] font-light tracking-[0.2em] uppercase mt-0.5"
          >
            Planner
          </span>
        </Link>

        <ul className="flex gap-1">
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`text-sm px-3.5 py-1.5 rounded-full transition-all duration-250 ${
                    active
                      ? "text-orange-400"
                      : "text-warm-700 hover:text-warm-900"
                  }`}
                  style={
                    active
                      ? {
                          background: "rgba(240,192,96,0.08)",
                          boxShadow:
                            "0 0 0 1px rgba(240,192,96,0.28), 0 0 14px rgba(240,192,96,0.14)",
                        }
                      : undefined
                  }
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px nav-border" />
    </nav>
  );
}
