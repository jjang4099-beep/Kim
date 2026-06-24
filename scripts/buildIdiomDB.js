/**
 * buildIdiomDB.js
 * 고사성어 DB 구축 스크립트 (1회성 실행)
 * 실행: node scripts/buildIdiomDB.js
 *
 * 예상 비용: 약 1,000원 (1회)
 * 예상 카드: 300개 × 맥락 2종 = 600카드 (약 1년 반치)
 * 저작권: 고사성어 자체는 저작권 없음 ✅
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// 고사성어 목록 (300개)
// ─────────────────────────────────────────────
const IDIOMS = [
  // 인생·처세
  '사필귀정', '새옹지마', '전화위복', '고진감래', '인과응보',
  '자업자득', '권선징악', '화무십일홍', '흥망성쇠', '영고성쇠',
  '무상', '허무', '달관', '초연', '안빈낙도',
  '지족', '지족상락', '과유불급', '중용', '중도',

  // 학문·노력
  '형설지공', '주경야독', '절차탁마', '와신상담', '권토중래',
  '각고면려', '불철주야', '주야장천', '분골쇄신', '살신성인',
  '십년공부', '일취월장', '청출어람', '교학상장', '온고지신',
  '박학다식', '다재다능', '문일지십', '거안제미', '타산지석',

  // 리더십·전략
  '지피지기', '백전백승', '선즉제인', '후즉제어', '이이제이',
  '원교근공', '합종연횡', '원수근공', '성동격서', '허허실실',
  '반간계', '고육계', '연환계', '공성계', '미인계',
  '용병여신', '임기응변', '기기묘묘', '신출귀몰', '변화무쌍',

  // 인간관계
  '관포지교', '수어지교', '문경지교', '막역지우', '죽마고우',
  '동병상련', '타향살이', '고향', '혈육', '골육상쟁',
  '이심전심', '언중유골', '일언지하', '언행일치', '표리부동',
  '외유내강', '내유외강', '유유상종', '초록은동색', '끼리끼리',

  // 역경·극복
  '백절불굴', '불굴의의지', '칠전팔기', '기사회생', '절체절명',
  '사면초가', '진퇴양난', '오리무중', '풍전등화', '누란지위',
  '배수진', '파부침주', '건곤일척', '명재경각', '위기일발',
  '천우신조', '구사일생', '기적', '역전', '반전',

  // 성공·성취
  '일석이조', '일거양득', '금상첨화', '화룡점정', '유종의미',
  '금의환향', '입신양명', '공성신퇴', '명불허전', '실력발휘',
  '천하무적', '독보적', '전무후무', '전대미문', '공전절후',
  '개천에서용난다', '대기만성', '만시지탄', '적시적소', '천재일우',

  // 겸손·경계
  '교만은패망의선봉', '자만', '자고자대', '우물안개구리', '정저지와',
  '하룻강아지범무서운줄모른다', '무지', '무모', '경거망동', '즉흥적',
  '삼인성호', '유언비어', '확인사살', '사실확인', '신중함',
  '돌다리도두드려건너라', '신중', '조심', '경계', '조심성',

  // 시간·변화
  '광음여류', '세월여류', '일각여삼추', '격세지감', '상전벽해',
  '천지개벽', '일취월장', '우공이산', '점진적', '적소성대',
  '낙수물이바위뚫는다', '인내', '지속', '꾸준함', '항상성',
  '천리길도한걸음부터', '시작', '첫걸음', '출발', '도전',

  // 욕심·절제
  '과욕', '탐욕', '사욕', '물욕', '권욕',
  '견물생심', '탐소실대', '소탐대실', '눈먼돈', '횡재',
  '분수를알다', '지족', '자족', '만족', '감사',
  '무욕', '청빈', '淸廉', '절개', '지조',

  // 지혜·판단
  '선견지명', '혜안', '통찰', '직관', '명찰',
  '일목요연', '핵심파악', '본질', '본말전도', '주객전도',
  '대의명분', '명분과실리', '실사구시', '현실주의', '이상주의',
  '양자택일', '취사선택', '우선순위', '선택과집중', '선택의기술',

  // 소통·설득
  '언변', '웅변', '달변', '눌변', '무언',
  '침묵은금', '말한마디로천냥빚을갚는다', '언어의힘', '말의무게', '화술',
  '경청', '역지사지', '입장바꿔생각하기', '공감', '이해',
  '설득', '협상', '타협', '조율', '합의',

  // 우정·의리
  '의리', '신의', '약속', '믿음', '신뢰',
  '배신', '변절', '배은망덕', '토사구팽', '과하교',
  '진정한친구', '참된우정', '동지', '전우', '동료',
  '상부상조', '협력', '연대', '공동체', '함께',

  // 부모·효도
  '반포지효', '오매불망', '백행지본', '부모은공', '효도',
  '공경', '존경', '어른', '어른공경', '예의',
  '가화만사성', '화목', '가정', '가족', '혈연',

  // 기타 명구
  '천고마비', '春來不似春', '花無十日紅', '月滿則虧', '物極必反',
  '知彼知己', '百戰不殆', '三人行必有我師', '學而時習之', '溫故知新',
];

// ─────────────────────────────────────────────
// IdiomCard 스키마
// ─────────────────────────────────────────────
const IdiomCardSchema = new mongoose.Schema({
  idiom:       { type: String, required: true },   // "사필귀정"
  hanja:       { type: String, default: '' },      // "事必歸正"
  meaning:     { type: String, required: true },   // 뜻풀이
  origin:      { type: String, default: '' },      // 유래
  example:     { type: String, default: '' },      // 예문
  modernUse:   { type: String, default: '' },      // 현대적 활용
  contextType: {
    type: String,
    enum: ['work', 'life'],
    default: 'work',
  },
  tags:        [String],
  used:        { type: Boolean, default: false },
  usedAt:      { type: Date, default: null },
  createdAt:   { type: Date, default: Date.now },
});

IdiomCardSchema.index({ used: 1 });
IdiomCardSchema.index({ idiom: 1, contextType: 1 }, { unique: true });

const IdiomCard = mongoose.model('IdiomCard', IdiomCardSchema);

// ─────────────────────────────────────────────
// 고사성어 카드 생성
// ─────────────────────────────────────────────
const CONTEXT_TYPES = [
  { type: 'work', label: '직장·비즈니스 관점' },
  { type: 'life', label: '일상·인생 관점' },
];

async function generateIdiomCards(idiom) {
  const results = [];

  for (const ctx of CONTEXT_TYPES) {
    const prompt = `
"${idiom}"이라는 고사성어를 "${ctx.label}"에서 풀어줘.

아래 JSON 형식으로만 응답해줘. 다른 텍스트 없이 순수 JSON만:

{
  "hanja": "한자 표기 (모를 경우 빈 문자열)",
  "meaning": "뜻풀이 (1~2문장, 쉽고 명확하게)",
  "origin": "유래 또는 출전 (1~2문장, 없으면 빈 문자열)",
  "example": "예문 (이 고사성어를 쓴 실제 문장 1개)",
  "modernUse": "현대적 활용 (${ctx.label}에서 쓰는 상황 2~3문장, 구체적으로)",
  "tags": ["태그1", "태그2"]
}
    `.trim();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const text  = response.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const data  = JSON.parse(clean);

    results.push({
      idiom,
      hanja:       data.hanja     || '',
      meaning:     data.meaning   || '',
      origin:      data.origin    || '',
      example:     data.example   || '',
      modernUse:   data.modernUse || '',
      contextType: ctx.type,
      tags:        data.tags      || [],
      used:        false,
      usedAt:      null,
    });
  }

  return results;
}

// ─────────────────────────────────────────────
// 딜레이 유틸
// ─────────────────────────────────────────────
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────
// 메인 실행
// ─────────────────────────────────────────────
async function main() {
  console.log('📜 SJ 아카이브 — 고사성어 DB 구축 시작');
  console.log(`총 ${IDIOMS.length}개 × 맥락 2종 = ${IDIOMS.length * 2}개 카드`);
  console.log(`약 ${Math.floor(IDIOMS.length * 2 / 365 * 10) / 10}년치 콘텐츠\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB 연결 완료\n');

  let totalSaved = 0;
  const errors   = [];

  for (let i = 0; i < IDIOMS.length; i++) {
    const idiom    = IDIOMS[i];
    const progress = `[${i + 1}/${IDIOMS.length}]`;

    const existing = await IdiomCard.countDocuments({ idiom });
    if (existing >= 2) {
      console.log(`${progress} ⏭️  "${idiom}" — 이미 존재, 스킵`);
      totalSaved += existing;
      continue;
    }

    try {
      console.log(`${progress} 🔄 "${idiom}" 생성 중...`);
      const cards = await generateIdiomCards(idiom);

      for (const card of cards) {
        await IdiomCard.findOneAndUpdate(
          { idiom: card.idiom, contextType: card.contextType },
          card,
          { upsert: true, new: true }
        );
      }

      totalSaved += cards.length;
      console.log(`${progress} ✅ "${idiom}" — ${cards.length}개 저장`);
      await delay(500);

    } catch (e) {
      console.error(`${progress} ❌ "${idiom}" 실패:`, e.message);
      errors.push({ idiom, error: e.message });
      await delay(2000);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 고사성어 DB 구축 완료');
  console.log('='.repeat(50));
  console.log(`✅ 총 저장 카드: ${totalSaved}개`);
  console.log(`⏱️  약 ${Math.floor(totalSaved / 365 * 10) / 10}년치 콘텐츠`);

  if (errors.length > 0) {
    console.log(`\n⚠️  실패 (${errors.length}개):`);
    errors.forEach(e => console.log(`   - ${e.idiom}: ${e.error}`));
  }

  console.log('='.repeat(50));
  await mongoose.disconnect();
  console.log('\n✅ 완료!');
}

main().catch(e => {
  console.error('💥 오류:', e);
  process.exit(1);
});
