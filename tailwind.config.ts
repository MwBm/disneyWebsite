import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Remapped to space palette — existing class names preserved
        cream: {
          50:  "#020b18",
          100: "#060f20",  // body bg
          200: "#0e2040",  // borders / dividers / table headers
        },
        warm: {
          900: "#e0eaff",  // primary text
          700: "#7b90b8",  // secondary text
          500: "#4a5f80",  // muted / placeholder
        },
        orange: {
          400: "#60a5fa",  // blue-light
          500: "#3b82f6",  // blue main (CTA)
          600: "#2563eb",  // blue dark
        },
        // Card bg for bg-white replacements
        space: {
          card: "#0d1b35",
          900:  "#060f20",
          800:  "#0d1b35",
          700:  "#0e2040",
          600:  "#162550",
        },
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
