"use client";

import dynamic from "next/dynamic";

/**
 * Mounts the loading overlay client-side only. LoadingScreen seeds its
 * starfield and opening fact from Math.random(), so a server render would never
 * match the client's.
 *
 * `ssr: false` is only permitted inside a Client Component, which is why this
 * wrapper exists rather than the dynamic() call living in the layout.
 */
const LoadingScreen = dynamic(() => import("./LoadingScreen"), { ssr: false });

export default function LoadingScreenMount() {
  return <LoadingScreen />;
}
