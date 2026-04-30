"use client";

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  colorR: number;
  colorG: number;
  colorB: number;
  phase: number;
  driftSpeed: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  opacity: number;
  color: string;
}

const PALETTE = [
  { r: 240, g: 192, b: 96 },  // warm gold
  { r: 251, g: 146, b: 60 },  // burnt amber
  { r: 232, g: 220, b: 195 }, // cream
  { r: 245, g: 168, b: 80 },  // golden amber
];

const CONNECT_DIST = 130;
const MOUSE_RADIUS = 160;
const COUNT = 160;

export default function SpaceBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const ripples = useRef<Ripple[]>([]);
  const particles = useRef<Particle[]>([]);
  const raf = useRef<number>(0);
  const dims = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    function initParticles() {
      const { w, h } = dims.current;
      particles.current = Array.from({ length: COUNT }, () => {
        const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35,
          r: 0.8 + Math.random() * 2.2,
          colorR: c.r,
          colorG: c.g,
          colorB: c.b,
          phase: Math.random() * Math.PI * 2,
          driftSpeed: 0.25 + Math.random() * 0.5,
        };
      });
    }

    function resize() {
      dims.current.w = canvas.width = window.innerWidth;
      dims.current.h = canvas.height = window.innerHeight;
      initParticles();
    }

    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };
    const onClick = (e: MouseEvent) => {
      const colors = ["rgba(240,192,96,", "rgba(251,146,60,", "rgba(232,220,195,"];
      ripples.current.push({
        x: e.clientX,
        y: e.clientY,
        r: 0,
        opacity: 0.7,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
      // Second inner ripple
      ripples.current.push({
        x: e.clientX,
        y: e.clientY,
        r: 0,
        opacity: 0.35,
        color: "rgba(245,168,80,",
      });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("click", onClick);

    let t = 0;

    function draw() {
      t += 0.01;
      const { w, h } = dims.current;
      const mx = mouse.current.x;
      const my = mouse.current.y;

      // Background
      ctx.fillStyle = "#070810";
      ctx.fillRect(0, 0, w, h);

      // Warm ambient glows
      const glow = (cx: number, cy: number, r: number, rgba: string) => {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, rgba);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      };
      glow(w * 0.75, h * 0.2, w * 0.5, "rgba(251,146,60,0.045)");
      glow(w * 0.15, h * 0.75, w * 0.45, "rgba(240,192,96,0.04)");
      glow(w * 0.5, h * 0.5, w * 0.3, "rgba(210,160,60,0.02)");

      // Update particles
      for (const p of particles.current) {
        // Organic drift
        p.x += p.vx + Math.sin(t * p.driftSpeed + p.phase) * 0.18;
        p.y += p.vy + Math.cos(t * p.driftSpeed * 0.8 + p.phase + 1) * 0.18;

        // Wrap
        if (p.x < -12) p.x = w + 12;
        else if (p.x > w + 12) p.x = -12;
        if (p.y < -12) p.y = h + 12;
        else if (p.y > h + 12) p.y = -12;

        // Mouse magnetic attraction
        const dx = mx - p.x;
        const dy = my - p.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < MOUSE_RADIUS * MOUSE_RADIUS && distSq > 0) {
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / MOUSE_RADIUS) * 0.9;
          p.vx += (dx / dist) * force * 0.055;
          p.vy += (dy / dist) * force * 0.055;
        }

        // Ripple push
        for (const rip of ripples.current) {
          const rdx = p.x - rip.x;
          const rdy = p.y - rip.y;
          const rd = Math.sqrt(rdx * rdx + rdy * rdy);
          const band = 40;
          if (rd > 0 && Math.abs(rd - rip.r) < band) {
            const strength = (1 - Math.abs(rd - rip.r) / band) * 2.8;
            p.vx += (rdx / rd) * strength;
            p.vy += (rdy / rd) * strength;
          }
        }

        // Damping + speed cap
        p.vx *= 0.97;
        p.vy *= 0.97;
        const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (spd > 2.5) { p.vx = (p.vx / spd) * 2.5; p.vy = (p.vy / spd) * 2.5; }
      }

      // Draw connections
      ctx.lineWidth = 0.6;
      for (let i = 0; i < particles.current.length; i++) {
        const a = particles.current[i];
        for (let j = i + 1; j < particles.current.length; j++) {
          const b = particles.current[j];
          const ddx = a.x - b.x;
          const ddy = a.y - b.y;
          const d = Math.sqrt(ddx * ddx + ddy * ddy);
          if (d < CONNECT_DIST) {
            const alpha = (1 - d / CONNECT_DIST) * 0.3;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(240,192,96,${alpha})`;
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles.current) {
        const { r: pr, colorR: cr, colorG: cg, colorB: cb } = p;
        const dm = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
        const boost = dm < MOUSE_RADIUS ? (1 - dm / MOUSE_RADIUS) * 0.6 : 0;

        // Glow halo for larger particles
        if (pr > 1.4) {
          const haloR = pr * 5;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
          g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.35 + boost})`);
          g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
        }

        // Core
        ctx.beginPath();
        ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.75 + boost})`;
        ctx.fill();
      }

      // Draw ripples
      ripples.current = ripples.current.filter((rip) => rip.opacity > 0.015);
      for (const rip of ripples.current) {
        rip.r += 5.5;
        rip.opacity *= 0.934;

        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
        ctx.strokeStyle = `${rip.color}${rip.opacity})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        if (rip.r > 20) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.r * 0.6, 0, Math.PI * 2);
          ctx.strokeStyle = `${rip.color}${rip.opacity * 0.4})`;
          ctx.lineWidth = 0.5;
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
