import Anthropic, { APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { Env } from "@/lib/env";

/**
 * LlmClient — ADR-003. Anthropic 구현체를 인터페이스 뒤에 감싸 서비스 테스트에서 모킹한다.
 * docs/TRD.md §7: 네트워크 재시도 0회, JSON 파싱 실패 1회 재시도.
 *
 * timeoutMs 의미론(01_plan.md §2.2): 파싱 재시도를 포함한 호출 전체의 총 예산이다.
 * 시작 시각 기준 하나의 deadline(= start + timeoutMs)만 두고, 첫 시도가 그 안에 끝났는데
 * 파싱/스키마 검증에 실패했을 때만 남은 시간(remaining)으로 정확히 한 번 재시도한다.
 * 새 timeoutMs 를 다시 채우지 않으므로 이 함수는 항상 timeoutMs 이내에 확정된다.
 */

export class LlmTimeoutError extends Error {
  constructor(message = "LLM 호출이 시간 초과되었습니다.") {
    super(message);
    this.name = "LlmTimeoutError";
  }
}

export class LlmFailedError extends Error {
  constructor(message = "LLM 호출이 실패했습니다.", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmFailedError";
  }
}

export interface LlmClient {
  generateJson<T>(
    system: string,
    user: string,
    schema: z.ZodType<T>,
    timeoutMs: number,
    purpose: string,
  ): Promise<T>;
}

type LlmEnv = Pick<Env, "ANTHROPIC_API_KEY" | "LLM_MODEL">;

interface RawCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callOnce(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<RawCallResult> {
  try {
    const res = await client.messages.create(
      {
        model,
        max_tokens: 2048,
        system,
        messages: [{ role: "user", content: user }],
      },
      { timeout: timeoutMs },
    );
    const block = res.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text : "";
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  } catch (err) {
    if (err instanceof APIConnectionTimeoutError) {
      throw new LlmTimeoutError();
    }
    throw new LlmFailedError("LLM 호출 실패", { cause: err });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // 코드펜스·설명 문구가 섞여 왔을 때를 대비해 첫 JSON 객체만 뽑아 재시도한다.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("응답에서 JSON 객체를 찾을 수 없습니다.");
    return JSON.parse(match[0]);
  }
}

// 파싱/스키마 검증에 실패한 응답 원문을 로그에 남길 때의 길이 상한(CLAUDE.md CRITICAL 규칙).
const RAW_RESPONSE_LOG_MAX_LEN = 2000;

function truncateForLog(text: string): string {
  return text.length > RAW_RESPONSE_LOG_MAX_LEN
    ? `${text.slice(0, RAW_RESPONSE_LOG_MAX_LEN)}…(truncated)`
    : text;
}

function logCall(fields: {
  purpose: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** 파싱/스키마 검증 실패 시에만 채운다 — 통과 못 한 응답은 원문을 로그에 남긴다. */
  rawText?: string;
}): void {
  console.log(
    JSON.stringify({
      event: "llm_called",
      purpose: fields.purpose,
      model: fields.model,
      input_tokens: fields.inputTokens,
      output_tokens: fields.outputTokens,
      latency_ms: fields.latencyMs,
      ok: fields.ok,
      ...(fields.rawText !== undefined ? { raw_response: truncateForLog(fields.rawText) } : {}),
    }),
  );
}

export function createAnthropicClient(env: LlmEnv): LlmClient {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
  const model = env.LLM_MODEL;

  return {
    async generateJson<T>(
      system: string,
      user: string,
      schema: z.ZodType<T>,
      timeoutMs: number,
      purpose: string,
    ): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      const startedAt = Date.now();

      // 첫 시도 — 이 자체가 timeoutMs 를 넘기면(네트워크 무응답) 재시도 없이 LlmTimeoutError.
      let raw: RawCallResult;
      try {
        raw = await callOnce(client, model, system, user, timeoutMs);
      } catch (err) {
        logCall({ purpose, model, ok: false, latencyMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0 });
        throw err;
      }

      const firstParsed = schema.safeParse(safeJsonParse(raw.text));
      if (firstParsed.success) {
        logCall({
          purpose,
          model,
          ok: true,
          latencyMs: Date.now() - startedAt,
          inputTokens: raw.inputTokens,
          outputTokens: raw.outputTokens,
        });
        return firstParsed.data;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        logCall({
          purpose,
          model,
          ok: false,
          latencyMs: Date.now() - startedAt,
          inputTokens: raw.inputTokens,
          outputTokens: raw.outputTokens,
          rawText: raw.text,
        });
        throw new LlmFailedError("LLM 출력이 JSON 스키마를 통과하지 못했습니다.");
      }

      // 파싱/스키마 실패 1회 재시도 — 남은 예산(remaining)만 쓰고 새 창을 열지 않는다.
      let retryRaw: RawCallResult;
      try {
        retryRaw = await callOnce(client, model, system, user, remaining);
      } catch (err) {
        logCall({
          purpose,
          model,
          ok: false,
          latencyMs: Date.now() - startedAt,
          inputTokens: raw.inputTokens,
          outputTokens: raw.outputTokens,
          rawText: raw.text,
        });
        throw err;
      }

      const retryParsed = schema.safeParse(safeJsonParse(retryRaw.text));
      const totalLatencyMs = Date.now() - startedAt;
      const totalInputTokens = raw.inputTokens + retryRaw.inputTokens;
      const totalOutputTokens = raw.outputTokens + retryRaw.outputTokens;

      if (retryParsed.success) {
        logCall({
          purpose,
          model,
          ok: true,
          latencyMs: totalLatencyMs,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        });
        return retryParsed.data;
      }

      logCall({
        purpose,
        model,
        ok: false,
        latencyMs: totalLatencyMs,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        rawText: retryRaw.text,
      });
      throw new LlmFailedError("LLM 출력이 재시도 후에도 JSON 스키마를 통과하지 못했습니다.");
    },
  };
}

/** parseJson 이 던지는 예외(빈 문자열·완전히 깨진 JSON)를 zod safeParse 가 실패로 처리할 수 있는 값으로 바꾼다. */
function safeJsonParse(text: string): unknown {
  try {
    return parseJson(text);
  } catch {
    return undefined;
  }
}
