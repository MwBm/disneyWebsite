"use client";

import dynamic from "next/dynamic";

/**
 * Mounts the loading overlay client-side only.
 *
 * LoadingScreen seeds its starfield and its opening fact from Math.random().
 * Server-rendering it meant the server and client produced different values,
 * which the component worked around by starting empty and filling itself in via
 * two mount effects — each one an extra render pass. Skipping SSR removes the
 * mismatch at the source, and keeps a purely decorative overlay out of the
 * server HTML payload.
 *
 * `ssr: false` is only permitted inside a Client Component, which is why this
 * wrapper exists rather than the dynamic() call living in the layout.
 */
const LoadingScreen = dynamic(() => import("./LoadingScreen"), { ssr: false });

export default function LoadingScreenMount() {
  return <LoadingScreen />;
}
