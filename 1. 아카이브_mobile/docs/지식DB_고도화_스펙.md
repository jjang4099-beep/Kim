# SJ 아카이브 — 지식 DB 고도화 작업 지시서

> 대상: Claude Code
> 전제: 기존 `CLAUDE.md`의 패턴 규칙을 우선 따른다. 이 문서와 충돌하면 `CLAUDE.md`가 이긴다.
> 원칙: **단계별 순차 적용. 각 Phase 완료 후 동작 확인 전까지 다음 Phase로 넘어가지 않는다.**

---

## 0. 문제 정의

현재 `liber_classic` / `insight_daily` / `idiom_daily` 세 피드는 항목을 **무작위 낱개**로 내보낸다.
그 결과:

- 오늘 본 것과 내일 볼 것 사이에 관계가 없다 → 축적이 안 됨
- 항목 하나의 정보량이 적다 → 검색 30초면 나오는 수준
- 한 번 소비되고 끝난다 → 재등장 설계가 없다

**해결 방향은 항목을 길게 쓰는 게 아니라, 항목들 사이에 구조를 넣는 것이다.**

세 축으로 나눠 작업한다.

| 축 | 내용 |
|---|---|
| A. 계열(series) | 낱개 대신 주제 묶음으로 순차 배달 |
| B. 3층 깊이(depth) | 한 줄 / 한 문단 / 한 페이지 |
| C. 재등장(recall) | 노출 이력 기반 재배달 |

---

## Phase 1 — 스키마 확장

### 1-1. 기존 item 스키마에 필드 추가

모든 지식 컬렉션(`liber_classic`, `insight_daily`, `idiom_daily`)의 아이템 문서에 다음을 추가한다.
**기존 필드는 건드리지 않는다. 전부 optional로 추가하고 기본값을 준다.**

```js
{
  // ── 기존 필드 유지 ──

  // A. 계열
  seriesId:     { type: String, default: null, index: true },
  seriesOrder:  { type: Number, default: null },   // 계열 내 순번 (1부터)

  // B. 깊이
  depth: {
    line:      { type: String, required: true },   // 1층 — 한 줄. 앱 카드에 노출
    paragraph: { type: String, default: null },    // 2층 — 3~5문장. 앱 상세
    page:      { type: String, default: null }     // 3층 — 웹 딥다이브 (마크다운)
  },
  hasDeepDive:  { type: Boolean, default: false }, // page 존재 여부 캐시

  // C. 재등장
  exposureCount:   { type: Number, default: 0, index: true },
  lastExposedAt:   { type: Date,   default: null, index: true },
  recallEligibleAt:{ type: Date,   default: null, index: true },

  // 공통
  tags:       { type: [String], default: [], index: true },
  difficulty: { type: Number, default: 2 },        // 1~3
  sourceNote: { type: String, default: null }      // 출처 / 참고
}
```

> **주의:** `depth.line`은 기존 본문 필드에서 그대로 옮겨온다. 마이그레이션에서 처리.

### 1-2. 새 컬렉션 `series`

```js
{
  _id,
  seriesId:    { type: String, unique: true },   // 예: 'idiom-decision'
  title:       String,        // '결정과 망설임'
  subtitle:    String,        // 한 줄 설명
  domain:      String,        // 'idiom' | 'insight' | 'classic'
  itemCount:   Number,
  intervalDays:{ type: Number, default: 1 },     // 항목 간 배달 간격
  accentColor: String,        // 웹 디자인 토큰용
  createdAt, updatedAt
}
```

### 1-3. 새 컬렉션 `userSeriesProgress`

```js
{
  userId,
  seriesId,
  currentOrder: { type: Number, default: 0 },  // 마지막으로 받은 순번
  startedAt:    Date,
  completedAt:  { type: Date, default: null }
}
```
복합 인덱스: `{ userId: 1, seriesId: 1 }` unique

---

## Phase 2 — 마이그레이션 스크립트

`scripts/migrate-depth-schema.js` 로 작성. **멱등(idempotent)하게. 두 번 돌려도 안전해야 한다.**

1. 각 지식 컬렉션 순회
2. `depth.line`이 없으면 기존 본문 필드 값을 복사
3. 나머지 신규 필드에 기본값 주입
4. `seriesId`는 전부 `null`로 두고 Phase 3에서 채운다
5. 처리 건수 / 스킵 건수를 콘솔에 출력
6. `--dry-run` 플래그 지원

기존 빌더(`buildClassicDB`, `buildInsightDB`, `buildIdiomDB`)도 새 스키마로 생성하도록 수정한다.

---

## Phase 3 — 계열 구성

### 3-1. 초기 계열 정의

`data/series-definitions.json` 에 정의를 두고 `scripts/build-series.js`로 주입한다.

**`idiom_daily` 계열 예시 (300개를 아래 방식으로 묶는다):**

| seriesId | 제목 | 개수 |
|---|---|---|
| `idiom-decision` | 결정과 망설임 | 10 |
| `idiom-conflict` | 갈등과 화해 | 10 |
| `idiom-money` | 돈과 거래 | 10 |
| `idiom-body` | 몸에서 온 말 | 10 |
| `idiom-sea` | 바다와 배에서 온 말 | 10 |
| `idiom-war` | 전쟁에서 온 말 | 10 |

**`insight_daily`는 기존 7 카테고리를 그대로 계열의 상위로 쓰되, 각 카테고리 안에서 8~12개짜리 계열로 다시 쪼갠다.**

**`liber_classic`(38권)은 책 단위가 곧 계열이다.** `seriesId = 'classic-{bookSlug}'`, `seriesOrder`는 발췌 순서.

### 3-2. 계열 배정 규칙

- 어떤 계열에도 안 들어가는 항목은 `seriesId: null`로 남긴다 (기존처럼 낱개 배달)
- 한 계열의 최소 크기는 6. 그보다 작으면 계열로 만들지 않는다
- 계열 내 순서는 **쉬운 것 → 어려운 것**, 또는 **일반 → 특수** 로 정렬한다. 무작위 금지

---

## Phase 4 — 배달 로직 교체

`services/delivery.js` (없으면 신설)에 오늘의 항목 선정 로직을 통합한다.

### 4-1. 우선순위

```
1. 진행 중인 계열이 있으면 → 그 계열의 다음 항목
2. 재등장 대상이 있으면 → recall 항목 (하루 최대 1개)
3. 새 계열 시작 조건이면 → 새 계열의 1번 항목
4. 그 외 → 낱개 항목 무작위
```

### 4-2. 계열 진행 규칙

- 한 사용자가 동시에 진행하는 계열은 **도메인당 최대 1개** (idiom 1개 + insight 1개 + classic 1개 = 최대 3개 동시)
- 계열 완료 시 `completedAt` 기록 후, **완료 카드**를 하나 발행한다
  → "결정과 망설임 10편을 마쳤습니다. 다시 보기 / 딥다이브"
- 계열 중단(7일 미접속) 시 재개 카드로 안내

### 4-3. 재등장 규칙

- 배달 시점에 `exposureCount++`, `lastExposedAt = now`
- `recallEligibleAt = now + interval`
  - 1회차 → +30일
  - 2회차 → +90일
  - 3회차 → +180일
  - 4회차 이상 → 재등장 풀에서 제외
- 재등장 카드는 시각적으로 구분한다. 상단에 `3월 12일에 본 표현` 라벨
- 재등장 시에는 **1층이 아니라 2층(paragraph)을 먼저 보여준다.** 같은 걸 두 번 보는 게 아니라 한 겹 더 들어가는 경험이어야 한다

---

## Phase 5 — 3층 콘텐츠 채우기

### 5-1. 작성 대상 선정

전부 채우지 않는다. 다음 기준으로 고른다.

- **2층(paragraph):** 전 항목 필수. 3~5문장. "왜 그런가 / 어디서 왔는가"를 담는다
- **3층(page):** 계열당 1~2개만. 그 계열의 대표 항목

### 5-2. 3층 문서 규격

마크다운으로 저장하고 웹에서 렌더한다.

```
## 한 줄 요약
## 배경 — 어디서 왔는가
## 실제 용례 3개 (문맥이 다른 것으로)
## 비슷하지만 다른 표현
## 이 계열의 다른 항목들 (자동 생성 링크)
```

> **품질 기준 한 가지:** 작성 후 스스로 물을 것 — "이걸 검색하면 30초 만에 나오는가?"
> 그렇다면 2층까지만 쓰고 3층은 만들지 않는다.

### 5-3. 작성 워크플로

`scripts/draft-depth.js` — 특정 `seriesId`를 받아 각 항목의 2층 초안을 생성하고 `data/drafts/{seriesId}.json`에 저장한다.
**DB에 바로 쓰지 않는다.** 사람이 검수한 뒤 `scripts/apply-depth.js`로 주입한다.

---

## Phase 6 — API 및 프런트

### 6-1. 엔드포인트

```
GET  /api/feed/today            오늘의 배달 (계열 정보 포함)
GET  /api/series                계열 목록
GET  /api/series/:seriesId      계열 상세 + 진행률
GET  /api/item/:id/depth/:level 2층 또는 3층 조회
POST /api/item/:id/exposure     노출 기록
```

`/api/feed/today` 응답에 다음을 포함한다.

```json
{
  "item": { ... },
  "context": {
    "type": "series",              // series | recall | single
    "seriesTitle": "결정과 망설임",
    "order": 4,
    "total": 10,
    "previousInSeries": [ /* 앞선 3개 요약 */ ]
  }
}
```

### 6-2. 앱 카드 변경

- 계열 항목이면 카드 상단에 **진행 표시**: `결정과 망설임 · 4 / 10`
- 카드 하단에 **앞선 항목 3개**를 작게 노출한다. 이게 축적을 체감하게 하는 핵심 UI다
- `hasDeepDive: true`면 **더 읽기** 버튼 → 웹 3층으로 이동
- 재등장 항목은 날짜 라벨 표시

### 6-3. 웹 연결

3층 페이지는 웹 플랫폼에 둔다. URL 규칙: `/deep/{seriesId}/{itemSlug}`
페이지 하단에 같은 계열의 다른 항목 링크를 자동 생성한다.

---

## Phase 7 — 연말 리포트 반영

기존 Wrapped 형식 리포트에 다음 지표를 추가한다.

- 완주한 계열 수와 목록
- 가장 오래 붙든 계열
- 재등장으로 다시 만난 항목 수
- 딥다이브까지 읽은 항목 수
- 도메인별 비중 (idiom / insight / classic)

---

## 작업 순서 요약

```
Phase 1  스키마 확장            → 기존 동작 무영향 확인
Phase 2  마이그레이션           → dry-run 후 실행
Phase 3  계열 구성              → idiom 6개 계열부터
Phase 4  배달 로직              → 계열 우선순위만 먼저, recall은 이후
Phase 5  2층 콘텐츠             → idiom 1개 계열로 파일럿
Phase 6  API + 앱 카드          → 진행 표시가 핵심
Phase 7  리포트                 → 마지막
```

**Phase 3~5는 `idiom-decision` 계열 하나로 끝까지 먼저 관통한 뒤, 나머지로 확장한다.**
전체를 동시에 넓히지 않는다.

---

## 하지 말 것

- 기존 필드 이름 변경 또는 삭제
- 2층/3층 콘텐츠를 검수 없이 DB에 직접 주입
- 계열 배달과 재등장 로직을 한 번에 붙이기
- 소셜 / 공유 / 스터디그룹 관련 기능 확장 (코어 안정화 전까지 보류)
