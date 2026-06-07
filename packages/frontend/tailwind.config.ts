import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1320px" } },
    // Win95 has no rounded corners. Flattening the whole radius scale keeps
    // existing rounded-* call sites valid while rendering them square.
    borderRadius: {
      none: "0",
      sm: "0",
      DEFAULT: "0",
      md: "0",
      lg: "0",
      xl: "0",
      "2xl": "0",
      "3xl": "0",
      full: "0",
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        bull: "hsl(var(--bull))",
        bear: "hsl(var(--bear))",
        ember: "hsl(var(--ember))",
        moss: "hsl(var(--moss))",
        dusk: "hsl(var(--dusk))",
      },
      fontFamily: {
        sans: ['"MS Sans Serif"', "Tahoma", '"Segoe UI"', "sans-serif"],
        mono: ['"Courier New"', "Courier", "monospace"],
        display: ['"MS Sans Serif"', "Tahoma", "sans-serif"],
      },
      letterSpacing: {
        tightest: "0",
      },
      boxShadow: {
        // hover lift for window-cards: hard offset shadow, no blur
        "card-hover": "4px 4px 0 0 rgb(0 0 0 / 0.35)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "ember-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
      },
      animation: {
        // instant-ish: Win95 didn't ease, it appeared
        "fade-up": "fade-up 120ms steps(2, end) both",
        "ember-pulse": "ember-pulse 1.2s steps(2, end) infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
