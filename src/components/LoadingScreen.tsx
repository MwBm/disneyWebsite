"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Streak = {
  angle: number;
  length: number;
  thickness: number;
  delay: number;
  duration: number;
  opacity: number;
};

/** Long enough for the arrival effect to be legible, short enough not to block the app. */
export const MIN_VISIBLE_MS = 1_050;
/** Must match the fade transition below. */
export const FADE_MS = 350;

function createStreaks(): Streak[] {
  return Array.from({ length: 72 }, () => ({
    angle: Math.random() * 360,
    length: Math.round(Math.random() * 116 + 42),
    thickness: Math.random() < 0.88 ? 1 : 2,
    delay: +(Math.random() * 1.05).toFixed(2),
    duration: +(Math.random() * 0.54 + 0.56).toFixed(2),
    opacity: +(Math.random() * 0.47 + 0.4).toFixed(2),
  }));
}

export default function LoadingScreen() {
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  // This component is mounted client-only, so the visual randomness does not
  // create a server/client hydration mismatch.
  const [streaks] = useState(createStreaks);
  const dismissed = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setInterval>>();
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>();

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    clearInterval(progressTimer.current);
    setProgress(100);
    fadeTimer.current = setTimeout(() => setVisible(false), FADE_MS);
  }, []);

  useEffect(() => {
    (window as Window & { finishLoading?: () => void }).finishLoading = dismiss;

    progressTimer.current = setInterval(() => {
      setProgress((value) => Math.min(value + Math.max(2, (90 - value) * 0.09), 92));
    }, 90);
    const arrivalTimer = setTimeout(dismiss, MIN_VISIBLE_MS);

    return () => {
      clearInterval(progressTimer.current);
      clearTimeout(arrivalTimer);
      clearTimeout(fadeTimer.current);
      delete (window as Window & { finishLoading?: () => void }).finishLoading;
    };
  }, [dismiss]);

  return (
    <div
      className="hyperdrive-loader"
      aria-label="Loading Disneyland Planner"
      style={{
        opacity: visible ? 1 : 0,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        transition: `opacity ${FADE_MS}ms ease-out, visibility ${FADE_MS}ms ease-out`,
      }}
    >
      <div className="hyperdrive-vignette" />
      <div className="hyperdrive-rays" aria-hidden="true">
        {streaks.map((streak, index) => (
          <span
            className="hyperdrive-ray"
            key={index}
            style={{ transform: `rotate(${streak.angle}deg)` }}
          >
            <i
              style={{
                width: streak.length,
                height: streak.thickness,
                opacity: streak.opacity,
                animationDelay: `${streak.delay}s`,
                animationDuration: `${streak.duration}s`,
              }}
            />
          </span>
        ))}
      </div>

      <div className="hyperdrive-copy">
        <div className="hyperdrive-mark" aria-hidden="true">✦</div>
        <p className="hyperdrive-eyebrow">Disneyland Planner</p>
        <p className="hyperdrive-status">Entering hyperspace</p>
        <div className="hyperdrive-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
      </div>

      <style>{`
        .hyperdrive-loader {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: grid;
          place-items: center;
          overflow: hidden;
          background: radial-gradient(circle at 50% 50%, #142a61 0%, #07112d 24%, #030712 70%);
        }
        .hyperdrive-vignette {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: radial-gradient(circle, transparent 24%, rgb(0 0 0 / 0.43) 100%);
          pointer-events: none;
        }
        .hyperdrive-rays { position: absolute; inset: 0; overflow: hidden; }
        .hyperdrive-ray {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 1px;
          transform-origin: 0 50%;
        }
        .hyperdrive-ray i {
          display: block;
          transform-origin: left center;
          background: linear-gradient(90deg, transparent, #d9ecff 26%, #fff 68%, transparent);
          border-radius: 999px;
          box-shadow: 0 0 8px rgb(142 195 255 / 0.7);
          animation-name: hyperdrive-rush;
          animation-timing-function: cubic-bezier(0.14, 0.64, 0.25, 1);
          animation-iteration-count: infinite;
        }
        .hyperdrive-copy {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          color: #eff6ff;
          text-align: center;
          text-shadow: 0 2px 28px rgb(80 152 255 / 0.34);
        }
        .hyperdrive-mark { color: #b9dcff; font-size: 1.35rem; line-height: 1; margin-bottom: 1rem; }
        .hyperdrive-eyebrow {
          margin: 0;
          font-size: clamp(0.68rem, 1.8vw, 0.8rem);
          font-weight: 500;
          letter-spacing: 0.32em;
          text-transform: uppercase;
        }
        .hyperdrive-status {
          margin: 0.72rem 0 1rem;
          color: #9fbbe9;
          font-size: 0.68rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }
        .hyperdrive-progress {
          width: min(190px, 46vw);
          height: 1px;
          overflow: hidden;
          background: rgb(182 216 255 / 0.24);
        }
        .hyperdrive-progress span {
          display: block;
          width: 100%;
          height: 100%;
          transform-origin: left center;
          background: #d5ecff;
          box-shadow: 0 0 10px #b9dcff;
          transition: transform 0.14s ease-out;
        }
        @keyframes hyperdrive-rush {
          0% { transform: translateX(0) scaleX(0.05); opacity: 0; }
          12% { opacity: 0.88; }
          100% { transform: translateX(105vmax) scaleX(1.15); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .hyperdrive-ray i { animation: none; opacity: 0.25 !important; transform: translateX(25vmax) scaleX(0.15); }
          .hyperdrive-progress span { transition: none; }
        }
      `}</style>
    </div>
  );
}
