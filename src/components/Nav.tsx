"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const links = [
  { href: "/",           label: "Forecast"   },
  { href: "/wait-times", label: "Wait Times" },
  { href: "/calendar",   label: "Calendar"   },
  { href: "/accuracy",   label: "Accuracy"   },
  { href: "/chat",       label: "Chat"       },
];

function NavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`relative block px-2 py-2 text-[0.8rem] transition-colors ${
        active ? "text-warm-900" : "text-warm-500 hover:text-warm-900"
      }`}
    >
      {label}
      {active && <span aria-hidden="true" className="absolute inset-x-2 -bottom-px h-px bg-warm-900" />}
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

  // Close on route change. Adjusting state during render is React's documented
  // alternative to an effect that immediately sets state — it avoids the extra
  // render pass an effect would cause.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  return (
    <nav
      className="sticky top-0 z-10 border-b border-space-700"
      style={{ background: "var(--nav-bg)", backdropFilter: "blur(16px)" }}
    >
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-[3.75rem] flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="Disneyland Planner home">
          <span className="grid h-5 w-5 place-items-center rounded-sm border border-space-700 text-[0.62rem] font-semibold text-warm-900">D</span>
          <span className="text-[0.86rem] font-medium tracking-[-0.01em] text-warm-900">
            Disneyland Planner
          </span>
        </Link>

        <ul className="hidden sm:flex h-full items-center gap-1">
          {links.map(({ href, label }) => (
            <li key={href}>
              <NavLink href={href} label={label} active={pathname === href} />
            </li>
          ))}
        </ul>

        <button
          className="sm:hidden flex flex-col gap-1.5 p-2 rounded-md text-warm-500 hover:text-warm-900 hover:bg-space-800 transition-colors"
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

      {open && (
        <div className="sm:hidden border-t border-space-700 px-5 py-3" style={{ background: "var(--nav-bg)", backdropFilter: "blur(16px)" }}>
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
    </nav>
  );
}
