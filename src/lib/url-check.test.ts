import { afterEach, describe, expect, it, vi } from "vitest";

// 계약: FR-013(_workspace/contract_fr-013-publish.md) 「외부 경계 · UrlChecker.check」·
// 「유닛 · createUrlChecker()·isPrivateHost」.
// isPrivateHost 는 export 여부가 자율(계약 밖)이라 createUrlChecker().check() 의 반환값으로
// 간접 검증한다. fetch 는 전역을 모킹한다 — 실제 네트워크 I/O 는 절대 타지 않는다.

import { createUrlChecker } from "./url-check";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createUrlChecker().check", () => {
  it("2xx 응답이면 'ok' 를 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createUrlChecker().check("https://example.com/post/1");

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/post/1",
      expect.objectContaining({
        method: "HEAD",
        headers: { "User-Agent": "BananaIslandOps-LinkChecker/1.0" },
      }),
    );
  });

  it("4xx 응답이면 'unreachable' 을 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await createUrlChecker().check("https://example.com/missing");

    expect(result).toBe("unreachable");
  });

  it("5xx 응답이면 'unreachable' 을 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await createUrlChecker().check("https://example.com/down");

    expect(result).toBe("unreachable");
  });

  it("fetch 가 네트워크 예외를 던지면 'unreachable' 을 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network error")));

    const result = await createUrlChecker().check("https://example.com/unreachable-host");

    expect(result).toBe("unreachable");
  });

  it("fetch 가 타임아웃(AbortError)으로 거부되면 'unreachable' 을 반환한다", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const result = await createUrlChecker().check("https://example.com/slow");

    expect(result).toBe("unreachable");
  });

  it("url 이 null 이면 fetch 를 호출하지 않고 'skipped' 를 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createUrlChecker().check(null);

    expect(result).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("url 이 빈 문자열이면 fetch 를 호출하지 않고 'skipped' 를 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createUrlChecker().check("");

    expect(result).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("URL 형태가 아닌 문자열이면 fetch 를 호출하지 않고 'unreachable' 을 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createUrlChecker().check("이것은 url이 아니다");

    expect(result).toBe("unreachable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["루프백(127.0.0.1)", "http://127.0.0.1/path"],
    ["localhost", "http://localhost/path"],
    ["사설망(10.0.0.1)", "http://10.0.0.1/path"],
    ["사설망(192.168.1.1)", "http://192.168.1.1/path"],
    ["링크로컬(169.254.169.254, 클라우드 메타데이터)", "http://169.254.169.254/latest/meta-data"],
  ])("호스트가 %s 면 fetch 를 호출하지 않고 즉시 'unreachable' 을 반환한다(SSRF 가드)", async (_label, url) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await createUrlChecker().check(url);

    expect(result).toBe("unreachable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
