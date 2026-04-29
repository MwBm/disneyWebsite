"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { crowdLabel } from "@/lib/forecast";

type Props = { score: number };

export default function CrowdMeter({ score }: Props) {
  const spring = useSpring(0, { stiffness: 60, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => {
    spring.set(score);
  }, [score, spring]);

  const { label, color, description } = crowdLabel(score);
  const pct = score;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative w-48 h-48">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="44" fill="none" stroke="#0e2040" strokeWidth="8" />
          <motion.circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 44}`}
            initial={{ strokeDashoffset: 2 * Math.PI * 44 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 44 * (1 - pct / 100) }}
            transition={{ duration: 1.2, ease: "easeOut" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span className="text-4xl font-semibold text-warm-900">
            {display}
          </motion.span>
          <span className="text-xs text-warm-700 mt-1">/ 100</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-lg font-medium" style={{ color }}>
          {label}
        </p>
        <p className="text-sm text-warm-700">{description}</p>
      </div>
    </div>
  );
}
