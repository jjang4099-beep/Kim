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

  const life = (id, offset, hh, text, photos, extra = {}) => ({
    id, contentType: 'life', domain: 'life', mode: 'PROFESSIONAL', ...at(offset, hh),
    title: text || '라이프 기록', text, life: { photos, ...extra },
  });
  const en = (id, offset, hh, expr, meaning, nuance) => ({
    id, source: 'daily-feed-entry', domain: 'language', mode: 'PROFESSIONAL', ...at(offset, hh),
    title: expr, text: `[demo] ${expr}\n뜻: ${meaning}\n뉘앙스: ${nuance}`,
  });
  const fd = (id, offset, hh, domain, feedData, mode = 'PROFESSIONAL') => ({
    id, type: 'humanities', domain, mode, ...at(offset, hh), title: feedData.title || '', feedData,
  });

  window.CHRONICLE_DEMO_ITEMS = [
    /* ── 오늘 ── */
    life('d-l1', 0, 19, '퇴근길 한강. 하늘이 이렇게 분홍색인 건 오랜만이다.', [PHOTO.riverSunset], { location: '여의도', mood: '🙂' }),
    life('d-l2', 0, 13, '드디어 가 본 그 파스타집. 줄 설 만했다.', [PHOTO.pasta], { location: '성수', mood: '😋' }),
    en('d-e1', 0, 8, "Let's circle back on this next week.", '이 주제는 다음 주에 다시 논의하죠.',
      '나중에 다시 돌아와 논의하자는 뜻으로 미국 직장에서 아주 흔합니다. 실제로 다시 다루지 않으면 "흐지부지하겠다"는 뜻으로 받아들여지니 날짜를 붙이세요.'),
    en('d-e2', 0, 8, "That's on me.", '그건 제 실수예요, 제 책임이에요.',
      '"I\'m sorry"는 사과지만 책임 소재는 흐릴 수 있는 반면, 이 표현은 책임을 분명히 가져갑니다. 식당에서 "It\'s on me"는 "제가 살게요"라는 전혀 다른 뜻입니다.'),
    { id: 'd-p1', type: 'language', domain: 'language', mode: 'PROFESSIONAL', ...at(0, 8),
      feedData: { themeTitle: '회의에서 이견을 부드럽게 말할 때', vocabEntries: [
        { expression: "I'd like to offer a different perspective.", meaning: '다른 관점을 제시하고 싶습니다.' },
        { expression: 'I see where you\'re coming from, but…', meaning: '무슨 뜻인지는 알겠지만…' },
        { expression: 'Can we unpack this a bit more?', meaning: '이걸 좀 더 풀어서 볼까요?' },
        { expression: 'Let\'s agree to disagree.', meaning: '서로 생각이 다르다는 걸 인정하죠.' } ] } },
    fd('d-h1', 0, 9, 'humanities', { subType: 'history', title: '헨리 8세와 아라곤의 캐서린 — 이혼 하나가 나라의 종교를 바꾸다 (1527~1534년)',
      period: '근세', region: '영국 런던·이탈리아 로마',
      summary: '캐서린은 원래 헨리의 형 아서의 아내였다. 아들이 없으면 왕조가 흔들린다고 믿은 헨리는 결혼 자체가 무효라고 주장했지만 교황은 끝내 허락하지 않았고, 결국 1534년 수장령으로 로마 교회와 결별했다.' }),
    fd('d-i1', 0, 9, 'humanities', { subType: 'idiom', idiom: '불치하문', hanja: '不恥下問', meaning: '아랫사람에게 묻는 것을 부끄러워하지 않는다.',
      origin: '《논어》 〈공야장〉편에서 자공이 물었다. "공문자는 어째서 문(文)이라는 시호를 받았습니까?" 공자의 답은 이랬다. "영민하면서도 배우기를 좋아하고, 아랫사람에게 묻기를 부끄러워하지 않았다."' }),
    fd('d-c1', 0, 10, 'psychology', { subType: 'liber', book: '명상록', author: '마르쿠스 아우렐리우스',
      quote: '당신이 외적인 것들로 인해 고통받는다면, 그 고통은 그것들 때문이 아니라 당신의 판단 때문이다.',
      backstory: '마르쿠스는 어려서부터 몸이 약했고, 위와 가슴의 통증 때문에 거의 먹지 못했다고 전해진다. 매일 아픈 몸으로 전선을 지킨 사람이 스스로를 붙들기 위해 쓴 문장이다.' }),
    { id: 'd-w1', type: 'wrong_answer', domain: 'science', mode: 'EXAM_PREP', ...at(0, 21), title: '[수학] 속도와 위치',
      wrongAnswer: { subject: 'math', subjectName: '수학', unit: '미분과 적분 > 속도와 가속도',
        keyConceptName: '위치, 속도, 이동 거리의 관계', problemSummary: '속도 함수 v(t)=t²−kt+4가 주어졌을 때 점 P의 위치·운동 방향·이동 거리를 판단하는 문제.' } },
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
})();
