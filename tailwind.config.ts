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
        // Dark warm backgrounds (class names preserved for compat)
        cream: {
          50:  "#080703",
          100: "#0d0b09",  // body bg
          200: "#221a0f",  // borders / dividers / table headers
        },
        warm: {
          900: "#e8e4d8",  // primary text — warm cream
          700: "#9b8f7e",  // secondary text
          500: "#5a5048",  // muted / placeholder
        },
        // Primary accent — warm gold (class names kept for compat)
        orange: {
          400: "#f0c060",  // gold light
          500: "#d4a438",  // gold main CTA
          600: "#b8882a",  // gold dark
        },
        // Card / surface tokens
        space: {
          card: "#141009",
          900:  "#080703",
          800:  "#0d0b09",
          700:  "#221a0f",
          600:  "#2a1e0a",
        },
        // Burnt amber secondary
        amber: {
          400: "#fb923c",
          500: "#ea6c1e",
        },
      },
      fontFamily: {
        sans: ["Outfit", "system-ui", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
