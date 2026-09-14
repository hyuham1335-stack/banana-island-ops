import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/shell/Nav";
import { Topbar } from "@/components/shell/Topbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "바나나아일랜드 운영",
  description: "다국어 콘텐츠 · 광고 성과 · 3국 원가손익 운영 도구",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.css"
        />
      </head>
      <body>
        <Topbar />
        <div className="shell">
          <Nav />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
