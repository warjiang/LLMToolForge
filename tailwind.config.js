/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      // Geist breakpoints
      screens: {
        sm: "401px",
        md: "601px",
        lg: "961px",
        xl: "1200px",
        "2xl": "1400px",
      },
      fontFamily: {
        sans: [
          "Geist Sans",
          "Geist",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Semantic tokens (switch with .dark)
        background: "var(--background)",
        "background-secondary": "var(--background-secondary)",
        chrome: {
          DEFAULT: "var(--chrome)",
          foreground: "var(--chrome-foreground)",
        },
        foreground: "var(--foreground)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
          elevated: "var(--card-elevated)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
          subtle: "var(--accent-subtle)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          foreground: "var(--warning-foreground)",
        },
        // Raw Geist palette (theme-independent)
        red: {
          100: "#ffeeef", 200: "#ffe8ea", 300: "#ffe3e4", 400: "#ffd7d6",
          500: "#ffb1b3", 600: "#ff676d", 700: "#fc0035", 800: "#ea001d",
          900: "#d8001b", 1000: "#47000c",
        },
        amber: {
          100: "#fff6de", 200: "#fff4cf", 300: "#fff1c1", 400: "#ffdc73",
          500: "#ffc543", 600: "#ffa600", 700: "#ffae00", 800: "#ff9300",
          900: "#aa4d00", 1000: "#561900",
        },
        green: {
          100: "#ecfdec", 200: "#e5fce7", 300: "#d3fad1", 400: "#b9f5bc",
          500: "#82eb8d", 600: "#4ce15e", 700: "#28a948", 800: "#279141",
          900: "#107d32", 1000: "#003a00",
        },
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "6px",
        md: "12px",
        lg: "16px",
        full: "9999px",
      },
      spacing: {
        // Geist 4px scale (additive to default scale)
        18: "72px",
      },
      fontSize: {
        "heading-72": ["64px", { lineHeight: "64px", letterSpacing: "-3.84px", fontWeight: "600" }],
        "heading-48": ["40px", { lineHeight: "46px", letterSpacing: "-2.4px", fontWeight: "600" }],
        "heading-32": ["26px", { lineHeight: "32px", letterSpacing: "-1.04px", fontWeight: "600" }],
        "heading-24": ["20px", { lineHeight: "27px", letterSpacing: "-0.6px", fontWeight: "600" }],
        "heading-20": ["17px", { lineHeight: "23px", letterSpacing: "-0.34px", fontWeight: "600" }],
        "heading-16": ["14px", { lineHeight: "20px", letterSpacing: "-0.2px", fontWeight: "600" }],
        "heading-14": ["13px", { lineHeight: "18px", letterSpacing: "-0.2px", fontWeight: "600" }],
        "copy-16": ["14px", { lineHeight: "21px" }],
        "copy-14": ["13px", { lineHeight: "19px" }],
        "copy-13": ["12px", { lineHeight: "17px" }],
        "label-14": ["13px", { lineHeight: "18px" }],
        "label-13": ["12px", { lineHeight: "16px" }],
        "label-12": ["11px", { lineHeight: "15px" }],
      },
      boxShadow: {
        // Geist light elevation
        "geist-sm": "0px 1px 2px rgba(0,0,0,0.08)",
        "geist-md": "0px 2px 4px rgba(0,0,0,0.06), 0px 1px 2px rgba(0,0,0,0.08)",
        "geist-lg": "0px 8px 16px rgba(0,0,0,0.08), 0px 2px 4px rgba(0,0,0,0.06)",
        "geist-focus": "0 0 0 1px var(--ring)",
      },
      transitionTimingFunction: {
        geist: "cubic-bezier(0.175, 0.885, 0.32, 1.1)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "modal-overlay-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "modal-overlay-out": {
          from: { opacity: "1" },
          to: { opacity: "0" },
        },
        "modal-content-in": {
          from: {
            opacity: "0",
            transform: "translate(-50%, -48%) scale(0.985)",
          },
          to: {
            opacity: "1",
            transform: "translate(-50%, -50%) scale(1)",
          },
        },
        "modal-content-out": {
          from: {
            opacity: "1",
            transform: "translate(-50%, -50%) scale(1)",
          },
          to: {
            opacity: "0",
            transform: "translate(-50%, -49%) scale(0.992)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.1)",
        "modal-overlay-in": "modal-overlay-in 180ms ease-out",
        "modal-overlay-out": "modal-overlay-out 140ms ease-in",
        "modal-content-in": "modal-content-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        "modal-content-out": "modal-content-out 140ms ease-in",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
