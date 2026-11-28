# 월간 편지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 학습 관리에서 달을 고르면 "이번 달의 당신" 잡지·편지가 열린다.
**Architecture:** 순수 함수 모듈(`lib/monthlyLetter.js`)이 기록에서 사실을 모으고, 서버 라우트가 AI 편지를 붙여 캐시, 앱이 전체 화면 잡지로 그린다.
**Tech Stack:** Node(Express, sql.js), node:test, 바닐라 JS/CSS(모바일 앱).
**Spec:** `docs/superpowers/specs/2026-11-28-monthly-letter-design.md`

## Global Constraints
- 새 전역 금지(앱은 `Mob` 안, state 객체), `fetchJSON` 사용, 한국어 토스트, CSS 변수만, 클릭 44px, 라이트·다크, 이모지 금지.
- 모든 `/api/*` requireAuth, 유저 데이터는 `req.userId` + `ItemsDB.getItemsByUser`. 응답 `{success…}`.
- 앱 파일 바꾸면 `index_mobile.html` `?v=`·`sw.js` CACHE_NAME 올림. server.js CRLF 유지.

## Review Focus
1. 기록이 하나도 없는 달 → 짧은 대체 편지, 빈 섹션은 숨김(오류 아님).
2. 자동 문구 생각('['로 시작)은 인용하지 않는다.
3. 다른 유저 기록이 섞이지 않는다(캐시 키에 userId).
4. AI 실패 → 대체 편지로 200.
5. 미래 달·잘못된 형식 ym → 400.

### Task 1: monthlyLetter 모듈
**Files:** Create `public/lib/monthlyLetter.js`, `scripts/tests/monthly-letter.test.js`
**Produces:** `letterFacts({ ym, items, got, stageOf }) -> { ym, label, days, received, saved, thoughts, english, path:[{cat,theme,stage,count}], quotes:[{text,title,date}], scenes:[{date,text,location,photo}], cover, thin }`,
`letterPrompt(facts) -> { system, user }`, `fallbackLetter(facts) -> { title, letter }`, `parseLetter(raw) -> { title, letter }`, `fingerprint(facts) -> string`.
- [ ] 테스트: 그달만 셈 · 생각 인용은 '[' 제외·최대 3 · path는 단계별 개수 내림차순 최대 4 · english = stageOf().cat==='영어' · 빈 달 thin=true · fallbackLetter가 숫자를 말함 · parseLetter 첫 줄 제목
- [ ] FAIL 확인 → 구현 → PASS → 커밋

### Task 2: 서버 라우트
**Files:** Modify `public/server.js`
**Produces:** `GET /api/letter/monthly/:ym?mode=PROFESSIONAL` → `{ success, ...facts, title, letter, ai:boolean }`
- [ ] 구현(캐시 → 사실 → AI → 대체), 로컬 확인: 이번 달 200, `2026-13` 400, 미래 달 400 → 커밋

### Task 3: 앱 화면
**Files:** Modify `public/index_mobile.html`, `public/js/manage.js`, `public/css/style_mobile.css`, `public/sw.js`
- [ ] "지식 결산" 블록 → "나의 역사"(달 칩 6개) · `Mob.openLetter(ym)` 전체 화면 잡지 · 닫기
- [ ] 로컬 확인: 라이트·다크·375px, 빈 달, 닫기 → 커밋

### Task 4: 배포와 기록
- [ ] `npm test` → 배포 → 운영 v 확인 → 핸드오프·메모리 → 푸시
