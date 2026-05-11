"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  colorR: number; colorG: number; colorB: number;
  phase: number; driftSpeed: number;
}

interface Ripple {
  x: number; y: number; r: number; opacity: number; color: string;
}

// "Sunlit Kingdom" — golden dust floating in warm parchment air
const PALETTE = [
  { r: 196, g: 144, b: 24  },  // rich gold
  { r: 212, g: 112, b: 26  },  // amber
  { r: 192, g: 72,  b: 112 },  // rose
  { r: 165, g: 148, b: 220 },  // soft indigo
];

const CONNECT_DIST = 130;
const MOUSE_RADIUS = 120;
const MOUSE_ATTRACTION = 0.022;
const COUNT        = 160;

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse     = useRef({ x: -9999, y: -9999 });
  const ripples   = useRef<Ripple[]>([]);
  const particles = useRef<Particle[]>([]);
  const raf       = useRef<number>(0);
  const dims      = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;

    function initParticles() {
      const { w, h } = dims.current;
      particles.current = Array.from({ length: COUNT }, () => {
        const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        return {
          x: Math.random() * w,  y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: 0.8 + Math.random() * 2.2,
          colorR: c.r, colorG: c.g, colorB: c.b,
          phase: Math.random() * Math.PI * 2,
          driftSpeed: 0.25 + Math.random() * 0.5,
        };
      });
    }

    function resize() {
      dims.current.w = canvas.width  = window.innerWidth;
      dims.current.h = canvas.height = window.innerHeight;
      initParticles();
    }

    resize();
    window.addEventListener("resize", resize);

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const { w, h } = dims.current;
      ctx.fillStyle = "#faf4e8";
      ctx.fillRect(0, 0, w, h);
      for (const p of particles.current) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.colorR},${p.colorG},${p.colorB},0.45)`;
        ctx.fill();
      }
      return () => window.removeEventListener("resize", resize);
    }

    const onMove  = (e: MouseEvent) => { mouse.current = { x: e.clientX, y: e.clientY }; };
    const onClick = (e: MouseEvent) => {
      const colors = ["rgba(196,144,24,", "rgba(212,112,26,", "rgba(192,72,112,"];
      ripples.current.push({ x: e.clientX, y: e.clientY, r: 0, opacity: 0.7,
        color: colors[Math.floor(Math.random() * colors.length)] });
      ripples.current.push({ x: e.clientX, y: e.clientY, r: 0, opacity: 0.35,
        color: "rgba(196,144,24," });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("click", onClick);

    let t = 0;

    function draw() {
      t += 0.01;
      const { w, h } = dims.current;
      const mx = mouse.current.x;
      const my = mouse.current.y;

      ctx.fillStyle = "#faf4e8";
      ctx.fillRect(0, 0, w, h);

      // Ambient glows
      const glow = (cx: number, cy: number, r: number, rgba: string) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      };
      glow(w * 0.75, h * 0.2,  w * 0.5,  "rgba(196,144,24,0.07)");
      glow(w * 0.15, h * 0.75, w * 0.45, "rgba(212,112,26,0.06)");
      glow(w * 0.5,  h * 0.5,  w * 0.3,  "rgba(192,72,112,0.03)");

      // Update particles
      for (const p of particles.current) {
        p.x += p.vx + Math.sin(t * p.driftSpeed + p.phase) * 0.18;
        p.y += p.vy + Math.cos(t * p.driftSpeed * 0.8 + p.phase + 1) * 0.18;

        if (p.x < -12)        p.x = w + 12;
        else if (p.x > w + 12) p.x = -12;
        if (p.y < -12)        p.y = h + 12;
        else if (p.y > h + 12) p.y = -12;

        const dx = mx - p.x, dy = my - p.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < MOUSE_RADIUS * MOUSE_RADIUS && distSq > 0) {
          const dist  = Math.sqrt(distSq);
          const force = (1 - dist / MOUSE_RADIUS) * 0.9;
          p.vx += (dx / dist) * force * MOUSE_ATTRACTION;
          p.vy += (dy / dist) * force * MOUSE_ATTRACTION;
        }

        for (const rip of ripples.current) {
          const rdx = p.x - rip.x, rdy = p.y - rip.y;
          const rd   = Math.sqrt(rdx * rdx + rdy * rdy);
          const band = 40;
          if (rd > 0 && Math.abs(rd - rip.r) < band) {
            const strength = (1 - Math.abs(rd - rip.r) / band) * 2.8;
            p.vx += (rdx / rd) * strength;
            p.vy += (rdy / rd) * strength;
          }
        }

        p.vx *= 0.97; p.vy *= 0.97;
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (spd > 2.5) { p.vx = (p.vx / spd) * 2.5; p.vy = (p.vy / spd) * 2.5; }
      }

      // Connections
      ctx.lineWidth = 0.6;
      for (let i = 0; i < particles.current.length; i++) {
        const a = particles.current[i];
        for (let j = i + 1; j < particles.current.length; j++) {
          const b   = particles.current[j];
          const ddx = a.x - b.x, ddy = a.y - b.y;
          const d   = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < CONNECT_DIST) {
            const alpha = (1 - d / CONNECT_DIST) * 0.14;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(196,144,24,${alpha})`;
            ctx.stroke();
          }
        }
      }

      // Particles
      for (const p of particles.current) {
        const { r: pr, colorR: cr, colorG: cg, colorB: cb } = p;
        const dm    = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
        const boost = dm < MOUSE_RADIUS ? (1 - dm / MOUSE_RADIUS) * 0.6 : 0;

        if (pr > 1.4) {
          const haloR = pr * 5;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.25 + boost})`);
          g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.5 + boost})`;
        ctx.fill();
      }

      // Ripples
      ripples.current = ripples.current.filter(rip => rip.opacity > 0.015);
      for (const rip of ripples.current) {
        rip.r       += 5.5;
        rip.opacity *= 0.934;
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
        ctx.strokeStyle = `${rip.color}${rip.opacity})`;
        ctx.lineWidth   = 1.2;
        ctx.stroke();
        if (rip.r > 20) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.r * 0.6, 0, Math.PI * 2);
          ctx.strokeStyle = `${rip.color}${rip.opacity * 0.4})`;
          ctx.lineWidth   = 0.5;
          ctx.stroke();
        }
      }

      raf.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }}
    />
  );
}
