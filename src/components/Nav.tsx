"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Forecast" },
  { href: "/wait-times", label: "Wait Times" },
  { href: "/accuracy", label: "Accuracy" },
  { href: "/chat", label: "Chat" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav
      className="sticky top-0 z-10"
      style={{ background: "rgba(6,15,32,0.85)", backdropFilter: "blur(16px)" }}
    >
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold tracking-tight group"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="icon-pulse text-blue-400"
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span className="text-shimmer">Disneyland Planner</span>
        </Link>

        <ul className="flex gap-1.5">
          {links.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`relative text-sm px-3.5 py-1.5 rounded-full transition-all duration-300 ${
                    active
                      ? "text-warm-900"
                      : "text-warm-700 hover:text-warm-900"
                  }`}
                  style={
                    active
                      ? {
                          background:
                            "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(168,120,255,0.14))",
                          boxShadow:
                            "0 0 0 1px rgba(96,165,250,0.4), 0 0 16px rgba(96,165,250,0.28), 0 0 32px rgba(168,120,255,0.18), inset 0 0 14px rgba(168,120,255,0.08)",
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
