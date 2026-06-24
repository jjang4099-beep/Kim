/**
 * buildInsightDB.js
 * 오늘의 인사이트 DB 구축 스크립트 (1회성 실행)
 * 실행: node scripts/buildInsightDB.js
 *
 * ⚠️ 주의: 반드시 로컬에서 1회만 실행 후 DB 덤프 사용
 * 예상 비용: 약 5,000원 (1회)
 * 예상 카드: 7개 카테고리 × 약 50개 = 350개 (약 1년치)
 * 맥락 변형 × 4 적용 시: 약 1,400개 (약 4년치)
 *
 * 저작권: 학술 개념 자체는 저작권 없음 ✅
 * 특정 저자 문장 직접 인용은 제외하고 개념만 활용
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────
// 인사이트 카테고리 7종
// 요일별 로테이션으로 배달
// ─────────────────────────────────────────────
const INSIGHT_CATEGORIES = [

  // 월요일
  {
    subCategory: 'psychology',
    label: '심리학',
    icon: '🧠',
    color: '#7c3aed',
    dayOfWeek: 1,
    description: '직장인·수험생 일상에 바로 적용 가능한 심리학 개념',
    topics: [
      '확증 편향', '더닝-크루거 효과', '손실 회피', '밴드왜건 효과',
      '후광 효과', '플라시보 효과', '자기효능감', '인지 부조화',
      '사회적 비교', '귀인 오류', '방관자 효과', '점화 효과',
      '정박 효과', '희소성 원리', '상호성 원리', '사회적 증거',
      '소유 효과', '현상 유지 편향', '가용성 휴리스틱', '대표성 휴리스틱',
      '감정 휴리스틱', '매몰 비용 오류', '최신 효과', '초두 효과',
      '선택적 주의', '인지 과부하', '의지력 고갈', '자기 결정 이론',
      '내재적 동기', '외재적 동기', '성장 마인드셋', '고정 마인드셋',
      '심리적 안전감', '몰입(Flow) 상태', '자기 조절', '감정 조절',
      '공감 피로', '번아웃 심리', '레질리언스', '트라우마와 성장',
      '애착 이론', '자아 고갈', '사회적 태만', '링겔만 효과',
      '피그말리온 효과', '스티그마 효과', '자기 실현적 예언', '인상 관리',
    ],
  },

  // 화요일
  {
    subCategory: 'behavioral_economics',
    label: '행동경제학',
    icon: '💹',
    color: '#059669',
    dayOfWeek: 2,
    description: '돈과 선택에 관한 인간의 비이성적 행동 패턴',
    topics: [
      '넛지 이론', '자유주의적 개입주의', '디폴트 옵션 효과',
      '심적 회계', '프레이밍 효과', '시간 할인', '쌍곡형 할인',
      '현재 편향', '제한된 합리성', '만족화 전략', '선택 과부하',
      '결정 피로', '가격 앵커링', '미끼 효과', '타협 효과',
      '선물 교환 이론', '공정성 선호', '이타적 처벌', '신뢰 게임',
      '최후통첩 게임', '공공재 게임', '죄수의 딜레마', '내쉬 균형',
      '보험의 역설', '복권의 역설', '위험 회피', '위험 추구',
      '도박사의 오류', '핫핸드 효과', '회귀 오류', '기저율 무시',
      '소비자 잉여', '가격 민감도', '준거점 의존성', '이익과 손실의 비대칭',
      '사회적 규범 vs 시장 규범', '내재적 가치 훼손', '군중심리와 투자',
      '과잉 자신감', '통제 환상', '계획 오류', '낙관 편향',
    ],
  },

  // 수요일
  {
    subCategory: 'philosophy',
    label: '철학 한 줌',
    icon: '🏛️',
    color: '#92400e',
    dayOfWeek: 3,
    description: '2,500년 철학의 정수를 3분 안에',
    topics: [
      '소크라테스의 무지의 지', '플라톤의 이데아론', '아리스토텔레스의 중용',
      '에픽테토스의 통제 이분법', '스토아의 아파테이아', '에피쿠로스의 쾌락',
      '공리주의', '의무론적 윤리학', '덕 윤리학', '실존주의',
      '허무주의와 초월', '니체의 힘에의 의지', '사르트르의 실존',
      '하이데거의 존재', '현상학', '해석학', '구조주의',
      '후기구조주의', '포스트모더니즘', '프래그머티즘',
      '칸트의 정언명령', '벤담의 최대 행복', '밀의 자유론',
      '롤스의 정의론', '노직의 자유지상주의', '공동체주의',
      '마르크스의 소외', '헤겔의 변증법', '쇼펜하우어의 의지',
      '버트런드 러셀의 회의주의', '비트겐슈타인의 언어게임',
      '푸코의 권력-지식', '데리다의 해체', '들뢰즈의 차이',
      '한나 아렌트의 악의 평범성', '시몬 드 보부아르의 타자',
      '알튀세르의 이데올로기', '그람시의 헤게모니',
      '공자의 인(仁)', '노자의 무위', '불교의 공(空)',
      '선불교의 화두', '유교의 격물치지',
    ],
  },

  // 목요일
  {
    subCategory: 'sociology_org',
    label: '조직·사회학',
    icon: '🏢',
    color: '#0891b2',
    dayOfWeek: 4,
    description: '조직과 사회를 움직이는 보이지 않는 법칙',
    topics: [
      '파킨슨의 법칙', '피터의 원리', '파레토 법칙',
      '멱함수 법칙', '티핑 포인트', '약한 연대의 강함',
      '구조적 공백', '사회 자본', '신뢰와 협력',
      '집단 지성', '집단 사고', '동조 압력',
      '권위에 대한 복종', '밀그램 실험', '스탠퍼드 감옥 실험',
      '아이히만 효과', '악의 평범성', '도덕적 해이',
      '정보 비대칭', '역선택', '주인-대리인 문제',
      '게임 이론과 협력', '반복 게임', '평판 효과',
      '제도 경제학', '경로 의존성', '잠금 효과',
      '네트워크 외부성', '임계 다수', '플랫폼 효과',
      '혁신 확산 이론', '얼리어답터', '캐즘 이론',
      '창조적 파괴', '기술 혁명 사이클', '산업 생태계',
      '조직 학습', '단일·이중 루프 학습', '심리적 안전감',
      '애자일 조직', '홀라크라시', '자기조직화',
      '번아웃과 조직문화', '침묵 효과', '내부 고발',
    ],
  },

  // 금요일
  {
    subCategory: 'neuroscience',
    label: '뇌과학·인지',
    icon: '⚡',
    color: '#4f46e5',
    dayOfWeek: 5,
    description: '뇌가 작동하는 방식을 알면 삶이 달라진다',
    topics: [
      '시스템 1과 시스템 2 사고', '작업 기억', '장기 기억',
      '절차 기억', '일화 기억', '의미 기억',
      '수면과 기억 공고화', '망각 곡선', '간격 반복 효과',
      '인출 연습 효과', '교차 학습', '다감각 학습',
      '뇌의 가소성', '임계기', '미엘린화',
      '도파민 보상 회로', '세로토닌과 기분', '코르티솔과 스트레스',
      '편도체 하이재킹', '전두엽과 충동 조절', '거울 뉴런',
      '공감의 신경과학', '의사결정의 뇌과학', '위험 인식',
      '집중력과 주의', '디폴트 모드 네트워크', '마음 방황',
      '마음챙김의 신경과학', '명상의 효과', '호흡과 자율신경',
      '운동과 뇌', 'BDNF와 학습', '수면 부족의 영향',
      '멀티태스킹의 신화', '딥워크의 신경과학', '창의성의 뇌과학',
      '음악과 뇌', '언어 처리', '은유적 사고',
      '노화와 인지', '신경발달장애', '뇌의 취약성과 회복력',
    ],
  },

  // 토요일
  {
    subCategory: 'history_figure',
    label: '역사 속 인물',
    icon: '👑',
    color: '#b45309',
    dayOfWeek: 6,
    description: '역사를 바꾼 사람들의 결정적 순간',
    topics: [
      '줄리어스 시저의 루비콘 결단', '아우구스투스의 제국 설계',
      '알렉산더 대왕의 동방 원정', '한니발의 알프스 전략',
      '칭기즈칸의 정보 시스템', '쿠빌라이 칸의 관용 정책',
      '이순신의 역발상 전략', '세종대왕의 집현전',
      '나폴레옹의 속도전', '비스마르크의 현실 정치',
      '링컨의 팀 오브 라이벌', '처칠의 수사학',
      '루스벨트의 뉴딜', '케인스의 위기 대응',
      '레오나르도 다빈치의 융합적 사고', '미켈란젤로의 집착',
      '갈릴레이의 용기', '뉴턴의 사과',
      '아인슈타인의 상상력', '퀴리 부인의 집념',
      '에디슨의 실패 철학', '테슬라의 비극',
      '스티브 잡스의 현실 왜곡장', '빌 게이츠의 독서법',
      '워런 버핏의 인내', '찰리 멍거의 역발상',
      '피터 드러커의 경영 통찰', '데밍의 품질 혁명',
      '마키아벨리의 현실주의', '토마스 모어의 이상주의',
      '간디의 비폭력', '만델라의 용서',
      '마틴 루터 킹의 꿈', '로자 파크스의 거부',
      '플로렌스 나이팅게일의 데이터', '마리 퀴리의 개척',
    ],
  },

  // 일요일
  {
    subCategory: 'data_world',
    label: '숫자로 본 세상',
    icon: '📊',
    color: '#0f766e',
    dayOfWeek: 0,
    description: '데이터와 통계가 말해주는 세상의 진실',
    topics: [
      '생존자 편향의 함정', '심슨의 역설', '상관관계 vs 인과관계',
      '표본 편향', 'p-해킹', '재현성 위기',
      '베이즈 정리', '조건부 확률', '몬티 홀 문제',
      '생일 역설', '6단계 분리 이론', '멱함수 분포',
      '정규 분포의 함정', '블랙 스완', '두꺼운 꼬리',
      '회귀 평균', '자연 실험', '무작위 대조 실험',
      'GDP의 한계', '지니 계수', '빈곤의 측정',
      '행복 경제학', '국민 행복 지수', '에스테르 뒤플로의 빈곤 연구',
      '세계 불평등의 현실', '픽케티의 r>g', '부의 세습',
      '인구 전환 이론', '인구 절벽', '고령화 경제',
      '기후 데이터 읽기', '탄소 발자국 계산', '에너지 전환 속도',
      '기술 수용 곡선', 'S커브 성장', '지수 성장의 직관',
      '무어의 법칙', '수확 체감의 법칙', '네트워크 효과 측정',
      '광고 효과 측정', 'A/B 테스트', '코호트 분석',
    ],
  },
];

// ─────────────────────────────────────────────
// DailyInsight 스키마
// ─────────────────────────────────────────────
const DailyInsightSchema = new mongoose.Schema({
  subCategory:  { type: String, required: true },  // 'psychology' 등
  label:        { type: String, required: true },  // '심리학'
  icon:         { type: String, default: '💡' },
  color:        { type: String, default: '#6b7280' },
  dayOfWeek:    { type: Number, default: -1 },     // 0=일 ~ 6=토, -1=무작위

  topic:        { type: String, required: true },  // '확증 편향'
  headline:     { type: String, required: true },  // 한 줄 훅
  body:         { type: String, required: true },  // 본문 (3~5문장)
  realLife:     { type: String, required: true },  // 실생활 적용 예시
  question:     { type: String, default: '' },     // 오늘의 생각 질문

  // 맥락 변형 (같은 개념 다른 각도)
  contextType: {
    type: String,
    enum: ['work', 'study', 'relationship', 'money'],
    default: 'work',
  },

  tags:         [String],
  targetMode:   {
    type: String,
    enum: ['work', 'exam', 'both'],
    default: 'both',
  },

  used:         { type: Boolean, default: false },
  usedAt:       { type: Date, default: null },
  createdAt:    { type: Date, default: Date.now },
});

DailyInsightSchema.index({ used: 1, subCategory: 1, dayOfWeek: 1 });
DailyInsightSchema.index({ topic: 1, contextType: 1 }, { unique: true });

const DailyInsight = mongoose.model('DailyInsight', DailyInsightSchema);

// ─────────────────────────────────────────────
// 인사이트 생성 함수
// ─────────────────────────────────────────────
const CONTEXT_TYPES = [
  { type: 'work',         label: '직장·업무 관점' },
  { type: 'study',        label: '공부·학습 관점' },
  { type: 'relationship', label: '인간관계·소통 관점' },
  { type: 'money',        label: '돈·경제·투자 관점' },
];

async function generateInsightsForTopic(category, topic) {
  const results = [];

  for (const ctx of CONTEXT_TYPES) {
    const prompt = `
너는 복잡한 개념을 3분 안에 이해시키는 세계 최고의 지식 큐레이터야.
"${topic}"이라는 개념을 "${ctx.label}"에서 풀어줘.

아래 조건을 반드시 지켜줘:
- 독자: 바쁜 한국 직장인 또는 수험생
- 톤: 너무 학술적이지 않게, 하지만 깊이 있게
- 첫 문장은 반드시 호기심을 자극하는 훅으로 시작
- 실생활 예시는 한국 직장/학교 상황으로

아래 JSON 형식으로만 응답해줘.
다른 텍스트, 마크다운 없이 순수 JSON 객체만:

{
  "headline": "오늘의 인사이트 제목 한 줄 (20자 이내, 임팩트 있게)",
  "body": "본문 설명 (3~5문장, 개념 설명 + 왜 중요한지)",
  "realLife": "실생활 적용 예시 (2~3문장, 구체적인 한국 상황)",
  "question": "오늘 하루 생각해볼 질문 1개 (독자가 스스로 돌아볼 수 있게)",
  "tags": ["태그1", "태그2", "태그3"],
  "targetMode": "work 또는 exam 또는 both"
}
    `.trim();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text  = response.content[0].text.trim();
    const clean = text.replace(/```json|```/g, '').trim();
    const data  = JSON.parse(clean);

    results.push({
      subCategory:  category.subCategory,
      label:        category.label,
      icon:         category.icon,
      color:        category.color,
      dayOfWeek:    category.dayOfWeek,
      topic,
      headline:     data.headline,
      body:         data.body,
      realLife:     data.realLife,
      question:     data.question || '',
      contextType:  ctx.type,
      tags:         data.tags || [],
      targetMode:   data.targetMode || 'both',
      used:         false,
      usedAt:       null,
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
  console.log('💡 SJ 아카이브 — 오늘의 인사이트 DB 구축 시작');

  const totalTopics = INSIGHT_CATEGORIES.reduce((acc, c) => acc + c.topics.length, 0);
  const totalCards  = totalTopics * 4; // 맥락 4종
  console.log(`총 ${INSIGHT_CATEGORIES.length}개 카테고리`);
  console.log(`총 ${totalTopics}개 주제 × 맥락 4종 = ${totalCards}개 카드`);
  console.log(`약 ${Math.floor(totalCards / 365 * 10) / 10}년치 콘텐츠\n`);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ MongoDB 연결 완료\n');

  let totalSaved = 0;
  const errors   = [];

  for (const category of INSIGHT_CATEGORIES) {
    console.log(`\n📂 [${category.label}] 카테고리 시작 (${category.topics.length}개 주제)`);

    for (let i = 0; i < category.topics.length; i++) {
      const topic    = category.topics[i];
      const progress = `  [${i + 1}/${category.topics.length}]`;

      // 이미 처리된 주제면 스킵
      const existing = await DailyInsight.countDocuments({
        subCategory: category.subCategory,
        topic,
      });
      if (existing >= 4) {
        console.log(`${progress} ⏭️  "${topic}" — 이미 존재, 스킵`);
        totalSaved += existing;
        continue;
      }

      try {
        console.log(`${progress} 🔄 "${topic}" 생성 중...`);
        const insights = await generateInsightsForTopic(category, topic);

        // 중복 제거 후 삽입
        for (const insight of insights) {
          await DailyInsight.findOneAndUpdate(
            { topic: insight.topic, contextType: insight.contextType },
            insight,
            { upsert: true, new: true }
          );
        }

        totalSaved += insights.length;
        console.log(`${progress} ✅ "${topic}" — ${insights.length}개 카드 저장`);

        await delay(800);

      } catch (e) {
        console.error(`${progress} ❌ "${topic}" 실패:`, e.message);
        errors.push({ category: category.label, topic, error: e.message });
        await delay(2000);
      }
    }
  }

  // ─── 최종 결과 ───
  console.log('\n' + '='.repeat(55));
  console.log('📊 오늘의 인사이트 DB 구축 완료');
  console.log('='.repeat(55));
  console.log(`✅ 총 저장 카드: ${totalSaved}개`);
  console.log(`📅 배달 가능일: 약 ${totalSaved}일 (1일 1카드 기준)`);
  console.log(`⏱️  약 ${Math.floor(totalSaved / 365 * 10) / 10}년치 콘텐츠`);

  // 카테고리별 통계
  console.log('\n📈 카테고리별 구성:');
  for (const cat of INSIGHT_CATEGORIES) {
    const count = await DailyInsight.countDocuments({ subCategory: cat.subCategory });
    console.log(`   ${cat.icon} ${cat.label}: ${count}개`);
  }

  if (errors.length > 0) {
    console.log(`\n⚠️  실패 항목 (${errors.length}개):`);
    errors.forEach(e => console.log(`   - [${e.category}] ${e.topic}: ${e.error}`));
  }

  console.log('='.repeat(55));
  await mongoose.disconnect();
  console.log('\n✅ 완료! 다음 단계: server.js에 generateInsightFeed() 추가');
}

main().catch(e => {
  console.error('💥 치명적 오류:', e);
  process.exit(1);
});
