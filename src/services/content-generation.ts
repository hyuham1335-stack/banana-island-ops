import type { Db } from "@/lib/db/client";
import type { ErrorCode } from "@/lib/http";
import type { LlmClient } from "@/lib/llm/client";
import { LlmTimeoutError } from "@/lib/llm/client";
import { buildTitleRegenPrompt, buildTitlesSystemPrompt, buildTitlesUserPrompt } from "@/lib/llm/prompts";
import { LlmTitleCandidatesSchema, LlmTitleItemSchema, type LlmTitleItem, type TitleRequest } from "@/lib/schemas";
import { validate } from "@/lib/validator";
import { resolveRules } from "@/services/rules";

/**
 * FR-004 제목+앵글 3안 생성 — docs/API_SPEC.md 136~140행, docs/TRD.md §3 FR-004.
 * 01_plan.md(run 20260914-2058-0053) §2.5 의 5단계·시간 예산 산식을 그대로 구현한다.
 * 저장 없음(contents 등 기존 스키마 변경 없음).
 */

// 서비스는 throw 하지 않는다 — rules.ts·plans.ts 와 같은 Result 패턴을 이 파일에서도 로컬로 쓴다.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: unknown } };

export interface TitleCandidates {
  items: LlmTitleItem[];
  regeneratedIdx: number[];
}

const INITIAL_TIMEOUT_MS = 20_000;
// 합산 재생성 예산 상한 — route 의 maxDuration=30_000ms 보다 2초 여유(01_plan.md §2.5).
export const TITLE_TOTAL_BUDGET_MS = 28_000;
// 이 미만 남으면 재생성 시도 안 함.
export const MIN_REGEN_BUDGET_MS = 3_000;
const REGEN_MAX_TIMEOUT_MS = 8_000;
const REGEN_SAFETY_MARGIN_MS = 1_000;

export async function generateTitles(
  deps: { db: Db; llm: LlmClient },
  input: TitleRequest,
): Promise<Result<TitleCandidates>> {
  // 경과시간 측정은 resolveRules 호출 전부터 시작한다 — DB 조회도 TITLE_TOTAL_BUDGET_MS 예산을
  // 갉아먹으므로, 1차 LLM 호출의 timeoutMs 계산에 그 시간이 반영돼야 한다.
  const startedAt = Date.now();

  // 1. 규칙 병합 조회 — 실패(NOT_FOUND 등)는 그대로 전파한다.
  const rulesResult = await resolveRules(
    { db: deps.db },
    { channelId: input.channelId, lang: input.lang, productId: input.productId ?? undefined },
  );
  if (!rulesResult.ok) {
    return { ok: false, error: rulesResult.error };
  }
  const rules = rulesResult.data;

  const system = buildTitlesSystemPrompt(rules);
  const user = buildTitlesUserPrompt(input);

  // 2. 1차 LLM 호출 — resolveRules 로 이미 소진된 시간을 뺀 나머지만 이 호출의 예산으로 쓴다.
  // 남은 예산이 없으면 호출 자체를 생략하고 타임아웃으로 즉시 반환한다.
  const remainingForInitial = TITLE_TOTAL_BUDGET_MS - (Date.now() - startedAt);
  if (remainingForInitial <= 0) {
    return { ok: false, error: { code: "LLM_TIMEOUT", message: "제목 생성이 시간 초과되었습니다." } };
  }

  let candidates: { items: LlmTitleItem[] };
  try {
    candidates = await deps.llm.generateJson(
      system,
      user,
      LlmTitleCandidatesSchema,
      Math.min(INITIAL_TIMEOUT_MS, remainingForInitial),
      "titles",
    );
  } catch (err) {
    if (err instanceof LlmTimeoutError) {
      return { ok: false, error: { code: "LLM_TIMEOUT", message: "제목 생성이 시간 초과되었습니다." } };
    }
    return { ok: false, error: { code: "LLM_FAILED", message: "제목 생성에 실패했습니다." } };
  }

  const items: LlmTitleItem[] = candidates.items.map((item) => ({ ...item }));
  const regeneratedIdx: number[] = [];
  let elapsedMs = Date.now() - startedAt;

  // 3. 차단 항목만 순서대로 순회하며 합산 예산 안에서 1회 재요청한다.
  for (let i = 0; i < items.length; i++) {
    const validation = validate(items[i].title, { must: rules.must, ban: rules.ban });
    if (validation.blocks.length === 0) continue;

    const remaining = TITLE_TOTAL_BUDGET_MS - elapsedMs;
    if (remaining < MIN_REGEN_BUDGET_MS) {
      // 예산 소진 — 재생성을 건너뛰고 원래(차단된) 값을 그대로 둔다.
      continue;
    }

    const regenTimeoutMs = Math.min(REGEN_MAX_TIMEOUT_MS, remaining - REGEN_SAFETY_MARGIN_MS);
    const regenPrompt = buildTitleRegenPrompt(items[i], validation.blocks[0]);

    const regenStartedAt = Date.now();
    try {
      const regenerated = await deps.llm.generateJson(
        system,
        regenPrompt,
        LlmTitleItemSchema,
        regenTimeoutMs,
        "titles_regenerate",
      );
      items[i] = regenerated;
      regeneratedIdx.push(i);
    } catch {
      // 재생성 호출 자체의 실패/타임아웃은 항목 단위로 흡수한다 — 원래 값 유지, 전체 요청은
      // 계속 성공으로 진행한다(4번의 LLM_FAILED/LLM_TIMEOUT 매핑은 2번의 실패에만 적용).
    } finally {
      elapsedMs += Date.now() - regenStartedAt;
    }
  }

  // 5. 성공 — 저장 없음.
  return { ok: true, data: { items, regeneratedIdx } };
}
