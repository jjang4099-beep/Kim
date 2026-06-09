/**
 * SJ 지식 서재 — app.js v3
 * 서가형 UI, 타임머신, 통찰 카드, 연말 결산 모달 완전 재구축
 */

'use strict';

const API = 'http://localhost:3000/api';

// ══════════════════════════════════════════════
//  메타데이터
// ══════════════════════════════════════════════

// SHELF_META는 서버에서 동적으로 로드 (아래 loadCategories 참조)
let SHELF_META = {
  all: { label: 'All', icon: 'ti-books', color: '#374151', kr: '전체' },
};

const RANK_MARKS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'];

// ══════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════

const state = { shelf: 'all', items: [], activeTag: null, subCategory: null };

// ══════════════════════════════════════════════
//  API 헬퍼
// ══════════════════════════════════════════════

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ══════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════

function esc(s = '') {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * 간단한 마크다운 → HTML 변환기
 * 지원: ## 헤더, **볼드**, - 목록, 1. 숫자목록, 빈줄=단락
 */
/** 마크다운 기호를 제거해 카드 미리보기용 평문으로 변환 */
function stripMd(md = '') {
  return String(md)
    .replace(/\\n/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mdToHtml(md = '') {
  if (!md) return '';
  const lines = md.replace(/\\n/g, '\n').split('\n');
  const out = [];
  let inUl = false, inOl = false;

  const closeList = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  const inlineFormat = s =>
    s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
     .replace(/\*(.+?)\*/g, '<em>$1</em>')
     .replace(/`(.+?)`/g, '<code>$1</code>');

  for (let raw of lines) {
    const line = raw.trimEnd();

    // ## 헤더
    if (/^###\s/.test(line)) {
      closeList();
      out.push(`<h4 class="md-h4">${inlineFormat(esc(line.slice(4)))}</h4>`);
    } else if (/^##\s/.test(line)) {
      closeList();
      out.push(`<h3 class="md-h3">${inlineFormat(esc(line.slice(3)))}</h3>`);
    } else if (/^#\s/.test(line)) {
      closeList();
      out.push(`<h2 class="md-h2">${inlineFormat(esc(line.slice(2)))}</h2>`);

    // 순서 없는 목록: - 또는 *
    } else if (/^[-*]\s/.test(line)) {
      if (!inUl) { closeList(); out.push('<ul class="md-ul">'); inUl = true; }
      out.push(`<li>${inlineFormat(esc(line.slice(2)))}</li>`);

    // 순서 있는 목록: 1. 2. 등
    } else if (/^\d+\.\s/.test(line)) {
      if (!inOl) { closeList(); out.push('<ol class="md-ol">'); inOl = true; }
      out.push(`<li>${inlineFormat(esc(line.replace(/^\d+\.\s/, '')))}</li>`);

    // 빈 줄
    } else if (line.trim() === '') {
      closeList();
      out.push('<div class="md-gap"></div>');

    // 일반 단락
    } else {
      closeList();
      out.push(`<p class="md-p">${inlineFormat(esc(line))}</p>`);
    }
  }
  closeList();
  return out.join('');
}

function fmtDate(ds = '') {
  if (!ds) return '';
  const [y,m,d] = ds.split('-').map(Number);
  const dt   = new Date(y, m-1, d);
  const days = ['일','월','화','수','목','금','토'];
  const today = new Date();
  if (ds === `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`)
    return '오늘';
  return `${m}월 ${d}일 (${days[dt.getDay()]})`;
}

function el(id) { return document.getElementById(id); }

// ══════════════════════════════════════════════
//  운동 링 업데이트
// ══════════════════════════════════════════════

const MOTIVATIONS = [
  '지식을 서재에 꽂아 보세요', '첫 권이 꽂혔습니다',
  '서재가 채워지고 있습니다', '오늘의 독서가 깊어집니다',
  '지식의 건축이 계속됩니다 📚', '목표에 다가가고 있습니다',
  '서재가 빛을 발합니다 ✨', '오늘의 지식 운동 완성! 🏆'
];

function updateRing(count) {
  const GOAL   = 10, CIRC = 138.2;
  const pct    = Math.min(count / GOAL, 1);
  const ring   = el('ringFill');
  if (ring) {
    ring.style.strokeDashoffset = CIRC * (1 - pct);
    ring.style.stroke = count >= GOAL ? '#d4a820' : 'var(--mahogany)';
  }
  if (el('todayNum')) el('todayNum').textContent = count;
  if (el('wkSub'))   el('wkSub').textContent    = MOTIVATIONS[Math.min(Math.floor(count/1.5), MOTIVATIONS.length-1)];
}

// ══════════════════════════════════════════════
//  잔디 렌더링
// ══════════════════════════════════════════════

function renderGrass(grassData) {
  const grid = el('grassGrid');
  if (!grid) return;
  grid.innerHTML = '';
  (grassData || []).forEach(({ date, count }) => {
    const cell = document.createElement('div');
    cell.className = 'grass-cell';
    cell.title = `${date} · ${count}개`;
    const lv = count === 0 ? 0 : count <= 2 ? 1 : count <= 4 ? 2 : 3;
    if (lv) cell.dataset.lv = lv;
    grid.appendChild(cell);
  });
}

// ══════════════════════════════════════════════
//  통계 업데이트
// ══════════════════════════════════════════════

function updateStats(stats) {
  const { todayCount=0, weekCount=0, streak=0, total=0, shelfCounts={}, subCounts={}, grassData=[] } = stats;
  updateRing(todayCount);
  if (el('msWeek'))   el('msWeek').textContent   = weekCount;
  if (el('msTotal'))  el('msTotal').textContent  = total;
  if (el('msStreak')) el('msStreak').textContent = streak;
  if (el('streakNum')) el('streakNum').textContent = streak;
  // 사이드바 트리 카운트용 맵 저장 후 재렌더
  Library._shelfCounts = shelfCounts;
  Library._subCounts   = subCounts;
  if (Library._categories) Library._renderSidebar(Library._categories);
  renderGrass(grassData);
}

// ══════════════════════════════════════════════
//  서가 렌더링 (핵심)
// ══════════════════════════════════════════════

// ── 영어 단어장 카드 (flashcard blur 효과) ─────────────────
function enVocabCardHTML(item, featured = false) {
  const m         = SHELF_META.en || { label: '영어', icon: 'ti-language', color: '#0EA5E9' };
  const entries   = (item.extras?.vocabEntries || []).slice(0, 3);
  const hasInsight = item.myInsight && item.myInsight.trim().length > 0;

  const entriesHTML = entries.map((e, i) => `
    <div class="vocab-entry">
      <div class="vocab-expression">${esc(e.expression || '')}</div>
      <div class="vocab-meaning blurred"
        onclick="event.stopPropagation();this.classList.toggle('revealed')"
        title="탭하여 뜻 확인">
        <span class="vocab-meaning-text">${esc(e.meaning || '')}</span>
        <span class="vocab-reveal-hint">탭하여 확인</span>
      </div>
      ${e.sourceSentence ? `<div class="vocab-source">${esc(e.sourceSentence)}</div>` : ''}
    </div>`).join('');

  const noEntries = !entries.length
    ? `<div class="vocab-no-entries">${esc((item.aiSummary || item.summary || item.text || '').slice(0, 100))}</div>`
    : '';

  const tagsHTML = (item.tags||[]).length
    ? `<div class="book-tags">${(item.tags||[]).slice(0,4)
        .map(t=>`<span class="book-tag" onclick="event.stopPropagation();Library.filterByTag('${esc(t)}')">${esc(t)}</span>`)
        .join('')}</div>` : '';

  return `
  <article class="book-card en vocab-card${featured ? ' featured' : ''}${hasInsight ? ' has-insight' : ''}"
    data-id="${esc(item.id)}" tabindex="0"
    onclick="Library.openGraph('${esc(item.id)}')" style="cursor:pointer">
    <div class="book-spine"></div>
    <div class="book-inner">
      <div class="book-cat en">
        <i class="ti ti-language" aria-hidden="true"></i> 단어장
        <span class="vocab-count-badge">${entries.length}개 표현</span>
      </div>
      ${hasInsight ? `<div class="card-hero is-insight">${esc(item.myInsight)}</div>` : ''}
      <div class="vocab-entries-list">${entriesHTML}${noEntries}</div>
      ${tagsHTML}
      <div class="book-footer">
        <span class="book-date">${fmtDate(item.date)}</span>
        <div class="book-actions">
          <button class="book-btn" title="복사" onclick="event.stopPropagation();Library.copyItem('${esc(item.id)}',this)" aria-label="복사"><i class="ti ti-copy"></i></button>
          <button class="book-btn del" title="삭제" onclick="event.stopPropagation();Library.deleteItem('${esc(item.id)}')" aria-label="삭제"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    </div>
  </article>`;
}

// aiAnalysis(우선)/aiSummary에서 '📌 핵심 요약' 단락만 추출 → 카드 미리보기용 평문
function extractCoreSummary(item) {
  const md = item.aiAnalysis || item.aiSummary || '';
  if (md) {
    const norm = String(md).replace(/\\n/g, '\n');
    const parts = norm.split(/^##\s+/m);
    for (const p of parts) {
      const nl = p.indexOf('\n');
      if (nl === -1) continue;
      if (/핵심\s*요약|요약|Executive/i.test(p.slice(0, nl))) {
        const body = stripMd(p.slice(nl + 1)).trim();
        if (body) return body;
      }
    }
    const flat = stripMd(md).trim();
    if (flat) return flat;
  }
  return item.summary || '';
}

// 카드 좌측 시각 영역 (썸네일 / 플레이 오버레이 / 그라데이션 폴백)
function cardVisualHTML(item, m, isYoutube) {
  const grad = `linear-gradient(135deg, ${esc(m.color)} 0%, ${esc(m.color)}aa 100%)`;
  const fallback = `<div class="card-visual-bg" style="background:${grad}"><i class="ti ${esc(m.icon)}"></i></div>`;
  const thumb = item.thumbnailUrl
    ? `<img class="card-thumb" src="${esc(item.thumbnailUrl)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : '';
  const play = isYoutube ? `<span class="card-play"><i class="ti ti-player-play-filled"></i></span>` : '';
  return `<div class="card-visual${isYoutube ? ' is-video' : ''}${item.thumbnailUrl ? '' : ' no-thumb'}">${fallback}${thumb}${play}</div>`;
}

// ── 메인 타임라인 카드 (좌측 시각 + 우측 텍스트, 유튜브 피드 스타일) ──
function bookCardHTML(item, featured = false) {
  // 영어 단어장 카드 분기
  if (item.category === 'en' && item.extras?.vocabEntries?.length) {
    return enVocabCardHTML(item, featured);
  }

  const m       = SHELF_META[item.category] || SHELF_META.inbox;
  const isUrl   = item.type === 'url' && item.originalUrl;
  const isYoutube = item.category === 'youtube' || /youtube\.com|youtu\.be/i.test(item.originalUrl || '');
  const hasInsight = item.myInsight && item.myInsight.trim().length > 0;

  const title = item.title || (item.text || '').split('\n')[0].slice(0, 80) || '(제목 없음)';

  // 핵심 요약 미리보기 (백그라운드 분석 결과)
  let summaryPreview = extractCoreSummary(item);
  if (!summaryPreview && item.analysisStatus === 'pending') summaryPreview = '⚙️ AI 사서가 분석 중입니다…';

  // 출처 (도메인)
  let domain = '';
  if (isUrl) { try { domain = new URL(item.originalUrl).hostname.replace('www.', ''); } catch {} }

  const tagsHTML = (item.tags||[]).length
    ? `<div class="book-tags">${(item.tags||[]).slice(0,5)
        .map(t=>`<span class="book-tag" onclick="event.stopPropagation();Library.filterByTag('${esc(t)}')">${esc(t)}</span>`)
        .join('')}</div>` : '';

  return `
  <article class="book-card ${esc(item.category)}${isUrl ? ' is-url' : ''}${featured ? ' featured' : ''}${hasInsight ? ' has-insight' : ''}" data-id="${esc(item.id)}" tabindex="0"
    onclick="Library.openGraph('${esc(item.id)}')" style="cursor:pointer">
    <div class="book-spine"></div>
    <div class="card-body">
      ${cardVisualHTML(item, m, isYoutube)}
      <div class="book-inner">
        <div class="book-cat ${esc(item.category)}">
          <i class="ti ${esc(m.icon)}" aria-hidden="true"></i> ${esc(m.label)}
          ${item.subCategory ? `<span class="book-subcat"><i class="ti ti-point-filled"></i>${esc(item.subCategory)}</span>` : ''}
        </div>
        <h3 class="card-title">${esc(title)}</h3>
        ${hasInsight ? `<div class="card-myinsight"><i class="ti ti-bulb"></i> ${esc(item.myInsight)}</div>` : ''}
        ${summaryPreview ? `<div class="card-summary-preview">${esc(summaryPreview)}</div>` : ''}
        ${domain ? `<a class="card-source-link" href="${esc(item.originalUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()"><i class="ti ti-external-link"></i>${esc(domain)}</a>` : ''}
        ${tagsHTML}
        <div class="book-footer">
          <span class="book-date">${fmtDate(item.date)}</span>
          <div class="book-actions">
            <button class="book-btn" title="복사" onclick="event.stopPropagation();Library.copyItem('${esc(item.id)}',this)" aria-label="복사"><i class="ti ti-copy"></i></button>
            <button class="book-btn del" title="삭제" onclick="event.stopPropagation();Library.deleteItem('${esc(item.id)}')" aria-label="삭제"><i class="ti ti-trash"></i></button>
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

// ── Inbox 카드 (미처리, 클릭하면 Insight 편집기 오픈) ──
function inboxCardHTML(item) {
  const isUrl = item.type === 'url' && item.originalUrl;
  const preview = (item.aiSummary || item.summary || item.text || '').slice(0, 120);
  const domain  = isUrl ? (() => { try { return new URL(item.originalUrl).hostname.replace('www.',''); } catch(e) { return ''; } })() : '';

  return `
  <article class="inbox-card" data-id="${esc(item.id)}" tabindex="0"
    onclick="Library.openInboxProcess('${esc(item.id)}')" style="cursor:pointer">
    <div class="inbox-card-top">
      <span class="inbox-badge">미처리</span>
      ${domain ? `<span class="inbox-domain"><i class="ti ti-world"></i>${esc(domain)}</span>` : ''}
      <span class="inbox-time">${fmtDate(item.date)}</span>
      <button class="inbox-discard" title="폐기하기"
        onclick="event.stopPropagation();Library.discardInbox('${esc(item.id)}')" aria-label="폐기하기">
        <i class="ti ti-trash"></i>
      </button>
    </div>
    <div class="inbox-preview">${esc(preview)}${preview.length >= 120 ? '…' : ''}</div>
    ${isUrl ? `<a class="inbox-url" href="${esc(item.originalUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
      <i class="ti ti-external-link"></i>${esc(item.title || item.originalUrl).slice(0,60)}
    </a>` : ''}
    <div class="inbox-cta"><i class="ti ti-pencil"></i> 내 생각을 더해 지식으로 승인하기</div>
  </article>`;
}

function groupByShelf(items) {
  const groups = {};
  items.forEach(item => {
    const s = item.shelf || item.category || 'inbox';
    if (!groups[s]) groups[s] = [];
    groups[s].push(item);
  });
  return groups;
}

const SHELF_ORDER = ['en','history','economy','youtube','inbox'];

// 날짜 레이블 포맷
function dateLabel(dateStr) {
  const today     = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const d         = new Date(dateStr); d.setHours(0,0,0,0);
  if (d.getTime() === today.getTime())     return '🗓️ 오늘';
  if (d.getTime() === yesterday.getTime()) return '🗓️ 어제';
  return `🗓️ ${d.getFullYear()}년 ${String(d.getMonth()+1).padStart(2,'0')}월 ${String(d.getDate()).padStart(2,'0')}일`;
}

// items → { 'YYYY-MM-DD': [...items] } 로 그룹화 (최신일 먼저)
function groupByDate(items) {
  const map = {};
  items.forEach(item => {
    const key = (item.date || item.createdAt?.slice(0,10) || 'unknown');
    if (!map[key]) map[key] = [];
    map[key].push(item);
  });
  return Object.entries(map).sort((a,b) => b[0].localeCompare(a[0]));
}

// 날짜 그룹 HTML 생성 (첫 카드는 featured)
function dateGroupsHTML(items) {
  if (!items.length) return '';
  const groups = groupByDate(items);
  return groups.map(([date, its]) => {
    const [first, ...rest] = its;
    const featuredHTML = bookCardHTML(first, true);
    const restHTML = rest.map(i => bookCardHTML(i, false)).join('');
    return `
    <div class="date-group">
      <div class="date-header">${dateLabel(date)} <span class="date-count">${its.length}개</span></div>
      <div class="book-grid featured-grid">
        ${featuredHTML}
        ${restHTML}
      </div>
    </div>`;
  }).join('');
}

function renderBookshelf(items) {
  const shelf = el('bookshelf');
  if (!shelf) return;

  // ── Inbox 탭: 미처리 항목 전용 렌더링 ──
  if (state.shelf === 'inbox') {
    renderInboxShelf(items);
    return;
  }

  if (!items.length) {
    shelf.innerHTML = `
      <div class="shelf-empty">
        <i class="ti ti-books"></i>
        <p>서재가 비어 있습니다</p>
        <span>지식을 추가하고, Inbox에서 내 생각을 더해 서재에 꽂아 보세요</span>
      </div>`;
    return;
  }

  let html = '';

  if (state.shelf === 'all') {
    html = dateGroupsHTML(items);
  } else {
    const m = SHELF_META[state.shelf] || SHELF_META.inbox;
    html = `
      <div class="shelf-section-header">
        <span class="shelf-plaque ${state.shelf}" style="background:${esc(m.color||'#6B7280')}">${esc(m.label)}</span>
        <div class="shelf-bar"></div>
        <span class="shelf-count">${items.length}개</span>
      </div>
      ${dateGroupsHTML(items)}`;
  }

  shelf.innerHTML = html;
}

// Inbox 전용 렌더러
function renderInboxShelf(items) {
  const shelf = el('bookshelf');
  if (!shelf) return;

  if (!items.length) {
    shelf.innerHTML = `
      <div class="shelf-empty">
        <i class="ti ti-inbox"></i>
        <p>Inbox가 비어 있습니다</p>
        <span>새로 저장된 내용이 여기에 쌓입니다.<br>내 생각을 더해 지식으로 승인해 보세요.</span>
      </div>`;
    return;
  }

  shelf.innerHTML = `
    <div class="inbox-header">
      <i class="ti ti-inbox"></i>
      <span>미처리 항목 <strong>${items.length}개</strong></span>
      <span class="inbox-header-hint">클릭하면 내 생각을 더해 지식으로 승인할 수 있습니다</span>
    </div>
    <div class="inbox-list">${items.map(inboxCardHTML).join('')}</div>`;
}

// ══════════════════════════════════════════════
//  타임머신 위젯
// ══════════════════════════════════════════════

async function renderTimeMachine(items) {
  const list = el('tmList');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div class="tm-empty"><i class="ti ti-hourglass-empty"></i><p>7일 이전의 지식이 없습니다<br>기록이 쌓이면 나타납니다</p></div>`;
    return;
  }

  list.innerHTML = items.map(item => {
    const m = SHELF_META[item.category] || SHELF_META.inbox;
    return `
    <div class="tm-item">
      <div class="tm-item-cat ${item.category}">
        <i class="ti ${m.icon}" aria-hidden="true"></i> ${esc(m.kr)}
      </div>
      <div class="tm-item-text">${esc(item.text)}</div>
      <div class="tm-item-date">${esc(item.date)}</div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
//  통찰 패널
// ══════════════════════════════════════════════

async function loadInsights() {
  try {
    const data = await api('/insights?limit=3');
    const list = el('ipList');
    if (!list) return;
    if (!data.insights?.length) return;

    list.innerHTML = data.insights.map(ins => `
      <div class="ip-item">
        <div class="ip-item-title">${esc(ins.title)}</div>
        <div class="ip-item-body">${esc(ins.body)}</div>
        <div class="ip-item-date">${esc(ins.createdAt?.slice(0,10) || '')}</div>
      </div>`).join('');

    // 최신 통찰을 메인 배너에 표시
    const latest = data.insights[0];
    if (latest) {
      el('ibTitle').textContent = latest.title;
      el('ibBody').textContent  = latest.body;
      el('insightBanner').hidden = false;
    }
  } catch { /* 통찰 없으면 조용히 패스 */ }
}

// ══════════════════════════════════════════════
//  스켈레톤
// ══════════════════════════════════════════════

function showSkeleton() {
  const shelf = el('bookshelf');
  if (shelf) shelf.innerHTML = Array(6).fill(`<div class="skeleton sk-card"></div>`).join('');
}

// ══════════════════════════════════════════════
//  연말 결산 도넛 차트
// ══════════════════════════════════════════════

function drawDonut(canvasId, slices) {
  const canvas = el(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = 70, cy = 70, ro = 58, ri = 34;

  ctx.clearRect(0, 0, 140, 140);
  const total = slices.reduce((s, x) => s + x.v, 0);
  if (!total) return;

  let angle = -Math.PI / 2;
  slices.forEach(s => {
    const sweep = (s.v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, ro, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = s.c;
    ctx.fill();
    angle += sweep;
  });

  // 구멍
  ctx.beginPath();
  ctx.arc(cx, cy, ri, 0, Math.PI * 2);
  ctx.fillStyle = 'var(--cream, #fffdf7)';
  ctx.fill();

  // 중앙 텍스트
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5c3d2e';
  ctx.font = `700 18px 'Noto Serif KR', serif`;
  ctx.fillText(total, cx, cy + 4);
  ctx.fillStyle = '#8a7a68';
  ctx.font = `400 10px 'DM Sans', sans-serif`;
  ctx.fillText('총 저장', cx, cy + 16);
}

// ══════════════════════════════════════════════
//  Library 컨트롤러
// ══════════════════════════════════════════════

const Library = {

  async init() {
    showSkeleton();
    await this.loadCategories();
    await this.refresh();
    await this.loadTags();
    Library.loadTimeMachine();
    loadInsights();
    Library._initReportDates(); // 보고서 기간 피커 기본값(최근 7일)
    Library._checkFeedBadge();  // 지식 배달 메뉴 배지(읽지 않은 피드 수)
  },

  // ── 카테고리 동적 로드 ────────────────────────
  async loadCategories() {
    try {
      const data = await api('/categories');
      const cats = data.categories || [];
      // SHELF_META 재구성
      SHELF_META = { all: { label: 'All', icon: 'ti-books', color: '#374151', kr: '전체' } };
      cats.forEach(c => {
        SHELF_META[c.id] = { label: c.label, icon: c.icon || 'ti-folder', color: c.color || '#6B7280', kr: c.label };
      });
      this._categories = cats;
      this._renderTabs(cats);
      this._renderSidebar(cats);
    } catch (e) { console.warn('카테고리 로드 실패', e); }
  },

  _renderTabs(cats) {
    const nav = document.querySelector('.topbar-nav');
    if (!nav) return;
    nav.innerHTML = `
      <button class="shelf-tab ${state.shelf==='all'?'active':''}" data-shelf="all" onclick="Library.selectShelf(this)">All</button>
      ${cats.map(c => `
        <button class="shelf-tab ${state.shelf===c.id?'active':''}" data-shelf="${esc(c.id)}" onclick="Library.selectShelf(this)">${esc(c.label)}</button>
      `).join('')}
      <button class="shelf-tab shelf-tab-feed" onclick="Library.openDailyFeedView()" title="오늘의 지식 배달">🎁 지식 배달</button>
    `;
  },

  _renderSidebar(cats) {
    const el_ = document.querySelector('.shelf-stats');
    if (!el_) return;
    const shelfCounts = Library._shelfCounts || {};
    const subCounts   = Library._subCounts   || {};
    const expanded    = Library._expandedCats || (Library._expandedCats = {});

    const rows = cats.filter(c => c.id !== 'all').map(c => {
      const subs    = c.subCategories || [];
      const isOpen  = !!expanded[c.id];
      const isMainActive = state.shelf === c.id && !state.subCategory;
      const hasSubs = subs.length > 0;

      // 세부 카테고리 트리 children
      const childHTML = hasSubs ? `
        <div class="ss-subtree" ${isOpen ? '' : 'hidden'}>
          ${subs.map(s => {
            const cnt = subCounts[`${c.id}::${s}`] || 0;
            const act = state.shelf === c.id && state.subCategory === s;
            return `
            <div class="ss-subitem ${act ? 'active' : ''}"
              onclick="event.stopPropagation();Library.selectSubCategory('${esc(c.id)}','${esc(s)}')">
              <span class="ss-sub-line"></span>
              <span class="ss-sub-name">${esc(s)}</span>
              <span class="ss-sub-cnt">${cnt}</span>
            </div>`;
          }).join('')}
        </div>` : '';

      return `
      <div class="ss-group ${isOpen ? 'open' : ''}">
        <div class="ss-item ${isMainActive ? 'active' : ''}" onclick="Library.selectShelfById('${esc(c.id)}')">
          ${hasSubs
            ? `<button class="ss-toggle" onclick="event.stopPropagation();Library.toggleCatTree('${esc(c.id)}')" aria-label="펼치기">
                 <i class="ti ti-chevron-right"></i>
               </button>`
            : `<span class="ss-toggle-spacer"></span>`}
          <span class="ss-icon" style="background:${esc(c.color)}">${esc(c.label.slice(0,2))}</span>
          <span class="ss-name">${esc(c.label)}</span>
          <span class="ss-cnt">${shelfCounts[c.id] || 0}</span>
        </div>
        ${childHTML}
      </div>`;
    }).join('');
    el_.innerHTML = `<div class="ss-title">Categories</div>${rows}`;
  },

  // 대분류 트리 펼침/접힘
  toggleCatTree(catId) {
    if (!Library._expandedCats) Library._expandedCats = {};
    Library._expandedCats[catId] = !Library._expandedCats[catId];
    Library._renderSidebar(Library._categories || []);
  },

  // 세부 카테고리 필터 선택
  selectSubCategory(catId, sub) {
    state.shelf = catId;
    state.subCategory = sub;
    if (!Library._expandedCats) Library._expandedCats = {};
    Library._expandedCats[catId] = true;
    const m = SHELF_META[catId] || SHELF_META.all;
    if (el('shelfTitle')) el('shelfTitle').textContent = `${m.label} › ${sub}`;
    if (el('shelfDesc'))  el('shelfDesc').textContent  = `세부 분류 '${sub}' 항목`;
    document.querySelectorAll('.shelf-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.shelf === catId);
    });
    showSkeleton();
    this.refresh();
  },

  // ── 태그 필터바 ─────────────────────────────
  async loadTags() {
    try {
      const data = await api('/tags');
      this._allTags = data.tags || [];
      this._renderTagBar(data.tags || []);
    } catch (e) { console.warn('태그 로드 실패', e); }
  },

  _renderTagBar(tags) {
    let bar = el('tagFilterBar');
    if (!bar) return;
    if (!tags.length) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = tags.slice(0, 30).map(({ tag, count }) => `
      <button class="tag-filter-btn ${state.activeTag===tag?'active':''}"
        onclick="Library.filterByTag('${esc(tag)}')">${esc(tag)} <span class="tag-cnt">${count}</span></button>
    `).join('');
  },

  filterByTag(tag) {
    if (state.activeTag === tag) {
      state.activeTag = null;
    } else {
      state.activeTag = tag;
    }
    this._renderTagBar(this._allTags || []);
    this._applyTagFilter();
  },

  _applyTagFilter() {
    const items = Library._cachedItems || [];
    const filtered = state.activeTag
      ? items.filter(i => (i.tags || []).includes(state.activeTag))
      : items;
    renderBookshelf(filtered);
  },

  // ── 카테고리 관리 모달 ───────────────────────
  openCatManager() {
    const overlay = el('catManagerOverlay');
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeCatManager(); };
    this._renderCatList();
  },

  closeCatManager() {
    el('catManagerOverlay').hidden = true;
    document.body.style.overflow  = '';
  },

  _renderCatList() {
    const list = el('catList');
    if (!list) return;
    const cats = this._categories || [];
    list.innerHTML = cats.map(c => `
      <div class="cat-row" data-id="${esc(c.id)}">
        <span class="cat-row-dot" style="background:${esc(c.color)}"></span>
        <span class="cat-row-label">${esc(c.label)}</span>
        ${c.builtIn
          ? `<span class="cat-row-builtin">기본</span>`
          : `<button class="cat-row-del" onclick="Library.deleteCat('${esc(c.id)}')" title="삭제"><i class="ti ti-trash"></i></button>`
        }
      </div>`).join('');
  },

  async addCat() {
    const labelEl = el('newCatName');
    const colorEl = el('newCatColor');
    const label = labelEl.value.trim();
    if (!label) return;
    try {
      await api('/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, color: colorEl.value || '#6B7280' })
      });
      labelEl.value = '';
      await this.loadCategories();
      this._renderCatList();
      showToast(`"${label}" 카테고리 추가됨`);
    } catch (e) { showToast('추가 실패: ' + e.message, 'err'); }
  },

  async deleteCat(id) {
    if (!confirm('이 카테고리를 삭제할까요?')) return;
    try {
      await api(`/categories/${id}`, { method: 'DELETE' });
      await this.loadCategories();
      this._renderCatList();
      showToast('카테고리 삭제됨');
    } catch (e) { showToast('삭제 실패: ' + e.message, 'err'); }
  },

  async refresh() {
    try {
      let q;
      if (state.shelf === 'inbox') {
        q = '?status=inbox&limit=200';
      } else if (state.shelf === 'all') {
        q = '?limit=200';
      } else {
        q = `?category=${state.shelf}&limit=200`;
        if (state.subCategory) q += `&subCategory=${encodeURIComponent(state.subCategory)}`;
      }
      const [itemsData, statsData] = await Promise.all([
        api(`/items${q}`),
        api('/stats')
      ]);

      state.items = itemsData.items || [];
      Library._cachedItems = state.items;
      state.activeTag = null; // 탭 전환 시 태그 필터 초기화
      Library.loadTags();
      renderBookshelf(state.items);
      updateStats(statsData.stats || {});
    } catch (err) {
      el('bookshelf').innerHTML = `
        <div class="shelf-empty">
          <i class="ti ti-server-off"></i>
          <p>서버에 연결할 수 없습니다</p>
          <span>터미널에서 node server.js를 실행 후 새로고침하세요</span>
        </div>`;
      console.error(err);
    }
  },

  // 서가 탭 전환
  selectShelf(btn) {
    document.querySelectorAll('.shelf-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    this.selectShelfById(btn.dataset.shelf);
  },

  selectShelfById(shelfId) {
    state.shelf = shelfId;
    state.subCategory = null; // 대분류 전환 시 세부 필터 해제
    const m = SHELF_META[shelfId] || SHELF_META.all;
    if (el('shelfTitle')) el('shelfTitle').textContent = m.label;
    if (el('shelfDesc'))  el('shelfDesc').textContent  = m.desc || '';

    // 탭도 동기화
    document.querySelectorAll('.shelf-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.shelf === shelfId);
    });

    showSkeleton();
    this.refresh();
  },

  // 타임머신 로드
  async loadTimeMachine() {
    try {
      const data = await api('/timemachine?count=3');
      renderTimeMachine(data.items || []);
    } catch { /* 조용히 실패 */ }
  },

  // ══════════════════════════════════════════════
  //  🎁 오늘의 지식 배달 (데일리 피드)
  // ══════════════════════════════════════════════

  // 전용 풀스크린 뷰 열기/닫기
  openDailyFeedView() {
    const ov = el('feedOverlay');
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    this.loadDailyFeed(false);
  },

  closeDailyFeedView() {
    el('feedOverlay').hidden = true;
    document.body.style.overflow = '';
  },

  // 메뉴 배지: 오늘 미저장 피드 수 (가볍게 조회)
  async _checkFeedBadge() {
    try {
      const data = await api('/daily-feed');
      Library._subscriptions = data.subscriptions || [];
      const unsaved = (data.feeds || []).filter(f => !f.saved).length;
      const badge = el('feedMenuBadge');
      if (badge) { badge.textContent = unsaved; badge.hidden = unsaved === 0; }
    } catch { /* 조용히 */ }
  },

  async loadDailyFeed(force = false) {
    const mag = el('feedMagazine');
    if (!mag) return;
    mag.innerHTML = `
      <div class="fm-loading">
        <i class="ti ti-loader-2 spin"></i>
        <span>오늘의 학습 콘텐츠를 준비하고 있어요…</span>
      </div>`;
    try {
      const data = await api('/daily-feed');
      Library._subscriptions = data.subscriptions || [];
      const feeds = data.feeds || [];
      if (el('feedHeroSub')) el('feedHeroSub').textContent =
        feeds.length ? `${data.date} · 오늘 배달된 지식 ${feeds.length}건` : `${data.date}`;

      if (!feeds.length) {
        mag.innerHTML = `
          <div class="fm-empty">
            <i class="ti ti-mailbox-off"></i>
            <p>구독 중인 피드가 없습니다.</p>
            <button class="df-empty-btn" onclick="Library.openFeedSettings()">
              <i class="ti ti-settings"></i> 구독 설정하기
            </button>
          </div>`;
        return;
      }
      mag.innerHTML = feeds.map(f => this._dailyFeedCardHTML(f)).join('');
      this._checkFeedBadge();
    } catch (e) {
      mag.innerHTML = `<div class="fm-empty"><i class="ti ti-cloud-off"></i><p>피드를 불러오지 못했습니다.</p></div>`;
      console.warn('데일리 피드 로드 실패', e);
    }
  },

  _dailyFeedCardHTML(f) {
    const m = SHELF_META[f.category] || { label: f.category, color: '#6B7280', icon: 'ti-folder' };
    const saved = !!f.saved;
    const isLang = f.type === 'language' && (f.vocabEntries || []).length;

    const savedEntries = f.savedEntries || {};
    let bodyHTML = '';
    if (isLang) {
      bodyHTML = `<div class="fm-vocab-list">${
        f.vocabEntries.map((e, i) => {
          const entrySaved = !!savedEntries[i];
          return `
          <div class="fm-vocab-entry">
            <span class="fm-vocab-num">${i + 1}</span>
            <div class="fm-vocab-main">
              <div class="fm-vocab-expr">${esc(e.expression || '')}</div>
              <div class="vocab-meaning blurred" onclick="this.classList.toggle('revealed')" title="올리거나 탭하면 뜻이 보입니다">
                <span class="vocab-meaning-text">${esc(e.meaning || '')}</span>
                <span class="vocab-reveal-hint">뜻 보기</span>
              </div>
              ${e.nuance ? `<div class="fm-vocab-nuance">${esc(e.nuance)}</div>` : ''}
              ${e.sourceSentence ? `<div class="fm-vocab-ex">“${esc(e.sourceSentence)}”</div>` : ''}
              ${e.practiceSentence ? `<div class="fm-vocab-ex prac">→ ${esc(e.practiceSentence)}</div>` : ''}
            </div>
            <button class="fm-single-save ${entrySaved ? 'saved' : ''}" ${entrySaved ? 'disabled' : ''}
              title="${entrySaved ? '저장됨' : '이 표현만 서재에 낱개 저장'}"
              onclick="event.stopPropagation();Library.saveSingleFeed('${esc(f.date)}','${esc(f.subId)}',${i},this)">
              ${entrySaved ? `<i class="ti ti-check"></i> 저장됨` : `<i class="ti ti-download"></i> 낱개 저장`}
            </button>
          </div>`;
        }).join('')
      }</div>`;

      // 짧은 지문
      if (f.paragraph) {
        bodyHTML += `
          <div class="fm-extra fm-paragraph">
            <div class="fm-extra-h"><i class="ti ti-file-text"></i> 짧은 지문</div>
            <p class="fm-para-en">${esc(f.paragraph)}</p>
            ${f.paragraphKo ? `<p class="fm-para-ko">${esc(f.paragraphKo)}</p>` : ''}
          </div>`;
      }
      // 실전 대화문
      if ((f.dialogue || []).length) {
        bodyHTML += `
          <div class="fm-extra fm-dialogue">
            <div class="fm-extra-h"><i class="ti ti-messages"></i> 실전 대화문 (롤플레잉)</div>
            ${f.dialogue.map(t => `
              <div class="fm-dia-line ${t.speaker === 'A' ? 'spk-a' : 'spk-b'}">
                <span class="fm-dia-spk">${esc(t.speaker || '')}</span>
                <div class="fm-dia-body">
                  <div class="fm-dia-text">${esc(t.line || '')}</div>
                  ${t.ko ? `<div class="fm-dia-ko">${esc(t.ko)}</div>` : ''}
                </div>
              </div>`).join('')}
          </div>`;
      }
    } else {
      bodyHTML = `<div class="fm-report">${mdToHtml(f.report || f.summary || '')}</div>`;

      // 경제 지식 섹션 (Economy 피드에만 존재)
      const ecoKnowledge = Array.isArray(f.aiEconomicKnowledge) ? f.aiEconomicKnowledge : [];
      if (ecoKnowledge.length) {
        const savedEcoEntries = f.savedEcoEntries || {};
        bodyHTML += `
          <div class="fm-eco-knowledge">
            <div class="fm-eco-header">
              <i class="ti ti-bulb"></i> 이 시황을 이해하는 핵심 경제 개념
            </div>
            ${ecoKnowledge.map((k, i) => {
              const ecoSaved = !!savedEcoEntries[i];
              return `
              <div class="fm-eco-item">
                <div class="fm-eco-term">${esc(k.term || '')}</div>
                <div class="fm-eco-importance">${esc(k.importance || '')}</div>
                <div class="fm-eco-connection"><span class="fm-eco-conn-label">📎 연결고리</span> ${esc(k.connection || '')}</div>
                <button class="fm-eco-save ${ecoSaved ? 'saved' : ''}" ${ecoSaved ? 'disabled' : ''}
                  title="${ecoSaved ? '저장됨' : '이 개념만 서재에 낱개 저장'}"
                  onclick="event.stopPropagation();Library.saveSingleFeed('${esc(f.date)}','${esc(f.subId)}',${i},this,'aiEconomicKnowledge')">
                  ${ecoSaved ? `<i class="ti ti-check"></i> 저장됨` : `<i class="ti ti-download"></i> 서재에 저장`}
                </button>
              </div>`;
            }).join('')}
          </div>`;
      }
    }

    return `
    <article class="fm-card ${esc(f.category)}" data-feed="${esc(f.date)}::${esc(f.subId)}">
      <div class="fm-card-head">
        <span class="fm-chip" style="background:${esc(m.color)}1a;color:${esc(m.color)}">
          <i class="ti ${esc(m.icon)}"></i> ${esc(f.label)}
        </span>
        ${f.subCategory ? `<span class="fm-topic">${esc(f.subCategory)}</span>` : ''}
        ${isLang ? `<span class="fm-count">${f.vocabEntries.length}개 표현</span>` : ''}
      </div>
      <h2 class="fm-card-title">${esc(f.title || f.label)}</h2>
      ${bodyHTML}
      <div class="fm-card-foot">
        <button class="df-save-btn ${saved ? 'saved' : ''}" ${saved ? 'disabled' : ''}
          onclick="Library.saveDailyFeed('${esc(f.date)}','${esc(f.subId)}',this)">
          ${saved
            ? `<i class="ti ti-check"></i> 저장 완료`
            : `<i class="ti ti-bookmark-plus"></i> 내 지식창고에 저장하기`}
        </button>
      </div>
    </article>`;
  },

  async saveDailyFeed(date, subId, btn) {
    if (btn.disabled) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ti ti-loader-2 spin"></i> 저장 중…`;
    try {
      const r = await api(`/daily-feed/${date}/${subId}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      btn.classList.add('saved');
      btn.innerHTML = `<i class="ti ti-check"></i> 저장 완료`;
      this.toast(r.alreadySaved ? '이미 서재에 있습니다' : '📚 내 지식창고에 저장했어요!', 'ok');
      this._checkFeedBadge();
      await this.loadCategories();
      await this.refresh();
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = orig;
      this.toast('저장 실패: ' + e.message, 'err');
    }
  },

  // 개별 구문/단어/경제지식 낱개 저장 (field: 'aiEconomicKnowledge' or undefined)
  async saveSingleFeed(date, subId, index, btn, field) {
    if (btn.disabled) return;
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ti ti-loader-2 spin"></i>`;
    try {
      const body = { date, subId, index };
      if (field) body.field = field;
      const r = await api('/archive/single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      btn.classList.add('saved');
      btn.innerHTML = `<i class="ti ti-check"></i> 저장됨`;
      this.toast(r.alreadySaved ? '이미 서재에 있는 표현입니다' : '📥 이 표현을 서재에 저장했어요!', 'ok');
      this._checkFeedBadge();
      await this.loadCategories();
      await this.refresh();
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = orig;
      this.toast('저장 실패: ' + e.message, 'err');
    }
  },

  // ── 구독 설정 모달 (세부 주제 + 분량 옵션) ──
  openFeedSettings() {
    const ov = el('feedSettingsOverlay');
    this._renderFeedSettings(Library._subscriptions || []);
    ov.hidden = false;
    document.body.style.overflow = 'hidden';
    ov.onclick = (e) => { if (e.target === ov) this.closeFeedSettings(); };
  },

  closeFeedSettings() {
    el('feedSettingsOverlay').hidden = true;
    // 피드 뷰가 열려있지 않으면 스크롤 복구
    if (el('feedOverlay').hidden) document.body.style.overflow = '';
  },

  _renderFeedSettings(subs) {
    const list = el('fsList');
    if (!list) return;
    list.innerHTML = subs.map(s => {
      const o = s.options || { count: 5, includeParagraph: false, includeDialogue: false };
      const isLang = s.type === 'language';
      const topics = (s.topicOptions || []).map(t =>
        `<option value="${esc(t)}" ${t === s.topic ? 'selected' : ''}>${esc(t)}</option>`).join('');

      return `
      <div class="fs-card ${s.enabled ? '' : 'fs-off'}" data-id="${esc(s.id)}">
        <div class="fs-card-top">
          <span class="fs-item-main">
            <i class="ti ${esc(s.icon || 'ti-bell')} fs-item-icon"></i>
            <span>
              <span class="fs-item-label">${esc(s.label)}</span>
              <span class="fs-item-desc">${esc(s.desc || '')}</span>
            </span>
          </span>
          <label class="fs-switch">
            <input type="checkbox" class="fs-toggle" data-id="${esc(s.id)}" ${s.enabled ? 'checked' : ''}
              onchange="this.closest('.fs-card').classList.toggle('fs-off', !this.checked)">
            <span class="fs-switch-track"></span>
          </label>
        </div>
        <div class="fs-options">
          <div class="fs-opt-row">
            <label class="fs-opt-label">세부 주제</label>
            <select class="fs-topic" data-id="${esc(s.id)}">${topics}</select>
          </div>
          ${isLang ? `
          <div class="fs-opt-row">
            <label class="fs-opt-label">구문 개수</label>
            <select class="fs-count" data-id="${esc(s.id)}">
              <option value="5"  ${Number(o.count) === 5  ? 'selected' : ''}>5개</option>
              <option value="10" ${Number(o.count) === 10 ? 'selected' : ''}>10개</option>
            </select>
          </div>
          <div class="fs-opt-row fs-opt-toggles">
            <label class="fs-chk"><input type="checkbox" class="fs-para" data-id="${esc(s.id)}" ${o.includeParagraph ? 'checked' : ''}> 짧은 지문 포함</label>
            <label class="fs-chk"><input type="checkbox" class="fs-dia" data-id="${esc(s.id)}" ${o.includeDialogue ? 'checked' : ''}> 실전 대화문 추가</label>
          </div>` : `
          <div class="fs-opt-row fs-opt-toggles">
            <label class="fs-chk"><input type="checkbox" class="fs-para" data-id="${esc(s.id)}" ${o.includeParagraph ? 'checked' : ''}> 상세 지문 포함</label>
          </div>`}
        </div>
      </div>`;
    }).join('');
  },

  async saveFeedSettings() {
    const cards = Array.from(document.querySelectorAll('.fs-card'));
    const get = (cls, id) => document.querySelector(`.${cls}[data-id="${id}"]`);
    const payload = cards.map(c => {
      const id = c.dataset.id;
      return {
        id,
        enabled: get('fs-toggle', id)?.checked || false,
        topic:   get('fs-topic', id)?.value || '',
        options: {
          count: Number(get('fs-count', id)?.value || 5),
          includeParagraph: get('fs-para', id)?.checked || false,
          includeDialogue:  get('fs-dia', id)?.checked || false,
        }
      };
    });
    try {
      const r = await api('/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptions: payload })
      });
      Library._subscriptions = r.subscriptions || [];
      this.closeFeedSettings();
      this.toast('구독 설정을 저장했습니다 · 새 조건으로 다시 배달합니다');
      // 피드 뷰가 열려 있으면 새 조건으로 재생성
      if (!el('feedOverlay').hidden) await this.loadDailyFeed(true);
      else this._checkFeedBadge();
    } catch (e) { this.toast('저장 실패: ' + e.message, 'err'); }
  },

  // ══════════════════════════════════════════════
  //  📄 기간별 맞춤형 지식 보고서 인쇄 / PDF
  // ══════════════════════════════════════════════

  _isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  // 날짜 피커 기본값(최근 7일) 세팅
  _initReportDates() {
    const s = el('rpStart'), e = el('rpEnd');
    if (!s || !e) return;
    if (!e.value) e.value = this._isoDate(new Date());
    if (!s.value) { const d = new Date(); d.setDate(d.getDate() - 7); s.value = this._isoDate(d); }
  },

  // 프리셋 기간 버튼 (최근 N일)
  setReportRange(days) {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);
    if (el('rpEnd'))   el('rpEnd').value   = this._isoDate(end);
    if (el('rpStart')) el('rpStart').value = this._isoDate(start);
  },

  async openPrintReport() {
    this._initReportDates();
    const startDate = el('rpStart').value;
    const endDate   = el('rpEnd').value;
    if (startDate && endDate && startDate > endDate) {
      this.toast('시작일이 종료일보다 늦습니다', 'err'); return;
    }
    // 현재 보고 있는 서가를 카테고리 필터로 사용 (inbox/all 은 전체)
    const category = (state.shelf && state.shelf !== 'inbox' && state.shelf !== 'all') ? state.shelf : 'all';

    try {
      const q = `?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&category=${encodeURIComponent(category)}`;
      const data = await api(`/export-report${q}`);
      el('printContent').innerHTML = this._renderPrintReport(data.items || [], data.meta || {});
      el('ptInfo').textContent = `총 ${data.meta.total}건 · ${startDate} ~ ${endDate}`;
      const ov = el('printOverlay');
      ov.hidden = false;
      document.body.classList.add('printing');
      document.body.style.overflow = 'hidden';
      ov.onclick = (e) => { if (e.target === ov) this.closePrintReport(); };
      // 렌더 완료 후 브라우저 인쇄 대화상자 자동 호출
      setTimeout(() => { try { window.print(); } catch(_){} }, 400);
    } catch (e) {
      this.toast('보고서 생성 실패: ' + e.message, 'err');
    }
  },

  closePrintReport() {
    el('printOverlay').hidden = true;
    document.body.classList.remove('printing');
    document.body.style.overflow = '';
  },

  // 마크다운을 ## 헤더 기준 섹션맵으로 분해
  _extractSections(md = '') {
    const out = {};
    const norm = String(md).replace(/\\n/g, '\n');
    norm.split(/^##\s+/m).forEach(part => {
      const nl = part.indexOf('\n');
      if (nl === -1) return;
      const head = part.slice(0, nl).trim().replace(/[#*`]/g, '');
      const body = part.slice(nl + 1).trim();
      if (head) out[head] = body;
    });
    return out;
  },

  // 텍스트 → 불릿 배열
  _toBullets(text = '') {
    const norm = String(text).replace(/\\n/g, '\n');
    let bullets = norm.split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => l.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').replace(/\*\*/g, '').replace(/[#`]/g, '').trim())
      .filter(Boolean);
    // 한 덩어리 긴 문단이면 문장 단위로 분할
    if (bullets.length === 1 && bullets[0].length > 150) {
      bullets = bullets[0].split(/(?<=[.。!?])\s+/).map(s => s.trim()).filter(Boolean);
    }
    return bullets.slice(0, 8);
  },

  _renderPrintReport(items, meta) {
    const catLabel = (!meta.category || meta.category === 'all')
      ? '전체' : (SHELF_META[meta.category]?.label || meta.category);
    const period = `${meta.startDate || '처음'} ~ ${meta.endDate || '오늘'}`;
    const printedOn = new Date().toLocaleDateString('ko-KR');

    // 카테고리별 그룹화 (en은 표, 나머지는 리포트)
    const groups = {};
    items.forEach(i => { (groups[i.category] = groups[i.category] || []).push(i); });

    let body = '';
    Object.entries(groups).forEach(([cat, its]) => {
      const m = SHELF_META[cat] || { label: cat };
      body += `<section class="pr-cat-section">
        <h2 class="pr-cat-head">${esc(m.label)} <span class="pr-cat-cnt">${its.length}건</span></h2>
        ${cat === 'en' ? this._renderEnTable(its) : its.map(i => this._renderReportItem(i)).join('')}
      </section>`;
    });

    return `
    <header class="pr-header">
      <div class="pr-brand">SJ ARCHIVE · KNOWLEDGE REPORT</div>
      <h1 class="pr-doc-title">맞춤형 지식 누적 보고서</h1>
      <div class="pr-meta">
        <span><b>기간</b> ${esc(period)}</span>
        <span><b>분류</b> ${esc(catLabel)}</span>
        <span><b>총계</b> ${meta.total || 0}건</span>
        <span><b>출력일</b> ${esc(printedOn)}</span>
      </div>
    </header>
    ${items.length ? body : '<div class="pr-empty">선택한 기간·분류에 해당하는 지식이 없습니다.</div>'}
    <footer class="pr-footer">SJ Knowledge Library · 종이를 접어 우측 뜻을 가리면 암기 테스트가 됩니다.</footer>`;
  },

  // 어학: 접이식 암기 테이블
  _renderEnTable(items) {
    const rows = [];
    items.forEach(it => {
      const ves = (it.extras && it.extras.vocabEntries) || [];
      if (ves.length) {
        ves.forEach(v => rows.push({
          expr: v.expression || '', meaning: v.meaning || '',
          nuance: v.nuance || '', src: v.sourceSentence || '', prac: v.practiceSentence || ''
        }));
      } else {
        rows.push({ expr: it.title || (it.text || '').slice(0, 40), meaning: it.summary || it.myInsight || '', nuance: '', src: '', prac: '' });
      }
    });
    return `
    <table class="pr-en-table">
      <thead><tr>
        <th class="c-expr">구문 · 표현</th>
        <th class="c-mean">뜻 · 뉘앙스 · 예문</th>
        <th class="c-chk">자가진단</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
        <tr class="pr-row">
          <td class="c-expr"><span class="pr-expr">${esc(r.expr)}</span></td>
          <td class="c-mean">
            <div class="pr-mean">${esc(r.meaning)}</div>
            ${r.nuance ? `<div class="pr-nuance">${esc(r.nuance)}</div>` : ''}
            ${r.src ? `<div class="pr-ex">“${esc(r.src)}”</div>` : ''}
            ${r.prac ? `<div class="pr-ex pr-ex-prac">→ ${esc(r.prac)}</div>` : ''}
          </td>
          <td class="c-chk"><span class="pr-box"></span></td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  },

  // 경제/인사이트: 리포트 양식 (요약/논거/통찰)
  _renderReportItem(it) {
    const sec = this._extractSections(it.aiSummary || '');
    const summary = it.summary || sec['핵심 요약'] || '';
    let argues = '';
    Object.entries(sec).forEach(([h, b]) => {
      if (/(논거|메커니즘|핵심 포인트|줄거리|takeaway)/i.test(h) && !/요약/.test(h) && !argues) argues = b;
    });
    if (!argues) argues = String(it.aiSummary || '').replace(/^##.*$/gm, '').trim();
    const bullets = this._toBullets(argues);
    const insight = it.myInsight || '';

    return `
    <article class="pr-report">
      <h3 class="pr-report-title">${esc(it.title || '제목 없음')}
        <span class="pr-report-date">${esc(it.date || '')}</span>
      </h3>
      <div class="pr-sec">
        <div class="pr-sec-h">📌 핵심 요약</div>
        <p class="pr-sec-b">${esc(summary || '—')}</p>
      </div>
      <div class="pr-sec">
        <div class="pr-sec-h">🔑 주요 핵심 논거</div>
        <ul class="pr-bullets">${bullets.length ? bullets.map(b => `<li>${esc(b)}</li>`).join('') : '<li>—</li>'}</ul>
      </div>
      <div class="pr-sec">
        <div class="pr-sec-h">📝 나의 주관적 통찰</div>
        <p class="pr-sec-b pr-insight">${esc(insight || '(작성된 통찰 없음)')}</p>
      </div>
    </article>`;
  },

  // ─── 지식 추가 모달 ───

  openCapture() {
    el('captureOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => el('capInput')?.focus(), 50);
  },

  closeCapture() {
    el('captureOverlay').hidden = true;
    document.body.style.overflow = '';
    el('capInput').value = '';
    el('capAI').hidden = true;
    el('capBtn').disabled = false;
  },

  handleCapKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.capture(); }
    if (e.key === 'Escape') this.closeCapture();
  },

  async capture() {
    const text   = el('capInput').value.trim();
    const source = el('capSource').value;
    if (!text) { this.toast('내용을 입력해 주세요', 'err'); el('capInput').focus(); return; }

    const btn   = el('capBtn');
    const aiBar = el('capAI');
    const msgs  = ['사서가 내용을 분석하고 있습니다...','주제와 카테고리를 판별 중입니다...','서가를 결정하고 있습니다...','서가에 꽂는 중입니다...'];
    let mi = 0;

    btn.disabled = true;
    aiBar.hidden = false;
    const iv = setInterval(() => {
      const m = el('capAIMsg');
      if (m && mi < msgs.length) m.textContent = msgs[mi++];
    }, 600);

    try {
      const result = await api('/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source })
      });
      clearInterval(iv);
      this.closeCapture();
      this.toast(`📥 인박스에 담았습니다 · 서재로 옮길 때 AI가 분석합니다`, 'ok');
      await this.refresh();
    } catch (err) {
      clearInterval(iv);
      aiBar.hidden = true;
      btn.disabled = false;
      this.toast(`저장 실패: ${err.message}`, 'err');
    }
  },

  // ─── 책 액션 ───

  async copyItem(id, btn) {
    const item = state.items.find(i => i.id === id);
    if (!item) return;
    try {
      await navigator.clipboard.writeText(item.text);
      const icon = btn.querySelector('i');
      icon.className = 'ti ti-check';
      setTimeout(() => { icon.className = 'ti ti-copy'; }, 1600);
      this.toast('클립보드에 복사했습니다');
    } catch { this.toast('복사 실패', 'err'); }
  },

  async deleteItem(id) {
    if (!confirm('이 지식을 서재에서 꺼내시겠습니까?')) return;
    try {
      await api(`/items/${id}`, { method: 'DELETE' });
      const card = document.querySelector(`[data-id="${id}"]`);
      if (card) {
        card.style.transition = 'opacity .2s, transform .2s';
        card.style.opacity = '0'; card.style.transform = 'scale(0.96)';
        setTimeout(() => card.remove(), 220);
      }
      state.items = state.items.filter(i => i.id !== id);
      await this.refresh();
      this.toast('서재에서 꺼냈습니다');
    } catch (err) { this.toast(`삭제 실패: ${err.message}`, 'err'); }
  },

  // ─── 인박스 대기 지식 폐기 ───
  async discardInbox(id) {
    if (!confirm('이 인박스 항목을 완전히 폐기할까요? 되돌릴 수 없습니다.')) return;
    try {
      await api(`/items/${id}`, { method: 'DELETE' });
      // 카드 즉시 제거 애니메이션
      const card = document.querySelector(`.inbox-card[data-id="${id}"]`);
      if (card) {
        card.style.transition = 'opacity .2s, transform .2s';
        card.style.opacity = '0'; card.style.transform = 'translateX(-12px)';
        setTimeout(() => card.remove(), 200);
      }
      Library._cachedItems = (Library._cachedItems || []).filter(i => i.id !== id);
      state.items = state.items.filter(i => i.id !== id);
      await this.refresh();
      this.toast('🗑️ 인박스에서 폐기했습니다');
    } catch (err) { this.toast(`폐기 실패: ${err.message}`, 'err'); }
  },

  // ─── 주간 브리핑 모달 ───

  openWeekly() {
    el('weeklyOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
    this._loadWeekly();
  },

  closeWeekly() {
    el('weeklyOverlay').hidden = true;
    document.body.style.overflow = '';
    el('weeklyLoading').hidden = false;
    el('weeklyContent').hidden = true;
  },

  async _loadWeekly() {
    el('weeklyLoading').hidden = false;
    el('weeklyContent').hidden = true;
    try {
      const data = await api('/report/weekly');
      const r    = data.storyReport || {};
      if (el('weeklyHeadline')) el('weeklyHeadline').textContent = r.headline || '주간 지식 브리핑';
      if (el('weeklyMeta'))     el('weeklyMeta').textContent     = `${data.period?.from} — ${data.period?.to} · ${data.totalItems}개 항목`;
      if (el('weeklyStory'))    el('weeklyStory').textContent    = r.story    || '';
      if (el('weeklyInsight'))  el('weeklyInsight').textContent  = r.crossInsight || '';
      if (el('weeklyPhrase'))   el('weeklyPhrase').textContent   = r.weeklyPhrase || '';
      el('weeklyLoading').hidden = true;
      el('weeklyContent').hidden = false;
    } catch (err) {
      el('weeklyLoading').innerHTML = `<i class="ti ti-server-off" style="font-size:32px;color:var(--ink3)"></i><p style="color:var(--ink3)">로딩 실패: ${err.message}</p>`;
    }
  },

  // ─── 연말 결산 모달 (완전 재구축) ───

  openYearEnd() {
    const overlay = el('yearEndOverlay');
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    // 배경 클릭 닫기
    overlay.onclick = (e) => { if (e.target === overlay) this.closeYearEnd(); };
    this._loadYearEnd();
  },

  // 무조건 닫기 (로딩·에러 상태 무관)
  closeYearEnd() {
    try {
      const overlay = el('yearEndOverlay');
      if (overlay) overlay.hidden = true;
      document.body.style.overflow = '';
      // 상태 리셋
      const loading = el('yrLoading');
      if (loading) {
        loading.innerHTML = `<div class="spin-ring"></div><p>연간 지식 서재를 분석 중입니다...</p>`;
        loading.hidden = false;
      }
      const content = el('yrContent');
      if (content) content.hidden = true;
    } catch (e) { console.warn('closeYearEnd error:', e); }
  },

  // ── 카드 상세 모달 (심층 지식 노트) ──────────────────
  openDetail(id) {
    const items = Library._cachedItems || [];
    const item  = items.find(i => i.id === id);
    if (!item) return;

    const m = SHELF_META[item.category] || { label: 'Inbox', color: '#6B7280' };
    const box = el('detailBox');

    // 내 생각(myInsight)이 있으면 최상단에 강조
    const insightSection = (item.myInsight && item.myInsight.trim())
      ? `<div class="detail-my-insight">
           <div class="detail-my-insight-label"><i class="ti ti-bulb"></i> 나의 생각</div>
           <div class="detail-my-insight-body">${esc(item.myInsight)}</div>
         </div>`
      : '';

    // AI 심층 분석 (aiSummary → 마크다운 렌더링) / 분석 중이면 플레이스홀더
    const hasDeepAnalysis = item.aiSummary && item.aiSummary.trim().length > 80;
    const analysisSection = (item.analysisStatus === 'pending')
      ? `<div class="detail-ai-analysis">${this._analyzingPlaceholderHTML()}</div>`
      : hasDeepAnalysis
      ? `<div class="detail-ai-analysis">
           <div class="detail-ai-label"><i class="ti ti-robot"></i> AI 심층 분석</div>
           <div class="detail-md-body">${mdToHtml(item.aiSummary)}</div>
         </div>`
      : item.summary
      ? `<div class="detail-ai-analysis">
           <div class="detail-ai-label"><i class="ti ti-robot"></i> AI 요약</div>
           <div class="detail-md-body"><p class="md-p">${esc(item.summary)}</p></div>
         </div>`
      : '';

    // 원문 (접기)
    const origSection = (item.text && item.text !== item.aiSummary)
      ? `<details class="detail-orig-details">
           <summary>원문 보기</summary>
           <div class="detail-orig-text">${esc(item.text)}</div>
         </details>`
      : '';

    // 태그
    const tagsHtml = (item.tags || []).length
      ? `<div class="detail-tags">${(item.tags || []).map(t =>
          `<span class="book-tag" onclick="Library.filterByTag('${esc(t)}');Library.closeDetail()">${esc(t)}</span>`
        ).join('')}</div>` : '';

    // URL 링크
    const urlHtml = item.originalUrl
      ? `<a class="detail-url" href="${esc(item.originalUrl)}" target="_blank" rel="noopener">
           <i class="ti ti-external-link"></i>${esc(item.title || item.originalUrl)}
         </a>` : '';

    // 메타
    const metaHtml = `<div class="detail-meta">
      <span class="detail-cat-badge" style="background:${esc(m.color||'#6B7280')}20;color:${esc(m.color||'#6B7280')};border:1px solid ${esc(m.color||'#6B7280')}40">${esc(m.label)}</span>
      <span>${fmtDate(item.date)}</span>
      <span>${item.source || 'manual'}</span>
    </div>`;

    box.innerHTML = `
      <div class="mb-header detail-header">
        ${metaHtml}
        <button class="mb-close" onclick="Library.closeDetail()" aria-label="닫기"><i class="ti ti-x"></i></button>
      </div>
      <div class="detail-body">
        <h2 class="detail-title">${esc(item.title || item.text.slice(0, 80))}</h2>
        ${urlHtml}
        ${insightSection}
        ${analysisSection}
        ${tagsHtml}
        ${origSection}
      </div>`;

    const overlay = el('detailOverlay');
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeDetail(); };
  },

  closeDetail() {
    el('detailOverlay').hidden   = true;
    document.body.style.overflow = '';
  },

  // ── Inbox 처리 모달 (미처리 → 지식 승인) ──────────────
  openInboxProcess(id) {
    const items = Library._cachedItems || [];
    const item  = items.find(i => i.id === id);
    if (!item) return;

    const isUrl = item.type === 'url' && item.originalUrl;

    // 모달 내용 채우기
    el('ipTitle').textContent   = item.title || item.text.slice(0, 60);
    el('ipAiSummary').textContent = item.aiSummary || item.summary || '(AI 요약 없음)';
    el('ipSourceWrap').hidden   = !isUrl;
    if (isUrl) {
      el('ipSourceLink').href         = item.originalUrl;
      el('ipSourceLinkText').textContent = item.originalUrl;
    }
    el('ipOrigText').textContent = item.text || '';
    el('ipInsightInput').value   = item.myInsight || '';

    // 카테고리 셀렉터 구성
    const cats = Library._categories || [];
    el('ipCatSelect').innerHTML = cats
      .map(c => `<option value="${esc(c.id)}" ${c.id === item.category ? 'selected' : ''}>${esc(c.label)}</option>`)
      .join('');

    // 현재 아이템 ID + 선택 세부분류 저장
    el('inboxProcessOverlay').dataset.itemId = id;
    el('inboxProcessOverlay').dataset.subCategory = item.subCategory || '';

    // 세부 분류 칩 렌더 (현재 카테고리 기준)
    this._renderInboxSubs(item.category, item.subCategory || '');

    el('inboxProcessOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
    el('inboxProcessOverlay').onclick = (e) => {
      if (e.target === el('inboxProcessOverlay')) this.closeInboxProcess();
    };
    el('ipInsightInput').focus();
  },

  closeInboxProcess() {
    el('inboxProcessOverlay').hidden = true;
    document.body.style.overflow = '';
  },

  // 인박스 모달: 현재 카테고리의 세부 분류 칩 렌더
  _renderInboxSubs(categoryId, selectedSub = '') {
    const wrap = el('ipSubList');
    if (!wrap) return;
    const cat  = (Library._categories || []).find(c => c.id === categoryId);
    const subs = (cat && cat.subCategories) || [];
    el('inboxProcessOverlay').dataset.subCategory = selectedSub;

    if (!subs.length) {
      wrap.innerHTML = `<span class="ip-sub-empty">아직 세부 분류가 없습니다. 아래에서 추가해 보세요.</span>`;
      return;
    }
    wrap.innerHTML = subs.map(s => `
      <button class="ip-sub-chip ${s === selectedSub ? 'active' : ''}"
        onclick="Library.selectInboxSub('${esc(s)}')">${esc(s)}</button>
    `).join('');
  },

  // 세부 분류 칩 선택/해제 (토글)
  selectInboxSub(sub) {
    const overlay = el('inboxProcessOverlay');
    const cur = overlay.dataset.subCategory || '';
    const next = cur === sub ? '' : sub; // 같은 걸 다시 누르면 해제
    this._renderInboxSubs(el('ipCatSelect').value, next);
  },

  // 대분류 셀렉터 변경 시 세부 분류 칩 갱신
  onInboxCatChange() {
    this._renderInboxSubs(el('ipCatSelect').value, '');
  },

  // 즉석 세부 분류 추가
  async addInboxSub() {
    const input = el('ipSubNewInput');
    const name  = input.value.trim();
    const catId = el('ipCatSelect').value;
    if (!name) { input.focus(); return; }
    try {
      await api(`/categories/${catId}/sub`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      input.value = '';
      await this.loadCategories();          // 카테고리 캐시 갱신
      this._renderInboxSubs(catId, name);    // 새 세부분류 자동 선택
      this.toast(`세부 분류 "${name}" 추가됨`);
    } catch (e) {
      this.toast(e.message.includes('이미') ? '이미 있는 세부 분류입니다' : '추가 실패: ' + e.message, 'err');
    }
  },

  async publishItem() {
    const overlay  = el('inboxProcessOverlay');
    const id       = overlay.dataset.itemId;
    const category = el('ipCatSelect').value;
    const subCategory = overlay.dataset.subCategory || '';
    let   insight  = el('ipInsightInput').value.trim();

    // 인사이트는 '선택' — 비어 있으면 AI 요약 첫 줄 또는 제목을 기본값으로
    if (!insight) {
      const item = (Library._cachedItems || []).find(i => i.id === id) || {};
      const firstLine = (s) => (s || '').replace(/[#*>`-]/g, '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
      insight = firstLine(item.summary) || firstLine(item.aiSummary) || (item.title || '').trim() || '(요약 없음)';
    }
    el('ipInsightInput').classList.remove('input-error');

    const btn = el('ipPublishBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> 서재로 옮기는 중...';

    try {
      // 즉시 응답받는 비동기 아카이브 (분석은 서버 백그라운드에서 진행)
      const r = await api('/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, myInsight: insight, category, subCategory }),
      });

      this.closeInboxProcess();
      this.toast(r.analyzing
        ? '📚 지식을 서재에 추가했습니다 · AI가 백그라운드에서 분석 중입니다'
        : '📚 지식을 서재에 추가했습니다', 'ok');

      // 캐시에서 제거 + 즉시 UI 갱신 (인박스 카드 제거 / 타임라인 이동)
      Library._cachedItems = (Library._cachedItems || []).filter(i => i.id !== id);
      await this.refresh();
    } catch (e) {
      this.toast('이관 실패: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-books"></i> 서재에 꽂기';
    }
  },

  // ── 심층 지식 대시보드 ──────────────────────────────────
  openGraph(id) {
    const items  = Library._cachedItems || [];
    const center = items.find(i => i.id === id);
    if (!center) return;

    const m      = SHELF_META[center.category] || { color: '#4F46E5', label: 'etc', icon: 'ti-folder' };
    const isUrl  = center.type === 'url' && center.originalUrl;

    // 현재 열린 아이템 ID 저장 (저장 시 참조)
    el('graphOverlay').dataset.itemId = id;

    // ── 헤더 바 ──
    const badge = el('kdCatBadge');
    badge.textContent = m.label;
    badge.style.cssText = `background:${m.color}22;color:${m.color};border:1px solid ${m.color}44`;

    el('kdTopTitle').textContent = (center.title || center.text || '').slice(0, 60);

    // ── 왼쪽: 제목 + 출처 + AI 분석 ──
    el('kdTitle').textContent = center.title || center.text.slice(0, 80) || '(제목 없음)';

    const srcLink = el('kdSourceLink');
    if (isUrl) {
      srcLink.href = center.originalUrl;
      el('kdSourceText').textContent = (() => {
        try { return new URL(center.originalUrl).hostname.replace('www.',''); }
        catch { return center.originalUrl.slice(0, 50); }
      })();
      srcLink.hidden = false;
    } else {
      srcLink.hidden = true;
    }

    const analysisBody = el('kdAnalysisBody');

    // 백그라운드 분석 진행 중이면 로딩 플레이스홀더 + 폴링
    if (center.analysisStatus === 'pending') {
      analysisBody.innerHTML = this._analyzingPlaceholderHTML();
      this._startAnalysisPoll(id);
    } else {
      this._stopAnalysisPoll();
      this._renderKdAnalysisBody(center, analysisBody);
    }

    // ── 오른쪽: 인사이트 입력 ──
    const insightInput = el('kdInsightInput');
    insightInput.value = center.myInsight || '';
    this._updateCharCount();
    insightInput.oninput = () => Library._updateCharCount();

    // ── 오른쪽: 연관 지식 ──
    const centerTags = new Set(center.tags || []);
    const related = items
      .filter(i => i.id !== center.id && i.status !== 'inbox')
      .map(i => ({ item: i, shared: (i.tags || []).filter(t => centerTags.has(t)) }))
      .filter(x => x.shared.length > 0)
      .sort((a, b) => b.shared.length - a.shared.length)
      .slice(0, 8);

    el('kdRelatedCount').textContent = related.length ? `${related.length}개` : '없음';

    const relatedList = el('kdRelatedList');
    if (related.length === 0) {
      relatedList.innerHTML = `<div class="kd-related-empty">
        <i class="ti ti-unlink"></i>
        <p>공유 태그가 있는 연관 지식이 없습니다.<br>태그를 추가하면 자동으로 연결됩니다.</p>
      </div>`;
    } else {
      relatedList.innerHTML = related.map(({ item, shared }) => {
        const rm    = SHELF_META[item.category] || { color: '#6B7280', label: 'etc' };
        const hero  = (item.myInsight || item.summary || item.text || '').slice(0, 80);
        const sharedTags = shared.slice(0, 3).map(t =>
          `<span class="kd-rel-tag">${esc(t)}</span>`).join('');
        return `
          <div class="kd-related-card" onclick="Library.closeGraph();Library.openGraph('${esc(item.id)}')">
            <div class="kd-rel-top">
              <span class="kd-rel-cat" style="color:${esc(rm.color)}">${esc(rm.label)}</span>
              <span class="kd-rel-date">${fmtDate(item.date)}</span>
            </div>
            <div class="kd-rel-hero">${esc(hero)}${hero.length >= 80 ? '…' : ''}</div>
            <div class="kd-rel-tags">${sharedTags}</div>
          </div>`;
      }).join('');
    }

    // 오버레이 열기
    const overlay = el('graphOverlay');
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    overlay.onclick = (e) => { if (e.target === overlay) this.closeGraph(); };

    // 포커스: 인사이트 입력창으로
    setTimeout(() => { if (!insightInput.value) insightInput.focus(); }, 120);
  },

  closeGraph() {
    el('graphOverlay').hidden = true;
    document.body.style.overflow = '';
    this._stopAnalysisPoll();
  },

  _updateCharCount() {
    const len = (el('kdInsightInput')?.value || '').length;
    const cc  = el('kdCharCount');
    if (cc) cc.textContent = `${len}자`;
  },

  // 분석 중 로딩 플레이스홀더
  _analyzingPlaceholderHTML() {
    return `
      <div class="kd-analyzing">
        <div class="kd-analyzing-orb"><i class="ti ti-settings spin-slow"></i></div>
        <div class="kd-analyzing-title">AI 사서가 지식을 심층 분석 중입니다… ⚙️</div>
        <div class="kd-analyzing-sub">잠시만 기다려 주세요. 분석이 끝나면 자동으로 채워집니다.</div>
        <div class="kd-analyzing-bar"><span></span></div>
      </div>`;
  },

  // 대시보드 왼쪽 분석 본문 렌더 (분석 완료 상태)
  _renderKdAnalysisBody(center, analysisBody) {
    const vocabEntries = center.extras?.vocabEntries || [];
    if (center.category === 'en' && vocabEntries.length) {
      analysisBody.innerHTML = `
        <div class="kd-vocab-section">
          <div class="kd-vocab-header">
            <i class="ti ti-cards"></i> 플래시카드 학습 — 뜻을 가린 채 테스트해보세요
          </div>
          ${vocabEntries.map(e => `
          <div class="kd-vocab-card">
            <div class="kd-vocab-expression">${esc(e.expression || '')}</div>
            <div class="kd-vocab-meaning blurred"
              onclick="this.classList.toggle('revealed')"
              title="클릭하여 뜻 확인">
              <span class="kd-vocab-meaning-text">${esc(e.meaning || '')}</span>
              <span class="kd-vocab-reveal-hint"><i class="ti ti-eye"></i> 클릭하여 확인</span>
            </div>
            ${e.nuance ? `<div class="kd-vocab-nuance">${esc(e.nuance)}</div>` : ''}
            <div class="kd-vocab-examples">
              ${e.sourceSentence ? `<div class="kd-vocab-ex"><span class="kd-ex-label">원문</span> ${esc(e.sourceSentence)}</div>` : ''}
              ${e.practiceSentence ? `<div class="kd-vocab-ex"><span class="kd-ex-label">응용</span> ${esc(e.practiceSentence)}</div>` : ''}
            </div>
          </div>`).join('')}
          ${center.aiSummary ? `<div class="kd-vocab-summary">${mdToHtml(center.aiSummary)}</div>` : ''}
        </div>`;
    } else if (center.aiSummary && center.aiSummary.trim().length > 60) {
      analysisBody.innerHTML = mdToHtml(center.aiSummary);
    } else if (center.analysisStatus === 'failed') {
      analysisBody.innerHTML = `
        <div class="kd-no-analysis">
          <i class="ti ti-alert-triangle"></i>
          <p>AI 분석에 실패했습니다.</p>
          <div class="kd-no-analysis-hint">잠시 후 카드를 다시 열면 재시도됩니다. (무료 한도 초과 시 잠시 대기 필요)</div>
        </div>`;
    } else if (center.summary) {
      analysisBody.innerHTML = `
        <div class="kd-no-analysis">
          <p class="md-p">${esc(center.summary)}</p>
          <div class="kd-no-analysis-hint">
            <i class="ti ti-robot"></i>
            인박스에서 서재로 옮기면 Gemini가 심층 분석을 자동 생성합니다.
          </div>
        </div>`;
    } else {
      analysisBody.innerHTML = `
        <div class="kd-no-analysis">
          <i class="ti ti-file-text"></i>
          <p>AI 분석 내용이 없습니다.</p>
          <div class="kd-no-analysis-hint">인박스에서 서재로 옮기면 Gemini가 자동 분석합니다.</div>
        </div>`;
    }
  },

  // 분석 완료까지 폴링 (3초 간격, 최대 ~40초)
  _startAnalysisPoll(id) {
    this._stopAnalysisPoll();
    let tries = 0;
    this._analysisPollId = setInterval(async () => {
      tries++;
      // 대시보드가 닫혔거나 다른 항목으로 전환되면 중단
      const overlay = el('graphOverlay');
      if (overlay.hidden || overlay.dataset.itemId !== id) { this._stopAnalysisPoll(); return; }
      try {
        const { item } = await api(`/items/${id}`);
        if (!item) { this._stopAnalysisPoll(); return; }
        // 캐시 동기화
        const cache = Library._cachedItems || [];
        const ci = cache.findIndex(x => x.id === id);
        if (ci !== -1) cache[ci] = item;

        if (item.analysisStatus !== 'pending') {
          this._stopAnalysisPoll();
          // 여전히 같은 카드가 열려 있으면 부드럽게 채워넣기
          if (!overlay.hidden && overlay.dataset.itemId === id) {
            const body = el('kdAnalysisBody');
            body.classList.add('kd-fade-in');
            this._renderKdAnalysisBody(item, body);
            setTimeout(() => body.classList.remove('kd-fade-in'), 600);
          }
        }
      } catch { /* 네트워크 일시 오류는 다음 틱에 재시도 */ }
      if (tries >= 14) this._stopAnalysisPoll(); // 안전장치
    }, 3000);
  },

  _stopAnalysisPoll() {
    if (this._analysisPollId) { clearInterval(this._analysisPollId); this._analysisPollId = null; }
  },

  async saveDashInsight() {
    const id      = el('graphOverlay').dataset.itemId;
    const insight = el('kdInsightInput').value.trim();
    if (!id) return;

    const btn = el('kdSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-loader-2 spin"></i> 저장 중...';

    try {
      const res = await api(`/items/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ myInsight: insight }),
      });

      // 로컬 캐시 즉시 갱신
      const cached = Library._cachedItems || [];
      const idx    = cached.findIndex(i => i.id === id);
      if (idx !== -1) cached[idx].myInsight = insight;

      btn.innerHTML = '<i class="ti ti-check"></i> 저장됨';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i class="ti ti-device-floppy"></i> 저장';
        btn.style.background = '';
      }, 1800);

      this.toast('💡 인사이트가 저장됐습니다', 'ok');
    } catch (e) {
      this.toast('저장 실패: ' + e.message, 'err');
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-device-floppy"></i> 저장';
    }
  },

  async _loadYearEnd() {
    el('yrLoading').hidden  = false;
    el('yrContent').hidden  = true;

    const year = new Date().getFullYear();
    if (el('yrBadgeYear')) el('yrBadgeYear').textContent = year;

    try {
      const data = await api(`/report/year-end?year=${year}`);

      if (!data.totalItems) {
        el('yrLoading').hidden = true;
        el('yrContent').hidden = false;
        el('yrNums').innerHTML = `<p style="color:var(--ink3);text-align:center;padding:20px"><i class="ti ti-books" style="font-size:36px;display:block;margin-bottom:10px"></i>${year}년 저장된 지식이 없습니다</p>`;
        el('yrKwRow').innerHTML = '';
        el('yrBest').innerHTML = '';
        el('yrAiSummary').textContent = '';
        el('yrAiInsight').textContent = '';
        el('yrAiLetter').textContent = '';
        return;
      }

      this._renderYearEndContent(data);
      el('yrLoading').hidden = true;
      el('yrContent').hidden = false;
    } catch (err) {
      // 에러가 나도 X 버튼은 항상 작동
      el('yrLoading').innerHTML = `
        <i class="ti ti-server-off" style="font-size:36px;color:var(--ink3)"></i>
        <p style="color:var(--ink3)">분석 실패: ${esc(err.message)}</p>
        <button onclick="Library.closeYearEnd()" style="margin-top:10px;padding:8px 16px;background:var(--mahogany2);color:var(--gold);border:none;border-radius:6px;cursor:pointer;font-family:var(--serif)">닫기</button>`;
    }
  },

  _renderYearEndContent(data) {
    const { year, totalItems, byCategory, topKeywords, bestSentences, aiAnalysis } = data;

    // 숫자 통계
    el('yrNums').innerHTML = `
      <div class="yr-num"><div class="n">${totalItems}</div><div class="l">총 저장</div></div>
      <div class="yr-num"><div class="n">${Object.keys(byCategory).length}</div><div class="l">서가 수</div></div>
      <div class="yr-num"><div class="n">${topKeywords?.length || 0}</div><div class="l">수집 키워드</div></div>
      <div class="yr-num"><div class="n">${bestSentences?.length || 0}</div><div class="l">베스트 문장</div></div>`;

    // 3대 키워드
    const kws = aiAnalysis?.top3Keywords || [];
    el('yrKwRow').innerHTML = kws.length
      ? kws.map((k, i) => `
          <div class="yr-kw-card">
            <div class="yr-kw-rank">${RANK_MARKS[i]}</div>
            <div class="yr-kw-word">${esc(k.word)}</div>
            <div class="yr-kw-desc">${esc(k.description)}</div>
          </div>`).join('')
      : '<p style="color:var(--ink3);font-size:13px">키워드 데이터 부족</p>';

    // 도넛 차트
    const catEntries = Object.entries(byCategory).sort((a,b) => b[1]-a[1]);
    const total = catEntries.reduce((s,[,v]) => s+v, 0);
    const slices = catEntries.map(([cat, v]) => ({
      c: CAT_DONUT_COLORS[cat] || '#888', v, cat,
      label: (SHELF_META[cat] || SHELF_META.inbox).kr
    }));
    requestAnimationFrame(() => drawDonut('yrDonut', slices));
    el('yrLegend').innerHTML = slices.map(s => `
      <div class="yr-leg-row">
        <span class="yr-leg-dot" style="background:${esc(s.c)}"></span>
        <span class="yr-leg-name">${esc(s.label)}</span>
        <span class="yr-leg-pct">${total ? Math.round(s.v/total*100) : 0}%</span>
        <span class="yr-leg-n">${s.v}권</span>
      </div>`).join('');

    // 베스트 문장 TOP 5
    el('yrBest').innerHTML = (bestSentences || []).map((item, i) => {
      const m = SHELF_META[item.category] || SHELF_META.inbox;
      return `
        <div class="yr-best-item">
          <div class="yr-rank">${RANK_MARKS[i]}</div>
          <div class="yr-best-body">
            <div class="yr-best-text">${esc(item.text)}</div>
            <div class="yr-best-meta">
              <span class="yr-best-cat cat-${esc(item.category)}" style="background:${m.color}22;color:${m.color}">${esc(m.kr)}</span>
              <span class="yr-best-date">${esc(item.date)}</span>
            </div>
          </div>
        </div>`;
    }).join('') || '<p style="color:var(--ink3)">저장된 문장이 없습니다</p>';

    // AI 분석
    const ai = aiAnalysis || {};
    if (el('yrAiSummary')) el('yrAiSummary').textContent = ai.yearSummary        || '';
    if (el('yrAiInsight')) el('yrAiInsight').textContent = ai.crossCategoryInsight || '';
    if (el('yrAiLetter'))  el('yrAiLetter').textContent  = ai.letterToNextYear    || '';
    if (el('yrMockNote'))  el('yrMockNote').hidden = !ai._mock;
  },

  // ─── 토스트 ───
  toast(msg, type = '') {
    const t = el('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast show${type ? ' '+type : ''}`;
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), 2800);
  }
};

// ══════════════════════════════════════════════
//  글로벌 단축키
// ══════════════════════════════════════════════

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!el('printOverlay').hidden)       { Library.closePrintReport(); return; }
    if (!el('feedSettingsOverlay').hidden){ Library.closeFeedSettings(); return; }
    if (!el('feedOverlay').hidden)        { Library.closeDailyFeedView(); return; }
    if (!el('inboxProcessOverlay').hidden) { Library.closeInboxProcess(); return; }
    if (!el('graphOverlay').hidden)      { Library.closeGraph();      return; }
    if (!el('catManagerOverlay').hidden) { Library.closeCatManager(); return; }
    if (!el('detailOverlay').hidden)     { Library.closeDetail();     return; }
    if (!el('yearEndOverlay').hidden)  { Library.closeYearEnd(); return; }
    if (!el('weeklyOverlay').hidden)   { Library.closeWeekly();  return; }
    if (!el('captureOverlay').hidden)  { Library.closeCapture(); return; }
  }
  // n 키로 빠른 지식 추가
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'TEXTAREA') {
    Library.openCapture();
  }
});

// ══════════════════════════════════════════════
//  시작
// ══════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => Library.init());
