import React from "react";

export default function PageHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center text-orange-400 shrink-0"
        style={{ background: "rgba(240,192,96,0.07)", border: "1px solid rgba(240,192,96,0.14)" }}
      >
        {icon}
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-warm-900 tracking-tight">{title}</h1>
        <p className="text-warm-700 text-sm mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
