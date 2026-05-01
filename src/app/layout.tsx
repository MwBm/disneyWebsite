import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import SpaceBackground from "@/components/SpaceBackground";
import LoadingScreen from "@/components/LoadingScreen";

export const metadata: Metadata = {
  title: "Disneyland Planner",
  description: "Crowd forecasts, wait time predictions, and trip planning for Disneyland.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cream-100">
        <LoadingScreen />
        <SpaceBackground />
<div className="relative z-10">
          <Nav />
          <main className="max-w-5xl mx-auto px-4 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
