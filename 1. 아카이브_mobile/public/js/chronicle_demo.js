/**
 * chronicle_demo.js — 연대기 샘플 미리보기 데이터 (chronicle.html?demo=1 일 때만 로드)
 * ────────────────────────────────────────────
 * 실제 계정·DB와 무관한 가짜 기록이다. 날짜는 "오늘"을 기준으로 상대 계산하므로 언제 열어도
 * 오늘·어제·이번 주에 기록이 있는 모습으로 보인다. 내용은 실제 시드(knowledge_db·work_db)에서 가져왔다.
 * 사진은 외부 이미지 대신 SVG 풍경 일러스트(data URI)를 쓴다 — 파일 하나로 끝나고 오프라인에서도 보이게.
 */
'use strict';

(function () {
  const pad2 = n => String(n).padStart(2, '0');
  /* 오늘에서 offset일 전, hh시 */
  const at = (offset, hh = 12) => {
    const d = new Date(); d.setDate(d.getDate() - offset); d.setHours(hh, 0, 0, 0);
    return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, createdAt: d.toISOString() };
  };

  /* ── 사진 대용 SVG 풍경 ── */
  const svg = body => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">${body}</svg>`);
  const PHOTO = {
    riverSunset: svg(`<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F7B7A3"/><stop offset=".55" stop-color="#F9D7C4"/><stop offset="1" stop-color="#C9B8E8"/></linearGradient></defs>
      <rect width="400" height="300" fill="url(#s)"/><circle cx="270" cy="150" r="34" fill="#FFE9D6" opacity=".95"/>
      <rect y="178" width="400" height="122" fill="#8FA3D6"/><rect y="178" width="400" height="6" fill="#FFE1CF" opacity=".7"/>
      <path d="M0 176 L60 160 L95 168 L140 150 L190 166 L230 158 L280 170 L330 152 L400 166 L400 180 L0 180Z" fill="#5E6B9E"/>
      <path d="M40 180 h320" stroke="#E7ECFA" stroke-width="2" opacity=".5"/>`),
    pasta: svg(`<rect width="400" height="300" fill="#EFE3D3"/><rect y="200" width="400" height="100" fill="#D8C3A5"/>
      <ellipse cx="200" cy="160" rx="120" ry="92" fill="#FFFFFF"/><ellipse cx="200" cy="158" rx="92" ry="68" fill="#F4D58D"/>
      <path d="M140 150 q30 -30 60 0 t60 0 M130 170 q35 -25 70 0 t70 0" stroke="#E9B949" stroke-width="7" fill="none" stroke-linecap="round"/>
      <circle cx="175" cy="140" r="9" fill="#D9534F"/><circle cx="228" cy="165" r="8" fill="#D9534F"/><circle cx="205" cy="128" r="6" fill="#6BA368"/>
      <rect x="320" y="60" width="14" height="150" rx="7" fill="#B9B9B9"/>`),
    morningHill: svg(`<defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#CFE6FA"/><stop offset="1" stop-color="#EAF4FD"/></linearGradient></defs>
      <rect width="400" height="300" fill="url(#m)"/><circle cx="90" cy="80" r="26" fill="#FFF6D8"/>
      <path d="M0 210 Q90 140 180 190 T400 170 V300 H0Z" fill="#A9D3B4"/><path d="M0 240 Q120 190 240 230 T400 220 V300 H0Z" fill="#7FBF94"/>
      <path d="M250 150 l12 -30 l12 30Z M300 160 l10 -26 l10 26Z" fill="#5E9E74"/>`),
    bookCafe: svg(`<rect width="400" height="300" fill="#E8DCCB"/><rect x="0" y="210" width="400" height="90" fill="#B58C63"/>
      <rect x="70" y="150" width="150" height="70" rx="4" fill="#FFFFFF"/><rect x="145" y="150" width="2" height="70" fill="#D9CBB8"/>
      <path d="M85 168h45M85 180h50M85 192h40M160 168h45M160 180h40M160 192h48" stroke="#BFB2A0" stroke-width="3"/>
      <rect x="255" y="150" width="62" height="64" rx="10" fill="#FFFFFF"/><ellipse cx="286" cy="152" rx="31" ry="8" fill="#7A5236"/>
      <path d="M317 165 q20 0 20 16 t-20 16" stroke="#FFFFFF" stroke-width="7" fill="none"/>
      <path d="M278 120 q8 -12 0 -24 M292 124 q8 -12 0 -24" stroke="#FFFFFF" stroke-width="3" fill="none" opacity=".8"/>`),
  };

  /* 여행 사진용 풍경 — 나라 분위기만 살짝 */
  Object.assign(PHOTO, {
    torii: svg(`<rect width="400" height="300" fill="#F6E3D8"/><circle cx="300" cy="80" r="30" fill="#F2B9A6"/>
      <path d="M0 240 Q200 200 400 240 V300 H0Z" fill="#B9C9A7"/>
      <rect x="120" y="110" width="160" height="16" rx="3" fill="#C8412E"/><rect x="110" y="96" width="180" height="14" rx="4" fill="#A83424"/>
      <rect x="140" y="126" width="14" height="120" fill="#C8412E"/><rect x="246" y="126" width="14" height="120" fill="#C8412E"/>
      <rect x="135" y="150" width="130" height="10" fill="#A83424"/>`),
    kyotoStreet: svg(`<rect width="400" height="300" fill="#E9E2D6"/><rect y="210" width="400" height="90" fill="#9C8F7E"/>
      <rect x="30" y="110" width="120" height="100" fill="#6E4F3A"/><path d="M20 115 L90 70 L160 115Z" fill="#3E3A39"/>
      <rect x="220" y="120" width="140" height="90" fill="#7A5A44"/><path d="M210 125 L290 80 L370 125Z" fill="#3E3A39"/>
      <circle cx="90" cy="150" r="10" fill="#F2C14E"/><circle cx="290" cy="160" r="10" fill="#F2C14E"/>`),
    beach: svg(`<rect width="400" height="300" fill="#CDEBF5"/><rect y="150" width="400" height="80" fill="#57B5CF"/>
      <rect y="150" width="400" height="6" fill="#E7F7FB" opacity=".7"/><path d="M0 230 Q200 210 400 230 V300 H0Z" fill="#F3DFB5"/>
      <path d="M300 230 q-6 -70 10 -110" stroke="#7A5A3A" stroke-width="8" fill="none"/>
      <path d="M310 120 q-40 -10 -60 10 M310 120 q30 -20 60 0 M310 120 q-20 -30 -50 -30 M310 120 q20 -30 45 -25" stroke="#4E9A5B" stroke-width="10" fill="none" stroke-linecap="round"/>`),
    eiffel: svg(`<rect width="400" height="300" fill="#DCE3F2"/><circle cx="90" cy="70" r="24" fill="#F7E7C6"/>
      <path d="M0 250 H400 V300 H0Z" fill="#B7BFA8"/>
      <path d="M200 40 L186 130 L170 200 L150 250 H175 Q200 215 225 250 H250 L230 200 L214 130Z" fill="#6B6F7A"/>
      <rect x="176" y="128" width="48" height="8" fill="#555A64"/><rect x="164" y="196" width="72" height="9" fill="#555A64"/>`),
    hallasan: svg(`<rect width="400" height="300" fill="#D9EEF7"/><path d="M0 220 Q140 110 200 110 T400 220 V300 H0Z" fill="#7BA88A"/>
      <path d="M170 116 Q200 104 230 116 L220 124 Q200 118 180 124Z" fill="#EEF4F1"/>
      <path d="M0 250 Q120 230 240 250 T400 245 V300 H0Z" fill="#E7C66B"/>`),
  });

  const life = (id, offset, hh, text, photos, extra = {}) => ({
    id, contentType: 'life', domain: 'life', mode: 'PROFESSIONAL', ...at(offset, hh),
    title: text || '라이프 기록', text, life: { photos, ...extra },
  });
  /* 실제 낱개 저장 영어처럼 vocabEntries(뉘앙스·예문·대화)도 함께 갖게 한다 */
  const en = (id, offset, hh, expr, meaning, nuance, more = {}) => ({
    id, source: 'daily-feed-entry', domain: 'language', mode: 'PROFESSIONAL', ...at(offset, hh),
    title: expr, text: `[demo] ${expr}\n뜻: ${meaning}\n뉘앙스: ${nuance}`,
    vocabEntries: [{ expression: expr, meaning, nuance, ...more }],
  });
  const fd = (id, offset, hh, domain, feedData, mode = 'PROFESSIONAL') => ({
    id, type: 'humanities', domain, mode, ...at(offset, hh), title: feedData.title || '', feedData,
  });

  /* 여행 — life.place는 GPS 파이프라인이 채울 자리(나라 코드는 world-atlas의 ISO 숫자 id) */
  const PLACE = {
    JP: { iso: '392', code: 'JP', name: '일본', flag: '🇯🇵' },
    VN: { iso: '704', code: 'VN', name: '베트남', flag: '🇻🇳' },
    FR: { iso: '250', code: 'FR', name: '프랑스', flag: '🇫🇷' },
    KR: { iso: '410', code: 'KR', name: '대한민국', flag: '🇰🇷' },
  };
  const trip = (id, offset, hh, text, photos, place, city, extra = {}) =>
    life(id, offset, hh, text, photos, { place: { ...PLACE[place], city }, location: city, ...extra });

  const TRIPS = [
    /* 파리 — 약 다섯 달 전 */
    trip('t-fr1', 160, 11, '에펠탑은 사진보다 훨씬 컸다. 올라가는 줄만 한 시간.', [PHOTO.eiffel], 'FR', '파리', { mood: '🤩' }),
    trip('t-fr2', 159, 15, '오르세 미술관. 고흐 방 앞에서 한참 서 있었다.', [PHOTO.morningHill], 'FR', '파리', { mood: '🎨' }),
    trip('t-fr3', 157, 20, '마지막 밤, 센강 산책. 또 오자.', [PHOTO.riverSunset], 'FR', '파리', { mood: '🥲' }),
    /* 교토 — 약 석 달 전 */
    trip('t-jp1', 86, 9, '후시미 이나리. 새벽에 오니까 사람이 거의 없다.', [PHOTO.torii, PHOTO.morningHill], 'JP', '교토', { mood: '⛩️', weather: '맑음 · 27°' }),
    trip('t-jp2', 85, 18, '기온 거리 저녁. 등불 켜지는 시간이 제일 예쁘다.', [PHOTO.kyotoStreet], 'JP', '교토', { mood: '🏮' }),
    trip('t-jp3', 83, 13, '오사카로 넘어와서 타코야키 세 접시.', [PHOTO.pasta], 'JP', '오사카', { mood: '😋' }),
    /* 다낭 — 약 한 달 반 전 */
    trip('t-vn1', 45, 16, '미케 비치. 물 색이 말도 안 된다.', [PHOTO.beach], 'VN', '다낭', { mood: '🏖️', weather: '맑음 · 31°' }),
    trip('t-vn2', 44, 10, '호이안 올드타운 등불 거리.', [PHOTO.kyotoStreet, PHOTO.riverSunset], 'VN', '호이안', { mood: '✨' }),
    /* 제주 — 약 3주 전 */
    trip('t-kr1', 24, 12, '한라산 윗세오름까지. 다리가 후들후들.', [PHOTO.hallasan], 'KR', '제주', { mood: '⛰️' }),
    trip('t-kr2', 23, 17, '협재 바다 보면서 귤 까먹기.', [PHOTO.beach], 'KR', '제주', { mood: '🍊' }),
  ];

  window.CHRONICLE_DEMO_ITEMS = [
    ...TRIPS,
    /* ── 오늘 ── */
    life('d-l1', 0, 19, '퇴근길 한강. 하늘이 이렇게 분홍색인 건 오랜만이다.\n\n요즘 계속 야근이라 해 지는 걸 본 게 한 달 만인 것 같다. 벤치에 앉아서 20분쯤 그냥 멍하니 있었는데, 그게 오늘 제일 좋았던 시간. 내일은 조금 일찍 나와서 걸어야지.',
      [PHOTO.riverSunset, PHOTO.morningHill], { location: '여의도 한강공원', mood: '🙂', weather: '맑음 · 21°' }),
    life('d-l2', 0, 13, '드디어 가 본 그 파스타집. 줄 설 만했다.', [PHOTO.pasta], { location: '성수', mood: '😋' }),
    en('d-e1', 0, 8, "Let's circle back on this next week.", '이 주제는 다음 주에 다시 논의하죠.',
      '나중에 다시 돌아와 논의하자는 뜻으로 미국 직장에서 아주 흔합니다. 실제로 다시 다루지 않으면 "흐지부지하겠다"는 뜻으로 받아들여지니 날짜를 붙이세요.',
      { sourceSentence: "We don't have enough data to decide today, so let's circle back on this next week after the audit.",
        sourceSentenceKo: '오늘은 결정할 데이터가 부족하니, 감사 끝나고 다음 주에 다시 얘기합시다.',
        dialogue: "A: Should we lock the budget now?\nB: Let's circle back on this next Tuesday — I want the Q3 numbers first.",
        practiceSentence: "Let's circle back on the hiring plan once we hear from finance." }),
    en('d-e2', 0, 8, "That's on me.", '그건 제 실수예요, 제 책임이에요.',
      '"I\'m sorry"는 사과지만 책임 소재는 흐릴 수 있는 반면, 이 표현은 책임을 분명히 가져갑니다. 식당에서 "It\'s on me"는 "제가 살게요"라는 전혀 다른 뜻입니다.'),
    /* 테마팩 '전체 저장' — 앱의 POST /api/daily-feed/:date/:subId/save 와 같은 모양(실제 시드 PACK_EN_001) */
    (() => { const feed = {"type": "language", "category": "en", "subCategory": "mental_block_at_work", "label": "English", "themeTitle": "프로젝트 아이디어가 막혀서 멘붕이 왔을 때", "themeTitleEn": "When Your Mind Goes Blank Under Pressure", "title": "프로젝트 아이디어가 막혀서 멘붕이 왔을 때: I'm drawing a blank. 외 4개", "vocabEntries": [{"item_id": "PACK_EN_001_01", "expression": "I'm drawing a blank.", "meaning": "머릿속이 하얘지다", "nuance": "단순히 '기억이 안 난다(I don't remember)'가 아닙니다. 회의 중 상사나 클라이언트가 기습 질문을 던졌을 때, 극도의 긴장감이나 스트레스로 인해 뇌 회로가 순간적으로 단선되어 머릿속이 하얘진 당혹스러운 심리 상태를 대변합니다. 'blank'는 빈 도화지를 연상시키며, 아무것도 떠오르지 않는 순간의 공허함을 시각적으로 표현합니다.", "dialogue": "Team Lead: Sungjae, do you have any alternative marketing strategies for our US launch?\nYou: Honestly, I'm drawing a blank right now. The pressure is really getting to me.\nTeam Lead: Take a breath. There's no rush — we still have fifteen minutes before the client call.\nYou: Thanks. Let me pull up my notes from last week. I know I had a few ideas jotted down.", "sourceSentence": "When the director asked for my long-term forecast on the spot, I was drawing a blank.", "sourceSentenceKo": "부장님이 갑자기 장기 전망을 물어보셨을 때, 머릿속이 하얘졌다.", "practiceSentence": "I'm drawing a blank on the vendor's contact info — could you check the shared drive?"}, {"item_id": "PACK_EN_001_02", "expression": "It's a no-brainer.", "meaning": "고민할 필요도 없는 당연한 일", "nuance": "'No-brainer'는 'brain'이 필요 없을 정도로 너무나 분명하고 쉬운 선택임을 강조합니다. 'Obviously'보다 훨씬 강렬하고, 어떤 상황에서도 굳이 깊이 고민하거나 분석할 필요조차 없다는 자신감을 담습니다. 특히 비즈니스 의사결정 상황에서 '이건 당연히 해야 하는 것'이라는 뉘앙스로 자주 쓰입니다.", "dialogue": "Manager: Should we switch to the new cloud platform even though the migration will take two weeks?\nYou: It's a no-brainer, honestly. The current system crashes every time we hit peak traffic.\nManager: I agree, but we need to convince the board. Can you put together a cost-benefit analysis?\nYou: Absolutely. Once they see we're losing 20% revenue per outage, the decision will make itself.", "sourceSentence": "Automating the manual reporting process is a no-brainer — it saves us eight hours a week.", "sourceSentenceKo": "수작업 보고 과정을 자동화하는 건 두말할 것도 없다 — 주당 8시간을 절약해준다.", "practiceSentence": "Offering free onboarding support to enterprise clients is a no-brainer given their contract size."}, {"item_id": "PACK_EN_001_03", "expression": "I've been on edge all morning.", "meaning": "아침 내내 신경이 날카로워져 있었다", "nuance": "'On edge'는 신체적으로 날이 세워진 칼날 위에 서 있는 이미지에서 나온 표현으로, 내가 통제할 수 없는 불안 요소(시스템 장애, 마감, 인사 발표 등) 때문에 온종일 신경이 곤두서 있는 상태를 묘사합니다. 단순한 '긴장(nervous)'과 달리, 이 상태는 지속적이고 누적된 스트레스에서 비롯된 만성적 초조함을 내포합니다.", "dialogue": "Colleague: Are you okay? You seem distracted during the standup.\nYou: Sorry. I've been on edge all morning because of the server incident. It's hard to focus.\nColleague: I get it. The whole team is stressed. Did DevOps give any update yet?\nYou: They said it'll be resolved by noon, but I keep checking the dashboard every five minutes.", "sourceSentence": "With the audit coming up next week, the entire finance team has been on edge.", "sourceSentenceKo": "다음 주 감사를 앞두고, 재무팀 전체가 예민해져 있다.", "practiceSentence": "I've been on edge all morning waiting for the board's decision on the restructuring plan."}, {"item_id": "PACK_EN_001_04", "expression": "Let's not boil the ocean.", "meaning": "너무 많은 것을 한꺼번에 하려 들지 맙시다", "nuance": "'Boil the ocean'은 바다를 통째로 끓이려는 비현실적인 시도에서 나온 은유로, 지나치게 방대한 목표나 무한히 넓은 범위의 작업에 무모하게 뛰어드는 행동을 비판할 때 씁니다. 스타트업이나 프로젝트 관리 맥락에서 '일단 MVP부터 시작하자', '범위를 좁히자'는 제안을 세련되게 표현하는 방법입니다.", "dialogue": "You: I'm thinking we should redesign the entire platform, revamp the brand identity, and launch a mobile app all at once.\nLead: Whoa, let's not boil the ocean here. We have a three-person team and a six-week deadline.\nYou: Fair point. So what should we prioritize first?\nLead: Let's nail the core checkout flow. Everything else can wait for version two.", "sourceSentence": "We only have three weeks — let's not boil the ocean and focus on the two highest-impact features.", "sourceSentenceKo": "3주밖에 없으니, 너무 방대하게 벌이지 말고 영향력이 가장 큰 기능 두 가지에 집중하자.", "practiceSentence": "Let's not boil the ocean on this redesign. Tackle the homepage first and iterate from there."}, {"item_id": "PACK_EN_001_05", "expression": "I'm all over the place today.", "meaning": "오늘 정신이 완전히 산만하다", "nuance": "'All over the place'는 생각이나 행동이 사방팔방으로 흩어져 일관성이 없는 상태를 묘사합니다. 일이 너무 많거나 갑작스러운 변수들이 터졌을 때 마음과 우선순위가 중구난방인 느낌을 솔직하게 고백하는 표현입니다. 공식적인 자리보다는 팀원 간의 대화에서 자신의 상태를 정직하게 드러낼 때 효과적입니다.", "dialogue": "Colleague: Did you finish the proposal draft?\nYou: I'm sorry, I'm all over the place today. I started three different tasks and didn't complete any.\nColleague: That happens. What's the most urgent thing on your list right now?\nYou: Honestly, the proposal. Let me block off the next two hours and just focus on that.", "sourceSentence": "Between the three back-to-back calls and the urgent brief, I've been all over the place today.", "sourceSentenceKo": "연달아 세 번의 통화와 급한 브리핑까지 겹쳐서, 오늘 하루 종일 정신이 없었다.", "practiceSentence": "Sorry for the scattered emails — I've been all over the place today with the launch prep."}], "wordEntries": [{"item_id": "WD_001", "word": "streamline", "pos": "동사", "meaning": "불필요한 단계를 걷어내 흐름을 매끄럽게 만들다", "collocations": ["streamline the process", "streamline operations", "streamline the approval flow"], "confusable": "simplify는 '쉽게' 만드는 것이고 streamline은 '불필요한 단계를 없애' 빠르게 만드는 것입니다. 내용은 그대로 두고 절차만 줄일 때 streamline이 맞습니다.", "nuance": "원래 물이나 공기가 매끄럽게 흐르도록 만든 유선형(streamline)에서 온 말입니다. 그래서 대상이 '과정·절차'일 때 가장 자연스럽고, 사람이나 생각에는 잘 쓰지 않습니다. 업무 개선 보고서에서 가장 많이 보이는 동사 중 하나입니다.", "example": "We streamlined the approval process from five steps to two.", "exampleKo": "승인 절차를 다섯 단계에서 두 단계로 간소화했습니다."}, {"item_id": "WD_002", "word": "escalate", "pos": "동사", "meaning": "상부로 올리다 / (상황이) 악화되다", "collocations": ["escalate the issue to management", "escalate a ticket", "the situation escalated quickly"], "confusable": "report는 단순히 알리는 것이고 escalate는 **내 선에서 못 푸니 윗선으로 넘긴다**는 뜻입니다. 그래서 escalate에는 긴급함과 책임 이동이 함께 담깁니다.", "nuance": "한국인은 '보고하다'라는 타동사 뜻만 아는 경우가 많은데, 목적어 없이 쓰면 '악화되다'라는 정반대 결의 뜻이 됩니다. \"It escalated\"는 일이 커졌다는 말이지 보고했다는 말이 아닙니다. 고객 응대·IT 지원 업무에서 특히 자주 등장합니다.", "example": "If the client doesn't respond by Friday, we'll escalate it to the account director.", "exampleKo": "고객이 금요일까지 회신하지 않으면 담당 디렉터에게 올리겠습니다."}, {"item_id": "WD_003", "word": "mitigate", "pos": "동사", "meaning": "(위험·피해를) 완화하다, 줄이다", "collocations": ["mitigate risk", "mitigate the impact", "mitigating factors"], "confusable": "prevent는 아예 막는 것이고 mitigate는 **일어나긴 하되 피해를 줄이는** 것입니다. 완전히 막을 수 있다면 prevent를 쓰는 게 정확합니다.", "nuance": "리스크 관리 문서의 기본 동사라, 'risk'와 짝으로 외워두면 바로 쓸 수 있습니다. 법률에서는 mitigating circumstances(정상참작 사유)처럼 형을 덜어주는 사정을 가리키기도 합니다.", "example": "We can't eliminate the delay, but we can mitigate its impact on the launch.", "exampleKo": "지연 자체를 없앨 수는 없지만 출시에 미치는 영향은 줄일 수 있습니다."}], "masterParagraph": {"text": "Yesterday's meeting was absolute chaos. When the director suddenly asked for my long-term forecast, I was drawing a blank — the morning's server crisis had left me completely on edge. Everyone in the room knew it was a no-brainer that our initial plan was flawed, yet I was so all over the place that I couldn't articulate a single coherent thought. Finally, my colleague stepped in and said, 'Let's not boil the ocean here — let's fix the three core issues first and show the board a realistic roadmap.' That one sentence cut through the fog and got everyone back on track.", "translation": "어제 회의는 그야말로 혼돈이었다. 이사가 갑자기 장기 전망을 물었을 때, 나는 머릿속이 완전히 하얘졌다 — 오전 내내 서버 위기 때문에 신경이 극도로 날카로워져 있던 탓이었다. 방 안의 모두가 우리 초기 계획에 결함이 있다는 사실은 고민할 필요도 없는 당연한 일이라는 걸 알았지만, 나는 정신이 너무 산만해서 제대로 된 말 한마디를 꺼낼 수가 없었다. 그때 동료가 끼어들며 말했다, '한 번에 너무 많은 걸 해결하려 들지 맙시다 — 핵심 세 가지 문제만 고치고 이사회에 현실적인 로드맵을 보여줍시다.' 그 한 마디가 안개를 걷어냈고, 모두가 다시 궤도에 오르게 해주었다.", "highlights": ["drawing a blank", "on edge", "no-brainer", "all over the place", "boil the ocean"]}, "pack_id": "PACK_EN_001"};
      return { id: 'd-p1', type: 'language', domain: 'language', mode: 'PROFESSIONAL', source: 'daily-feed', ...at(0, 8),
        title: feed.themeTitle, themeTitle: feed.themeTitle, themeTitleEn: feed.themeTitleEn,
        vocabEntries: feed.vocabEntries, masterParagraph: feed.masterParagraph, feedData: feed }; })(),
    fd('d-h1', 0, 9, 'humanities', { subType: 'history', title: '헨리 8세와 아라곤의 캐서린 — 이혼 하나가 나라의 종교를 바꾸다 (1527~1534년)',
      period: '근세', region: '영국 런던·이탈리아 로마',
      summary: '캐서린은 원래 헨리의 형 아서의 아내였다. 아서가 결혼 몇 달 만에 죽자 스페인과의 동맹을 놓치기 싫었던 영국 왕실은 교황의 특별 허가를 받아 동생 헨리와 재혼시켰다. 아들이 없으면 왕조가 흔들린다고 믿은 헨리는 결혼 자체가 무효라고 주장했지만 교황은 끝내 허락하지 않았고, 결국 1534년 수장령으로 로마 교회와 결별했다.',
      behindStory: '교황이 버틴 진짜 이유는 정치였다. 1527년 캐서린의 조카인 황제 카를 5세의 군대가 로마를 약탈했고, 교황은 사실상 그의 손안에 있었다. 1529년 재판정에서 캐서린은 헨리 앞에 무릎을 꿇고 "나는 20년 동안 당신의 진실하고 순종하는 아내였다"고 말한 뒤 법정을 나가 버렸다.' }),
    fd('d-i1', 0, 9, 'humanities', { subType: 'idiom', idiom: '불치하문', hanja: '不恥下問', meaning: '아랫사람에게 묻는 것을 부끄러워하지 않는다.',
      origin: '《논어》 〈공야장〉편에서 자공이 물었다. "공문자는 어째서 문(文)이라는 시호를 받았습니까?" 자공이 의아해한 데는 이유가 있었다. 공문자는 사사로운 행실에 흠이 많은 위나라 대부였기 때문이다. 공자의 답은 이랬다. "영민하면서도 배우기를 좋아하고, 아랫사람에게 묻기를 부끄러워하지 않았다."',
      story: '팀에서 가장 오래된 시니어인데도 신입에게 새 툴 사용법을 먼저 물어보는 그의 태도가 불치하문이었다.',
      application: '직급이 높아질수록 모른다고 말하기 어려워진다. 그 순간이 배움이 멈추는 순간이다.' }),
    fd('d-c1', 0, 10, 'psychology', { subType: 'liber', book: '명상록', author: '마르쿠스 아우렐리우스',
      quote: '당신이 외적인 것들로 인해 고통받는다면, 그 고통은 그것들 때문이 아니라 당신의 판단 때문이다.',
      backstory: '마르쿠스는 어려서부터 몸이 약했고, 위와 가슴의 통증 때문에 거의 먹지 못했다고 전해진다. 매일 아픈 몸으로 전선을 지킨 사람이 스스로를 붙들기 위해 쓴 문장이다.',
      source: 'Meditations VIII.47', era: 'Roman Stoicism',
      context: '회의에서 누군가의 한마디에 하루 종일 기분이 상했다면, 상처를 준 건 그 말이 아니라 그 말에 내가 붙인 해석일 수 있다. 해석은 지금 당장 바꿀 수 있다.',
      tags: ['스토아', '감정', '판단', '회복력'] }),
    { id: 'd-w1', type: 'wrong_answer', domain: 'science', mode: 'EXAM_PREP', ...at(0, 21), title: '[수학] 속도와 위치',
      wrongAnswer: { subject: 'math', subjectName: '수학', unit: '미분과 적분 > 속도와 가속도',
        keyConceptName: '위치, 속도, 이동 거리의 관계', problemSummary: '속도 함수 v(t)=t²−kt+4가 주어졌을 때 점 P의 위치·운동 방향·이동 거리를 판단하는 문제.',
        answer: '정답은 3번 (ㄱ, ㄷ)',
        requiredConcepts: [{ term: '위치 = 속도의 적분', desc: 'x(t) = ∫v(t)dt, 출발점이 원점이면 적분상수 0.' },
                           { term: '이동 거리', desc: '속도의 부호가 바뀌는 구간을 나눠 |v(t)|를 적분한다.' }],
        modelSteps: ['1. k 값마다 v(t)를 세운다.', '2. v(t)=0인 시각으로 운동 방향이 바뀌는지 본다.', '3. 이동 거리는 절댓값 적분으로 구한다.'],
        whatToReinforce: '위치 변화량(∫v)과 이동 거리(∫|v|)를 구분하는 것이 핵심. 부호가 바뀌는 구간을 먼저 찾는 습관을 들이자.' } },
    { id: 'd-y1', type: 'youtube', domain: 'business', mode: 'PROFESSIONAL', ...at(0, 22), title: '10분 만에 이해하는 금리와 환율', channelName: '경제 한 입', source: 'https://www.youtube.com/' },
    { id: 'd-a1', type: 'daily_delivery', domain: 'business', mode: 'PROFESSIONAL', ...at(0, 5), title: '미국 증시: 기술주 중심 완만한 상승', text: '자동 배달된 시황 카드 (체크박스를 켜야 보임)' },

    /* ── 어제 ── */
    life('d-l3', 1, 20, '첫 발표 끝. 떨렸지만 끝까지 했다.', [], { mood: '😮‍💨' }),
    en('d-e3', 1, 8, "I'm swamped.", '엄청 바쁘다, 일에 파묻혀 있다.',
      '늪에 빠져 허우적대는 이미지라 "busy"보다 과부하 느낌이 강합니다. 거절이나 일정 조정의 이유로 쓰기 좋지만 매번 쓰면 핑계처럼 들려요.'),
    fd('d-h2', 1, 9, 'humanities', { subType: 'history', title: '클레오파트라 — 이집트의 마지막 파라오는 이집트인이 아니었다 (기원전 48~30년)',
      period: '고대', region: '이집트 알렉산드리아',
      summary: '클레오파트라 7세는 알렉산드로스 대왕의 장군이 세운 그리스계 왕조의 마지막 군주였다. 카이사르, 안토니우스와 손잡았지만 악티움 해전에서 패한 뒤 스스로 목숨을 끊었다.' }),

    /* ── 사흘 전 ── */
    life('d-l4', 3, 8, '아침 산책. 공기가 벌써 차다.', [PHOTO.morningHill], { location: '남산', mood: '🌿' }),
    en('d-e4', 3, 8, 'Let me sleep on it.', '좀 더 생각해볼게요.',
      '하룻밤 자고 결정하겠다는 뜻으로, 거절이 아니라 신중하게 생각하겠다는 신호입니다. 정말 하루 안에 답을 주지 않으면 사실상 거절로 받아들여집니다.'),
    fd('d-i2', 3, 9, 'humanities', { subType: 'idiom', idiom: '수적천석', hanja: '水滴穿石', meaning: '물방울이 돌을 뚫는다.',
      origin: '북송의 관리 장괴애가 동전 한 닢을 훔친 아전에게 "하루 한 닢이면 천 날에 천 닢이다. 물방울이 떨어져도 돌이 뚫린다"고 판결했다.' }),

    /* ── 엿새 전 ── */
    en('d-e5', 6, 8, 'Read between the lines.', '글자 그대로가 아닌 숨은 의미를 파악하다.',
      '영어권 비즈니스에서 "We\'ll think about it"이나 "Interesting idea"가 사실상 거절인 경우가 많아서 이 능력이 특히 중요합니다.'),
    fd('d-c2', 6, 9, 'psychology', { subType: 'liber', book: '채근담', author: '홍자성',
      quote: '책을 읽으면서 성현의 뜻을 만나지 못하면 종이와 붓의 머슴에 불과하다.',
      backstory: '원문의 "연참용(鉛槧傭)"은 글을 베껴 써 주고 삯을 받던 사람을 가리킨다. 경전을 외우고도 뜻은 모르는 선비를 필경사 품팔이에 비유한 것이다.' }),

    /* ── 열이틀 전 ── */
    life('d-l5', 12, 15, '비 오는 날 동네 서점 카페. 오랜만에 종이책 한 권 다 읽었다.', [PHOTO.bookCafe], { location: '망원', mood: '☕' }),
    en('d-e6', 12, 8, "You've got my full support.", '전적으로 지지합니다.',
      '리더가 팀원에게 하면 "책임은 내가 함께 지겠다"는 든든한 신호가 됩니다. "whatever you need"를 붙이면 더 믿음이 갑니다.'),
    { id: 'd-x1', examWord: { word: 'analogy', pos: 'noun', meaning: '유추, 비유를 통한 설명', exampleEn: 'The author draws an analogy between the immune system and a city\'s defense.', exampleKo: '저자는 면역 체계와 도시 방어 사이의 유추를 제시한다.' },
      type: 'exam_word', domain: 'language', mode: 'EXAM_PREP', ...at(12, 21), title: 'analogy' },
  ];
  /* 샘플 "내 생각" 하나 — 카드와 팝업에서 어떻게 보이는지 */
  const henry = window.CHRONICLE_DEMO_ITEMS.find(it => it.id === 'd-h1');
  if (henry) henry.myInsight = '결국 신앙이 아니라 정치가 판을 갈랐다. 명분(레위기)은 나중에 찾은 것 — 회사에서 "원칙"이라며 밀어붙이는 결정도 사실은 누군가의 필요에서 출발하는 경우가 많다.';

  /* 팩에서 표현 하나만 저장한 경우 — 서버가 붙여 주는 packContext(그 팩의 글·다른 표현)와 같은 모양 */
  const pk = window.CHRONICLE_DEMO_ITEMS.find(it => it.id === 'd-p1')?.feedData;
  if (pk) {
    const v = pk.vocabEntries[3];
    window.CHRONICLE_DEMO_ITEMS.push({
      ...en('d-e7', 1, 9, v.expression, v.meaning, v.nuance, v), type: 'language',
      packContext: { packId: pk.pack_id, themeTitle: pk.themeTitle, themeTitleEn: pk.themeTitleEn,
        masterParagraph: pk.masterParagraph, siblings: pk.vocabEntries.map(e => ({ expression: e.expression, meaning: e.meaning })) },
    });
  }

  /* 샘플 노트 — 배달받은 카드를 @로 엮어 내 말로 정리한 긴 글 */
  const m = (id, label) => `<a class="mention" contenteditable="false" data-id="${id}">${label}</a>`;
  const note = (id, offset, hh, n) => ({ id, type: 'note', domain: 'humanities', mode: 'PROFESSIONAL', ...at(offset, hh), note: n });
  window.CHRONICLE_DEMO_ITEMS.push(
    note('d-n1', 0, 22, { icon: '🏰', cover: 'tile-2', title: '튜더 왕조 한 장 정리', tags: ['세계사', '영국'], html: [
      `<p>오늘 배달받은 ${m('d-h1', '🏛 헨리 8세와 아라곤의 캐서린')} 이야기가 재밌어서 앞뒤를 이어 정리해 둔다.</p>`,
      `<h2>한 줄 요약</h2>`,
      `<blockquote class="callout">왕의 이혼 문제가 로마와의 결별 → 국교회 → 엘리자베스 시대까지 이어진다. <b>개인의 욕망이 제도를 바꾼 사례.</b></blockquote>`,
      `<h2>흐름</h2>`,
      `<ol><li>1509 헨리 8세 즉위, 형수였던 캐서린과 결혼</li><li>1527 아들이 없자 혼인 무효를 교황에게 청원</li><li>1534 수장령 — 영국 국왕이 교회의 수장</li><li>1558 엘리자베스 1세 즉위, 국교회 정착</li></ol>`,
      `<h3>더 알아볼 것</h3>`,
      `<ul class="todo"><li class="done">캐서린이 끝까지 이혼을 거부한 이유</li><li>토머스 모어는 왜 처형됐나</li><li>영화 「천일의 앤」 보기</li></ul>`,
      `<hr>`,
      `<blockquote>명분은 나중에 찾는 것이다.</blockquote>`,
      `<p>회사에서도 비슷하다. 결정이 먼저고, 근거는 뒤따라온다.</p>`,
    ].join('') }),
    note('d-n2', 3, 21, { icon: '💬', cover: 'tile-3', title: '회의에서 바로 쓰는 영어 모음', tags: ['영어', '회의'], html: [
      `<p>이번 주 배달받은 표현 중 실제 회의에서 쓸 만한 것만 골랐다.</p>`,
      `<h2>미룰 때</h2>`,
      `<ul><li>${m('d-e1', "🔤 Let's circle back on this next week.")} — 정중하게 다음으로</li><li>${m('d-e4', '🔤 Let me sleep on it.')} — 답을 하루 미룰 때</li></ul>`,
      `<h2>책임질 때</h2>`,
      `<ul><li>${m('d-e2', "🔤 That's on me.")} — 변명 없이 짧게</li></ul>`,
      `<blockquote class="callout">다음 주 주간회의에서 적어도 하나는 직접 써 보기.</blockquote>`,
      `<ul class="todo"><li>circle back 써 보기</li><li>sleep on it 써 보기</li></ul>`,
    ].join('') }),
  );
})();
