import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getServerActor } from "@/lib/auth";
import { getFxRailState, todayUtc, type FxRailState } from "@/services/fx";
import { getDb } from "@/lib/db/client";
import { Nav } from "@/components/shell/Nav";
import { Topbar } from "@/components/shell/Topbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "바나나아일랜드 운영",
  description: "다국어 콘텐츠 · 광고 성과 · 3국 원가손익 운영 도구",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { role } = await getServerActor();

  let fx: FxRailState = { kind: "unavailable" };
  try {
    fx = await getFxRailState({ db: getDb() }, todayUtc());
  } catch {
    // getDb 의 env 오류 등 — unavailable 유지
  }

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
        <Topbar role={role} fx={fx} />
        <div className="shell">
          <Nav role={role} />
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
