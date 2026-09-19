# 이월 미해결 (deferred)

> 원장(`findings.jsonl`)의 **파생 뷰**이지 출처가 아니다. 08 이 매 런 통째로 다시 만든다 — 손으로 고치지 않는다 (ADR-H051). 옛 행은 `path` 가 없어 `(경로 미기재)` 한 버킷이다. 00 봉투가 요청 경로와 겹치는 건수를 표기한다.

열린 `deferred` **89건** · 경로 8개

## `src/app/api/plans/webhook/route.ts` — 1건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2343-d42d` | minor | OTHER | 웹훅 시크릿이 막는 동작을 무인가 /api/plans/sync 가 그대로 열어 두어, 시크릿은 접근 통제가 아니라 출처 라벨 보증에 그친다 | sec |

## `src/services/plan-sync.ts` — 1건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2343-d42d` | minor | CONCURRENCY | 웹훅이 자동 진입점이 되면서 syncPlansFromSheet 가 겹쳐 실행될 수 있고, 순서가 뒤집히면 최신 편집이 사라지거나 새 계획이 on_hold 된다 | data |

## `src/services/rules.ts` — 4건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2342-9258` | minor | CONTRACT_DEFECT | 화면 조회와 resolveRules 모두 ORDER BY 가 없어 같은 슬롯 규칙 선택·출력 순서가 비결정적이다 | data |
| `20260919-2342-9258` | minor | CONTRACT_DEFECT | 계약이 입력 순서에 기대면서 brand_rules 조회의 정렬을 정하지 않는다 | gen |
| `20260919-2342-9258` | minor | OTHER | listBrandStandards 의 StandardRuleRow 캐스팅이 select 목록과 타입의 어긋남을 타입검사에서 가린다 | arch |
| `20260919-2342-9258` | minor | DOC_CODE_DRIFT | services/rules.ts 모듈 머리 주석이 products 를 읽는 새 함수와 모순된다 | arch |

## `src/components/shell/Nav.tsx` — 2건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2342-9258` | minor | DOC_CODE_DRIFT | Nav 모듈 주석이 /rules 링크 추가와 모순된다 | gen |
| `20260919-2342-9258` | minor | DOC_CODE_DRIFT | Nav.tsx 주석이 링크 세 개와 나머지 메뉴 6개라고 적고 있으나 /rules 항목이 추가됐다 | arch |

## `src/lib/rules-merge.ts` — 1건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2342-9258` | minor | OTHER | 채널별 규칙 적용 조건이 resolveRules(SQL)와 buildBrandStandards(메모리) 두 곳에 있고 둘이 같은지 확인하는 테스트가 없다 | arch |

## `src/app/rules/page.tsx` — 1건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2342-9258` | major | NAMING | 계약에 없는 public 심볼 dynamic 가 생겼다 |  |

## `src/services/rules.test.ts` — 1건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260919-2342-9258` | minor | TEST_MISSING_FAILURE_PATH | status 필터 단언이 조건을 평탄한 부분문자열로만 봐서 연산자를 잠그지 못하고 정당한 결합 조건에서는 거짓 실패한다 | test |

## `(경로 미기재)` — 78건

| run_id | severity | category | 제목 | 리뷰어 |
|---|---|---|---|---|
| `20260914-1128-e0e4` | minor | CONTRACT_MISMATCH | parseSheetRow 반환 타입의 column 유니온이 계약보다 넓다 | arch |
| `20260914-1128-e0e4` | minor | CONTRACT_DEFECT | 트랜잭션 경계 문단의 '다음 동기화가 자동 복구' 서술이 on_hold-only 케이스에는 성립하지 않는다 | data |
| `20260914-2058-0053` | major | CONTRACT_MISMATCH | llm_called 구조화 로그에 purpose 필드가 아예 없어 초기 호출과 재생성 호출을 구분할 수 없다 | gen |
| `20260914-2058-0053` | major | OTHER | LLM 응답이 파싱/스키마 검증에 실패해도 원문이 로그에 남지 않는다 | data |
| `20260914-2058-0053` | minor | OTHER | productId 생략 케이스를 검증한다는 테스트가 실제로는 productId 를 5로 덮어써 보내고, 그 제목이 말하는 상황(키 생략)은 현재 스키마상 400이 난다 | gen |
| `20260914-2058-0053` | minor | INPUT_VALIDATION | TitleRequestSchema 의 topicMemo·targetPersona 가 빈 문자열을 신뢰 경계에서 걸러내지 않는다 | data |
| `20260914-2058-0053` | minor | CONTRACT_MISMATCH | TitleCandidates.items 가 계약의 3-tuple 대신 일반 배열 타입으로 선언됨 | arch |
| `20260914-2058-0053` | major | INPUT_VALIDATION | buildTitlesUserPrompt의 <user_input> 구분자가 입력값에 같은 종료 태그를 넣으면 그대로 깨져 05의 프롬프트 인젝션 완화(sec F-2)가 우회된다 |  |
| `20260914-2058-0053` | major | OTHER | generateTitles의 시간 예산 타이머가 resolveRules(DB 조회 2회) 완료 이후부터 시작돼, DB 지연이 TITLE_TOTAL_BUDGET_MS·maxDuration=30 계산에서 빠진다 |  |
| `20260914-2058-0053` | major | OTHER | JSON 복구용 정규식이 응답 전체에 걸쳐 탐욕적으로 매치돼, 유효한 JSON 뒤에 붙은 부가 텍스트가 있으면 파싱 실패로 오판해 재시도 예산을 낭비한다 |  |
| `20260915-0930-3b43` | minor | CONTRACT_MISMATCH | parseJson 마지막 폴백 분기가 다른 실패 분기와 다른 오류 타입으로 빠져나간다 | gen |
| `20260915-1256-5ef4` | minor | CONTRACT_MISMATCH | INSERT/재시도 UPDATE의 RETURNING 절에 계약이 명시한 updatedAt이 빠졌다 | gen |
| `20260915-1256-5ef4` | minor | OTHER | createContentWithBody 가 sales_channels 의 같은 행을 두 번 조회한다 | data |
| `20260915-1256-5ef4` | minor | INPUT_VALIDATION | buildBodyRegenPrompt 가 1차 LLM 출력·finding 을 이스케이프·경계 표시 없이 재삽입 | sec |
| `20260915-1256-5ef4` | major | NAMING | 계약에 없는 public 심볼 maxDuration 가 생겼다 |  |
| `20260915-1754-5568` | major | CONTRACT_DEFECT | GET /api/contents 라우트가 서비스 계층 없이 조회·필터링·매핑을 직접 수행한다 | arch |
| `20260915-1754-5568` | minor | CONCURRENCY | submit 전이의 check-then-act 시퀀스에 트랜잭션/락이 없어 동시 요청 시 content_history.versionNo 가 중복될 수 있다 | gen |
| `20260915-1754-5568` | minor | CONTRACT_DEFECT | cancel_review 의 extra.validation 널 폴백이 계약 문구(row.detectedTerms as ValidationResult, 널 방어 없음)와 다르고 테스트로 검증되지 않는다 | data |
| `20260915-1754-5568` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 services/content-workflow.ts · TRANSITIONS 를 참조하는 테스트가 없다 |  |
| `20260915-1754-5568` | major | NAMING | 계약에 없는 public 심볼 maxDuration 가 생겼다 |  |
| `20260915-1754-5568` | major | NAMING | 계약에 없는 public 심볼 Result 가 생겼다 |  |
| `20260915-1754-5568` | minor | CONTRACT_DEFECT | cancel_review 경로 extra.validation 널 폴백이 계약과는 일치하지만 여전히 테스트로 검증되지 않는다 (F-3 재상정) | data |
| `20260915-1754-5568` | minor | OTHER | GET이 파일 단위 maxDuration(POST의 60초)을 그대로 물려받아 계약이 정한 10초 예산과 다르다 |  |
| `20260915-1754-5568` | minor | OTHER | 중복된 쿼리 파라미터가 조용히 마지막 값만 반영된다 |  |
| `20260915-1754-5568` | minor | OTHER | resolveContentLink의 채널·제품 조회가 병렬화 가능한데 순차 실행이다 |  |
| `20260915-1754-5568` | minor | OTHER | id 파싱 블록이 세 라우트 파일에 그대로 반복된다 |  |
| `20260915-2042-728c` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 services/content-workflow.ts · TransitionAction 를 참조하는 테스트가 없다 |  |
| `20260915-2042-728c` | major | NAMING | 계약에 없는 public 심볼 maxDuration 가 생겼다 |  |
| `20260915-2042-728c` | minor | OTHER | resolveActorUserId가 ORDER BY 없이 LIMIT 1로 행을 골라 같은 role의 유저가 여럿이면 reviewerId가 비결정적이다 |  |
| `20260915-2042-728c` | minor | OTHER | 반려 사유 필수 규칙이 transition() 자신이 아니라 라우트의 zod 스키마에서만 강제된다 |  |
| `20260915-2042-728c` | minor | OTHER | approveContent가 본문 공백 여부를 검사하지 않아 빈 본문이 브랜드 예시로 등록될 수 있다 |  |
| `20260915-2042-728c` | minor | OTHER | updatedRow 재조립이 .set() 삼항식과 별도로 같은 필드를 액션별로 다시 분기해 두 곳을 수동으로 맞춰야 한다 |  |
| `20260915-2042-728c` | minor | OTHER | updateQuery의 4-way 분기가 where/returning 접미사를 매번 반복한다 |  |
| `20260915-2042-728c` | minor | OTHER | resolveActorUserId가 listContents의 동일한 인라인 쿼리와 중복된다 |  |
| `20260915-2042-728c` | minor | OTHER | approve/reject 라우트가 submit/cancel-review 라우트와 거의 동일한 보일러플레이트를 반복한다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/lib/env.ts · EnvSchema 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/app/layout.tsx · RootLayout({children}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/shell/Topbar.tsx · Topbar({role}: {role: Actor["role"]}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/shell/RoleSwitch.tsx · RoleSwitch({role}: {role: Actor["role"]}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/shell/Nav.tsx · Nav({role}: {role: Actor["role"]}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/app/contents/page.tsx · ContentsPage({searchParams}: {searchParams: Promise<{status?: string}>}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/app/contents/[id]/page.tsx · ContentDetailPage({params}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/contents/ContentDetailPanel.tsx · ContentDetailPanel({content, channelName, productName, actorRole}: {..., actorRole: Actor["role"]}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/contents/ContentActions.tsx · ContentActions({contentId, status, actorRole, hasWarnings}) 를 참조하는 테스트가 없다 |  |
| `20260916-0038-3305` | major | NAMING | 계약에 없는 public 심볼 maxDuration 가 생겼다 |  |
| `20260916-0206-6da3` | major | CONTRACT_DEFECT | resolveContentLink와 resolveChannelFormat가 같은 salesChannels 행을 매 요청마다 두 번 SELECT한다 — 계약에 박혀 있는 중복 조회 | data |
| `20260916-0206-6da3` | major | OTHER | approveContent가 새로 추가한 resolveChannelFormat 호출을 try/catch 없이 실행해 실패 시 처리되지 않은 예외로 이어질 수 있음 | sec |
| `20260916-0206-6da3` | major | NAMING | 계약에 없는 public 심볼 ChannelFormatCard 가 생겼다 |  |
| `20260916-0206-6da3` | minor | OTHER | resolveChannelFormat이 DB 조회 자체의 실패까지 '채널 없음'과 같은 null로 흡수한다 |  |
| `20260916-0206-6da3` | minor | OTHER | ChannelFormatCard의 '링크 복사' 버튼이 link가 빈 문자열이어도 그대로 노출된다 |  |
| `20260916-0206-6da3` | minor | OTHER | 해시태그 추출 정규식이 태그 뒤에 붙은 구두점을 포함한다 |  |
| `20260916-1054-e7ff` | major | CONTRACT_DEFECT | 가드가 hostname 문자열만 검사하고 실제 DNS 해석 결과(연결 시점 목적지 IP)를 재검증하지 않아 DNS 리바인딩으로 우회된다 | sec |
| `20260916-1054-e7ff` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/lib/schemas.ts · PublishInputSchema 를 참조하는 테스트가 없다 |  |
| `20260916-1054-e7ff` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/services/content-workflow.ts · TransitionAction 를 참조하는 테스트가 없다 |  |
| `20260916-1054-e7ff` | major | NAMING | 계약에 없는 public 심볼 maxDuration 가 생겼다 |  |
| `20260916-1054-e7ff` | major | NAMING | 계약에 없는 public 심볼 POST 가 생겼다 |  |
| `20260916-1054-e7ff` | major | NAMING | 계약에 없는 public 심볼 UrlCheckResult 가 생겼다 |  |
| `20260916-1054-e7ff` | major | OTHER | 0.0.0.0/:: (미지정 주소)가 PRIVATE_HOST_PATTERNS 에 없어 루프백 우회 가능 | sec |
| `20260916-1054-e7ff` | major | CONTRACT_DEFECT | DNS 리바인딩을 범위 밖으로 받아들인 계약 근거가 인증 없는 공개 엔드포인트라는 실제 노출과 맞지 않는다 | sec |
| `20260916-1347-f193` | minor | CONTRACT_DEFECT | 광고 성과 표 emptyLabel에 내부 MoSCoW 표기 'Should'가 사용자 화면에 그대로 노출된다 | gen |
| `20260916-1347-f193` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/ui/KpiBand.tsx · KpiBand({ label, now }: { label: string; now: number }): JSX.Element 를 참조하는 테스트가 없다 |  |
| `20260916-1347-f193` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/ui/Table.tsx · Table<T>({ headers, rows, renderRow, emptyLabel }: { headers: string[]; rows: T[]; renderRow: (row: T) => React.ReactNode[]; emptyLabel: string }): JSX.Element 를 참조하는 테스트가 없다 |  |
| `20260916-1347-f193` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/app/page.tsx · Home(): Promise<JSX.Element> 를 참조하는 테스트가 없다 |  |
| `20260916-1347-f193` | major | NAMING | 계약에 없는 public 심볼 dynamic 가 생겼다 |  |
| `20260916-1347-f193` | minor | OTHER | 채널당 광고 통화가 섞이면 min(currency)로 잘못 합산될 수 있다 |  |
| `20260916-1347-f193` | minor | OTHER | 검수 대기·승인됨 Table 호출부의 headers·renderRow가 그대로 중복된다 |  |
| `20260916-1347-f193` | minor | OTHER | KpiBand가 UI_GUIDE의 4열·목표 마커 전체 규격을 구현하지 않는다 |  |
| `20260916-1614-ad59` | major | TX_BOUNDARY | contents UPDATE 성공 후 content_history INSERT·후속 호출이 실패하면 데이터는 이미 바뀌었는데도 500 INTERNAL 로 응답한다 | data |
| `20260916-1614-ad59` | major | CONTRACT_DEFECT | regenerate 상태 가드가 content-workflow.ts 의 TRANSITIONS 밖에서 draft/rejected 를 하드코딩해 단일 출처 원칙을 어긴다 | arch |
| `20260916-1614-ad59` | minor | RESPONSE_SHAPE | 같은 INVALID_TRANSITION 코드가 이 함수 안에서, 그리고 content-workflow.ts 대비 서로 다른 details/message 형태로 나간다 | arch |
| `20260916-1614-ad59` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/lib/schemas.ts · RegenerateInputSchema 를 참조하는 테스트가 없다 |  |
| `20260916-1614-ad59` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/components/contents/ContentActions.tsx · ContentActions 를 참조하는 테스트가 없다 |  |
| `20260916-1614-ad59` | major | NAMING | 계약에 없는 public 심볼 maxDuration 가 생겼다 |  |
| `20260916-1614-ad59` | minor | OTHER | createContentWithBody와 regenerateContentBody의 예산 계산+FR-006 자동재생성 로직이 거의 그대로 중복된다 |  |
| `20260917-0028-40dc` | minor | TX_BOUNDARY | INSERT 실패 시 보상 UPDATE(publish_plan_id 복구)가 4단계와 달리 가드 없이 무조건 쓴다 | data |
| `20260917-0028-40dc` | minor | OTHER | 새 버전 제목이 항상 리터럴 " (v2)" 를 붙여 재-재생성 시 접미사가 중복된다 |  |
| `20260917-0028-40dc` | minor | OTHER | ContentActions.tsx 조기 return null 가드가 상태 5종을 전부 나열해 도달 불가능한 죽은 코드가 됐다 |  |
| `20260919-2343-d42d` | major | TEST_MISSING_FAILURE_PATH | 계약의 유닛 src/lib/db/schema.ts · importTriggerEnum 를 참조하는 테스트가 없다 |  |
