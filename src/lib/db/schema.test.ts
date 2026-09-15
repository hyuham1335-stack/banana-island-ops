import { getTableConfig, type PgColumn, PgNumeric, type PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

// docs/TRD.md §4 「테이블 매핑 (17개)」 — DB 연결 없이 getTableConfig 로 선언을 검사한다.

const TABLE_NAMES = [
  "users", "products", "sales_channels", "brand_rules", "brand_rule_history",
  "brand_examples", "prompt_templates", "publish_plans", "contents", "content_history",
  "content_performance", "fx_rates", "cost_sheets", "cost_items", "cost_calc_results",
  "ad_performance", "import_logs",
].sort();

function isPgTable(v: unknown): v is PgTable {
  return typeof v === "object" && v !== null && Symbol.for("drizzle:IsDrizzleTable") in v;
}

// export 전부를 unknown 으로 받아 타입 술어로 테이블·enum 을 가른다
const exported: unknown[] = Object.values(schema);
const tables = exported.filter(isPgTable).map((t) => getTableConfig(t));
const byName = Object.fromEntries(tables.map((t) => [t.name, t]));
const col = (table: string, name: string): PgColumn | undefined =>
  byName[table]?.columns.find((c) => c.name === name);
const uniqueSets = (table: string): string[][] => [
  ...byName[table].uniqueConstraints.map((u) => u.columns.map((c) => c.name).sort()),
  ...byName[table].indexes
    .filter((i) => i.config.unique)
    .map((i) => i.config.columns.map((c) => (c as PgColumn).name).sort()),
];
const hasUnique = (table: string, column: string): boolean =>
  col(table, column)?.isUnique === true || uniqueSets(table).some((s) => s.join() === column);

describe("schema — 테이블 집합", () => {
  it("(a) export 된 테이블 이름 집합이 TRD 의 17개와 정확히 같다", () => {
    expect(tables.map((t) => t.name).sort()).toEqual(TABLE_NAMES);
  });

  it("모든 테이블에 id bigserial PK 와 created_at timestamptz 가 있다", () => {
    for (const t of tables) {
      const id = t.columns.find((c) => c.name === "id");
      expect(id?.primary, t.name).toBe(true);
      expect(id?.getSQLType(), t.name).toBe("bigserial");
      expect(col(t.name, "created_at")?.getSQLType(), t.name).toBe("timestamp with time zone");
    }
  });
});

describe("schema — enum 값", () => {
  const cases: Array<[string, readonly string[]]> = [
    ["content_status", ["draft", "in_review", "approved", "rejected", "published"]],
    ["post_type", ["health_info", "activity_news", "comparison", "review"]],
    ["channel_kind", ["sales", "content"]],
    ["lang", ["ko", "en"]],
    ["rule_scope", ["common", "country", "channel", "product"]],
    ["rule_type", ["ban", "must", "tone", "format", "persona"]],
    ["severity", ["block", "warn"]],
    ["rule_status", ["draft", "active", "retired"]],
  ];
  const enums = exported.filter(
    // pgEnum 은 호출 가능한 함수 객체다 — typeof 가 "function" 이다
    (v: unknown): v is { enumName: string; enumValues: string[] } =>
      (typeof v === "function" || typeof v === "object") && v !== null && "enumName" in v && "enumValues" in v,
  );
  it.each(cases)("(b) pgEnum %s 의 값", (name, values) => {
    const e = enums.find((x) => x.enumName === name);
    expect(e, name).toBeDefined();
    expect(e!.enumValues).toEqual([...values]);
  });
});

describe("schema — 키·인덱스", () => {
  it("(c) contents.publish_plan_id 는 UNIQUE 이고 nullable 이다", () => {
    expect(col("contents", "publish_plan_id")?.notNull).toBe(false);
    expect(hasUnique("contents", "publish_plan_id")).toBe(true);
  });

  it("(d) publish_plans.sheet_row_key UNIQUE", () => {
    expect(hasUnique("publish_plans", "sheet_row_key")).toBe(true);
  });

  it("(d) fx_rates (rate_date, base, quote) UK", () => {
    expect(uniqueSets("fx_rates")).toContainEqual(["base", "quote", "rate_date"]);
  });

  it("(d) ad_performance (channel_id, period_start, period_end) UK", () => {
    expect(uniqueSets("ad_performance")).toContainEqual(["channel_id", "period_end", "period_start"]);
  });
});

describe("schema — ADR 가드", () => {
  // ADR-005: 환산값을 저장하는 컬럼을 만들지 않는다. 허용은 원본값과 결과 스냅샷뿐.
  // - products.price_krw: 원화 정가(원본값) — docs/TRD.md:97
  // - cost_calc_results.{unit_cost_krw, price_krw, fixed_cost_krw}: 적용 환율(fx_php·fx_usd)과
  //   함께 저장하는 결과 스냅샷 — docs/TRD.md:110, docs/ADR.md:40
  // TRD 가 바뀌면 이 표를 같이 고친다. 그 불일치가 테스트 실패로 드러나는 것이 가드의 목적이다.
  const KRW_ALLOWLIST: Record<string, string[]> = {
    products: ["price_krw"],
    cost_calc_results: ["unit_cost_krw", "price_krw", "fixed_cost_krw"],
  };

  it("(e) ADR-005 — _krw 로 끝나는 컬럼은 허용표에 있는 것뿐이다", () => {
    const found: Record<string, string[]> = {};
    for (const t of tables) {
      const krw = t.columns.map((c) => c.name).filter((n) => n.endsWith("_krw")).sort();
      if (krw.length) found[t.name] = krw;
    }
    const expected = Object.fromEntries(
      Object.entries(KRW_ALLOWLIST).map(([k, v]) => [k, [...v].sort()]),
    );
    expect(found).toEqual(expected);
  });

  it("(f) ADR-007 — publish_plans 에 status 컬럼이 없다 (계획 상태는 파생)", () => {
    expect(col("publish_plans", "status")).toBeUndefined();
  });

  it("(g) ADR-005 예외의 전제 — cost_calc_results 에 fx_php·fx_usd 가 있다", () => {
    expect(col("cost_calc_results", "fx_php")).toBeDefined();
    expect(col("cost_calc_results", "fx_usd")).toBeDefined();
  });

  // 계약: FR-005 「스키마·데이터 변경」 — contents.post_type 컬럼 추가.
  // postTypeEnum("post_type").notNull() 이고, 기존 postTypeEnum 재사용(새 enum 없음).
  // 컬럼 위치는 lang 다음, targetPersona 이전(기존 컬럼 순서 참고).
  it("(i) contents.post_type 은 postTypeEnum 을 재사용하는 NOT NULL 컬럼이다(새 enum 을 만들지 않는다)", () => {
    const postType = col("contents", "post_type");
    expect(postType).toBeDefined();
    expect(postType?.notNull).toBe(true);

    const enumCol = postType as unknown as { enum: unknown; enumValues: readonly string[] };
    // publish_plans.post_type 과 동일한 enum 인스턴스를 참조해야 한다 — 별도 enum 을
    // 새로 만들었다면 이 identity 비교가 깨진다.
    const publishPlansPostType = col("publish_plans", "post_type") as unknown as { enum: unknown } | undefined;
    expect(publishPlansPostType).toBeDefined();
    expect(enumCol.enum).toBe(publishPlansPostType!.enum);
    expect([...enumCol.enumValues]).toEqual(["health_info", "activity_news", "comparison", "review"]);
  });

  it("(j) contents 컬럼 순서 — post_type 은 lang 바로 다음, target_persona 바로 이전이다", () => {
    const names = byName["contents"].columns.map((c) => c.name);
    const langIdx = names.indexOf("lang");
    const postTypeIdx = names.indexOf("post_type");
    const personaIdx = names.indexOf("target_persona");

    expect(langIdx).toBeGreaterThanOrEqual(0);
    expect(postTypeIdx).toBeGreaterThanOrEqual(0);
    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(postTypeIdx).toBe(langIdx + 1);
    expect(personaIdx).toBe(postTypeIdx + 1);
  });

  it("(h) numeric 컬럼은 전부 precision·scale 이 있다 — 환율(fx_rates.rate · fx_*)은 (18,8), 나머지는 (14,4)", () => {
    let numericCount = 0;
    for (const t of tables) {
      for (const c of t.columns) {
        if (!c.getSQLType().startsWith("numeric")) continue;
        numericCount += 1;
        const isFx = (t.name === "fx_rates" && c.name === "rate") || c.name.startsWith("fx_");
        const where = `${t.name}.${c.name}`;
        // numeric 은 기본 모드(string → PgNumeric)만 쓴다. precision·scale 은 이 클래스의 공개 필드다.
        expect(c, where).toBeInstanceOf(PgNumeric);
        const n = c as PgNumeric<never>;
        expect(n.precision, where).toBe(isFx ? 18 : 14);
        expect(n.scale, where).toBe(isFx ? 8 : 4);
      }
    }
    expect(numericCount).toBeGreaterThan(0);
  });
});
