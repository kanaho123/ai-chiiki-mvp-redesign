import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI地域商社",
  description: "分散した地域食材の供給を、1つの仕入れ案にまとめるデモ",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="site-header">
          <Link href="/">AI地域商社</Link>
          <span className="demo-tag">デモ・架空データ</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
