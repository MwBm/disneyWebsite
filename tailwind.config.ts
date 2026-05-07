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
        // ── Semantic tokens (CSS-variable-backed, theme-aware) ──────────────

        // Preserve existing class names so components need zero changes
        cream: {
          50:  "rgb(var(--color-bg)      / <alpha-value>)",
          100: "rgb(var(--color-bg)      / <alpha-value>)",
          200: "rgb(var(--color-border)  / <alpha-value>)",
        },
        warm: {
          900: "rgb(var(--color-text-primary)   / <alpha-value>)",
          700: "rgb(var(--color-text-secondary) / <alpha-value>)",
          500: "rgb(var(--color-text-muted)     / <alpha-value>)",
        },
        orange: {
          400: "rgb(var(--color-gold)  / <alpha-value>)",
          500: "rgb(var(--color-gold)  / <alpha-value>)",
          600: "rgb(var(--color-amber) / <alpha-value>)",
        },
        space: {
          card: "rgb(var(--color-card)    / <alpha-value>)",
          900:  "rgb(var(--color-bg)      / <alpha-value>)",
          800:  "rgb(var(--color-bg)      / <alpha-value>)",
          700:  "rgb(var(--color-border)  / <alpha-value>)",
          600:  "rgb(var(--color-border)  / <alpha-value>)",
        },
        amber: {
          400: "rgb(var(--color-amber) / <alpha-value>)",
          500: "rgb(var(--color-amber) / <alpha-value>)",
        },

        // ── New semantic shortcuts ──────────────────────────────────────────
        bg:      "rgb(var(--color-bg)      / <alpha-value>)",
        surface: "rgb(var(--color-surface) / <alpha-value>)",
        card:    "rgb(var(--color-card)    / <alpha-value>)",
        gold:    "rgb(var(--color-gold)    / <alpha-value>)",
        rose:    "rgb(var(--color-rose)    / <alpha-value>)",
        indigo:  "rgb(var(--color-indigo)  / <alpha-value>)",
      },
      fontFamily: {
        sans:    ["Outfit", "system-ui", "sans-serif"],
        display: ["Fraunces", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
