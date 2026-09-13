import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_ORIGIN ?? "http://localhost:3000"),
  title: "激荡｜A股与公募基金研究终端",
  description: "证据驱动的A股模拟研究、公募基金账本与风险复盘工具。",
  openGraph: {
    title: "激荡｜股票与基金研究终端",
    description: "证据、风险、跟踪与复盘，不用口号替代判断。",
    images: [{ url: "/og.png", width: 1733, height: 909, alt: "激荡股票与基金研究终端" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "激荡｜股票与基金研究终端",
    description: "证据驱动的A股模拟研究与公募基金账本。",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
