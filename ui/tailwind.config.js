/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        studio: "hsl(var(--studio) / <alpha-value>)",
        panel: "hsl(var(--panel) / <alpha-value>)",
        card: "hsl(var(--card) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        ink: "hsl(var(--ink) / <alpha-value>)",
        mute: "hsl(var(--mute) / <alpha-value>)",
        mark: "hsl(var(--mark) / <alpha-value>)",
        moss: "hsl(var(--mark) / <alpha-value>)",
        predict: "#4F46E5",
        clash: "#D97706",
      },
      fontFamily: {
        sans: ["var(--font-ui)"],
        mono: ["var(--font-code)"],
      },
      boxShadow: {
        studio:
          "0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)",
      },
    },
  },
  plugins: [],
};
