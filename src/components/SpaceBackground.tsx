"use client";

import { useEffect, useRef } from "react";

type Star = {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  phase: number;
  pulseSpeed: number;
  color: string;
};

const STAR_COLORS = ["#ffffff", "#cfe1ff", "#9fc4ff", "#d9edff"];

/**
 * A deliberately still star field. Stars retain their position forever; only
 * their luminance changes, so the app feels calm once the arrival animation
 * has finished.
 */
export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrame = useRef<number>(0);
  const stars = useRef<Star[]>([]);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const density = Math.min(window.innerWidth * window.innerHeight / 9_000, 180);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * pixelRatio);
      canvas.height = Math.floor(window.innerHeight * pixelRatio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // Rebuild only on a viewport change. Rendering never alters x or y.
      stars.current = Array.from({ length: Math.max(80, Math.floor(density)) }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        radius: Math.random() < 0.88 ? Math.random() * 0.8 + 0.35 : Math.random() * 1.15 + 1,
        opacity: Math.random() * 0.48 + 0.26,
        phase: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.7 + 0.25,
        color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
      }));
    };

    const draw = (time = 0) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      context.clearRect(0, 0, width, height);

      const glow = context.createRadialGradient(width * 0.76, height * 0.05, 0, width * 0.76, height * 0.05, Math.max(width, height) * 0.7);
      glow.addColorStop(0, "rgba(71, 88, 124, 0.12)");
      glow.addColorStop(0.56, "rgba(29, 36, 55, 0.05)");
      glow.addColorStop(1, "rgba(3, 7, 18, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      for (const star of stars.current) {
        const pulse = reducedMotion.current
          ? 1
          : 0.72 + Math.sin(time * 0.001 * star.pulseSpeed + star.phase) * 0.28;
        const alpha = star.opacity * pulse;

        if (star.radius > 1.05) {
          const halo = context.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.radius * 5);
          halo.addColorStop(0, `${star.color}${Math.round(alpha * 70).toString(16).padStart(2, "0")}`);
          halo.addColorStop(1, `${star.color}00`);
          context.fillStyle = halo;
          context.beginPath();
          context.arc(star.x, star.y, star.radius * 5, 0, Math.PI * 2);
          context.fill();
        }

        context.globalAlpha = alpha;
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;

      if (!reducedMotion.current) animationFrame.current = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationFrame.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="space-background" aria-hidden="true" />;
}
