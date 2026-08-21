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
        // 深墨暖黑（Obsidian）背景体系
        paper: {
          DEFAULT: "#121110",
          white: "#171614",
          warm: "#1e1b17",
        },
        // 暖白（Ivory）文字体系
        ink: {
          DEFAULT: "#f0ece4",
          secondary: "#b8b0a4",
          muted: "#8f8a80",
          faint: "#6b655a",
        },
        // 鎏金（Gilded Gold）主强调色
        accent: {
          DEFAULT: "#c9a24b",
          hover: "#a8843a",
          light: "rgba(201,162,75,0.16)",
        },
        // 金阶（供渐变/高亮使用）
        gold: {
          bright: "#f3e2b3",
          light: "#e6c879",
          DEFAULT: "#c9a24b",
          hover: "#a8843a",
          deep: "#8a6a2c",
        },
        // 暖金调边框
        line: {
          DEFAULT: "#2a2620",
          light: "#221f1a",
        },
        // 深色下提亮的语义色
        success: "#7fc79e",
        warn: "#e0b56a",
        danger: "#f87171",
      },
      fontFamily: {
        serif: ['"Source Serif 4"', "Georgia", "Cambria", "serif"],
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"Microsoft YaHei"',
          '"PingFang SC"',
          '"Noto Sans SC"',
          "system-ui",
          "sans-serif",
        ],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      fontSize: {
        "display": ["1.5rem", { lineHeight: "1.3", fontWeight: "600" }],
        "heading": ["1.125rem", { lineHeight: "1.4", fontWeight: "600" }],
        "body": ["0.875rem", { lineHeight: "1.6" }],
        "caption": ["0.75rem", { lineHeight: "1.5" }],
      },
      spacing: {
        "18": "4.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
