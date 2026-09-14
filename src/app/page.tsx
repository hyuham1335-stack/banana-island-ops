import { redirect } from "next/navigation";

/**
 * 홈 대시보드(FR-016)는 아직 없다(services/dashboard.ts 미구현) — placeholder 를
 * 만드는 대신 지금 구현된 화면으로 바로 보낸다.
 */
export default function Home() {
  redirect("/plans");
}
