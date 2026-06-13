import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        framboos: {
          DEFAULT: "#B3315F",
          dark: "#8C2549",
          light: "#B93D62",
        },
        koraal: "#D66871",
        zalm: "#F0947F",
        staal: {
          DEFAULT: "#1A5380",
          dark: "#103655",
        },
        blissi: {
          roze: "#DC88B9",
          geel: "#FFEF80",
          groen: "#B6D180",
          blauw: "#75AAE0",
          oranje: "#DD7574",
        },
      },
      fontFamily: {
        sans: ["var(--font-quicksand)", "system-ui", "sans-serif"],
        display: ["var(--font-quicksand)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "count-pulse": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "wave": {
          "0%, 100%": { transform: "translateX(0)" },
          "50%": { transform: "translateX(-25%)" },
        },
      },
      animation: {
        "count-pulse": "count-pulse 0.6s ease-in-out",
        "slide-up": "slide-up 0.5s ease-out",
        "shimmer": "shimmer 2.5s linear infinite",
        "wave": "wave 12s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
