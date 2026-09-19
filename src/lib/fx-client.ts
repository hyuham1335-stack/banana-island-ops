/**
 * Frankfurter 환율 조회 클라이언트 — FR-022 계약(run 20260919-2343-1c04).
 * 응답을 검증 없이 그대로 반환한다(검증은 services/fx.ts 가 한다). 재시도 0회(TRD §7).
 */

export const FRANKFURTER_LATEST_URL = "https://api.frankfurter.dev/v1/latest?from=USD&to=KRW,PHP";
export const FX_FETCH_TIMEOUT_MS = 5000;

export interface FxClient {
  fetchLatest(): Promise<unknown>;
}

export function createFxClient(): FxClient {
  return {
    async fetchLatest(): Promise<unknown> {
      const res = await fetch(FRANKFURTER_LATEST_URL, { signal: AbortSignal.timeout(FX_FETCH_TIMEOUT_MS) });
      if (!res.ok) {
        throw new Error(`Frankfurter HTTP ${res.status}`);
      }
      return res.json();
    },
  };
}
