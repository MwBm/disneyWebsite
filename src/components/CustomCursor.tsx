"use client";

import { useEffect, useRef } from "react";

export default function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: -100, y: -100 });
  const ringPos = useRef({ x: -100, y: -100 });
  const scale = useRef(1);
  const opacity = useRef(0.55);
  const hovering = useRef(false);
  const raf = useRef<number>(0);

  useEffect(() => {
    const dot = dotRef.current!;
    const ring = ringRef.current!;

    const onMove = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
    };
    const onOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      hovering.current = !!el.closest("a, button, input, select, [role='button']");
    };

    window.addEventListener("mousemove", onMove);
    document.addEventListener("pointerover", onOver);

    function tick() {
      const { x, y } = pos.current;

      dot.style.transform = `translate(${x}px,${y}px)`;

      ringPos.current.x += (x - ringPos.current.x) * 0.18;
      ringPos.current.y += (y - ringPos.current.y) * 0.18;

      const targetScale = hovering.current ? 1.75 : 1;
      const targetOpacity = hovering.current ? 1 : 0.55;
      scale.current += (targetScale - scale.current) * 0.18;
      opacity.current += (targetOpacity - opacity.current) * 0.18;

      ring.style.transform = `translate(${ringPos.current.x}px,${ringPos.current.y}px) scale(${scale.current})`;
      ring.style.opacity = String(opacity.current);

      raf.current = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerover", onOver);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  return (
    <>
      <div
        ref={ringRef}
        style={{
          position: "fixed",
          top: -18,
          left: -18,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1.5px solid rgba(96,165,250,0.75)",
          boxShadow: "0 0 10px rgba(96,165,250,0.3)",
          zIndex: 99999,
          pointerEvents: "none",
          willChange: "transform",
        }}
      />
      <div
        ref={dotRef}
        style={{
          position: "fixed",
          top: -3,
          left: -3,
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: "#60a5fa",
          boxShadow: "0 0 8px #60a5fa, 0 0 18px rgba(96,165,250,0.45)",
          zIndex: 99999,
          pointerEvents: "none",
          willChange: "transform",
        }}
      />
    </>
  );
}
