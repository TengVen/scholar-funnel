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
        // ── 主题化语义色（2026-09-01：全部引用 CSS 变量，支持多主题切换）──
        // 变量集定义在 globals.css：:root=深色（默认）/ [data-theme=light]=暖米白
        // 深墨暖黑（Obsidian）背景体系
        paper: {
          DEFAULT: "rgb(var(--paper) / <alpha-value>)",
          white: "rgb(var(--paper-white) / <alpha-value>)",
          warm: "rgb(var(--paper-warm) / <alpha-value>)",
          chrome: "rgb(var(--paper-chrome) / <alpha-value>)",
        },
        // 暖白（Ivory）文字体系
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          secondary: "rgb(var(--ink-secondary) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          faint: "rgb(var(--ink-faint) / <alpha-value>)",
        },
        // 鎏金（Gilded Gold）主强调色
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          hover: "rgb(var(--accent-hover) / <alpha-value>)",
          light: "rgb(var(--accent) / 0.16)",
        },
        // 金阶（供渐变/高亮使用）
        gold: {
          bright: "rgb(var(--gold-bright) / <alpha-value>)",
          light: "rgb(var(--gold-light) / <alpha-value>)",
          DEFAULT: "rgb(var(--gold) / <alpha-value>)",
          hover: "rgb(var(--gold-hover) / <alpha-value>)",
          deep: "rgb(var(--gold-deep) / <alpha-value>)",
        },
        // 用户气泡（暖米白=浅蓝 #8ABCD1，深色兜底金色）
        bubble: {
          user: "rgb(var(--bubble-user) / <alpha-value>)",
        },
        // 暖金调边框
        line: {
          DEFAULT: "rgb(var(--line) / <alpha-value>)",
          light: "rgb(var(--line-light) / <alpha-value>)",
        },
        // 深色下提亮的语义色
        success: "rgb(var(--success) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        // 状态语义色（running=分析中 · partial=部分/降级 · failed=失败）
        status: {
          running: "rgb(var(--status-running) / <alpha-value>)",
          partial: "rgb(var(--status-partial) / <alpha-value>)",
          failed: "rgb(var(--status-failed) / <alpha-value>)",
        },
        // 分类三色（奠基/主流/前沿，主题化：浅色下自动变深保证可读）
        cat: {
          foundation: "rgb(var(--cat-foundation) / <alpha-value>)",
          mainstream: "rgb(var(--cat-mainstream) / <alpha-value>)",
          frontier: "rgb(var(--cat-frontier) / <alpha-value>)",
        },
        // 辅助冷调点缀（关键词/证据徽章/标记，主题化：深色亮、浅色深）
        aux: {
          teal: "rgb(var(--aux-teal) / <alpha-value>)",
          gold: "rgb(var(--aux-gold) / <alpha-value>)",
          amber: "rgb(var(--aux-amber) / <alpha-value>)",
          gray: "rgb(var(--aux-gray) / <alpha-value>)",
          blue: "rgb(var(--aux-blue) / <alpha-value>)",
          green: "rgb(var(--aux-green) / <alpha-value>)",
          purple: "rgb(var(--aux-purple) / <alpha-value>)",
          cyan: "rgb(var(--aux-cyan) / <alpha-value>)",
        },
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
        // 正文细档（2026-08-30 收敛：原 9 档任意值 text-[Npx] 收敛为此 5 档）
        // 2xs ← {10, 10.5}px 微标签 · xs ← {11, 11.5}px 徽章/元信息
        // sm ← {12, 12.5}px 次要正文 · base ← {13, 14}px 主正文 · lg ← {15, 17}px 小节标题
        "2xs": ["10.5px", { lineHeight: "1.5" }],
        "xs": ["11.5px", { lineHeight: "1.5" }],
        "sm": ["12.5px", { lineHeight: "1.55" }],
        "base": ["13px", { lineHeight: "1.6" }],
        "lg": ["15px", { lineHeight: "1.45" }],
      },
      spacing: {
        "18": "4.5rem",
      },
    },
  },
  plugins: [],
};

export default config;
