import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scholar Funnel",
  description: "文献高效检索工具",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-paper text-ink">
        {children}
      </body>
    </html>
  );
}
