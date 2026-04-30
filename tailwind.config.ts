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
          50:  "#050810",
          100: "#080c18",  // body bg
          200: "#13192a",  // borders / dividers / table headers
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
          card: "#0d1422",
          900:  "#050810",
          800:  "#080c18",
          700:  "#13192a",
          600:  "#1c2640",
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
