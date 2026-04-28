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
        cream: {
          50: "#fdfcfa",
          100: "#faf7f2",
          200: "#f0ebe3",
        },
        orange: {
          500: "#c94a1f",
          400: "#e07d52",
          600: "#a33916",
        },
        warm: {
          900: "#1a1410",
          700: "#6b5f57",
          500: "#9c8f87",
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
