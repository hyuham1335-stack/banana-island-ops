import Link from "next/link";
import type { ReactNode } from "react";
import { getDb } from "@/lib/db/client";
import { listBrandStandards } from "@/services/rules";
import type { ChannelStandard, BanStandard, MustGroup, ProductException } from "@/lib/rules-merge";
import { Panel } from "@/components/ui/Panel";
import { Table } from "@/components/ui/Table";
import { Notice } from "@/components/ui/Notice";
import { Empty } from "@/components/ui/Empty";

export const dynamic = "force-dynamic";

const DASH = "—";

function langLabel(lang: "ko" | "en"): string {
  return lang === "ko" ? "국문" : "영문";
}

function formatMonthDayKst(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

function orDash(value: string): string {
  return value === "" ? DASH : value;
}

function channelRow(ch: ChannelStandard): [ReactNode, ReactNode, ReactNode, ReactNode] {
  const updated = ch.updatedAt ? `${formatMonthDayKst(ch.updatedAt)} 갱신` : "갱신일 없음";
  return [
    <>
      {ch.name}
      <div className="sub">
        {langLabel(ch.lang)} · {ch.version} · {updated}
      </div>
    </>,
    orDash(ch.persona),
    orDash(ch.tone),
    orDash(ch.format),
  ];
}

function productExceptionLine(ex: ProductException): string {
  let line = `${ex.productName} (${langLabel(ex.lang)})`;
  const segments: string[] = [];
  if (ex.persona) segments.push(`읽을 사람 ${ex.persona}`);
  if (ex.tone) segments.push(ex.tone);
  if (ex.format) segments.push(ex.format);
  if (segments.length > 0) line += ` — ${segments.join(" · ")}`;
  if (ex.must.length > 0) line += `, 필수 표현에 ${ex.must.join(" · ")} 추가`;
  if (ex.affectedChannels.length > 0) {
    line += `. ${ex.affectedChannels.join("·")} 에서 이 제품을 고르면 채널 기준 대신 이 값이 들어갑니다.`;
  }
  return line;
}

function banRow(ban: BanStandard): [ReactNode, ReactNode, ReactNode, ReactNode] {
  const grade =
    ban.severity === "block" ? (
      <span className="tag warn">차단</span>
    ) : (
      <span className="tag ripe">경고</span>
    );
  let reasonText = ban.reason ?? DASH;
  if (ban.legalBasis) reasonText += ` · ${ban.legalBasis}`;
  return [
    <>
      {ban.label}
      <div className="sub">
        {langLabel(ban.lang)} · {ban.scopeLabel}
      </div>
    </>,
    grade,
    ban.alternative ?? DASH,
    reasonText,
  ];
}

function mustLine(group: MustGroup): string {
  return `${langLabel(group.lang)} · ${group.scopeLabel}: ${group.items.join(" · ")}`;
}

export default async function RulesPage() {
  const result = await listBrandStandards({ db: getDb() });

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">브랜드 기준</h1>
        <p className="page-desc">
          여기 적힌 내용이 모든 콘텐츠 생성에 자동으로 들어갑니다. 공통 → 국가 → 채널 → 제품 순으로 겹쳐 적용됩니다.
        </p>
      </div>

      {!result.ok ? (
        <Notice variant="bad">
          브랜드 기준을 불러오지 못했습니다 — {result.error.message}
          <div className="notice-actions">
            <Link href="/rules" className="btn small ghost">
              다시 시도
            </Link>
          </div>
        </Notice>
      ) : result.data.isEmpty ? (
        <Empty
          title="등록된 브랜드 기준이 없습니다"
          hint="활성 규칙이 생기면 채널별 기준과 금칙어가 여기에 표시됩니다."
        />
      ) : (
        <div className="grid2">
          <Panel title="채널별 기준" note="공통 → 국가 → 채널 순 병합">
            <Table
              headers={["채널", "읽을 사람 (타깃)", "말투", "형식"]}
              rows={result.data.channels}
              renderRow={channelRow}
              emptyLabel="채널별 기준 없음"
            />
            <div className="utm">
              <div className="utm-label">제품 범위 예외</div>
              {result.data.productExceptions.length === 0 ? (
                <div>제품 범위 예외 없음</div>
              ) : (
                result.data.productExceptions.map((ex) => (
                  <div key={`${ex.productId}-${ex.lang}`}>{productExceptionLine(ex)}</div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="금칙어" note="차단 = 생성 후 자동 재작성 · 경고 = 검수 화면 표시">
            <Table
              headers={["표현", "등급", "대신 쓸 표현", "근거"]}
              rows={result.data.bans}
              renderRow={banRow}
              emptyLabel="금칙어 없음"
            />
            <div className="utm">
              <div className="utm-label">필수 표현</div>
              {result.data.musts.length === 0 ? (
                <div>필수 표현 없음</div>
              ) : (
                result.data.musts.map((group, i) => <div key={i}>{mustLine(group)}</div>)
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  );
}
