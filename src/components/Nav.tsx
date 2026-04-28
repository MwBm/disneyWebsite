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
    <nav className="border-b border-cream-200 bg-cream-100">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-semibold text-warm-900 tracking-tight">
          Disneyland Planner
        </Link>
        <ul className="flex gap-6">
          {links.map(({ href, label }) => (
            <li key={href}>
              <Link
                href={href}
                className={`text-sm transition-colors ${
                  pathname === href
                    ? "text-orange-500 font-medium"
                    : "text-warm-700 hover:text-orange-500"
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
