"use client";

import { useEffect, useRef } from "react";

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decayRate: number;
  size: number;
  r: number;
  g: number;
  b: number;
}

const PALETTE = [
  { r: 240, g: 192, b: 96 },  // gold
  { r: 251, g: 146, b: 60 },  // amber
  { r: 255, g: 218, b: 130 }, // light gold
  { r: 245, g: 168, b: 75 },  // golden amber
];

function drawSparkle(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  size: number, alpha: number,
  r: number, g: number, b: number
) {
  if (size < 0.2 || alpha < 0.01) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  // 4-pointed star
  const outer = size;
  const inner = size * 0.3;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4 - Math.PI / 2;
    const rad = i % 2 === 0 ? outer : inner;
    const px = Math.cos(angle) * rad;
    const py = Math.sin(angle) * rad;
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fill();

  // Soft glow halo
  if (size > 1.8) {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.5);
    grad.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.45})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.beginPath();
    ctx.arc(0, 0, size * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.restore();
}

export default function CustomCursor() {
  const arrowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pos = useRef({ x: -200, y: -200 });
  const sparkles = useRef<Sparkle[]>([]);
  const lastSpawn = useRef({ x: -200, y: -200 });
  const raf = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const arrow = arrowRef.current!;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };

      const dx = e.clientX - lastSpawn.current.x;
      const dy = e.clientY - lastSpawn.current.y;
      if (dx * dx + dy * dy > 64) { // spawn every ~8px
        lastSpawn.current = { x: e.clientX, y: e.clientY };
        const count = Math.random() < 0.35 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const c = PALETTE[Math.floor(Math.random() * PALETTE.length)];
          sparkles.current.push({
            x: e.clientX + (Math.random() - 0.5) * 5,
            y: e.clientY + (Math.random() - 0.5) * 5,
            vx: (Math.random() - 0.5) * 1.4,
            vy: -0.4 - Math.random() * 1.0,
            life: 1,
            decayRate: 0.022 + Math.random() * 0.018,
            size: 1.8 + Math.random() * 3.2,
            r: c.r, g: c.g, b: c.b,
          });
        }
      }
    };
    window.addEventListener("mousemove", onMove);

    function tick() {
      const { x, y } = pos.current;

      // Arrow follows cursor tip exactly
      arrow.style.transform = `translate(${x}px,${y}px)`;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      sparkles.current = sparkles.current.filter((s) => s.life > 0);
      for (const s of sparkles.current) {
        s.life -= s.decayRate;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.025; // gentle gravity
        s.vx *= 0.98;

        const t = Math.max(0, s.life);
        drawSparkle(ctx, s.x, s.y, s.size * (t * 0.7 + 0.3), t, s.r, s.g, s.b);
      }

      raf.current = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99998,
          pointerEvents: "none",
        }}
      />
      <div
        ref={arrowRef}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 99999,
          pointerEvents: "none",
          willChange: "transform",
        }}
      >
        <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
          <path
            d="M1.5 1.5 L1.5 16 L5.2 12.2 L8.4 20 L11.2 18.8 L8 11 L13.5 11 Z"
            fill="#f0c060"
            stroke="#07080e"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </>
  );
}
