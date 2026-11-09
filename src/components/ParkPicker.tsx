"use client";

import { DCA_PARK_ID, DISNEYLAND_PARK_ID, PARK_LABELS, type ParkId } from "@/lib/parks";

export default function ParkPicker({
  value,
  onChange,
}: {
  value: ParkId;
  onChange: (parkId: ParkId) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-space-700 bg-space-card p-1" aria-label="Select a park">
      {[DISNEYLAND_PARK_ID, DCA_PARK_ID].map((parkId) => (
        <button
          key={parkId}
          type="button"
          onClick={() => onChange(parkId)}
          aria-pressed={value === parkId}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === parkId
              ? "bg-warm-900 text-space-900"
              : "text-warm-500 hover:bg-space-800 hover:text-warm-900"
          }`}
        >
          {PARK_LABELS[parkId]}
        </button>
      ))}
    </div>
  );
}
