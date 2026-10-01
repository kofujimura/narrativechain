import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NarrativeChain",
  description: "ニュースから生成された未来の因果連鎖",
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
