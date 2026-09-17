# 규칙 승격 이력

> 이 파일은 `promote` 가 쓴다. 사람이 직접 적지 않는다.
> 승격은 **07 에서 런당 한 번**이고, 05 는 `staged` 까지만 만든다.

각 줄이 담는 것 — 날짜 / `run_id` / `rule_id` / category / `enforceable` /
근거 런과 횟수 / 중복·충돌 판정 / 실제 조치 / 베이스라인 diff / 철회 사유.

**`lint` 승격은 베이스라인 diff 를 반드시 남긴다.** 없으면 "규칙은 추가했는데
아무것도 안 막는다"가 조용히 통과한다.

| 날짜 | run_id | rule_id | category | enforceable | 근거 | 판정 | 조치 | 베이스라인 diff | 철회 사유 |
|---|---|---|---|---|---|---|---|---|---|
| 2026-09-16 | 20260916-0038-3305 | naming-convention | NAMING | lint | 3회 / 3런 | new | skipped | 미측정 | - |
| 2026-09-16 | 20260916-0038-3305 | component-units-untested-by-design | TEST_MISSING_FAILURE_PATH | prose | 10회 / 2런 | new | skipped | 해당 없음 | - |
| 2026-09-16 | 20260916-0206-6da3 | maxduration-route-config-not-out-of-contract | NAMING | lint | 4회 / 4런 | new | skipped | 미측정 | - |
| 2026-09-16 | 20260916-0206-6da3 | transition-action-coverage-stale | TEST_MISSING_FAILURE_PATH | prose | 10회 / 2런 | new | skipped | 해당 없음 | - |
| 2026-09-16 | 20260916-1054-e7ff | maxduration-route-config-not-out-of-contract | NAMING | lint | 7회 / 5런 | new | skipped | 미측정 | - |
| 2026-09-16 | 20260916-1054-e7ff | transition-action-coverage-stale | TEST_MISSING_FAILURE_PATH | prose | 12회 / 3런 | new | skipped | 해당 없음 | - |
| 2026-09-16 | 20260916-1347-f193 | maxduration-route-config-not-out-of-contract | NAMING | lint | 8회 / 6런 | new | skipped | 미측정 | - |
| 2026-09-16 | 20260916-1347-f193 | transition-action-coverage-stale | TEST_MISSING_FAILURE_PATH | prose | 15회 / 4런 | new | skipped | 해당 없음 | - |
| 2026-09-16 | 20260916-1614-ad59 | maxduration-route-config-not-out-of-contract | NAMING | lint | 9회 / 7런 | new | skipped | 미측정 | - |
| 2026-09-16 | 20260916-1614-ad59 | transition-action-coverage-stale | TEST_MISSING_FAILURE_PATH | prose | 17회 / 5런 | new | skipped | 해당 없음 | - |
| 2026-09-17 | 20260917-0028-40dc | maxduration-route-config-not-out-of-contract | NAMING | lint | 9회 / 7런 | new | skipped | 미측정 | - |
| 2026-09-17 | 20260917-0028-40dc | internal-catchall-untested | TEST_MISSING_FAILURE_PATH | prose | 3회 / 2런 | new | skipped | 해당 없음 | - |
| 2026-09-17 | 20260917-0028-40dc | transition-action-coverage-stale | TEST_MISSING_FAILURE_PATH | prose | 17회 / 5런 | new | skipped | 해당 없음 | - |
