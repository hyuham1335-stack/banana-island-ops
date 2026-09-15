import type { Finding, ValidationResult } from "@/lib/validator";

/** 검증기 결과 — docs/UI_GUIDE.md 「Checks」. 서버가 이미 계산한 blocks/warns/missing 을 그대로 나열한다. */
export function Checks({ validation }: { validation: ValidationResult }) {
  const findings: Finding[] = [...validation.blocks, ...validation.warns];
  const isClean = findings.length === 0 && validation.missing.length === 0;

  return (
    <div className="checks">
      <div className="checks-head">
        검증기 결과
        <span className="panel-note">
          차단 {validation.blocks.length}건 · 경고 {validation.warns.length}건 · 필수표현 누락{" "}
          {validation.missing.length}건
        </span>
      </div>

      {isClean ? (
        <div className="check">
          <span className="sev ok">통과</span>
          <span>금칙어 없음 · 필수 표현 모두 포함</span>
        </div>
      ) : (
        <>
          {findings.map((finding, i) => (
            <div className="check" key={`${finding.ruleId}-${i}`}>
              <span className={`sev ${finding.severity === "block" ? "block" : "warn"}`}>
                {finding.severity === "block" ? "차단" : "경고"}
              </span>
              <span>
                &quot;{finding.matched}&quot; — {finding.label}
              </span>
              {finding.alternative ? <span className="alt">→ {finding.alternative}</span> : null}
            </div>
          ))}
          {validation.missing.map((phrase) => (
            <div className="check" key={phrase}>
              <span className="sev warn">누락</span>
              <span>필수 표현 &quot;{phrase}&quot;이 본문에 없습니다</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
