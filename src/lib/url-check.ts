/**
 * FR-013 발행 URL 도달성 점검 — 계약(_workspace/contract_fr-013-publish.md) 「외부 경계」·「유닛」.
 * `UrlChecker` 인터페이스로 주입해 테스트가 모킹할 수 있게 한다 — src/lib/sheets.ts 의
 * `SheetsClient` 인터페이스 주입 패턴과 같다.
 */

import { promises as dns } from "node:dns";

export type UrlCheckResult = "ok" | "unreachable" | "skipped";

export interface UrlChecker {
  check(url: string | null): Promise<UrlCheckResult>;
}

// 사설(RFC1918)·루프백·링크로컬 호스트 패턴 — SSRF 가드(02-cross-verify 반영).
// fe80::/10(링크로컬 IPv6)은 리터럴 접두사 정규식으로 대역 전체를 못 덮어 isFe80Range()로 계산 판정한다(05 라운드1 sec F-3).
const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^10\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.(\d{1,3})\.(\d{1,3})$/,
  /^192\.168\.(\d{1,3})\.(\d{1,3})$/,
  /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  /^169\.254\.(\d{1,3})\.(\d{1,3})$/,
  /^::1$/,
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^::$/,
];

// WHATWG URL.hostname 은 IPv6 를 대괄호로 감싸 반환한다("[::1]") — 사설 호스트 판정 전에 벗긴다(05 라운드1 F-2).
function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "");
}

// fe80::/10 은 첫 16비트 그룹이 0xfe80~0xfebf 인 모든 주소다. 정규식 하나로 못 채워 계산으로 판정한다(05 라운드1 sec F-3).
function isFe80Range(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  const firstGroup = hostname.split(":")[0];
  if (!/^[0-9a-fA-F]{1,4}$/.test(firstGroup)) return false;
  const groupValue = parseInt(firstGroup, 16);
  return groupValue >= 0xfe80 && groupValue <= 0xfebf;
}

// IPv4-매핑 IPv6("::ffff:a.b.c.d")는 마지막 32비트를 IPv4 주소로 해석해 IPv4 사설 대역 패턴을 그대로 적용한다(05 라운드1 F-2).
function extractIpv4MappedAddress(hostname: string): string | null {
  const match = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(hostname);
  return match ? match[1] : null;
}

function isPrivateHost(hostname: string): boolean {
  const mappedIpv4 = extractIpv4MappedAddress(hostname);
  if (mappedIpv4) {
    return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(mappedIpv4));
  }
  if (isFe80Range(hostname)) return true;
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

/**
 * 실제 구현 — fetch(HEAD) 로 발행 URL 도달성을 점검한다. 사설/루프백/링크로컬 호스트는
 * fetch 를 시도하지 않고 즉시 "unreachable"(SSRF 가드). 호출 시점에는 네트워크 I/O 가
 * 없다 — `.check()` 호출 시에만 fetch 한다.
 */
export function createUrlChecker(): UrlChecker {
  return {
    async check(url: string | null): Promise<UrlCheckResult> {
      if (!url) return "skipped";

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return "unreachable";
      }

      const hostname = stripBrackets(parsed.hostname);

      if (isPrivateHost(hostname)) {
        return "unreachable";
      }

      // DNS 조회 기반 재검증(05 라운드2 sec F-4) — 호스트 문자열 검사만으로는 사설 IP로
      // resolve되는 도메인(DNS 리바인딩)을 못 잡는다. fetch 전에 실제 해석된 IP 전부를
      // 조회해 그중 하나라도 사설/루프백/링크로컬/미지정 대역이면 fetch를 시도하지 않는다.
      // dns.lookup 자체에는 타임아웃이 없어(07 code-review 수리) 3초로 별도 제한한다 —
      // 없으면 응답 없는 네임서버가 라우트의 maxDuration(15초) 예산을 다 써버릴 수 있다.
      let dnsTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const addresses = await Promise.race([
          dns.lookup(hostname, { all: true }),
          new Promise<never>((_, reject) => {
            dnsTimer = setTimeout(() => reject(new Error("dns_timeout")), 3000);
          }),
        ]);
        if (addresses.some((address) => isPrivateHost(address.address))) {
          return "unreachable";
        }
      } catch {
        return "unreachable";
      } finally {
        clearTimeout(dnsTimer);
      }

      try {
        const res = await fetch(url, {
          method: "HEAD",
          redirect: "error",
          signal: AbortSignal.timeout(5000),
          headers: { "User-Agent": "BananaIslandOps-LinkChecker/1.0" },
        });
        return res.ok ? "ok" : "unreachable";
      } catch {
        return "unreachable";
      }
    },
  };
}
