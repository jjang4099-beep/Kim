/* 모든 콘텐츠 DB의 타입별 마지막 id + 개수 스캔 (가이드 "다음 id" 산출용) */
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, '..', '1. 아카이브_mobile', 'public', 'data');

function maxIdOf(items, prefix) {
  const re = new RegExp('^' + prefix + '_(\\d+)$');
  let mx = 0;
  for (const it of items || []) {
    const m = String((it && it.id) || '').match(re);
    if (m) mx = Math.max(mx, parseInt(m[1], 10));
  }
  return mx;
}
function scanDir(dir, specs) {
  const res = {};
  for (const s of specs) res[s.key] = { max: 0, count: 0, prefix: s.prefix, nested: s.nested };
  if (!fs.existsSync(dir)) return res;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const s of specs) {
      if (!Array.isArray(d[s.key])) continue;
      res[s.key].count += d[s.key].length;
      res[s.key].max = Math.max(res[s.key].max, maxIdOf(d[s.key], s.prefix));
      if (s.nested) { // exam_vocab_themes.words[].id = EV_###
        for (const t of d[s.key]) res.__nested = Math.max(res.__nested || 0, maxIdOf(t[s.nested.field], s.nested.prefix));
      }
    }
  }
  return res;
}
const pad = n => String(n).padStart(3, '0');
const k = scanDir(path.join(BASE, 'knowledge_db'), [
  { key: 'english_theme_packs', prefix: 'PACK_EN' },
  { key: 'english_expressions', prefix: 'EN' },
  { key: 'chinese_expressions', prefix: 'ZH' },
  { key: 'idioms_and_quotes',   prefix: 'IQ' },
  { key: 'history_facts',       prefix: 'HI' },
]);
const e = scanDir(path.join(BASE, 'exam_db'), [
  { key: 'exam_vocab_themes', prefix: 'EV_PACK', nested: { field: 'words', prefix: 'EV' } },
  { key: 'exam_history_items', prefix: 'EH' },
]);
const w = scanDir(path.join(BASE, 'work_db'), [
  { key: 'classic_quotes', prefix: 'CLQ' },
  { key: 'idiom_cards',    prefix: 'IDC' },
  { key: 'daily_insights', prefix: 'INS' },
]);
const line = (label, prefix, max, count) => `${label.padEnd(22)} 다음:${prefix}_${pad(max + 1)}  (마지막 ${prefix}_${pad(max)}, 총 ${count})`;
console.log('=== 직장인 knowledge_db ===');
console.log(line('영어 테마팩', 'PACK_EN', k.english_theme_packs.max, k.english_theme_packs.count));
console.log(line('영어 표현', 'EN', k.english_expressions.max, k.english_expressions.count));
console.log(line('중국어 표현', 'ZH', k.chinese_expressions.max, k.chinese_expressions.count));
console.log(line('명언·고사(구버전)', 'IQ', k.idioms_and_quotes.max, k.idioms_and_quotes.count));
console.log(line('역사 상식', 'HI', k.history_facts.max, k.history_facts.count));
console.log('=== 직장인 work_db (오늘 신규) ===');
console.log(line('고전 LIBER', 'CLQ', w.classic_quotes.max, w.classic_quotes.count));
console.log(line('고사성어', 'IDC', w.idiom_cards.max, w.idiom_cards.count));
console.log(line('인사이트', 'INS', w.daily_insights.max, w.daily_insights.count));
console.log('=== 수험생 exam_db ===');
console.log(line('수능 영단어 팩', 'EV_PACK', e.exam_vocab_themes.max, e.exam_vocab_themes.count));
console.log(`${'수능 영단어(단어)'.padEnd(22)} 다음:EV_${pad((e.__nested || 0) + 1)}  (마지막 EV_${pad(e.__nested || 0)})`);
console.log(line('한국사', 'EH', e.exam_history_items.max, e.exam_history_items.count));
