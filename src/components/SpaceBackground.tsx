"use client";

import { useEffect, useRef } from "react";

interface Star {
  x: number;     // 0..1 fractional
  y: number;
  r: number;
  opacity: number;
  layer: number; // 0=far 1=mid 2=near
  phase: number;
}

const PARALLAX = [0.018, 0.045, 0.09];

function createStars(count: number): Star[] {
  return Array.from({ length: count }, () => {
    const roll = Math.random();
    const layer = roll < 0.6 ? 0 : roll < 0.85 ? 1 : 2;
    return {
      x: Math.random(),
      y: Math.random(),
      r:
        layer === 0
          ? 0.4 + Math.random() * 0.4
          : layer === 1
          ? 0.7 + Math.random() * 0.6
          : 1.2 + Math.random() * 1.4,
      opacity: layer === 0 ? 0.25 + Math.random() * 0.35 : 0.5 + Math.random() * 0.5,
      layer,
      phase: Math.random() * Math.PI * 2,
    };
  });
}

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: 0.5, y: 0.5 });
  const target = useRef({ x: 0.5, y: 0.5 });
  const stars = useRef<Star[]>(createStars(220));
  const raf = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0;
    let h = 0;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      target.current = { x: e.clientX / w, y: e.clientY / h };
    };
    window.addEventListener("mousemove", onMove);

    let t = 0;

    function draw() {
      t += 0.008;

      // Smooth mouse lerp
      mouse.current.x += (target.current.x - mouse.current.x) * 0.04;
      mouse.current.y += (target.current.y - mouse.current.y) * 0.04;
      const mx = mouse.current.x - 0.5;
      const my = mouse.current.y - 0.5;

      // Deep space bg
      ctx.fillStyle = "#04091a";
      ctx.fillRect(0, 0, w, h);

      // Nebula blobs
      const drawNebula = (cx: number, cy: number, r: number, rgba: string) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      };
      drawNebula(w * 0.72, h * 0.22, w * 0.42, "rgba(18,45,110,0.18)");
      drawNebula(w * 0.14, h * 0.72, w * 0.36, "rgba(48,14,88,0.15)");
      drawNebula(w * 0.48, h * 0.85, w * 0.28, "rgba(8,36,76,0.12)");

      // Stars
      for (const s of stars.current) {
        const p = PARALLAX[s.layer];
        const px = (((s.x + mx * p) % 1) + 1) % 1;
        const py = (((s.y + my * p) % 1) + 1) % 1;
        const twinkle = s.layer > 0 ? 0.7 + 0.3 * Math.sin(t * 1.5 + s.phase) : 1;
        const alpha = s.opacity * twinkle;
        const sx = px * w;
        const sy = py * h;

        // Glow halo for large near stars
        if (s.layer === 2 && s.r > 2) {
          const gr = s.r * 4;
          const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
          g.addColorStop(0, `rgba(190,215,255,${alpha})`);
          g.addColorStop(0.35, `rgba(140,180,255,${alpha * 0.3})`);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(sx, sy, gr, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(215,230,255,${alpha})`;
        ctx.fill();
      }

      raf.current = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
