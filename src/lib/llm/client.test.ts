import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmTitleItemSchema } from "@/lib/schemas";

// 계약: PR #7(FR-004) Major 3건 수리 「유닛 · src/lib/llm/client.ts::parseJson(비-export)」
//
// 외부 경계(계약): parseJson 은 export 되지 않으므로 createAnthropicClient(...).generateJson(...)
// 을 통해 간접 검증한다. vi.mock("@anthropic-ai/sdk") 로 Anthropic 클래스(default export)만
// 목으로 바꾸고, APIConnectionTimeoutError 등 나머지 export 는 실물을 그대로 쓴다(importOriginal).
//
// 검증 대상: LLM 응답 텍스트에 부가 텍스트·코드펜스·문자열 내부에 이스케이프된 따옴표+중괄호가
// 섞여도 실제 JSON 객체를 정확히 추출해 스키마 검증까지 성공하는가. 세 경우 모두 "1차 시도에서
// 성공"해야 하므로 messages.create 가 정확히 1회만 호출돼야 한다(파싱 재시도가 필요 없다).

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  return {
    ...actual,
    // `new Anthropic(...)` 로 생성하므로 목도 생성자로 호출 가능해야 한다 — 화살표 함수는
    // 애초에 [[Construct]]가 없어 `new` 대상이 될 수 없으므로 일반 함수 표현식을 쓴다.
    default: vi.fn().mockImplementation(function () {
      return { messages: { create: mockCreate } };
    }),
  };
});

import { createAnthropicClient } from "./client";

function fakeAnthropicResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createAnthropicClient(...).generateJson — parseJson 간접 검증", () => {
  it("유효 JSON 뒤에 부가 텍스트가 붙은 응답은 재시도 없이 스키마 검증에 성공한다", async () => {
    mockCreate.mockResolvedValueOnce(fakeAnthropicResponse('{"title":"a","angle":"b"}\n이상입니다.'));
    const client = createAnthropicClient({ ANTHROPIC_API_KEY: "test-key", LLM_MODEL: "test-model" });

    const result = await client.generateJson("system", "user", LlmTitleItemSchema, 5000, "test");

    expect(result).toEqual({ title: "a", angle: "b" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("코드펜스로 감싼 응답은 파싱에 성공한다", async () => {
    mockCreate.mockResolvedValueOnce(
      fakeAnthropicResponse('```json\n{"title":"a","angle":"b"}\n```'),
    );
    const client = createAnthropicClient({ ANTHROPIC_API_KEY: "test-key", LLM_MODEL: "test-model" });

    const result = await client.generateJson("system", "user", LlmTitleItemSchema, 5000, "test");

    expect(result).toEqual({ title: "a", angle: "b" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("문자열 내부에 이스케이프된 따옴표+중괄호가 섞여도 조기 종료 없이 전체 객체를 추출해 파싱에 성공한다", async () => {
    mockCreate.mockResolvedValueOnce(
      fakeAnthropicResponse(
        '{"title":"이것은 \\"} 모양이 섞인 값","angle":"b"}\n덧붙는 텍스트',
      ),
    );
    const client = createAnthropicClient({ ANTHROPIC_API_KEY: "test-key", LLM_MODEL: "test-model" });

    const result = await client.generateJson("system", "user", LlmTitleItemSchema, 5000, "test");

    expect(result).toEqual({ title: '이것은 "} 모양이 섞인 값', angle: "b" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
