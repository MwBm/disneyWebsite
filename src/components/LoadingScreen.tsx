"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Abril_Fatface } from "next/font/google";

const abrilFatface = Abril_Fatface({ weight: "400", subsets: ["latin"], display: "swap" });

const FACTS = [
  "Disneyland opened July 17, 1955 — Walt called opening day 'Black Sunday' due to the chaos.",
  "The Matterhorn was the world's first steel tubular roller coaster when it opened in 1959.",
  "Sleeping Beauty Castle stands just 77 feet tall — forced perspective makes it look much taller!",
  "There are about 200 feral cats that roam Disneyland at night to control the rodent population.",
  "The smell of fresh popcorn is pumped through vents near Main Street — it's called 'scent marketing.'",
  "Walt Disney insisted the park stay spotless; cast members pick up trash every 30 feet on average.",
  "Pirates of the Caribbean used to contain real human skulls — eventually replaced with replicas.",
  "Indiana Jones Adventure has over 160,000 different ride variations programmed into its sequence.",
  "Club 33, Disneyland's secret members-only club, originally had a waiting list of over 14 years.",
  "The Haunted Mansion's stretching room actually descends — it's an elevator to the underground path.",
  "Walt Disney was afraid of mice — which makes Mickey's creation all the more legendary.",
  "Space Mountain's interior is so dark, riders can't see the track more than a foot ahead.",
  "The Turkey Legs at Disneyland are actually smoked ham — not turkey. 🦃",
  "Buzz Lightyear Astro Blasters has a secret max score that triggers a special Easter egg.",
  "There's a private apartment above the fire station on Main Street that Walt used to stay in.",
  "Every single trash can in Disneyland is within 30 steps of any spot in the park.",
  "The voice of the Haunted Mansion's Ghost Host is Paul Frees, who also voiced Boris Badenov.",
  "Splash Mountain drops you at 40 mph — faster than most people expect for a log flume.",
  "Finding Nemo Submarine Voyage reused subs from the original 1959 attraction.",
  "The Blue Bayou restaurant is technically inside the Pirates of the Caribbean ride.",
  "Walt Disney wanted Disneyland to be a place parents could enjoy just as much as kids.",
  "On hot days, the Mark Twain Riverboat can carry up to 300 guests — the largest capacity ride.",
  "The gift shops are always at the exits of rides — never an accident, always by design.",
  "Star Wars: Galaxy's Edge is built so no modern buildings are ever visible from inside.",
  "Matterhorn has a basketball court inside it — cast members play between shifts.",
  "'It's a Small World' was created for the 1964 World's Fair before moving to Disneyland.",
  "Tomorrowland was redesigned in 1998 because the original 1967 future looked… too accurate.",
  "The flowers on Main Street are replaced every single night after closing.",
  "New Orleans Square was Walt Disney's personal favorite land in the park.",
];

const STATUS_MESSAGES = [
  "Warming up the magic…",
  "Checking crowd forecasts…",
  "Consulting the crystal ball…",
  "Loading ride wait times…",
  "Almost ready for your adventure…",
];

type StarDef = { size: number; top: number; left: number; dur: number; delay: number; op: number };

export default function LoadingScreen() {
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [statusIndex, setStatusIndex] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [stars, setStars] = useState<StarDef[]>([]);
  const [doneText, setDoneText] = useState(false);

  const progressRef = useRef(0);
  const statusRef = useRef(0);
  const dismissedRef = useRef(false);
  const progressInterval = useRef<ReturnType<typeof setInterval>>();
  const factInterval = useRef<ReturnType<typeof setInterval>>();

  // Generate stars client-side only
  useEffect(() => {
    setStars(
      Array.from({ length: 80 }, () => ({
        size: Math.random() * 2.5 + 1,
        top: Math.random() * 100,
        left: Math.random() * 100,
        dur: +(Math.random() * 3 + 2).toFixed(1),
        delay: +(Math.random() * 4).toFixed(1),
        op: +(Math.random() * 0.5 + 0.3).toFixed(2),
      }))
    );
  }, []);

  // Randomize starting fact client-side only (avoids hydration mismatch)
  useEffect(() => {
    setFactIndex(Math.floor(Math.random() * FACTS.length));
  }, []);

  // Fact rotation
  useEffect(() => {
    factInterval.current = setInterval(() => setFactIndex((i) => i + 1), 4000);
    return () => clearInterval(factInterval.current);
  }, []);

  // Progress bar
  useEffect(() => {
    progressInterval.current = setInterval(() => {
      const p = progressRef.current;
      if (p >= 99) return;
      const inc =
        p < 30 ? Math.random() * 4 + 1
        : p < 70 ? Math.random() * 6 + 2
        : p < 90 ? Math.random() * 2 + 0.5
        : Math.random() * 0.8 + 0.2;
      progressRef.current = Math.min(p + inc, 99);
      setProgress(progressRef.current);
      const si = Math.floor(progressRef.current / 20);
      if (si !== statusRef.current && si < STATUS_MESSAGES.length) {
        statusRef.current = si;
        setStatusIndex(si);
      }
    }, 180);
    return () => clearInterval(progressInterval.current);
  }, []);

  const dismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearInterval(progressInterval.current);
    clearInterval(factInterval.current);
    setProgress(100);
    setDoneText(true);
    setTimeout(() => setVisible(false), 800);
  }, []);

  // Expose finishLoading + auto-dismiss
  useEffect(() => {
    (window as Window & { finishLoading?: () => void }).finishLoading = dismiss;
    const timer = setTimeout(dismiss, 3000);
    return () => {
      clearTimeout(timer);
      delete (window as Window & { finishLoading?: () => void }).finishLoading;
    };
  }, [dismiss]);

  const GOLD = "#c49018";
  const AMBER = "#d4701a";
  const BG = "#faf4e8";
  const DIM = "rgba(196,144,24,0.18)";

  return (
    <div
      className="ls-root"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.8s ease, visibility 0.8s ease",
      }}
    >
      {/* Star field */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {stars.map((s, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              borderRadius: "50%",
              background: AMBER,
              width: s.size,
              height: s.size,
              top: `${s.top}%`,
              left: `${s.left}%`,
              animation: `ls-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
              opacity: 0,
              ["--op" as string]: s.op,
            }}
          />
        ))}
      </div>

      {/* Retro frame */}
      <div
        style={{
          position: "absolute",
          inset: 20,
          border: `2px solid ${DIM}`,
          pointerEvents: "none",
        }}
      >
        <div style={{ position: "absolute", inset: 6, border: `1px solid ${DIM}` }} />
        {(["tl", "tr", "bl", "br"] as const).map((c) => (
          <div
            key={c}
            style={{
              position: "absolute",
              width: 18,
              height: 18,
              borderColor: GOLD,
              borderStyle: "solid",
              opacity: 0.6,
              ...(c === "tl" ? { top: -2, left: -2, borderWidth: "2px 0 0 2px" } : {}),
              ...(c === "tr" ? { top: -2, right: -2, borderWidth: "2px 2px 0 0" } : {}),
              ...(c === "bl" ? { bottom: -2, left: -2, borderWidth: "0 0 2px 2px" } : {}),
              ...(c === "br" ? { bottom: -2, right: -2, borderWidth: "0 2px 2px 0" } : {}),
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Title */}
        <h1
          className={abrilFatface.className}
          style={{
            fontSize: "clamp(2rem, 5vw, 3.2rem)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: GOLD,
            textShadow: `0 2px 20px rgba(196,144,24,0.25)`,
            marginBottom: 6,
            textAlign: "center",
            lineHeight: 1.1,
          }}
        >
          Disneyland
        </h1>
        <p
          style={{
            fontFamily: "monospace",
            fontSize: "clamp(0.6rem, 1.5vw, 0.72rem)",
            color: AMBER,
            letterSpacing: "0.25em",
            textTransform: "uppercase",
            marginBottom: 36,
            opacity: 0.9,
          }}
        >
          Planner
        </p>

        {/* Ferris wheel */}
        <div
          style={{
            position: "relative",
            width: 240,
            height: 240,
            marginBottom: 36,
          }}
        >
          <svg
            viewBox="0 0 240 230"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: "100%", height: "100%", overflow: "visible" }}
          >
            <defs>
              <radialGradient id="ls-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={GOLD} stopOpacity="0.12" />
                <stop offset="100%" stopColor={GOLD} stopOpacity="0" />
              </radialGradient>
              <filter id="ls-goldglow">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <circle cx="120" cy="110" r="85" fill="url(#ls-glow)" />

            {/* Support legs */}
            <line x1="120" y1="190" x2="68" y2="218" stroke={GOLD} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
            <line x1="120" y1="190" x2="172" y2="218" stroke={GOLD} strokeWidth="3" strokeLinecap="round" opacity="0.7" />
            <line x1="78" y1="208" x2="162" y2="208" stroke={GOLD} strokeWidth="1.5" opacity="0.4" />
            <line x1="86" y1="214" x2="154" y2="214" stroke={GOLD} strokeWidth="1" opacity="0.25" />
            <rect x="55" y="216" width="130" height="6" rx="3" fill={GOLD} opacity="0.35" />

            {/* Rotating group */}
            <g style={{ transformOrigin: "120px 110px", animation: "ls-spin 8s linear infinite" }}>
              <circle cx="120" cy="110" r="78" stroke={GOLD} strokeWidth="1.5" opacity="0.3" fill="none" />
              <circle cx="120" cy="110" r="55" stroke={GOLD} strokeWidth="1" opacity="0.18" fill="none" />

              {/* 8 spokes */}
              {[
                [120, 32], [175, 55], [198, 110], [175, 165],
                [120, 188], [65, 165], [42, 110], [65, 55],
              ].map(([x2, y2], i) => (
                <line key={i} x1="120" y1="110" x2={x2} y2={y2} stroke={GOLD} strokeWidth="1.5" opacity="0.5" />
              ))}

              {/* 8 gondolas */}
              {[
                { ox: 120, oy: 32,  rx: 110, ry: 23,  l1x: 115, l2x: 125 },
                { ox: 175, oy: 55,  rx: 165, ry: 46,  l1x: 170, l2x: 180 },
                { ox: 198, oy: 110, rx: 188, ry: 101, l1x: 193, l2x: 203 },
                { ox: 175, oy: 165, rx: 165, ry: 156, l1x: 170, l2x: 180 },
                { ox: 120, oy: 188, rx: 110, ry: 179, l1x: 115, l2x: 125 },
                { ox: 65,  oy: 165, rx: 55,  ry: 156, l1x: 60,  l2x: 70  },
                { ox: 42,  oy: 110, rx: 32,  ry: 101, l1x: 37,  l2x: 47  },
                { ox: 65,  oy: 55,  rx: 55,  ry: 46,  l1x: 60,  l2x: 70  },
              ].map((g, i) => (
                <g key={i} style={{ transformOrigin: `${g.ox}px ${g.oy}px`, animation: "ls-counter 8s linear infinite" }}>
                  <rect x={g.rx} y={g.ry} width="20" height="16" rx="3" fill={AMBER} stroke={GOLD} strokeWidth="1.5" />
                  <line x1={g.l1x} y1={g.ry} x2={g.l1x} y2={g.oy} stroke={GOLD} strokeWidth="1" opacity="0.6" />
                  <line x1={g.l2x} y1={g.ry} x2={g.l2x} y2={g.oy} stroke={GOLD} strokeWidth="1" opacity="0.6" />
                </g>
              ))}
            </g>

            {/* Hub */}
            <circle cx="120" cy="110" r="10" fill={BG} stroke={GOLD} strokeWidth="2.5" />
            <circle cx="120" cy="110" r="4" fill={GOLD} />

            {/* Lights */}
            {[
              [120, 32], [175, 55], [198, 110], [175, 165],
              [120, 188], [65, 165], [42, 110], [65, 55],
            ].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r="3" fill={GOLD} filter="url(#ls-goldglow)" opacity="0.9" />
            ))}
          </svg>
        </div>

        {/* Progress bar */}
        <div
          style={{
            width: "min(320px, 80vw)",
            height: 4,
            background: "rgba(196,144,24,0.18)",
            borderRadius: 2,
            overflow: "hidden",
            marginBottom: 28,
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              background: `linear-gradient(90deg, ${AMBER}, ${GOLD})`,
              borderRadius: 2,
              width: `${progress}%`,
              transition: "width 0.4s ease",
              boxShadow: "0 0 8px rgba(196,144,24,0.4)",
            }}
          />
        </div>

        {/* Fun facts */}
        <div
          style={{
            width: "min(380px, 88vw)",
            textAlign: "center",
            minHeight: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "monospace",
              fontSize: "0.6rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: AMBER,
              opacity: 0.8,
            }}
          >
            ★ Did you know? ★
          </span>
          <p
            key={factIndex}
            style={{
              fontFamily: `${abrilFatface.style.fontFamily}, Georgia, serif`,
              fontSize: "clamp(0.85rem, 2vw, 1rem)",
              color: "#1a152e",
              lineHeight: 1.55,
              animation: "ls-factfade 0.6s ease",
            }}
          >
            {FACTS[factIndex % FACTS.length]}
          </p>
        </div>

        {/* Status */}
        <p
          style={{
            marginTop: 16,
            fontFamily: "monospace",
            fontSize: "0.65rem",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: GOLD,
            opacity: 0.8,
          }}
        >
          {doneText ? "Welcome to the magic! ✨" : STATUS_MESSAGES[statusIndex]}
        </p>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes ls-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes ls-counter {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes ls-twinkle {
          0%, 100% { opacity: 0; transform: scale(0.5); }
          50% { opacity: var(--op, 0.7); transform: scale(1); }
        }
        @keyframes ls-factfade {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .ls-root, .ls-root * {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
          }
        }
      `}</style>
    </div>
  );
}
