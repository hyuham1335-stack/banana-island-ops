"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CostSheet } from "@/types";
import type { CostFx } from "@/lib/cost-calc";
import { perUnitKrw } from "@/lib/cost-calc";
import {
  emptyCostItem,
  toEditableItems,
  toUpdateInput,
  isDirty,
  describeCostSheetError,
  formatKrw,
  COST_STAGE_LABELS,
  type EditableCostItem,
} from "@/lib/cost-sheet-view";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";

const STAGES = ["ph", "kr", "us"] as const;
const CURRENCIES = ["KRW", "PHP", "USD"] as const;

/**
 * 원가표 편집·확정·복제 — 계약(run 20260920-0107-4265) 「화면 · CostSheetEditor」.
 * status 로 표시만 분기한다(01 F-5) — 전이 가능 여부의 판정은 서버가 하고, 이 컴포넌트는
 * 409 응답을 describeCostSheetError 문구로 보여줄 뿐이다.
 */
export function CostSheetEditor({ sheet, fx }: { sheet: CostSheet; fx: CostFx | null }) {
  const router = useRouter();
  const [name, setName] = useState(sheet.name);
  const [rows, setRows] = useState<EditableCostItem[]>(() => toEditableItems(sheet.items));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState(`${sheet.name} 복제`);

  const isDraft = sheet.status === "draft";
  const dirty = isDraft && isDirty(sheet, name, rows);

  function updateRow(index: number, patch: Partial<EditableCostItem>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyCostItem()]);
  }

  function perUnitCell(row: EditableCostItem): string {
    if (!fx) return "—";
    const amountNum = Number(row.amount);
    if (row.amount.trim() === "" || Number.isNaN(amountNum)) return "—";
    let batchQty: number | null = null;
    if (row.basis === "per_batch") {
      const batchNum = Number(row.batchQty);
      if (row.batchQty.trim() === "" || Number.isNaN(batchNum) || batchNum <= 0) return "—";
      batchQty = batchNum;
    }
    return formatKrw(perUnitKrw({ amount: row.amount, currency: row.currency, basis: row.basis, batchQty }, fx));
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/cost-sheets/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toUpdateInput(name, rows)),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(describeCostSheetError(res.status, json));
        setPending(false);
        return;
      }
      setName(json.data.name);
      setRows(toEditableItems(json.data.items));
      setPending(false);
      router.refresh();
    } catch {
      setError("요청을 보내지 못했습니다.");
      setPending(false);
    }
  }

  async function confirmSheet() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/cost-sheets/${sheet.id}/confirm`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(describeCostSheetError(res.status, json));
        setPending(false);
        return;
      }
      setPending(false);
      setConfirming(false);
      router.refresh();
    } catch {
      setError("요청을 보내지 못했습니다.");
      setPending(false);
    }
  }

  async function cloneSheet() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/cost-sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: sheet.productId,
          distributionRoute: sheet.distributionRoute,
          name: cloneName,
          cloneFromId: sheet.id,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(describeCostSheetError(res.status, json));
        setPending(false);
        return;
      }
      router.push(`/costsheet?productId=${sheet.productId}&route=${sheet.distributionRoute}&sheetId=${json.data.id}`);
    } catch {
      setError("요청을 보내지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        {isDraft ? (
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
        ) : (
          <span className="panel-title">{sheet.name}</span>
        )}
        <span className="tag">{isDraft ? "작성중" : "확정"}</span>
        {!isDraft && sheet.confirmedAt ? <span className="panel-note">{sheet.confirmedAt.slice(0, 10)} 확정</span> : null}
      </div>
      <div className="panel-body">
        <table className="table">
          <thead>
            <tr>
              <th>단계</th>
              <th>비용 종류</th>
              <th>금액</th>
              <th>통화</th>
              <th>산정 기준</th>
              <th>배치 수</th>
              <th>개당 원화</th>
              {isDraft ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={isDraft ? 8 : 7}>항목이 없습니다</td>
              </tr>
            ) : (
              rows.map((row, i) =>
                isDraft ? (
                  <tr key={i}>
                    <td>
                      <select
                        value={row.stage}
                        onChange={(e) => updateRow(i, { stage: e.target.value as EditableCostItem["stage"] })}
                      >
                        {STAGES.map((s) => (
                          <option key={s} value={s}>
                            {COST_STAGE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input value={row.costKind} onChange={(e) => updateRow(i, { costKind: e.target.value })} />
                    </td>
                    <td className="num">
                      <input value={row.amount} onChange={(e) => updateRow(i, { amount: e.target.value })} />
                    </td>
                    <td>
                      <select
                        value={row.currency}
                        onChange={(e) => updateRow(i, { currency: e.target.value as EditableCostItem["currency"] })}
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={row.basis}
                        onChange={(e) =>
                          updateRow(i, {
                            basis: e.target.value as EditableCostItem["basis"],
                            batchQty: e.target.value === "per_unit" ? "" : row.batchQty,
                          })
                        }
                      >
                        <option value="per_unit">개당</option>
                        <option value="per_batch">배치당</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        value={row.batchQty}
                        disabled={row.basis === "per_unit"}
                        onChange={(e) => updateRow(i, { batchQty: e.target.value })}
                      />
                    </td>
                    <td className="num">{perUnitCell(row)}</td>
                    <td>
                      <Button variant="danger" small disabled={pending} onClick={() => removeRow(i)}>
                        삭제
                      </Button>
                    </td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td>{COST_STAGE_LABELS[row.stage]}</td>
                    <td>{row.costKind}</td>
                    <td className="num">{row.amount}</td>
                    <td>{row.currency}</td>
                    <td>{row.basis === "per_unit" ? "개당" : "배치당"}</td>
                    <td className="num">{row.basis === "per_batch" ? row.batchQty : "—"}</td>
                    <td className="num">{perUnitCell(row)}</td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>

        {isDraft ? (
          <div className="btn-row">
            <Button variant="ghost" small disabled={pending} onClick={addRow}>
              항목 추가
            </Button>
            <Button small disabled={pending} onClick={() => void save()}>
              {pending ? "저장하는 중…" : "저장"}
            </Button>
            {dirty ? <span className="hint">저장하지 않은 변경이 있습니다</span> : null}
            {confirming ? (
              <div className="confirm">
                확정하면 더 고칠 수 없습니다. 확정할까요?
                <Button small disabled={pending} onClick={() => void confirmSheet()}>
                  확정
                </Button>
                <Button variant="ghost" small disabled={pending} onClick={() => setConfirming(false)}>
                  취소
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                small
                disabled={pending || dirty}
                disabledReason={dirty ? "저장하지 않은 변경이 있습니다" : undefined}
                onClick={() => setConfirming(true)}
              >
                확정
              </Button>
            )}
          </div>
        ) : (
          <div className="btn-row">
            {cloning ? (
              <div className="field">
                <label>새 원가표 이름</label>
                <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} disabled={pending} />
                <Button small disabled={pending} onClick={() => void cloneSheet()}>
                  {pending ? "복제하는 중…" : "복제하기"}
                </Button>
              </div>
            ) : (
              <Button variant="ghost" small disabled={pending} onClick={() => setCloning(true)}>
                복제해 새 버전 만들기
              </Button>
            )}
          </div>
        )}

        {error ? <Notice variant="bad">{error}</Notice> : null}
      </div>
    </div>
  );
}
