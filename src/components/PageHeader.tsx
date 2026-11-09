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
    <div>
      <div className="mb-4 flex items-center gap-2 text-warm-500">
        <span aria-hidden="true" className="inline-flex">{icon}</span>
        <span className="eyebrow">Disneyland Planner</span>
      </div>
      <div>
        <h1 className="text-3xl font-medium tracking-[-0.035em] text-warm-900">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-warm-700">{subtitle}</p>
      </div>
    </div>
  );
}
