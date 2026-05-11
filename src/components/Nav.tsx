"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const links = [
  { href: "/",          label: "Forecast" },
  { href: "/calendar",  label: "Calendar" },
  { href: "/accuracy",  label: "Accuracy" },
  { href: "/chat",      label: "Chat"     },
];

const SparkleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 1.5C12 1.5 13.1 8.2 15.2 10.3C17.2 12.1 23 12 23 12C23 12 17.2 11.9 15.2 13.7C13.1 15.8 12 22.5 12 22.5C12 22.5 10.9 15.8 8.8 13.7C6.8 11.9 1 12 1 12C1 12 6.8 12.1 8.8 10.3C10.9 8.2 12 1.5 12 1.5Z" />
  </svg>
);

function NavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`text-sm px-3.5 py-1.5 rounded-full transition-all duration-250 ${
        active ? "text-orange-400" : "text-warm-700 hover:text-warm-900"
      }`}
      style={
        active
          ? {
              background: "rgb(var(--color-gold) / 0.08)",
              boxShadow: "0 0 0 1px rgb(var(--color-gold) / 0.28), 0 0 14px rgb(var(--color-gold) / 0.14)",
            }
          : undefined
      }
    >
      {label}
    </Link>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <nav
      className="sticky top-0 z-10"
      style={{ background: "var(--nav-bg)", backdropFilter: "blur(20px)" }}
    >
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span className="text-orange-400 icon-float">
            <SparkleIcon />
          </span>
          <span className="font-display italic text-orange-400 text-[1.1rem] leading-none tracking-tight">
            Disneyland
          </span>
          <span className="text-warm-500 text-[0.65rem] font-light tracking-[0.2em] uppercase mt-0.5">
            Planner
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="hidden sm:flex gap-1">
          {links.map(({ href, label }) => (
            <li key={href}>
              <NavLink href={href} label={label} active={pathname === href} />
            </li>
          ))}
        </ul>

        {/* Mobile hamburger */}
        <button
          className="sm:hidden flex flex-col gap-1.5 p-2 rounded-lg text-warm-700 hover:text-warm-900 hover:bg-cream-200/50 transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="sm:hidden border-t border-space-700 px-4 py-3" style={{ background: "var(--nav-bg)", backdropFilter: "blur(20px)" }}>
          <ul className="flex flex-col gap-1">
            {links.map(({ href, label }) => (
              <li key={href}>
                <NavLink
                  href={href}
                  label={label}
                  active={pathname === href}
                  onClick={() => setOpen(false)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px nav-border" />
    </nav>
  );
}
