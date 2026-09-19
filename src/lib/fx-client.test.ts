import { afterEach, describe, expect, it, vi } from "vitest";
import { createFxClient, FRANKFURTER_LATEST_URL, FX_FETCH_TIMEOUT_MS } from "./fx-client";

// 계약: FR-022(런 20260919-2343-1c04) 「유닛 · lib/fx-client.ts · createFxClient」
// 「외부 경계」— 테스트가 모킹할 대상은 전역 fetch 하나뿐이다. URL·signal 전달, 비 2xx
// 시 throw, 성공 시 res.json() 을 검증 없이 그대로 반환하는지만 본다.

describe("createFxClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetchLatest 는 FRANKFURTER_LATEST_URL 에 AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) 로 fetch 를 1회 호출한다", async () => {
    const fakeSignal = {} as AbortSignal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(fakeSignal);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ some: "data" }) });
    vi.stubGlobal("fetch", fetchMock);

    await createFxClient().fetchLatest();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(FRANKFURTER_LATEST_URL, { signal: fakeSignal });
    expect(timeoutSpy).toHaveBeenCalledWith(FX_FETCH_TIMEOUT_MS);
  });

  it("res.ok 가 true 면 res.json() 결과를 검증 없이 그대로 반환한다", async () => {
    const payload = { base: "USD", date: "2026-09-20", rates: { KRW: 1380.5, PHP: 56.1 }, extra: "unvalidated" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) }));

    const result = await createFxClient().fetchLatest();

    expect(result).toEqual(payload);
  });

  it("res.ok 가 false 면 Error('Frankfurter HTTP <status>') 를 던진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }),
    );

    await expect(createFxClient().fetchLatest()).rejects.toThrow("Frankfurter HTTP 500");
  });

  it("fetch 자체가 throw 하면(네트워크·타임아웃) 그대로 전파한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    await expect(createFxClient().fetchLatest()).rejects.toThrow("network down");
  });
});
