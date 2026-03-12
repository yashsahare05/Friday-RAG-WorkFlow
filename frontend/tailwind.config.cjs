/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f7efe7",
        canvasStrong: "#efe2d6",
        card: "#fff7f0",
        ink: "#1f1b16",
        muted: "#6f6255",
        accent: "#ff6b4a",
        accent2: "#f2b94c",
        accent3: "#f77f3b",
        success: "#1f7a4f",
        warning: "#d9480f",
        danger: "#b42318",
      },
      boxShadow: {
        soft: "0 10px 24px rgba(31, 27, 22, 0.1)",
        medium: "0 14px 32px rgba(31, 27, 22, 0.14)",
        large: "0 22px 50px rgba(31, 27, 22, 0.18)",
        bubble: "0 8px 16px rgba(31, 27, 22, 0.08)",
      },
      fontFamily: {
        sans: ["Space Grotesk", "Segoe UI", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        floatIn: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        riseIn: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        progressSlide: {
          "0%": { transform: "translateX(-60%)" },
          "50%": { transform: "translateX(40%)" },
          "100%": { transform: "translateX(120%)" },
        },
      },
      animation: {
        floatIn: "floatIn 0.5s ease both",
        riseIn: "riseIn 0.35s ease both",
        progressSlide: "progressSlide 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
