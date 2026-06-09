/**
 * SJ 지식 서재 — app.js v3
 * 서가형 UI, 타임머신, 통찰 카드, 연말 결산 모달 완전 재구축
 */

'use strict';

const API = 'http://localhost:3000/api';

// ══════════════════════════════════════════════
//  메타데이터
// ══════════════════════════════════════════════

const SHELF_META = {
  en:      { label: '英語 서가',   plaque: 'en',      kr: '비즈니스 영어', icon: 'ti-language',          color: '#4a7cc7', desc: '언어의 힘으로 세계를 읽는 서가' },
  history: { label: '歷史 서가',   plaque: 'history', kr: '역사 타임라인', icon: 'ti-building-monument', color: '#c47a30', desc: '시간의 흐름 속 인간의 이야기' },
  economy: { label: '經濟 서가',   plaque: 'economy', kr: '경제·기사',     icon: 'ti-trending-up',       color: '#2d9a56', desc: '세계의 흐름을 읽는 경제 지식' },
  youtube: { label: '影像 서가',   plaque: 'youtube', kr: '유튜브 요약',   icon: 'ti-brand-youtube',     color: '#cc3333', desc: '영상에서 건져올린 핵심 지식' },
  inbox:   { label: '臨時 서랍',   plaque: 'inbox',   kr: '임시 보관함',   icon: 'ti-inbox',             color: '#8a7a60', desc: '하루 안에 서가로 이동될 예정' },
  all:     { label: '全 서가',     plaque: 'all',     kr: '전체',          icon: 'ti-books',             color: '#5c3d2e', desc: '모든 지식이 모인 서재의 전경' },
};

const CAT_DONUT_COLORS = {
  en: '#4a7cc7', history: '#c47a30', economy: '#2d9a56',
  youtube: '#cc3333', inbox: '#8a7a60', general: '#888070'
};
const RANK_MARKS = ['Ⅰ','Ⅱ','Ⅲ','Ⅳ','Ⅴ'];

// ══════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════

const state = { shelf: 'all', items: [] };

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
  const { todayCount=0, weekCount=0, streak=0, total=0, shelfCounts={}, grassData=[] } = stats;
  updateRing(todayCount);
  if (el('msWeek'))   el('msWeek').textContent   = weekCount;
  if (el('msTotal'))  el('msTotal').textContent  = total;
  if (el('msStreak')) el('msStreak').textContent = streak;
  if (el('streakNum')) el('streakNum').textContent = streak;
  const setN = (id, n) => { const e = el(id); if (e) e.textContent = n; };
  setN('sc-en',      shelfCounts.en      || 0);
  setN('sc-history', shelfCounts.history || 0);
  setN('sc-economy', shelfCounts.economy || 0);
  setN('sc-inbox',   shelfCounts.inbox   || 0);
  renderGrass(grassData);
}

// ══════════════════════════════════════════════
//  서가 렌더링 (핵심)
// ══════════════════════════════════════════════

function bookCardHTML(item) {
  const m   = SHELF_META[item.category] || SHELF_META.inbox;
  const kws = (item.keywords || []).slice(0, 4)
    .map(k => `<span class="book-kw">${esc(k)}</span>`).join('');
  const isEn = item.category === 'en';

  return `
  <article class="book-card ${esc(item.category)}" data-id="${esc(item.id)}" tabindex="0">
    <div class="book-spine"></div>
    <div class="book-inner">
      <div class="book-cat ${esc(item.category)}">
        <i class="ti ${m.icon}" aria-hidden="true"></i> ${esc(m.kr)}
      </div>
      ${item.summary ? `<div style="font-size:11px;color:var(--ink3);margin-bottom:6px;font-style:italic">${esc(item.summary)}</div>` : ''}
      <div class="book-text${isEn ? ' english' : ''}">${esc(item.text)}</div>
      ${kws ? `<div class="book-kws">${kws}</div>` : ''}
      <div class="book-footer">
        <span class="book-src"><i class="ti ti-archive" aria-hidden="true"></i>${esc(item.source||'manual')}</span>
        <span class="book-date">${fmtDate(item.date)}</span>
        <div class="book-actions">
          <button class="book-btn" title="복사" onclick="Library.copyItem('${esc(item.id)}',this)" aria-label="복사"><i class="ti ti-copy"></i></button>
          <button class="book-btn del" title="삭제" onclick="Library.deleteItem('${esc(item.id)}')" aria-label="삭제"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    </div>
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

function renderBookshelf(items) {
  const shelf    = el('bookshelf');
  if (!shelf) return;

  if (!items.length) {
    shelf.innerHTML = `
      <div class="shelf-empty">
        <i class="ti ti-books"></i>
        <p>서재가 비어 있습니다</p>
        <span>우측 상단 '지식 추가' 버튼으로 첫 권을 꽂아 보세요</span>
      </div>`;
    return;
  }

  let html = '';

  if (state.shelf === 'all') {
    // 전체 보기: 서가별 섹션 분리
    const groups = groupByShelf(items);
    const shelfKeys = SHELF_ORDER.filter(s => groups[s]?.length)
      .concat(Object.keys(groups).filter(s => !SHELF_ORDER.includes(s) && groups[s]?.length));

    shelfKeys.forEach(s => {
      const its = groups[s];
      const m   = SHELF_META[s] || SHELF_META.inbox;
      html += `
        <div class="shelf-section" id="section-${s}">
          <div class="shelf-name-row">
            <span class="shelf-plaque ${s}">${m.label}</span>
            <div class="shelf-bar"></div>
            <span class="shelf-count">${its.length}권</span>
          </div>
          <div class="book-grid">${its.map(bookCardHTML).join('')}</div>
        </div>`;
    });
  } else {
    // 특정 서가만
    const m = SHELF_META[state.shelf] || SHELF_META.inbox;
    html = `
      <div class="shelf-section">
        <div class="shelf-name-row">
          <span class="shelf-plaque ${state.shelf}">${m.label}</span>
          <div class="shelf-bar"></div>
          <span class="shelf-count">${items.length}권</span>
        </div>
        <div class="book-grid">${items.map(bookCardHTML).join('')}</div>
      </div>`;
    if (!items.length) html = `
      <div class="shelf-empty">
        <i class="ti ti-book-off"></i>
        <p>${m.label}이 비어 있습니다</p>
        <span>${m.desc}</span>
      </div>`;
  }

  shelf.innerHTML = html;
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
    await this.refresh();
    Library.loadTimeMachine();
    loadInsights();
  },

  async refresh() {
    try {
      const q = state.shelf === 'all' ? '' : `?category=${state.shelf}`;
      const [itemsData, statsData] = await Promise.all([
        api(`/items${q}&limit=200`),
        api('/stats')
      ]);

      state.items = itemsData.items || [];
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
    const m = SHELF_META[shelfId] || SHELF_META.all;
    if (el('shelfTitle')) el('shelfTitle').textContent = m.label;
    if (el('shelfDesc'))  el('shelfDesc').textContent  = m.desc;

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
      const m = SHELF_META[result.item?.category] || SHELF_META.inbox;
      this.toast(`📚 ${m.label}에 꽂았습니다`, 'ok');
      await this.refresh();
      // 통찰 갱신 (비동기)
      setTimeout(() => loadInsights(), 500);
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
    // X 버튼 안전 바인딩 (이벤트 중복 방지)
    const closeBtn = el('yrCloseBtn');
    if (closeBtn) {
      closeBtn.onclick = null;
      closeBtn.onclick = () => this.closeYearEnd();
    }
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

  async _loadYearEnd() {
    el('yrLoading').hidden  = false;
    el('yrContent').hidden  = true;

    const year = new Date().getFullYear();
    if (el('yrBadgeYear')) el('yrBadgeYear').textContent = year;

    try {
      const data = await api(`/report/year-end?year=${year}`);

      if (!data.totalItems) {
        el('yrLoading').innerHTML = `<i class="ti ti-books" style="font-size:36px;color:var(--ink3)"></i><p style="color:var(--ink3)">${year}년 저장된 지식이 없습니다</p>`;
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
