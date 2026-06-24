/**
 * buildClassicDB.js
 * 고전 명언 DB 구축 스크립트 (1회성 실행)
 * 실행: node scripts/buildClassicDB.js
 * 
 * ⚠️ 주의: 반드시 로컬에서 1회만 실행 후 DB 덤프 사용
 * 예상 비용: 약 3,300원 (1회)
 * 예상 구절: 38권 × 20구절 = 760구절 (약 2년치)
 *
 * 저작권 확인:
 *   생텍쥐페리 (1944년 사망) → 2014년 만료 ✅
 *   카뮈 (1960년 사망) → 2030년 만료 ❌ 제외
 *   카프카 (1924년 사망) → 1994년 만료 ✅
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// 고전 목록 (38권 확정)
// ─────────────────────────────────────────────
const CLASSICS = [

  // ★★★★★ 반드시 (10권)
  {
    book: '명상록',
    author: '마르쿠스 아우렐리우스',
    era: 'Stoicism',
    tags: ['철학', '자기계발', '스토아', '내면', '절제'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '군주론',
    author: '마키아벨리',
    era: 'Renaissance',
    tags: ['리더십', '전략', '권력', '현실주의', '정치'],
    targetMode: 'work',
    priority: 5,
  },
  {
    book: '탈무드',
    author: '유대 랍비 문학',
    era: 'Ancient',
    tags: ['지혜', '비즈니스', '삶의원칙', '유대철학', '처세'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '햄릿',
    author: '셰익스피어',
    era: 'Elizabethan',
    tags: ['결단', '존재', '복수', '망설임', '인간본성'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '전쟁과 평화',
    author: '톨스토이',
    era: 'Russian Realism',
    tags: ['역사', '운명', '인간의지', '사랑', '전쟁'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '레미제라블',
    author: '빅토르 위고',
    era: 'French Romanticism',
    tags: ['정의', '구원', '인간존엄', '사랑', '희생'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '1984',
    author: '조지 오웰',
    era: 'Modern',
    tags: ['전체주의', '감시', '언어', '권력', '자유'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '어린왕자',
    author: '앙투안 드 생텍쥐페리',
    era: 'French Literature',
    tags: ['순수', '어른', '삶의본질', '관계', '상상력'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '논어',
    author: '공자',
    era: 'Confucianism',
    tags: ['인(仁)', '예(禮)', '군자', '학문', '처세'],
    targetMode: 'both',
    priority: 5,
  },
  {
    book: '채근담',
    author: '홍자성',
    era: 'Ming Dynasty',
    tags: ['처세', '담담함', '인생통찰', '지혜', '동양철학'],
    targetMode: 'both',
    priority: 5,
  },

  // ★★★★☆ 강력 추천 (19권)
  {
    book: '맥베스',
    author: '셰익스피어',
    era: 'Elizabethan',
    tags: ['야망', '권력', '죄책감', '비극', '욕망'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '죄와 벌',
    author: '도스토예프스키',
    era: 'Russian Realism',
    tags: ['양심', '심리', '인간본성', '죄', '구원'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '파우스트',
    author: '괴테',
    era: 'German Classicism',
    tags: ['욕망', '지식', '거래', '구원', '인간한계'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '오디세이아',
    author: '호메로스',
    era: 'Ancient Greek',
    tags: ['귀환', '지혜', '시련', '인내', '여정'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '신곡',
    author: '단테',
    era: 'Medieval',
    tags: ['죄', '구원', '인간여정', '정의', '사랑'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '위대한 개츠비',
    author: 'F. 스콧 피츠제럴드',
    era: 'American Modernism',
    tags: ['꿈', '욕망', '허상', '계급', '아메리칸드림'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '변신',
    author: '프란츠 카프카',
    era: 'Modernism',
    tags: ['소외', '정체성', '관료제', '부조리', '가족'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '월든',
    author: '헨리 데이비드 소로',
    era: 'American Transcendentalism',
    tags: ['자연', '단순한삶', '성찰', '자급자족', '자유'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '인형의 집',
    author: '헨리크 입센',
    era: 'Norwegian Realism',
    tags: ['자유', '사회규범', '각성', '독립', '정체성'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '베니스의 상인',
    author: '셰익스피어',
    era: 'Elizabethan',
    tags: ['돈', '계약', '정의', '자비', '편견'],
    targetMode: 'work',
    priority: 4,
  },
  {
    book: '리어왕',
    author: '셰익스피어',
    era: 'Elizabethan',
    tags: ['권력이양', '배신', '노년', '자만', '비극'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '안나 카레니나',
    author: '톨스토이',
    era: 'Russian Realism',
    tags: ['사랑', '사회규범', '자유', '결혼', '비극'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '부활',
    author: '톨스토이',
    era: 'Russian Realism',
    tags: ['죄', '용서', '인간회복', '사랑', '구원'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '에픽테토스 어록',
    author: '에픽테토스',
    era: 'Stoicism',
    tags: ['스토아', '통제', '자유', '철학', '내면'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '유토피아',
    author: '토마스 모어',
    era: 'Renaissance',
    tags: ['이상사회', '정치', '풍자', '인간본성', '개혁'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '도덕경',
    author: '노자',
    era: 'Taoism',
    tags: ['무위자연', '역설', '도(道)', '겸손', '동양철학'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '국부론',
    author: '애덤 스미스',
    era: 'Enlightenment',
    tags: ['경제', '분업', '시장', '자유무역', '자본'],
    targetMode: 'work',
    priority: 4,
  },
  {
    book: '시민 불복종',
    author: '헨리 데이비드 소로',
    era: 'American Transcendentalism',
    tags: ['양심', '저항', '정의', '자유', '법과도덕'],
    targetMode: 'both',
    priority: 4,
  },
  {
    book: '인간의 대지',
    author: '앙투안 드 생텍쥐페리',
    era: 'French Literature',
    tags: ['리더십', '용기', '연대', '삶의의미', '모험'],
    targetMode: 'both',
    priority: 4,
  },
];

// ─────────────────────────────────────────────
// ClassicQuote 스키마
// ─────────────────────────────────────────────
const ClassicQuoteSchema = new mongoose.Schema({
  book:       { type: String, required: true },
  author:     { type: String, required: true },
  era:        { type: String, default: '' },
  quote:      { type: String, required: true },
  source:     { type: String, default: '' },
  theme:      { type: String, default: '' },
  context:    { type: String, default: '' },
  tags:       [String],
  targetMode: {
    type: String,
    enum: ['work', 'exam', 'both'],
    default: 'both',
  },
  priority:   { type: Number, default: 4 },
  used:       { type: Boolean, default: false },
  usedAt:     { type: Date, default: null },
  createdAt:  { type: Date, default: Date.now },
});

ClassicQuoteSchema.index({ used: 1, targetMode: 1, priority: -1 });
ClassicQuoteSchema.index({ book: 1 });
ClassicQuoteSchema.index({ tags: 1 });

const ClassicQuote = mongoose.model('ClassicQuote', ClassicQuoteSchema);

// ─────────────────────────────────────────────
// 구절 생성 함수
// ─────────────────────────────────────────────
async function generateQuotesForClassic(classic) {
  const prompt = `
너는 세계 문학과 철학의 전문가야.
${classic.author}의 《${classic.book}》에서
현대 직장인과 수험생에게 깊은 울림을 줄 수 있는
핵심 구절 20개를 선정해줘.

선정 기준:
- 삶의 태도, 리더십, 성장, 인간관계, 역경 극복에 관한 구절 우선
- 너무 길지 않고 한 화면에 담길 수 있는 분량 (1~4문장)
- 독자가 저장하고 싶고 공유하고 싶을 만큼 인상적인 구절
- 원문이 있을 경우 자연스러운 한국어 번역으로 제공

아래 JSON 배열 형식으로만 응답해줘.
다른 텍스트, 설명, 마크다운 없이 순수 JSON 배열만:

[
  {
    "quote": "구절 한국어 번역 (원문이 한국어면 그대로)",
    "source": "출처 표시 (예: 17장, 1권 3절, Act 3 Scene 1)",
    "theme": "이 구절의 핵심 주제 한 단어",
    "context": "이 구절의 현대적 맥락 해석 (2~3문장, 직장인/수험생 관점)",
    "targetMode": "work 또는 exam 또는 both"
  }
]
  `.trim();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();

  // JSON 파싱 (마크다운 펜스 제거)
  const clean = text.replace(/```json|```/g, '').trim();
  const quotes = JSON.parse(clean);

  return quotes.map(q => ({
    book:       classic.book,
    author:     classic.author,
    era:        classic.era,
    quote:      q.quote,
    source:     q.source || '',
    theme:      q.theme  || '',
    context:    q.context || '',
    tags:       classic.tags,
    targetMode: q.targetMode || classic.targetMode,
    priority:   classic.priority,
    used:       false,
    usedAt:     null,
  }));
}

// ─────────────────────────────────────────────
// 딜레이 유틸 (API 레이트 리밋 방지)
// ─────────────────────────────────────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────
async function main() {
  console.log('📚 SJ 아카이브 — 고전 DB 구축 시작');
  console.log(`총 ${CLASSICS.length}권 처리 예정\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB 연결 완료\n');

  let totalSaved = 0;
  const errors   = [];

  for (let i = 0; i < CLASSICS.length; i++) {
    const classic = CLASSICS[i];
    const progress = `[${i + 1}/${CLASSICS.length}]`;

    // 이미 처리된 책이면 스킵
    const existing = await ClassicQuote.countDocuments({ book: classic.book });
    if (existing > 0) {
      console.log(`${progress} ⏭️  ${classic.book} — 이미 ${existing}개 존재, 스킵`);
      totalSaved += existing;
      continue;
    }

    try {
      console.log(`${progress} 🔄 ${classic.book} (${classic.author}) 처리 중...`);
      const quotes = await generateQuotesForClassic(classic);
      await ClassicQuote.insertMany(quotes);

      totalSaved += quotes.length;
      console.log(`${progress} ✅ ${classic.book} — ${quotes.length}개 구절 저장 완료`);

      // API 레이트 리밋 방지 (1초 딜레이)
      if (i < CLASSICS.length - 1) await delay(1000);

    } catch (e) {
      console.error(`${progress} ❌ ${classic.book} 실패:`, e.message);
      errors.push({ book: classic.book, error: e.message });
      await delay(2000); // 실패 시 2초 대기 후 계속
    }
  }

  // ─── 최종 결과 ───
  console.log('\n' + '='.repeat(50));
  console.log('📊 구축 완료 요약');
  console.log('='.repeat(50));
  console.log(`✅ 총 저장 구절: ${totalSaved}개`);
  console.log(`📅 예상 배달 가능일: 약 ${Math.floor(totalSaved / 1)}일 (1일 1구절 기준)`);
  console.log(`⏱️  약 ${Math.floor(totalSaved / 365 * 10) / 10}년치 콘텐츠`);

  if (errors.length > 0) {
    console.log(`\n⚠️  실패한 책 (${errors.length}권):`);
    errors.forEach(e => console.log(`   - ${e.book}: ${e.error}`));
    console.log('\n위 책들은 개별로 재시도해주세요.');
  }

  // 우선순위별 통계
  const priority5 = await ClassicQuote.countDocuments({ priority: 5 });
  const priority4 = await ClassicQuote.countDocuments({ priority: 4 });
  const workMode  = await ClassicQuote.countDocuments({ targetMode: { $in: ['work', 'both'] } });
  const examMode  = await ClassicQuote.countDocuments({ targetMode: { $in: ['exam', 'both'] } });

  console.log('\n📈 구성 통계:');
  console.log(`   ★★★★★ 반드시:    ${priority5}구절`);
  console.log(`   ★★★★☆ 강력추천:  ${priority4}구절`);
  console.log(`   💼 직장인 모드:   ${workMode}구절`);
  console.log(`   📚 수험생 모드:   ${examMode}구절`);
  console.log('='.repeat(50));

  await mongoose.disconnect();
  console.log('\n✅ DB 연결 종료. 구축 완료!');
  console.log('💡 다음 단계: server.js에 generateLiberFeed() 함수 추가');
}

main().catch(e => {
  console.error('💥 치명적 오류:', e);
  process.exit(1);
});
