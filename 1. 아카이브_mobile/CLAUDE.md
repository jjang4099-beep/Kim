# CLAUDE.md — SJ 지식 아카이브 개발 규칙

> 이 파일을 항상 먼저 읽고 작업을 시작할 것.
> 기능 추가 전 반드시 기존 코드에 유사 함수가 있는지 확인할 것.

---

## 📁 프로젝트 구조

```
1. 아카이브_mobile/
├── public/
│   ├── index_mobile.html       # 앱 진입점, SPA 뷰 구조 (CSS/JS는 ?v=N 캐시버스팅)
│   ├── js/
│   │   ├── app_mobile.js       # 메인 로직 (Mob 네임스페이스)
│   │   ├── app_exam.js         # 수험생 모드 로직 (ExamMob 네임스페이스)
│   │   └── pwa.js              # PWA / 서비스워커 등록
│   ├── css/
│   │   └── style_mobile.css    # 전체 스타일 (CSS 변수 + data-theme)
│   ├── data/                   # 시드/캐시 데이터
│   │   ├── archive.db          # SQLite(sql.js) — ⚠️ git 미추적·런타임 생성물
│   │   ├── archive.json        # items 초기 시드 소스
│   │   ├── dailyFeeds.json     # 직장인 배달 캐시
│   │   ├── knowledge_db/       # 직장인 영어/중국어/명언/고사성어/역사 시드
│   │   └── exam_db/            # 수험생 영어단어/한국사 시드
│   └── server.js               # Node.js + Express API 서버
└── .claude/launch.json         # preview 실행 설정
```

> ⚠️ **데이터 영속성**: 배포(Render 무료 티어)는 휘발성 파일시스템이라 `archive.db`(유저 저장분)가
> 재시작마다 소실된다. 추후 Turso/유료 서버로 전환 예정. 저장 영속에 의존하는 기능을 "완성"으로 보고하지 말 것.

---

## 🏗️ 아키텍처 규칙

### 네임스페이스
```js
Mob       // 직장인/일반 모드 전체 로직 (app_mobile.js)
ExamMob   // 수험생 모드 전용 로직 (app_exam.js) — 이미 존재, Mob 유틸에 의존
```
- **절대로 전역 함수 새로 만들지 말 것** — 반드시 Mob 또는 ExamMob 안에 넣을 것
- 전역 허용(이미 존재): `el`, `toast`, `fmt`, `fmtFull`, `dayLabel`, `fetchJSON`, `parseFeedsArray`, `toLocalDateStr`

### 모드 격리 (중요)
- 직장인=`PROFESSIONAL`, 수험생=`EXAM_PREP`. 클라이언트는 `localStorage.userMode`('work'/'exam'),
  서버 ENUM 변환은 `Mob._modeEnum()`.
- `items` 테이블의 `mode` 컬럼으로 물리 격리. 모든 조회/저장에 `mode` 파라미터를 반드시 전달.
- 직장인 콘텐츠(`knowledge_db`)와 수험생 콘텐츠(`exam_db`)는 폴더·테이블·시드 함수까지 완전 독립.

### 상태 관리
```js
// 모든 앱 상태는 반드시 이 state 객체에만 저장 (app_mobile.js)
const state = {
  currentView, currentCat, items,
  feedItems,        // 직장인 배달 미리보기
  examDaily,        // 수험생 오늘의 배달(영어단어+한국사)
  libraryItems, libraryFilter, libraryLoaded, libraryAIOpen,
  feedLoaded, searchDebounce, selectedImageFile,
  activeFeedFilter, pendingFeedFilter,
  quiz: { items, current, score, answered, cat },
  // 새 상태 추가 시 여기에 명시 후 초기값 설정
};
```
- **절대로 새 전역 변수 만들지 말 것** — 상태는 state 객체에만 추가
- 모드 전환 시 `Mob._resetModeState()`로 이전 모드 흔적을 초기화

### 뷰 시스템
```js
const VIEW_CONFIG = {
  home:    { el:'viewHome',    tabsVisible:true,  title:'아카이브',   showHeaderActions:true  },
  feed:    { el:'viewFeed',    tabsVisible:false, title:'지식 배달',  showHeaderActions:false },
  summary: { el:'viewSummary', tabsVisible:false, title:'내 서재',   showHeaderActions:false },
  manage:  { el:'viewManage',  tabsVisible:false, title:'학습 관리', showHeaderActions:false },
  quiz:    { el:'viewQuiz',    tabsVisible:false, title:'AI 퀴즈',   showHeaderActions:false },
  // 신규 뷰는 여기 추가
};
```

---

## 🛠️ 코딩 규칙

### API 호출 — fetchJSON 헬퍼 반드시 사용
```js
const data = await fetchJSON('/api/items', {}, 20000);   // ✅
const res  = await fetch('/api/items');                   // ❌ 직접 호출 금지
```

### 토스트 메시지 — 한국어, 통일된 형식
```js
toast('저장됐습니다!', 'ok');     // 성공
toast('저장 실패', 'err');        // 실패
toast('분석 중이에요…', '');      // 진행 중
toast('메시지', 'ok', 5000);      // dur 기본 3000ms
```

### 렌더링 — innerHTML 템플릿 리터럴 패턴
```js
_renderSomething(item) {
  const id = item._id || item.id;
  return `<div class="mob-card" data-id="${id}" onclick="Mob.openDetail('${id}')">…</div>`;
},
```

### 로딩 상태
```js
`<div class="mob-loading"><span class="mob-spin"></span></div>`
```

### 날짜 처리
```js
fmt(dateStr)            // "6월 13일"
fmtFull(dateStr)        // "6월 13일 (금)"
toLocalDateStr(d)       // "2026-06-13" — 한국 타임존 날짜 '키'
```
- 날짜 **키**(YYYY-MM-DD)는 `toLocalDateStr`(클라)·`toDateStr`(서버) 사용 — `toISOString().slice(0,10)` 금지(UTC 밀림).
- 단, `createdAt` 같은 **타임스탬프**는 `new Date().toISOString()` 사용이 정상(기존 코드 관례).

---

## 📦 기존 유틸 함수 (새로 만들지 말 것)

| 함수 | 역할 |
|------|------|
| `el(id)` | document.getElementById 단축 |
| `toast(msg, type, dur)` | 토스트 알림 |
| `fmt(dateStr)` | 날짜 짧은 형식 |
| `fmtFull(dateStr)` | 날짜 긴 형식 (요일 포함) |
| `dayLabel(d)` | 요일 한글 반환 |
| `fetchJSON(url, options, timeout)` | API 호출 헬퍼 |
| `parseFeedsArray(data)` | 배열/객체 응답 정규화 |
| `toLocalDateStr(d)` | 로컬 날짜 문자열(YYYY-MM-DD) |
| `getItemDomain(item)` | 아이템 → 8대 도메인 키 |

---

## 🎨 CSS 규칙

### 클래스 네이밍
```
mob-          # 공통/홈 컴포넌트 (mob-card, mob-toast, mob-loading, mob-exam-card)
mvw-          # 뷰 전용 컴포넌트 (mvw-lib-card, mvw-wrong-card)
km-           # 서재 매거진 뷰 (km-filter-tab, knowledge-magazine-card)
exam-         # 수험생 모드 헤더 등 (exam-home-header)
```

### CSS 변수 — 하드코딩 금지
```css
color      : var(--text-1);    /* 본문 텍스트 (보조: --text-2) */
background : var(--surface);   /* 카드 배경 (페이지 배경: --bg) */
border     : 1px solid var(--border);   /* ✅ 변수명은 --border (--border-color 아님) */
/* ❌ color:#1a1a1a; background:#ffffff; 같은 하드코딩 금지 */
```
- 주요 변수: `--accent`, `--surface`, `--bg`, `--text-1`, `--text-2`, `--border`

### 다크모드 / 테마
- 테마는 `html[data-theme="dark"|"light"]`로 전환되며 CSS 변수가 자동 대응.
- ⚠️ `@media (prefers-color-scheme: dark)` 블록이 **이미 존재**한다. 새 컴포넌트는
  `data-theme` 오버라이드를 우선 작성하되, prefers 블록이 **배경/색을 주입해 라이트 테마로 누수**될 수 있으니
  (시스템 다크 + 앱 라이트 조합) 라이트 오버라이드에서 배경·테두리를 명시해 덮을 것.

### 터치 타겟 / 레이아웃
- 클릭 요소 최소 44×44px. 모바일 퍼스트(데스크탑 레이아웃 고려 불필요).
- CSS/JS 수정 시 `index_mobile.html`의 `?v=N` 버전을 올려 캐시 버스팅할 것.

---

## 🗄️ DB / API 규칙

### 저장소: SQLite (sql.js WASM) — `data/archive.db`
- MongoDB 아님. 단일 `items` 테이블에 아이템을 **JSON 문자열(`data` 컬럼)**로 저장하고,
  `id / category / mode / date / created_at`을 인덱스 컬럼으로 둔다.
- 콘텐츠 시드 테이블: `english_themes`·`english_expressions`(직장인 영어),
  `exam_vocab_themes`·`exam_vocab_words`·`exam_history_items`(수험생).
- 쓰기 헬퍼: `dbInsert(item)` / `dbUpdate(item)` / `dbDelete(id)` → 내부에서 `_persistDB()`로 디스크 저장.

### Item 객체 기본 구조 (data 컬럼에 직렬화)
```js
{
  id, title, text, summary, category, type, domain, mode,
  analysis: { title, summary, keywords[], insight },  // AI 분석분(있을 때)
  myInsight,                                            // 유저 메모
  createdAt, date
}
```

### API 엔드포인트
```
GET    /api/items?mode=…&domain=…&limit=…   → 목록 (mode 격리 필수)
POST   /api/items                            → 생성
PATCH  /api/items/:id                        → 부분 수정 (PUT 금지)
DELETE /api/items/:id                        → 삭제
GET    /api/daily-feed?mode=…                → 직장인 배달
GET    /api/daily-feed/status                → 피드 생성 상태
POST   /api/daily-feed/:date/:subId/save     → 배달 항목 저장
GET    /api/exam/daily-knowledge             → 수험생 영어단어+한국사 배달
POST   /api/exam/daily-knowledge/save        → 수험생 배달 저장
```

### 새 API 추가 시
- 부분 수정은 기존 범용 `PATCH /api/items/:id` 확장을 우선 검토.
- 응답: 성공은 `{ success: true, …필드 }`, 실패는 `{ success: false, error: '한국어 메시지' }`.
- 에러 메시지는 반드시 의미 있는 한국어로.

---

## ⚠️ 절대 하지 말아야 할 것
```
1. 전역 함수 신규 생성        → Mob 또는 ExamMob 안에 넣기
2. 전역 변수 신규 생성        → state 객체에 추가
3. fetch() 직접 호출          → fetchJSON() 사용
4. 날짜 키에 toISOString      → toLocalDateStr() / toDateStr()
5. CSS 색상 하드코딩          → CSS 변수 사용 (--border 등)
6. 기존 유틸 함수 중복 생성   → 위 목록 확인 후 재사용
7. VIEW_CONFIG 등록 없이 뷰 추가
8. mode 파라미터 없이 items 조회/저장 (모드 격리 위반)
9. archive.db / .env 를 git에 커밋
```

---

## ✅ 기능 추가 전 체크리스트
```
□ 비슷한 기능/함수가 이미 app_mobile.js / app_exam.js에 있는가?
□ 기존 함수를 확장하면 되는가?
□ state 객체에 새 상태 필드를 추가하고 초기값을 설정했는가?
□ VIEW_CONFIG에 새 뷰를 등록했는가? (해당 시)
□ mode 격리(PROFESSIONAL/EXAM_PREP)를 지켰는가?
□ CSS 변수를 사용했는가? (--border 등)
□ fetchJSON 헬퍼를 사용했는가?
□ 토스트 메시지가 한국어인가?
□ index_mobile.html 의 ?v= 버전을 올렸는가?
□ 라이트/다크 양쪽에서 깨지는 부분이 없는가? (prefers 누수 주의)
```

---

## 📋 배달 피드 구독 목록 (FEED_CHIP_MAP)
```js
en_expr    → 🗽 English     #4f46e5
zh_expr    → 🐉 중국어      #b45309
us_market  → 📈 미국 시황   #059669
kr_market  → 📊 한국 시황   #0891b2
hist_daily → 🏛️ 역사        #92400e
quote_daily→ 💡 명언        #7c3aed
idiom_daily→ 📜 고사성어    #c2410c
```
새 subId 추가 시 반드시 FEED_CHIP_MAP에도 등록.

---

## 🔄 리팩토링 원칙
1. **기능 동작 100% 유지** — 리팩토링은 동작 변경 없이 구조만.
2. 중복 함수 발견 시 → 하나로 합치고 나머지 제거.
3. 300줄 이상 함수 → 작은 private 함수(`_` 접두사)로 분리.
4. 주석 없는 복잡한 로직 → 한국어 주석 추가.

---

*SJ 지식 아카이브 | app_mobile.js v69 기준*
*이 파일이 업데이트되면 버전과 날짜를 하단에 기록할 것*
**마지막 업데이트**: 2026-06-17
