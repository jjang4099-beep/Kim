# 역사 연표 지도 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지식 지도의 역사 분야를 '시대 위 테마 칩 연표 + 그 시대 패널(그때 다른 나라는)'로 바꾸고, 역사 편 전부를 연재 또는 시대 테마에 배치한다.

**Architecture:** 분류 데이터는 `course_db/history_themes.json`(시대 테마·기업 이야기)과 `course_db/history_backbone.json`(큰 사건)에 둔다. 연도 계산·갈래별 단계 조립·다음 편 고르기는 순수 함수 모듈 `public/lib/historyTimeline.js`로 빼서 `node:test`로 검증하고, `server.js`는 그 모듈로 퀘스트 응답과 '이 길 걷기' 배달을 만든다. 화면은 `chronicle.js`에서 역사 분야일 때만 연표 렌더러를 쓴다.

**Tech Stack:** Node 18+ (Express, sql.js), `node:test`, 바닐라 JS/CSS(연대기 페이지).

**Spec:** `docs/superpowers/specs/2026-11-22-history-timeline-map-design.md`

## Global Constraints

- 새 전역 변수·전역 함수 금지 — 서버는 모듈/기존 함수 안, 클라이언트는 `chronicle.js` IIFE 안 `km` 상태에.
- 색은 CSS 변수만(연대기 토큰). 라이트·다크 둘 다 확인. 라벨·제목 앞 이모지 금지. 애니메이션 없음.
- 클릭 대상 44px 이상. 폰 너비(375px)에서 가로 스크롤 없음.
- API 응답 `{ success:true, … }` / `{ success:false, error:'한국어' }`. 모든 `/api/*`는 `requireAuth` 아래.
- 앱 파일 바꾸면 `chronicle.js?v=` 와 `sw.js` CACHE_NAME 올림.
- `server.js`는 CRLF, `public/` 나머지 JS/CSS/HTML·JSON은 LF — 줄끝 유지.
- 새 콘텐츠(테마 이름·부제·묶음, 일본 큰 사건)는 **덩어리마다 사용자 검수 후** 커밋.
- 커밋 금지: `public/data/dailyFeeds.json`, `archive.db`, `.env`, `참조용 사진/`.
- 커밋 끝줄: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 갈래 이름(lane) 값은 정확히 `한국` · `중국` · `일본` · `서양` · `세계`. 화면 이름은 한국·중국·일본·유럽·미국·그 밖의 세계.
- 시대 폭 가중치: 고대(BC 650–400) 1 · 중세(400–1400) 1 · 근세(1400–1800) 1.6 · 근대(1800–1945) 1.15 · 현대(1945–) 0.75. 가로 연표는 지도 너비 ≥ 760px.

## Review Focus

1. 한 편이 연재와 시대 테마(또는 두 테마)에 동시에 들어가면 지도에 두 번 세어진다 → 분류표 검증 테스트가 중복을 막는다(Task 1).
2. 앞으로 새 역사 편이 분류표 없이 추가되면 → 그 갈래 끝 '아직 묶지 않은 이야기'에 나타나야 한다(Task 6 테스트).
3. 고른 테마를 다 받았을 때 → 같은 갈래의 다음 단계(시작 연도순)로 이어져야지, 무작위로 튀면 안 된다(Task 6·8).
4. 기원전 기간 표기 → `BC 594–399`처럼 앞에만 BC, 기원전~기원후는 `BC 509–476`(Task 9 확인).
5. 역사 편을 하나도 안 받은 계정 → 지도는 모든 칩 '아직'으로 그려지고, 지금 걷는 테마는 한국 첫 테마(Task 7).

---

## 데이터 덩어리 (Task 1–5) — 덩어리마다 사용자 검수

각 덩어리: 초안을 표로 보여 줌 → 사용자 수정 반영 → 파일에 추가 → `npm test` → 커밋.
초안 작업 파일은 스크래치패드 `tl_themes.py`(분류)·`hist_all.json`(457편 목록).

### Task 1: 분류표 파일 + 검증 테스트 + 한국·옛 세계사 덩어리(승인됨)

**Files:**
- Create: `public/data/course_db/history_themes.json`
- Create: `scripts/tests/history-data.test.js`
- Modify: `package.json` (scripts에 `"test": "node --test scripts/tests/"`)

**Interfaces:**
- Produces: `history_themes.json` = `{ _comment, themes:[{ id, lane, label, sub, years:[from,to], items:[id] }], business:[] }`. 테마 id는 `kr-early`처럼 소문자-하이픈. 스펙 6장의 16개 테마 그대로.

- [ ] **Step 1: 테스트 작성** — `history-data.test.js` (data 파일을 직접 읽음, 서버 require 안 함)
  - `test('분류표 테마 id는 겹치지 않는다')`
  - `test('편은 분류표 안에서 한 번만 나온다')` — themes·business 전체 items 중복 0
  - `test('연재 편은 분류표에 들어가지 않는다')` — deep_layers series items ∩ 분류표 = ∅
  - `test('분류표의 편은 모두 실제 역사 편이다')` — knowledge_db `history_facts` id 집합에 포함
  - `test('lane과 기간이 올바르다')` — lane ∈ {한국,중국,일본,서양,세계}, `years[0] <= years[1]`, 정수
- [ ] **Step 2:** `npm test` → 파일 없음으로 FAIL 확인
- [ ] **Step 3:** 스펙 6장 16개 테마로 `history_themes.json` 생성(스크래치패드 `history_themes.draft.json`에서 lane을 `한국`/`서양`으로)
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: 커밋** `feat(data): 역사 시대 테마 분류표 — 한국·옛 세계사 16개 테마`

### Task 2: 중국·일본 덩어리 + 큰 사건 뼈대

**Files:**
- Modify: `public/data/course_db/history_themes.json`
- Create: `public/data/course_db/history_backbone.json`
- Modify: `scripts/tests/history-data.test.js`

**Interfaces:**
- Produces: `history_backbone.json` = `{ _comment, events:[{ id, lane, year, title }] }`. id는 원본 페이지 id(`k-1443`, `c-bc221`, `eu-1789`), 일본은 `j-<연도>`. title은 짧은 이름만(설명 본문 없음).

- [ ] **Step 1:** 세계사 낱편 중 중국(약 23)·일본(약 4) 편을 시대 테마로 묶은 초안 + 일본 큰 사건 약 15개 초안을 사용자에게 표로 보여 주고 검수 받기
- [ ] **Step 2: 테스트 추가** — `test('큰 사건은 lane·연도·이름이 있다')`(lane 5값, year 정수, title 비지 않음), `test('일본 큰 사건이 있다')`(lane 일본 ≥ 10)
- [ ] **Step 3:** 원본 페이지(`C:/Users/jjang/Desktop/유럽_한국_중국 역사 타임라인_PC 버전.html`)의 110개를 스크래치패드 `tl_data.json`의 `bb`에서 변환(lane korea→한국, china→중국, west→서양) + 검수된 일본 사건 추가해 `history_backbone.json` 생성. 검수된 중국·일본 테마를 분류표에 추가.
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: 커밋** `feat(data): 중국·일본 시대 테마 + 큰 사건 뼈대`

### Task 3: 유럽·미국 덩어리

**Files:** Modify `public/data/course_db/history_themes.json`

- [ ] **Step 1:** 세계사 낱편 중 유럽·미국(약 60) 편을 기존 서양 6개 테마에 넣거나 새 테마(예: 고대 지중해·비잔틴·절대왕정)로 묶은 초안을 보여 주고 검수
- [ ] **Step 2:** 반영 → `npm test` PASS
- [ ] **Step 3: 커밋** `feat(data): 유럽·미국 시대 테마 확장`

### Task 4: 그 밖의 세계 덩어리

**Files:**
- Modify: `public/data/course_db/history_themes.json`
- Modify: `public/data/course_db/catalog.json` (역사 groups에 `{ "id":"world", "label":"그 밖의 세계", "lane":"세계", "courses":[] }`, courses에 연재 12개 `sub`)

- [ ] **Step 1:** 이집트·페르시아·인도·이슬람·몽골·아프리카·중남미(약 20) 편 묶음 초안 검수
- [ ] **Step 2:** 반영 + catalog 수정 → `npm test` PASS
- [ ] **Step 3: 커밋** `feat(data): 그 밖의 세계 갈래`

### Task 5: 예전 항목 덩어리 + 전부 배치 테스트

**Files:**
- Modify: `public/data/course_db/history_themes.json` (`business` 채움, 개관 편은 시대 테마에)
- Modify: `scripts/tests/history-data.test.js`

- [ ] **Step 1:** 예전 107편을 개관(→ 시대 테마) / 기업 이야기(→ `business`)로 나눈 초안 검수. `business`는 테마 몇 개(예: 회사의 탄생·혁신과 몰락)로.
- [ ] **Step 2: 테스트 추가** — `test('역사 편은 전부 연재·시대 테마·기업 이야기 중 한 곳에 있다')`: `history_facts` 전체 − (모든 series items) − 분류표 = ∅ (과학 연재 포함 series 전체를 뺀다)
- [ ] **Step 3:** 반영 → `npm test` PASS
- [ ] **Step 4: 커밋** `feat(data): 예전 역사 항목 배치 — 개관은 시대 테마, 기업 이야기는 경제로`

---

### Task 6: `historyTimeline` 모듈

**Files:**
- Create: `public/lib/historyTimeline.js`
- Create: `scripts/tests/history-timeline.test.js`

**Interfaces:**
- Produces (CommonJS `module.exports`):
  - `yearOf(item: {title, period}) -> number|null` — 제목 끝 괄호의 연도 → 없으면 period → 없으면 왕조 대략값 표(`고조선:-400, 고구려:400, 백제:450, 신라:550, 통일신라:750, 고려:1100, 조선:1550, 조선 전기:1450, 조선 중·후기:1700, 개항기:1880, 대한제국:1900, 일제강점기:1930`). `BC N세기` → `-(N*100-50)`, `N세기` → `(N-1)*100+50`.
  - `laneStages(laneName, { series, themes, courses, laneOfSeries, unplaced }) -> Stage[]` — `Stage = { kind:'series'|'era'|'etc', id, title, sub, desc, years:[a,b], itemIds:string[] }`. 연재는 `id:'c:<sid>'`, years는 편 yearOf의 최소~최대(itemIds는 연재 순서 유지). 시대 테마는 `id:'h:<themeId>'`, years는 분류표 값, itemIds는 yearOf 오름차순. `unplaced`(이 갈래의 미배치 편 id 배열)가 있으면 맨 끝에 `{kind:'etc', id:'h:<lane>-etc', title:'아직 묶지 않은 이야기'}`. 결과는 years[0] 오름차순(같으면 연재 먼저).
  - `nextThemeItem(stages: Stage[], stageId: string, isOpen: (id)=>boolean) -> { stage: Stage, id: string } | null` — stageId 단계에서 isOpen인 첫 편, 없으면 뒤 단계들에서 차례로.
  - `laneOfItem(item) -> '한국'|'서양'` — 미배치 편용 기본 갈래(era==='한국사' → 한국, 아니면 서양).

- [ ] **Step 1: 테스트 작성**
  - `yearOf`: `{title:'로마 공화정의 탄생 — … (BC 509)'}` → `-509`; `{title:'고조선의 8조법 — … (기원전 4세기 이전)'}` → `-350`; `{title:'문익점과 목화 — 붓두껍 이야기보다 중요했던 3년 (1364년)'}` → `1364`; `{title:'벽란도 — 아라비아 상인이 드나들던 고려의 국제항', period:'고려'}` → `1100`; `{title:'x', period:''}` → `null`
  - `laneStages('한국', …실데이터…)`: 첫 단계 id `h:kr-early`, `c:samguk`이 `h:kr-silla`보다 앞, years[0]가 오름차순
  - `laneStages`에 `unplaced:['HI_X']` → 마지막 단계 `kind:'etc'`, `itemIds` `['HI_X']`
  - `nextThemeItem`: `h:kr-imjin`에서 첫 편이 열려 있으면 그 편; 그 단계 전부 닫힘이면 다음 단계(`h:kr-horan`)의 첫 열린 편; 끝까지 없으면 `null`
- [ ] **Step 2:** `npm test` → FAIL(모듈 없음)
- [ ] **Step 3:** 모듈 구현
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: 커밋** `feat: historyTimeline 모듈 — 연도·갈래 단계·다음 편`

### Task 7: 퀘스트 API — 역사 갈래 단계, 큰 사건, 기업 이야기

**Files:**
- Modify: `public/server.js` (`loadCourseDB`: `history_themes`·`backbone` 읽기 / `buildQuest`의 역사 블록 6504–6508 부근 / 경제 분야에 기업 이야기 테마)

**Interfaces:**
- Consumes: Task 6 `yearOf`, `laneStages`, `laneOfItem`.
- Produces: `GET /api/knowledge-quest` 역사 카테고리
  - `themes[]` = 갈래 5개(`korea`·`china`·`japan`·`west`·`world`, label은 catalog groups), 각 `stages[]`에 `{ id, no, title, sub, desc, years, kind, fixed:true, items:[{…item, year}], boss }`
  - 카테고리에 `backbone: [{ id, lane, year, title }]`, `current: <stageId>`(지금 걷는 테마: 고른 과정 → 최근 받은 역사 편의 테마 → 한국 첫 단계)
  - '그 밖의 역사'(`h-loose:N`) 없음
  - 경제 카테고리에 테마 `business`(label '기업 이야기'), 단계 = `business` 테마들, id `b:<id>`

- [ ] **Step 1:** 로컬 서버(스크래치 DATA_DIR, `.claude/launch.json` 임시 env) 띄우고 기존 테스트 계정으로 로그인 상태 확인
- [ ] **Step 2:** 구현
- [ ] **Step 3: 확인** — 브라우저 콘솔에서 `await fetch('/api/knowledge-quest?mode=PROFESSIONAL').then(r=>r.json())`:
  역사 themes 5개, 역사 stages의 items id 합집합 크기 = 457 − 기업 이야기 편수 − 과학 연재 10, 중복 0, `backbone.length ≥ 120`, 경제에 `business` 테마, `current`가 문자열
- [ ] **Step 4: 커밋** `feat: 퀘스트 API — 역사 갈래별 연재·시대 테마, 큰 사건, 기업 이야기`

### Task 8: 이 길 걷기 — 시대 테마 고르기와 배달

**Files:**
- Modify: `public/server.js` (`_chosenCourse` 2065, `_pickSeriesItem` 2084, `_courseNextStages` 2057, `POST /api/courses/select` 6726)

**Interfaces:**
- Consumes: Task 6 `laneStages`, `nextThemeItem`.
- Produces: `POST /api/courses/select { courseId }` — `courseId`가 연재 id 또는 `h:<themeId>` 이면 저장(그 밖은 400 `없는 과정이에요`). 시대 테마가 골라져 있으면 역사 배달이 그 테마의 안 받은 첫 편(연도순) → 다 받았으면 같은 갈래 다음 단계. 응답 카드의 `series`는 `{ id:'h:<id>', title:<테마 이름>, no, total, prev, next }`.

- [ ] **Step 1:** 구현(연재 동작은 그대로)
- [ ] **Step 2: 확인** — 로컬에서 `POST /api/courses/select {courseId:'h:kr-imjin'}` → `success:true` → `GET /api/daily-feed?mode=PROFESSIONAL`의 역사 카드 `item_id`가 `kr-imjin` 편 중 안 받은 첫 편, `series.title === '임진왜란과 그 시대'`. `{courseId:'h:nope'}` → 400. `{courseId:''}` → 고르기 풀림.
- [ ] **Step 3: 커밋** `feat: 이 길 걷기 — 시대 테마를 골라 배달받기`

### Task 9: 연표 화면

**Files:**
- Modify: `public/js/chronicle.js` (`renderKqCat` 2081: 역사면 `kqMapHTML` 대신 연표, `km`에 `sel` 추가, 새 함수 `ktlHTML(c)`, `ktlBind(c)`, `ktlPanelHTML(c, stageId)`)
- Modify: `public/chronicle.html` (`.ktl*` CSS, `chronicle.js?v=` +1)
- Modify: `public/sw.js` (CACHE_NAME +1)

**Interfaces:**
- Consumes: Task 7 응답(`stages[].years/sub/kind`, `items[].year`, `backbone`, `current`), Task 8 `POST /api/courses/select`, 기존 `openKmItem(id)`.

- [ ] **Step 1:** 시안 3판(스크래치패드 `tl_template.html`)의 배치·칩·패널을 옮겨 구현: 가로(≥760px)/세로, 칩 상태(지금 여기·받는 중·격파·아직), 패널(이 시대의 이야기 → 줄 누르면 `openKmItem`, 그때 다른 나라는 → 칩 누르면 그 테마 선택, 큰 사건 최대 6줄), 이 길 걷기 → `api('/api/courses/select', {method:'POST', …})` 후 `loadKmap(true)` + 토스트 대신 패널 문구 '다음 배달부터 이 테마에서 와요'
- [ ] **Step 2: 확인(로컬)** — 라이트·다크(1280px), 폰 375px(가로 스크롤 0), 칩 클릭 → 패널, 다른 나라 칩 → 전환, 편 줄 → 다시 읽기 팝업, 이 길 걷기 → 지금 여기 이동, 역사 아닌 분야는 예전 지도 그대로. 스크린샷 사용자에게 전송.
- [ ] **Step 3: 커밋** `feat: 역사 연표 지도 — 시대 위 테마 칩과 그때 다른 나라는`

### Task 10: 배포와 기록

**Files:**
- Modify: `docs/핸드오프.md`, 메모리 `knowledge-courses.md`

- [ ] **Step 1:** `npm test` PASS 확인 후 `export MSYS_NO_PATHCONV=1; flyctl deploy --remote-only`
- [ ] **Step 2: 확인** — 운영에서 `chronicle.js?v=` 새 버전 응답, 로그아웃 상태 `/api/knowledge-quest` 401
- [ ] **Step 3:** 핸드오프·메모리 갱신, 임시 launch.json 되돌림
- [ ] **Step 4: 커밋·푸시** `docs: 역사 연표 지도 핸드오프`
