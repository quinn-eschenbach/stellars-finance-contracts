import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1320px" } },
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
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
      },
      fontFamily: {
        sans: ['"Geist"', "system-ui", "sans-serif"],
        mono: ['"Geist Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        display: ['"Instrument Serif"', "ui-serif", "Georgia", "serif"],
      },
      letterSpacing: {
        tightest: "-0.04em",
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 0 0 1px rgba(255,255,255,0.04), 0 24px 60px -30px rgba(0,0,0,0.7)",
        "card-hover":
          "0 1px 0 0 rgba(255,255,255,0.06) inset, 0 0 0 1px rgba(220,170,110,0.18), 0 30px 70px -30px rgba(0,0,0,0.85)",
        glow: "0 0 0 1px rgba(212,165,116,0.35), 0 0 30px -8px rgba(212,165,116,0.45)",
      },
      backgroundImage: {
        "aurora-amber":
          "radial-gradient(60% 80% at 18% 40%, hsl(28 70% 45% / 0.55), transparent 60%)",
        "aurora-moss":
          "radial-gradient(50% 70% at 48% 55%, hsl(140 35% 35% / 0.45), transparent 60%)",
        "aurora-dusk":
          "radial-gradient(60% 80% at 82% 50%, hsl(248 60% 30% / 0.55), transparent 60%)",
      },
      keyframes: {
        "drift-a": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(3%,-2%,0) scale(1.05)" },
        },
        "drift-b": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(-2%,3%,0) scale(1.08)" },
        },
        "drift-c": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(-3%,-2%,0) scale(1.04)" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "ember-pulse": {
          "0%, 100%": { opacity: "0.7" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "drift-a": "drift-a 24s ease-in-out infinite",
        "drift-b": "drift-b 32s ease-in-out infinite",
        "drift-c": "drift-c 28s ease-in-out infinite",
        "fade-up": "fade-up 600ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "ember-pulse": "ember-pulse 2.4s ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
