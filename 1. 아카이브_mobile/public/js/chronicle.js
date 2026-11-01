/**
 * chronicle.js — 개인 연대기 (PC 웹)
 * ────────────────────────────────────────────
 * 모바일 SPA(Mob 네임스페이스)와 완전히 독립된 별도 페이지 스크립트.
 * 데이터는 같은 도메인의 기존 API를 그대로 사용한다 — 별도 백엔드/DB 없음.
 *   GET  /api/auth/me                      세션 확인
 *   POST /api/auth/login                   로그인
 *   GET  /api/items?mode=&limit=           기록 전체(연대기 재료)
 *   GET  /api/chronicle/review/:year?mode= 연말 AI 회고(기록이 바뀔 때만 다시 씀)
 * 같은 오리진이라 httpOnly 쿠키 세션이 그대로 먹는다(별도 도메인이면 sameSite=lax 때문에 불가).
 */

'use strict';

(function () {

  /* ── 상수 ───────────────────────────────── */
  const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
  const JI  = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
  const DOW = ['일','월','화','수','목','금','토'];

  /* 앱의 8대 도메인을 그대로 쓰되, 연대기 화면 톤에 맞춘 라벨/색 */
  const DOMAIN = {
    business:   { label: '비즈니스·경제', color: 'var(--d-business)' },
    language:   { label: '언어·표현',     color: 'var(--d-language)' },
    humanities: { label: '역사·문명',     color: 'var(--d-humanities)' },
    psychology: { label: '심리·철학',     color: 'var(--d-psychology)' },
    science:    { label: '과학·기술',     color: 'var(--d-science)' },
    arts:       { label: '문화·예술',     color: 'var(--d-arts)' },
    life:       { label: '자취·일상',     color: 'var(--d-life)' },
    society:    { label: '사회·정치',     color: 'var(--d-society)' },
  };
  const dom = d => DOMAIN[d] || { label: '기타', color: 'var(--text-3)' };

  /* ── 상태 ───────────────────────────────── */
  const state = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    selected: null,
    mode: '',            // '' = 전체
    includeAuto: false,  // 매일 자동 배달된 지식 카드 포함 여부
    raw: [],             // API 원본
    byDate: {},          // 'YYYY-MM-DD' → items[]
    aiCache: {},         // year|mode → summary
    cat: '',             // 분류 필터 — '' 전체 / 'memory' 추억 / 'study' 공부 전체 / 'english' 등 (CATS 참고)
    scope: 'day',        // 하루 보기 범위 — 'day' 그날 / 'week' 그 주 / 'month' 그 달 (복습용)
    quiz: false,         // 답 가리기 — 공부한 카드의 뜻·설명을 가려서 스스로 떠올려 보게
  };

  /* 샘플 미리보기 — chronicle.html?demo=1. 로그인·DB 없이 js/chronicle_demo.js의 가짜 기록으로 화면을 그린다.
     실제 계정에 기록을 넣지 않고 화면을 확인하기 위한 모드라 서버에 아무것도 쓰지 않는다. */
  const DEMO = new URLSearchParams(location.search).has('demo');

  /* ── 분류(추억 vs 공부) ─────────────────────
     추억 = 사진·일상 기록, 공부 = 배달·저장한 지식(영어·고전·역사…), 메모 = 영상·링크 등 그 밖의 것.
     복습할 때 "영어만, 이번 주만"처럼 좁혀 보기 위한 분류다. */
  const CATS = [
    { key: '',        label: '전체' },
    { key: 'memory',  label: '추억' },
    { key: 'note',    label: '노트' },
    { key: 'study',   label: '공부 전체' },
    { key: 'english', label: '영어' },
    { key: 'classic', label: '고전·명언' },
    { key: 'history', label: '역사' },
    { key: 'idiom',   label: '고사성어' },
    { key: 'insight', label: '인사이트' },
    { key: 'wrong',   label: '오답노트' },
    { key: 'memo',    label: '메모·링크' },
  ];
  const STUDY_CATS = new Set(['english', 'classic', 'history', 'idiom', 'insight', 'wrong']);
  const KIND_TO_CAT = [
    [/^영어|^수능 영단어/, 'english'], [/^고전|^명언/, 'classic'], [/^역사|^한국사/, 'history'],
    [/^고사성어/, 'idiom'], [/^인사이트/, 'insight'], [/^오답노트/, 'wrong'],
  ];
  const _catCache = new WeakMap();
  function catOf(it) {
    if (_catCache.has(it)) return _catCache.get(it);
    let c = 'memo';
    if (isLife(it)) c = 'memory';
    else if (it.type === 'note') c = 'note';
    else {
      const v = learnedView(it);
      if (v) c = (KIND_TO_CAT.find(([re]) => re.test(v.kind)) || [null, 'memo'])[1];
    }
    _catCache.set(it, c);
    return c;
  }
  function matchesCat(it) {
    if (!state.cat) return true;
    const c = catOf(it);
    return state.cat === 'study' ? STUDY_CATS.has(c) : c === state.cat;
  }

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const ganji = y => GAN[(y - 4) % 10] + JI[(y - 4) % 12];
  const pad2 = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

  async function api(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json())?.error || ''; } catch {}
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /* ── 아이템 분류 ─────────────────────────── */
  const isLife = it => it.contentType === 'life';
  const isAuto = it => it.type === 'daily_delivery';
  const dateKey = it => String(it.date || it.createdAt || '').slice(0, 10);

  /* 표제일(記) = 그날 자취(사진·일상) 기록이 있는 날 — "무엇을 했고 어디 갔는지" */
  const isSeal = key => (state.byDate[key] || []).some(isLife);

  /* ── 부팅 ───────────────────────────────── */
  async function boot() {
    $('gateGanji').textContent = ganji(state.year);
    if (DEMO) {
      /* 데모 데이터 스크립트는 이때만 불러온다 — 평소에는 한 바이트도 받지 않게 */
      await new Promise((ok, bad) => {
        const s = document.createElement('script');
        s.src = 'js/chronicle_demo.js?v=7'; s.onload = ok; s.onerror = () => bad(new Error('샘플 데이터를 불러오지 못했어요'));
        document.head.appendChild(s);
      }).catch(e => fail(e.message));
      $('demoBanner').hidden = false;
      return enter();
    }
    try {
      await api('/api/auth/me');
      await enter();
    } catch (e) {
      if (e.status === 401) openGate();
      else fail(e.message);
    }
  }

  function openGate() {
    $('loading').hidden = true;
    $('gate').dataset.open = '1';
    $('gateEmail').focus();
  }

  function fail(msg) {
    $('loading').textContent = '불러오지 못했습니다 — ' + msg;
  }

  $('gateForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('gateBtn'), err = $('gateErr');
    err.textContent = '';
    btn.disabled = true; btn.textContent = '확인 중…';
    try {
      await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('gateEmail').value.trim(), password: $('gatePw').value })
      });
      $('gate').dataset.open = '0';
      $('loading').hidden = false;
      $('loading').textContent = '불러오는 중…';
      await enter();
    } catch (e2) {
      err.textContent = e2.message || '로그인에 실패했어요';
    } finally {
      btn.disabled = false; btn.textContent = '들어가기';
    }
  });

  async function enter() {
    await loadItems();
    $('loading').hidden = true;
    $('wrap').hidden = false;
    renderLegend();
    renderAll();
    openAlbumFromLink();
    loadKmap();
  }

  /* 앱 홈의 '1년 전 오늘' 카드에서 넘어올 때 — chronicle.html?album=2025-10-14
     그날이 든 여행이 있으면 앨범을 바로 펼쳐 넘겨보기 시작, 없으면 그날을 연다. */
  function openAlbumFromLink() {
    const k = new URLSearchParams(location.search).get('album');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k || '')) return;
    if (Number(k.slice(0, 4)) !== state.year) {
      state.year = Number(k.slice(0, 4)); state.month = Number(k.slice(5, 7)) - 1;
      regroup(); renderAll();
    }
    const trip = tripsOf().find(t => t.from <= k && k <= t.to);
    if (trip && trip.photos) return playAlbum(trip);
    if (state.byDate[k]) { select(k); $('day').scrollIntoView({ block: 'start' }); }
  }

  /* ── 데이터 ─────────────────────────────── */
  async function loadItems() {
    /* 모드 격리 규칙에 따라 모드를 지정할 땐 반드시 파라미터로 명시.
       '전체'는 연대기 전용(직장인+수험생을 한 타임라인에 얹기 위함) — 이때만 생략. */
    if (DEMO) {
      /* 샘플 + 이 브라우저에서 추가한 기록, 그리고 적어 둔 생각을 합친다 */
      const st = demoStore.read();
      /* 노트: 저장본(수정·새 노트)이 샘플을 덮고, 지운 샘플 노트는 뺀다 */
      const notes = st.notes || [], gone = new Set(st.deletedNotes || []);
      const noteIds = new Set(notes.map(n => n.id));
      const all = [...(window.CHRONICLE_DEMO_ITEMS || []).filter(it => !noteIds.has(it.id) && !gone.has(it.id)), ...(st.added || []), ...notes]
        .map(it => (st.thoughts && st.thoughts[it.id] !== undefined ? { ...it, myInsight: st.thoughts[it.id] } : it));
      state.raw = all.filter(it => !state.mode || (it.mode || 'PROFESSIONAL') === state.mode).map(fixDomain);
      regroup();
      return;
    }
    const q = state.mode ? `?mode=${encodeURIComponent(state.mode)}&limit=2000` : '?limit=2000';
    const data = await api('/api/items' + q);
    state.raw = (Array.isArray(data.items) ? data.items : []).map(fixDomain);
    regroup();
  }

  /* 저장 경로에 따라 domain이 기본값 'business'로 들어간 기록이 있다(수험생 단어·한국사·오답, 저장한 고전).
     그대로 두면 연대기의 색·비율이 "비즈니스·경제"로 쏠리므로 내용으로 다시 판단한다. 원본은 건드리지 않는다. */
  const WA_DOMAIN = { math: 'science', science: 'science', physics: 'science', chemistry: 'science',
                      biology: 'science', earth: 'science', english: 'language', korean: 'language',
                      history: 'humanities', korean_history: 'humanities', social: 'society', ethics: 'psychology' };
  const FD_DOMAIN = { liber: 'psychology', quote: 'psychology', idiom: 'humanities', history: 'humanities' };
  function fixDomain(it) {
    let d = null;
    if (it.examWord) d = 'language';
    else if (it.examHistory) d = 'humanities';
    else if (it.wrongAnswer) d = WA_DOMAIN[it.wrongAnswer.subject] || 'science';
    else if (it.feedData && FD_DOMAIN[it.feedData.subType]) d = FD_DOMAIN[it.feedData.subType];
    return d && d !== it.domain ? { ...it, domain: d } : it;
  }

  /* 글 없이 저장한 자취는 서버가 제목을 '라이프 기록'으로 채운다 — 유저가 쓴 글이 아니므로 캡션으로 쓰지 않는다 */
  const DEFAULT_LIFE_TITLE = '라이프 기록';
  const lifeCaption = it => (it.text || (it.title !== DEFAULT_LIFE_TITLE ? it.title : '') || '').trim();

  function regroup() {
    const map = {};
    for (const it of state.raw) {
      if (!state.includeAuto && isAuto(it)) continue;
      if (!matchesCat(it)) continue;      // 분류 필터 — 달력 점·파형·통계·하루 보기가 모두 같은 기준을 따른다
      const k = dateKey(it);
      if (!k) continue;
      (map[k] || (map[k] = [])).push(it);
    }
    /* 하루 안에서는 자취(사진)를 먼저, 그다음 최신순 */
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => (isLife(b) - isLife(a)) ||
        String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    }
    state.byDate = map;
  }

  const yearKeys = () => Object.keys(state.byDate).filter(k => k.startsWith(state.year + '-'));
  const countOf  = k => (state.byDate[k] || []).length;

  /* ── 렌더: 전체 ──────────────────────────── */
  function renderAll() {
    $('ganji').textContent = ganji(state.year);
    $('yearLabel').textContent = state.year;
    $('nextYear').disabled = state.year >= new Date().getFullYear();

    /* 선택 기본값: 그 해에서 기록이 있는 가장 최근 날 */
    const keys = yearKeys().sort();
    if (!state.selected || !state.selected.startsWith(state.year + '-')) {
      state.selected = keys.length ? keys[keys.length - 1] : `${state.year}-${pad2(state.month + 1)}-01`;
      state.month = Number(state.selected.slice(5, 7)) - 1;
    }

    renderStats();
    renderCats();
    renderMonth();
    renderWave();
    renderDay();
    renderReview();
    renderFilterNote();
  }

  /* 분류 칩 — 올해 실제로 있는 분류만 보인다(없는 분류 칩은 누를 이유가 없다) */
  function renderCats() {
    const counts = {};
    yearRaw().forEach(it => {
      if (!state.includeAuto && isAuto(it)) return;
      const c = catOf(it);
      counts[c] = (counts[c] || 0) + 1;
      if (STUDY_CATS.has(c)) counts.study = (counts.study || 0) + 1;
    });
    $('cats').innerHTML = CATS
      .filter(c => !c.key || counts[c.key] || c.key === state.cat)
      .map(c => `<button type="button" data-cat="${c.key}" aria-pressed="${c.key === state.cat}">
          ${esc(c.label)}${c.key && counts[c.key] ? `<small>${counts[c.key]}</small>` : ''}</button>`)
      .join('');
    $('cats').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.cat = b.dataset.cat;
      /* 공부 분류를 고르면 복습이 목적이므로 범위를 한 주로 넓혀 준다. 전체·추억으로 돌아오면 그날로 */
      state.scope = (state.cat && state.cat !== 'memory') ? (state.scope === 'day' ? 'week' : state.scope) : 'day';
      regroup();
      const keep = state.selected;
      renderAll();
      if (keep && keep.startsWith(state.year + '-')) select(keep);
    }));
  }

  function renderFilterNote() {
    const total = state.raw.length;
    const auto  = state.raw.filter(isAuto).length;
    $('filterNote').textContent = state.includeAuto
      ? `전체 ${total}건`
      : `자동 배달 ${auto}건 제외 · ${total - auto}건 표시`;
  }

  function renderStats() {
    const keys = yearKeys();
    const total = keys.reduce((s, k) => s + countOf(k), 0);
    const byMonth = Array(12).fill(0);
    keys.forEach(k => { byMonth[Number(k.slice(5, 7)) - 1] += countOf(k); });
    const busy = byMonth.indexOf(Math.max(...byMonth));

    $('statTotal').textContent = total;
    $('statDays').textContent  = keys.length;
    $('statMonth').textContent = total ? (busy + 1) + '월' : '—';
  }

  function renderLegend() {
    $('legend').innerHTML = Object.entries(DOMAIN)
      .map(([, v]) => `<span><i class="dot" style="background:${v.color}"></i>${esc(v.label)}</span>`)
      .join('') + `<span><i class="seal">記</i>자취를 남긴 날</span>`;
  }

  /* ── 렌더: 월 보기(가로 날짜 스트립) ─────── */
  function renderMonth() {
    $('monthLabel').textContent = (state.month + 1) + '월';
    const strip = $('monthStrip');
    const last  = daysInMonth(state.year, state.month);
    const todayKey = isoOf(new Date());
    let html = '';

    for (let d = 1; d <= last; d++) {
      const key = `${state.year}-${pad2(state.month + 1)}-${pad2(d)}`;
      const date = new Date(state.year, state.month, d);
      const items = state.byDate[key] || [];
      const kinds = [...new Set(items.map(i => i.domain))].slice(0, 3);
      const marks = isSeal(key)
        ? `<i class="seal">記</i>`
        : kinds.map(k => `<i class="dot" style="background:${dom(k).color}"></i>`).join('');
      html += `<button class="daycell${items.length ? ' has' : ''}${date.getDay() === 0 ? ' sun' : ''}${key === todayKey ? ' today' : ''}"
                 role="option" aria-selected="${key === state.selected}" data-key="${key}"
                 title="${items.length ? items.length + '건' : '기록 없음'}">
                 <span class="daycell__dow">${DOW[date.getDay()]}</span>
                 <span class="daycell__num">${d}</span>
                 <span class="daycell__marks">${marks}</span>
               </button>`;
    }
    strip.innerHTML = html;
    strip.querySelectorAll('.daycell').forEach(c =>
      c.addEventListener('click', () => select(c.dataset.key)));
    centerSelectedDay();
  }

  /* 고른 날짜를 스트립 가운데로.
     scrollIntoView는 가로 컨테이너를 제대로 안 움직이고 페이지까지 스크롤시키는 경우가 있어
     컨테이너 scrollLeft를 직접 계산한다. behavior:'smooth'는 scroll-snap과 충돌해
     중간에 되돌아가므로 즉시 이동시킨다(스냅은 손으로 스크롤할 때만 쓰임). */
  function centerSelectedDay() {
    const strip = $('monthStrip');
    const sel = strip.querySelector('[aria-selected="true"]');
    if (!sel) return;
    strip.scrollLeft = sel.offsetLeft - (strip.clientWidth - sel.offsetWidth) / 2;
  }

  /* ── 렌더: 년 파형 ───────────────────────── */
  function renderWave() {
    const wave = $('wave'), ruler = $('ruler');
    const days = [];
    const cur = new Date(state.year, 0, 1);
    while (cur.getFullYear() === state.year) {
      days.push({ key: isoOf(cur), date: new Date(cur) });
      cur.setDate(cur.getDate() + 1);
    }
    const max = Math.max(1, ...days.map(d => countOf(d.key)));

    wave.innerHTML = '';
    days.forEach(({ key, date }) => {
      const n = countOf(key);
      const bar = document.createElement('span');
      bar.style.height = (n === 0 ? 3 : 14 + (n / max) * 86) + 'px';
      const items = state.byDate[key] || [];
      const main = items.length
        ? items.map(i => i.domain).sort((a, b) =>
            items.filter(i => i.domain === b).length - items.filter(i => i.domain === a).length)[0]
        : null;
      bar.style.background = isSeal(key) ? 'var(--jusa)' : (main ? dom(main).color : 'var(--border)');
      if (date.getDate() === 1) bar.style.boxShadow = '-1px 0 0 var(--border-soft)';
      wave.appendChild(bar);
    });
    wave.dataset.len = days.length;
    wave.setAttribute('aria-valuemax', days.length);

    ruler.innerHTML = '';
    for (let m = 0; m < 12; m++) {
      const s = document.createElement('span');
      s.style.flexGrow = daysInMonth(state.year, m);
      s.textContent = (m + 1) + '월';
      ruler.appendChild(s);
    }
    wave._days = days;
  }

  function waveIndex(x) {
    const wave = $('wave');
    const r = wave.getBoundingClientRect();
    const len = Number(wave.dataset.len || 365);
    return Math.min(len - 1, Math.max(0, Math.floor((x - r.left) / r.width * len)));
  }
  function peek(i) {
    const wave = $('wave');
    const d = wave._days[i];
    if (!d) return;
    const n = countOf(d.key);
    wave.classList.add('dim');
    [...wave.children].forEach((b, j) => b.classList.toggle('hot', j === i));
    $('readout').innerHTML =
      `<b>${d.date.getMonth() + 1}월 ${d.date.getDate()}일</b>` +
      `<span>${n ? `기록 ${n}건` : '기록 없음'}${isSeal(d.key) ? ' · 자취' : ''}</span>`;
    wave.setAttribute('aria-valuenow', i + 1);
  }

  $('wave').addEventListener('pointermove', e => peek(waveIndex(e.clientX)));
  $('wave').addEventListener('pointerleave', () => {
    $('wave').classList.remove('dim');
    $('readout').innerHTML = '<span>막대를 짚으면 그날의 기록 수가 보입니다.</span>';
  });
  $('wave').addEventListener('click', e => {
    const d = $('wave')._days[waveIndex(e.clientX)];
    if (d) { state.month = d.date.getMonth(); select(d.key); }
  });
  $('wave').addEventListener('keydown', e => {
    const wave = $('wave');
    const len = Number(wave.dataset.len || 365);
    const cur = Number(wave.getAttribute('aria-valuenow')) - 1;
    if (e.key === 'ArrowRight') { e.preventDefault(); peek(Math.min(len - 1, cur + 1)); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); peek(Math.max(0, cur - 1)); }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const d = wave._days[cur];
      if (d) { state.month = d.date.getMonth(); select(d.key); }
    }
  });

  /* ── 렌더: 하루 ──────────────────────────── */
  function select(key) {
    state.selected = key;
    const m = Number(key.slice(5, 7)) - 1;
    if (m !== state.month) {
      state.month = m;
      renderMonth();
    } else {
      $('monthStrip').querySelectorAll('.daycell').forEach(c =>
        c.setAttribute('aria-selected', c.dataset.key === key));
      centerSelectedDay();
    }
    renderDay();
  }

  function photoCard(it) {
    const photos = (it.life?.photos || []).filter(Boolean);
    const meta = [it.life?.mood, it.life?.location, it.life?.weather].filter(Boolean).join(' · ');
    const caption = lifeCaption(it);
    /* lazy 로딩을 쓰지 않는다 — 하루치 사진은 몇 장 안 되고, 지연되면 404 대체 표시가
       화면에 들어올 때까지 안 걸려서 빈 칸으로 보인다(재배포 전 업로드분은 전부 유실 상태). */
    const shots = photos.length
      ? `<div class="shots">${photos.map(p =>
          `<img src="${esc(p)}" alt=""
                onerror="this.outerHTML='&lt;div class=&quot;shot-missing&quot;&gt;사진을 찾을 수 없어요&lt;/div&gt;'"/>`).join('')}</div>`
      : '';
    return `<article class="entry">
      <div class="entry__kind"><i class="dot" style="background:${dom('life').color}"></i>자취·일상</div>
      <figure>
        ${shots}
        ${(caption || meta) ? `<figcaption>${caption ? `<span class="entry__cap">${esc(caption)}</span>` : ''}${meta ? `<div class="entry__meta">${esc(meta)}</div>` : ''}</figcaption>` : ''}
      </figure>
    </article>`;
  }

  function youtubeCard(it) {
    const d = dom(it.domain);
    return `<article class="entry">
      <div class="entry__kind"><i class="dot" style="background:${d.color}"></i>영상</div>
      ${it.thumbnail ? `<img class="entry__thumb" src="${esc(it.thumbnail)}" alt="" loading="lazy"/>` : ''}
      <div class="entry__body">
        <h3 class="entry__title">${esc(it.title || '영상')}</h3>
        ${it.channelName ? `<p class="entry__meta">${esc(it.channelName)}</p>` : ''}
        ${thoughtOf(it) ? `<p class="entry__note">${esc(thoughtOf(it))}</p>` : ''}
        ${it.source ? `<a class="entry__link" href="${esc(it.source)}" target="_blank" rel="noopener">유튜브에서 보기 ↗</a>` : ''}
      </div>
    </article>`;
  }

  const isUrl = s => /^https?:\/\/\S+$/.test(String(s || '').trim());

  function textCard(it) {
    const d = dom(it.domain);
    const a = it.analysis || {};
    const firstLine = (it.text || '').split('\n')[0].trim();

    /* 공유 시트로 들어온 링크는 title이 URL 그대로인 경우가 있다 — 그땐 요약을 제목으로 올리고
       URL은 아래 링크로 뺀다(제목 자리에 주소가 박히면 읽기 어렵다). */
    const candidates = [a.title, it.title, it.summary, firstLine].filter(Boolean);
    const title = candidates.find(t => !isUrl(t)) || '기록';

    const link = [it.source, it.title, firstLine].find(isUrl) || null;

    let body = a.summary || it.summary || it.text || '';
    if (body === title || isUrl(body)) body = (it.text && it.text !== title && !isUrl(it.text)) ? it.text : '';
    if (body.length > 420) body = body.slice(0, 420) + '…';

    return `<article class="entry">
      <div class="entry__kind">
        <i class="dot" style="background:${d.color}"></i>${esc(d.label)}
        ${isAuto(it) ? '<span class="auto">배달</span>' : ''}
      </div>
      <div class="entry__body">
        <h3 class="entry__title">${esc(title)}</h3>
        ${body ? `<p class="entry__text">${esc(body)}</p>` : ''}
        ${thoughtOf(it) ? `<p class="entry__note">${esc(thoughtOf(it))}</p>` : ''}
        ${link ? `<a class="entry__link" href="${esc(link)}" target="_blank" rel="noopener">원문 열기 ↗</a>` : ''}
      </div>
    </article>`;
  }

  /* ── 배운 것 카드 ────────────────────────────
     배달에서 저장한 지식은 원본 구조(feedData)나 "[태그] 표현\n뜻: …" 형식 텍스트로 남아 있어
     textCard로 그리면 내부 키·중복 본문이 그대로 보인다. 종류별로 풀어서 "무엇을 배웠는지"가
     한눈에 보이게 한다. 못 알아보는 모양이면 null → textCard로 넘긴다. */
  function parseEntryText(text) {
    const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    const pick = label => (lines.find(l => l.startsWith(label + ':')) || '').slice(label.length + 1).trim();
    const meaning = pick('뜻');
    if (!meaning) return null;
    return {
      expr: lines[0].replace(/^\[[^\]]*\]\s*/, ''),
      meaning,
      nuance: pick('뉘앙스'),
    };
  }

  function learnedView(it) {
    const fd = it.feedData;
    if (fd && typeof fd === 'object') {
      const sub = fd.subType || '';
      if (sub === 'liber' && fd.quote) return {
        kind: '고전', quote: fd.quote,
        sub: [fd.book || fd.source, fd.author].filter(Boolean).join(' — '),
        detail: fd.backstory || fd.context || '',
      };
      if (sub === 'idiom' && fd.idiom) return {
        kind: '고사성어', title: fd.idiom + (fd.hanja ? ` ${fd.hanja}` : ''),
        sub: fd.meaning || '', detail: fd.origin || fd.story || '',
      };
      if (sub === 'history' && fd.title) return {
        kind: '역사', title: fd.title,
        sub: [fd.period, fd.region].filter(Boolean).join(' · '),
        detail: fd.summary || fd.summary3 || fd.behindStory || '',
      };
      if (sub === 'quote' && fd.quote) return {
        kind: '명언', quote: fd.quote, sub: fd.author || '', detail: fd.context || fd.story || '',
      };
      if (sub === 'insight' && (fd.headline || fd.topic)) return {
        kind: '인사이트', title: fd.headline || fd.topic,
        sub: fd.headline && fd.topic ? fd.topic : '', detail: fd.body || fd.summary || '',
      };
      const vocab = Array.isArray(fd.vocabEntries) ? fd.vocabEntries : [];
      if (vocab.length) return {
        kind: '영어 · 테마팩', title: fd.themeTitle || fd.title || '오늘의 표현',
        sub: [fd.masterParagraph?.text ? '📖 글 1편' : '', `🔤 표현 ${vocab.length}`,
              (fd.wordEntries || []).length ? `📚 단어 ${fd.wordEntries.length}` : ''].filter(Boolean).join(' · '),
        list: vocab.slice(0, 8).map(v => ({ a: v.expression || v.word || '', b: v.meaning || '' })).filter(v => v.a),
      };
    }
    /* 수험생 기록 — 나중에 "그때 얼마나 치열했는지"를 보는 재료라 문제 사진까지 살린다 */
    const ew = it.examWord;
    if (ew && ew.word) return {
      kind: '수능 영단어', title: ew.word + (ew.pos ? ` (${ew.pos})` : ''),
      sub: ew.meaning || '', detail: [ew.exampleEn, ew.exampleKo].filter(Boolean).join('\n'),
    };
    const eh = it.examHistory;
    if (eh && eh.title) return {
      kind: '한국사', title: eh.title, sub: eh.eraLabel || '', detail: eh.keyPoint || eh.summary || '',
    };
    const wa = it.wrongAnswer;
    if (it.type === 'wrong_answer' && wa) return {
      kind: `오답노트 · ${wa.subjectName || '문제'}`,
      title: wa.unit || it.title || '틀린 문제',
      sub: wa.keyConceptName ? `놓친 개념 — ${wa.keyConceptName}` : '',
      detail: wa.problemSummary || '',
      img: it.thumbnailUrl || it.imageUrl || '',
    };
    if (it.source === 'daily-feed-entry') {
      const p = parseEntryText(it.text);
      if (p) return { kind: '영어 표현', title: p.expr, sub: p.meaning, detail: p.nuance,
                      from: it.packContext?.themeTitle ? `📖 「${it.packContext.themeTitle}」 글과 함께` : '' };
    }
    return null;
  }

  function learnedCard(it, v) {
    const d = dom(it.domain);
    const clip = s => (s && s.length > 360 ? s.slice(0, 360) + '…' : s);
    const note = thoughtOf(it);
    return `<article class="entry entry--learned">
      <div class="entry__kind">
        <i class="dot" style="background:${d.color}"></i>${esc(v.kind)}
        ${isAuto(it) ? '<span class="auto">배달</span>' : ''}
      </div>
      ${v.img ? `<img class="entry__thumb entry__thumb--doc" src="${esc(v.img)}" alt="" loading="lazy" onerror="this.remove()"/>` : ''}
      <div class="entry__body">
        ${v.quote ? `<blockquote class="entry__quote">${esc(v.quote)}</blockquote>` : ''}
        ${v.title ? `<h3 class="entry__title">${esc(v.title)}</h3>` : ''}
        ${v.sub ? `<p class="entry__sub">${esc(v.sub)}</p>` : ''}
        ${v.list ? `<dl class="entry__list">${v.list.map(x =>
            `<div><dt>${esc(x.a)}</dt><dd>${esc(x.b)}</dd></div>`).join('')}</dl>` : ''}
        ${v.detail ? `<p class="entry__text">${esc(clip(v.detail))}</p>` : ''}
        ${v.from ? `<p class="entry__from">${esc(v.from)}</p>` : ''}
        ${note ? `<p class="entry__note">${esc(note)}</p>` : ''}
      </div>
    </article>`;
  }

  /* ── 상세 팝업 ───────────────────────────────
     카드는 요약만 보여 주고, 누르면 저장된 내용을 빠짐없이 펼친다.
     필드가 비어 있으면 그 칸은 그리지 않는다 — 기록마다 채워진 정도가 달라서. */
  const para = s => esc(s).replace(/\n/g, '<br>');
  const sec = (label, body, cls = '') => body ? `<section class="md__sec ${cls}"><h4>${label}</h4><div>${body}</div></section>` : '';
  const whenOf = it => {
    const k = dateKey(it); if (!k) return '';
    const dd = new Date(k + 'T00:00:00');
    const t = it.createdAt ? new Date(it.createdAt) : null;
    const time = t && !isNaN(t) ? ` · ${t.getHours() < 12 ? '오전' : '오후'} ${((t.getHours() + 11) % 12) + 1}:${pad2(t.getMinutes())}` : '';
    return `${dd.getFullYear()}년 ${dd.getMonth() + 1}월 ${dd.getDate()}일 ${DOW[dd.getDay()]}요일${time}`;
  };

  /* 영어 표현 하나(테마팩 항목 또는 낱개 저장) */
  function vocabBlock(v, big) {
    return `<div class="md__vocab${big ? ' md__vocab--big' : ''}">
        ${v.expression || v.word ? `<p class="md__expr">${esc(v.expression || v.word)}</p>` : ''}
        ${v.meaning ? `<p class="md__mean">${esc(v.meaning)}</p>` : ''}
        ${sec('뉘앙스', v.nuance ? para(v.nuance) : '')}
        ${sec('예문', v.sourceSentence ? `${para(v.sourceSentence)}${v.sourceSentenceKo ? `<span class="md__ko">${para(v.sourceSentenceKo)}</span>` : ''}` : '')}
        ${sec('대화', v.dialogue ? `<p class="md__dialog">${para(typeof v.dialogue === 'string' ? v.dialogue : JSON.stringify(v.dialogue))}</p>${v.dialogueKo ? `<span class="md__ko">${para(v.dialogueKo)}</span>` : ''}` : '')}
        ${sec('따라 써 보기', v.practiceSentence ? para(v.practiceSentence) : '')}
      </div>`;
  }

  /* ── 테마팩 한 벌 ──
     팩을 통째로 저장하면 표현만이 아니라 그 표현들로 쓴 글(마스터 패러그래프)·오늘의 단어까지 함께 남는다
     (서버 save가 feedData에 배달 원본을 그대로 넣음). 복습은 "글 → 표현 → 단어" 순서가 자연스럽다. */
  /* focus: 낱개 저장한 표현 — 글 안에서 그 표현만 진하게, 나머지는 옅게 */
  function masterHTML(mp, opt = {}) {
    if (!mp || !mp.text) return '';
    const hl = (mp.highlights || []).filter(Boolean);
    const focus = String(opt.focus || '').toLowerCase();
    let txt = esc(mp.text);
    hl.forEach((h, i) => {
      const re = new RegExp(`(${esc(h).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
      const mine = focus && focus.includes(String(h).toLowerCase());
      txt = txt.replace(re, `<mark class="md__hl${focus ? (mine ? ' is-mine' : ' is-dim') : ''}" data-n="${i + 1}">$1</mark>`);
    });
    return `<section class="md__pack-sec" id="pk-text">
        <h4 class="md__pack-h">${opt.title || `📖 오늘의 글 <small>표현 ${hl.length}개가 한 문맥에</small>`}</h4>
        <div class="md__master">${txt}</div>
        ${mp.translation ? `<details class="md__tr"><summary>해석 보기</summary><p>${para(mp.translation)}</p></details>` : ''}
      </section>`;
  }
  const WORD_DOM = { news: '📰 뉴스', daily: '💬 일상', business: '💼 비즈니스' };
  const LV = { beginner: '초급', intermediate: '중급', advanced: '고급' };
  function wordBlock(w) {
    const tags = [WORD_DOM[w.domain], LV[w.level]].filter(Boolean).join(' · ');
    return `<details class="md__fold">
        <summary><b>${esc(w.word)}</b>${w.pos ? `<i>${esc(w.pos)}</i>` : ''}${tags ? `<i>${esc(tags)}</i>` : ''}<span>${esc(w.meaning || '')}</span></summary>
        <div class="md__fold-body">
          ${sec('함께 쓰는 말', (w.collocations || []).length ? `<p class="md__tags">${w.collocations.map(c => `<span>${esc(c)}</span>`).join('')}</p>` : '')}
          ${sec('헷갈리는 말', w.confusable ? para(w.confusable).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>') : '')}
          ${sec('뉘앙스', w.nuance ? para(w.nuance) : '')}
          ${sec('예문', w.example ? `${para(w.example)}${w.exampleKo ? `<span class="md__ko">${para(w.exampleKo)}</span>` : ''}` : '')}
        </div>
      </details>`;
  }
  /* 낱개로 저장한 표현 — 그 표현이 나온 팩의 글과, 같은 팩에 함께 있던 표현들 */
  function packContextHTML(pc, v) {
    if (!pc || !pc.masterParagraph?.text) return '';
    const me = String(v.expression || '').toLowerCase();
    const others = (pc.siblings || []).filter(s => String(s.expression || '').toLowerCase() !== me);
    return `<hr class="md__hr">`
      + masterHTML(pc.masterParagraph, { focus: v.expression, title: `📖 이 표현이 나온 글 <small>「${esc(pc.themeTitle || '')}」</small>` })
      + (others.length ? `<section class="md__pack-sec"><h4 class="md__pack-h">🔤 같은 글의 다른 표현</h4>
          <dl class="md__siblings">${others.map(s => `<div><dt>${esc(s.expression)}</dt><dd>${esc(s.meaning || '')}</dd></div>`).join('')}</dl></section>` : '');
  }

  /* 오늘의 구문 — 문장을 여는 틀 하나(언제·형태·예문·실수·비슷한 틀) */
  function patternHTML(p) {
    if (!p || !p.pattern) return '';
    const reg = { daily: '💬 일상 대화', business: '💼 비즈니스', any: '🔁 어디서나' }[p.register] || '';
    const bold = t => para(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    return `<section class="md__pack-sec" id="pk-pat"><h4 class="md__pack-h">💬 오늘의 구문 <small>${esc([reg, LV[p.level]].filter(Boolean).join(' · '))}</small></h4>
        <div class="md__fold" style="padding:12px 14px"><p class="md__expr" style="margin:0">${esc(p.pattern)}</p>
          ${p.meaning ? `<p class="md__mean">${esc(p.meaning)}</p>` : ''}
          ${sec('언제 쓰나', p.when ? bold(p.when) : '')}
          ${sec('형태', p.structure ? para(p.structure) : '')}
          ${sec('예문', (p.examples || []).map(e => `${para(e.en || '')}${e.ko ? `<span class="md__ko">${para(e.ko)}</span>` : ''}`).join('<br>'))}
          ${sec('흔한 실수', p.mistake ? bold(p.mistake) : '')}
          ${sec('비슷한 틀과 차이', p.similar ? bold(p.similar) : '')}
        </div></section>`;
  }

  function packHTML(vocab, mp, words, pat) {
    const jump = [mp && mp.text ? ['pk-text', '📖 글 1편'] : null, ['pk-expr', `🔤 표현 ${vocab.length}`],
                  pat && pat.pattern ? ['pk-pat', '💬 구문 1'] : null,
                  words.length ? ['pk-word', `📚 단어 ${words.length}`] : null].filter(Boolean);
    return `<nav class="md__jump">${jump.map(([id, l]) => `<button type="button" data-jump="${id}">${l}</button>`).join('')}</nav>`
      + masterHTML(mp)
      + `<section class="md__pack-sec" id="pk-expr"><h4 class="md__pack-h">🔤 표현 <small>눌러서 뉘앙스·예문·대화 보기</small></h4>
          ${vocab.map((v, i) => `<details class="md__fold"${i ? '' : ' open'}>
            <summary><em>${i + 1}</em><b>${esc(v.expression || v.word || '')}</b><span>${esc(v.meaning || '')}</span></summary>
            <div class="md__fold-body">${vocabBlock({ ...v, expression: '', meaning: '' }, false)}</div>
          </details>`).join('')}</section>`
      + patternHTML(pat)
      + (words.length ? `<section class="md__pack-sec" id="pk-word"><h4 class="md__pack-h">📚 오늘의 단어</h4>${words.map(wordBlock).join('')}</section>` : '');
  }

  function detailHTML(it) {
    const d = dom(it.domain);
    const noteSec = thoughtHTML(it);
    const head = (kind, title, sub) => `<header class="md__head">
        <div class="md__kind"><i class="dot" style="background:${d.color}"></i>${esc(kind)}</div>
        ${title ? `<h3 class="md__title">${esc(title)}</h3>` : ''}
        ${sub ? `<p class="md__sub">${esc(sub)}</p>` : ''}
        <p class="md__when">${whenOf(it)}</p>
      </header>`;

    /* 추억 — 사진은 크게, 글은 전부 */
    if (isLife(it)) {
      const photos = (it.life?.photos || []).filter(Boolean);
      const meta = [it.life?.mood, it.life?.location, it.life?.weather].filter(Boolean);
      return `<div class="md__gallery" data-n="${photos.length}">
          ${photos.map((p, i) => `<img src="${esc(p)}" alt="" data-i="${i}" ${i ? 'hidden' : ''}
              onerror="this.outerHTML='&lt;div class=&quot;shot-missing&quot; data-i=&quot;${i}&quot;&gt;사진을 찾을 수 없어요&lt;/div&gt;'"/>`).join('')}
          ${photos.length > 1 ? `<button type="button" class="md__nav md__nav--prev" aria-label="이전 사진">‹</button>
            <button type="button" class="md__nav md__nav--next" aria-label="다음 사진">›</button>
            <div class="md__count"><b>1</b> / ${photos.length}</div>` : ''}
        </div>
        ${head('추억', '', '')}
        ${lifeCaption(it) ? `<p class="md__story">${para(lifeCaption(it))}</p>` : '<p class="muted">글 없이 사진만 남긴 날이에요.</p>'}
        ${meta.length ? `<p class="md__meta">${meta.map(esc).join(' · ')}</p>` : ''}`;
    }

    const fd = it.feedData || {};
    const vocab = Array.isArray(it.vocabEntries) && it.vocabEntries.length ? it.vocabEntries
      : Array.isArray(fd.vocabEntries) ? fd.vocabEntries : [];

    /* 10-05 깊이 읽기 — 지식 한줌 카드의 배경·용어·그 후·한마디 */
    const dp = fd.deep || null;
    const deepSec = (keys) => !dp ? '' : keys.map(k => k === 'terms'
      ? sec('오늘 알게 된 말', (dp.terms || []).length ? `<dl class="md__terms">${dp.terms.map(t => `<dt>${esc(t.t)}</dt><dd>${esc(t.d)}</dd>`).join('')}</dl>` : '')
      : sec({ lesson: '한 줄', background: '그때 판', after: '그 후, 그리고 지금', talk: '써먹는 한마디' }[k], dp[k] ? para(dp[k]) : '', k === 'talk' ? 'md__sec--talk' : '')).join('');

    if (fd.subType === 'liber' && fd.quote) return head('고전', '', [fd.book, fd.author, fd.era].filter(Boolean).join(' · '))
      + `<blockquote class="md__quote">${para(fd.quote)}</blockquote>`
      + sec('원문', fd.source ? para(fd.source) : '', 'md__sec--muted')
      + deepSec(['lesson', 'background'])
      + sec('그때 무슨 일이', fd.backstory ? para(fd.backstory) : '')
      + deepSec(['terms', 'after'])
      + sec('오늘의 나에게', fd.context ? para(fd.context) : '')
      + deepSec(['talk'])
      + (Array.isArray(fd.tags) && fd.tags.length ? `<p class="md__tags">${fd.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</p>` : '')
      + noteSec;

    if (fd.subType === 'idiom' && fd.idiom) return head('고사성어', `${fd.idiom}${fd.hanja ? ` ${fd.hanja}` : ''}`, fd.meaning)
      + deepSec(['lesson', 'background'])
      + sec('유래', fd.origin ? para(fd.origin) : '')
      + deepSec(['terms'])
      + sec('이렇게 쓴다', fd.story ? para(fd.story) : '')
      + sec('숨은 이야기', fd.behindStory ? para(fd.behindStory) : '')
      + sec('오늘의 적용', fd.application ? para(fd.application) : '')
      + deepSec(['after', 'talk'])
      + noteSec;

    if (fd.subType === 'history' && fd.title) return head(fd.series ? `역사 · 연재 ${fd.series.title} ${fd.series.no}/${fd.series.total}` : '역사', fd.title, [fd.era, fd.period, fd.region].filter(Boolean).join(' · '))
      + sec('교훈', fd.lesson ? para(fd.lesson) : '')
      + deepSec(['background'])
      + sec('무슨 일이 있었나', fd.summary ? para(fd.summary) : '')
      + sec('세 줄 요약', fd.summary3 ? para(fd.summary3) : '')
      + sec('비하인드', fd.behindStory ? para(fd.behindStory) : '')
      + deepSec(['terms', 'after', 'talk'])
      + noteSec;

    if (fd.subType === 'insight' && (fd.headline || fd.topic)) return head('인사이트', fd.headline || fd.topic, fd.headline ? fd.topic : '')
      + deepSec(['lesson'])
      + sec('핵심', fd.body ? para(fd.body) : '')
      + deepSec(['background'])
      + sec('실제로는', fd.realLife ? para(fd.realLife) : '')
      + deepSec(['terms', 'after', 'talk'])
      + sec('생각해 볼 질문', fd.question ? para(fd.question) : '')
      + noteSec;

    if (fd.subType === 'quote' && fd.quote) return head('명언', '', fd.author)
      + `<blockquote class="md__quote">${para(fd.quote)}</blockquote>`
      + sec('맥락', (fd.context || fd.story) ? para(fd.context || fd.story) : '') + noteSec;

    const packTitle = it.themeTitle || fd.themeTitle;
    if (vocab.length > 1 && packTitle) {
      const words = [it.wordEntries, fd.wordEntries].find(a => Array.isArray(a) && a.length) || [];
      return head('영어 · 테마팩', packTitle, it.themeTitleEn || fd.themeTitleEn || '')
        + packHTML(vocab, it.masterParagraph || fd.masterParagraph, words, it.patternEntry || fd.patternEntry) + noteSec;
    }

    if (vocab.length) {
      const title = fd.themeTitle || (vocab.length > 1 ? (it.title || '오늘의 표현') : '');
      return head(vocab.length > 1 ? `영어 · 표현 ${vocab.length}개` : '영어 표현', title, '')
        + vocab.map(v => vocabBlock(v, vocab.length === 1)).join('<hr class="md__hr">')
        + (vocab.length === 1 ? packContextHTML(it.packContext, vocab[0]) : '') + noteSec;
    }

    const ew = it.examWord;
    if (ew && ew.word) return head('수능 영단어', `${ew.word}${ew.pos ? ` (${ew.pos})` : ''}`, ew.meaning)
      + sec('예문', ew.exampleEn ? `${para(ew.exampleEn)}${ew.exampleKo ? `<span class="md__ko">${para(ew.exampleKo)}</span>` : ''}` : '')
      + sec('기출', ew.csatRef ? para(ew.csatRef) : '') + noteSec;

    const eh = it.examHistory;
    if (eh && eh.title) return head('한국사', eh.title, eh.eraLabel)
      + sec('내용', eh.summary ? para(eh.summary) : '')
      + sec('핵심', eh.keyPoint ? para(eh.keyPoint) : '')
      + sec('시험 팁', eh.examTip ? para(eh.examTip) : '') + noteSec;

    const wa = it.wrongAnswer;
    if (it.type === 'wrong_answer' && wa) {
      const img = it.imageUrl || it.thumbnailUrl;
      const concepts = Array.isArray(wa.requiredConcepts) ? wa.requiredConcepts : [];
      const steps = Array.isArray(wa.modelSteps) ? wa.modelSteps : [];
      return head(`오답노트 · ${wa.subjectName || ''}`, wa.unit || it.title, wa.keyConceptName ? `놓친 개념 — ${wa.keyConceptName}` : '')
        + (img ? `<img class="md__doc" src="${esc(img)}" alt="" onerror="this.remove()"/>` : '')
        + sec('문제', wa.problemSummary ? para(wa.problemSummary) : '')
        + sec('정답', wa.answer ? para(wa.answer) : '')
        + sec('필요한 개념', concepts.length ? concepts.map(c => `<p><b>${esc(c.term || '')}</b> ${esc(c.desc || '')}</p>`).join('') : '')
        + sec('풀이 순서', steps.length ? `<ol>${steps.map(s => `<li>${esc(String(s).replace(/^\d+\.\s*/, ''))}</li>`).join('')}</ol>` : '')
        + sec('보강할 점', wa.whatToReinforce ? para(wa.whatToReinforce) : '') + noteSec;
    }

    /* 낱개 저장 영어(구형 텍스트만 있는 것) */
    if (it.source === 'daily-feed-entry') {
      const lines = String(it.text || '').split('\n').map(s => s.trim()).filter(Boolean);
      const expr = (lines.shift() || '').replace(/^\[[^\]]*\]\s*/, '');
      const rows = lines.map(l => { const m = l.match(/^([^:]{1,8}):\s*(.*)$/); return m ? sec(esc(m[1]), para(m[2])) : `<p>${para(l)}</p>`; }).join('');
      return head('영어 표현', expr, '') + rows + noteSec;
    }

    /* 영상 · 메모 · 링크 */
    const a = it.analysis || {};
    const link = [it.source, it.title, it.text].find(isUrl);
    return head(it.type === 'youtube' ? '영상' : d.label, [a.title, it.title].find(t => t && !isUrl(t)) || '기록', it.channelName || '')
      + (it.thumbnail ? `<img class="md__doc" src="${esc(it.thumbnail)}" alt="" onerror="this.remove()"/>` : '')
      + sec('요약', (a.summary || it.summary) ? para(a.summary || it.summary) : '')
      + sec('내용', it.text && !isUrl(it.text) && it.text !== it.title ? para(it.text) : '')
      + sec('인사이트', a.insight ? para(a.insight) : '')
      + noteSec
      + (link ? `<a class="entry__link" href="${esc(link)}" target="_blank" rel="noopener">원문 열기 ↗</a>` : '');
  }

  /* ── 내 생각 ─────────────────────────────────
     받은 지식에 내 생각을 붙이는 칸. 여기 적힌 것이 "받은 것"을 "내 것"으로 바꾼다.
     실제 계정은 PATCH /api/items/:id {myInsight}, 샘플 모드는 이 브라우저(localStorage)에만 둔다.
     옛 기록 중 '['로 시작하는 myInsight는 시스템이 넣은 태그라 유저 글로 보지 않는다. */
  const thoughtOf = it => (it.myInsight && !String(it.myInsight).startsWith('[') ? String(it.myInsight) : '');
  function thoughtHTML(it) {
    const t = thoughtOf(it);
    return `<section class="md__sec md__thought" data-id="${esc(it.id)}">
        <h4>💭 내 생각</h4>
        <div class="md__thought-view">${t ? `<p class="md__thought-text">${para(t)}</p>`
          : '<p class="muted">이걸 읽고 떠오른 생각, 내 일·삶과 이어지는 점을 적어 두세요. 연말 총평이 이 글을 읽습니다.</p>'}
          <button type="button" class="btn btn--sm md__thought-edit">${t ? '고치기' : '생각 적기'}</button></div>
        <div class="md__thought-form" hidden>
          <textarea rows="4" maxlength="4000" placeholder="예) 결국 정치가 종교를 이긴 이야기. 요즘 회사 조직 개편이랑 닮았다.">${esc(t)}</textarea>
          <div class="md__thought-actions"><span class="muted md__thought-msg"></span>
            <button type="button" class="btn btn--sm md__thought-cancel">취소</button>
            <button type="button" class="btn btn--sm btn--primary md__thought-save">저장</button></div>
        </div>
      </section>`;
  }

  /* 샘플 모드 저장소 — 새로고침해도 방금 적은 생각·기록이 남아 있게(이 브라우저에만) */
  const DEMO_KEY = 'chronicle-demo-v1';
  const demoStore = {
    read() { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || { thoughts: {}, added: [] }; } catch { return { thoughts: {}, added: [] }; } },
    write(v) { try { localStorage.setItem(DEMO_KEY, JSON.stringify(v)); } catch { /* 저장 못 해도 이번 화면에는 반영됨 */ } },
  };

  async function saveThought(id, text) {
    const it = state.raw.find(x => String(x.id) === String(id));
    if (!it) return;
    if (DEMO) {
      const st = demoStore.read(); st.thoughts[id] = text; demoStore.write(st);
    } else {
      await api(`/api/items/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ myInsight: text }),
      });
    }
    it.myInsight = text;
  }

  function bindThought() {
    const box = $('modalBody').querySelector('.md__thought');
    if (!box) return;
    const view = box.querySelector('.md__thought-view'), form = box.querySelector('.md__thought-form');
    const ta = form.querySelector('textarea'), msg = form.querySelector('.md__thought-msg');
    box.querySelector('.md__thought-edit').addEventListener('click', () => {
      view.hidden = true; form.hidden = false; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    form.querySelector('.md__thought-cancel').addEventListener('click', () => { form.hidden = true; view.hidden = false; });
    form.querySelector('.md__thought-save').addEventListener('click', async e => {
      const btn = e.currentTarget; btn.disabled = true; msg.textContent = '저장 중…';
      try {
        await saveThought(box.dataset.id, ta.value.trim());
        box.outerHTML = thoughtHTML(state.raw.find(x => String(x.id) === box.dataset.id));
        bindThought();
        renderDay();                                  // 카드에도 생각 미리보기가 바로 보이게
      } catch (err) {
        msg.textContent = '저장하지 못했어요 — ' + (err.message || ''); btn.disabled = false;
      }
    });
    /* Ctrl/⌘+Enter로 저장 */
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) form.querySelector('.md__thought-save').click(); });
  }

  /* ── 웹에서 바로 기록하기 ──────────────────────
     유튜브·기사 링크나 메모를 붙여 넣고, 원하면 내 생각을 함께 적는다.
     실제 계정은 앱과 같은 POST /api/items(유튜브는 제목·썸네일·요약 자동), 샘플은 이 브라우저에만. */
  const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
  const kindHint = t => {
    const s = t.trim();
    if (!s) return '';
    if (YT_RE.test(s)) return '🎬 유튜브 영상으로 저장돼요 — 제목·썸네일·요약은 자동으로 채워져요';
    if (/https?:\/\/\S+/.test(s)) return '🔗 링크로 저장돼요 — 내용을 읽고 분류·요약해요';
    return '📝 메모로 저장돼요 — 내용에 맞는 분야로 자동 분류해요';
  };

  function openCompose() {
    const cur = state.mode || 'PROFESSIONAL';
    showModal(`<header class="md__head">
        <div class="md__kind">✍️ 기록하기</div>
        <h3 class="md__title">무엇을 남길까요?</h3>
        <p class="md__sub">유튜브·기사 링크나, 오늘 배운 것·떠오른 생각을 그대로 붙여 넣으세요. 오늘 날짜로 연대기에 남습니다.</p>
      </header>
      <form class="compose" id="composeForm">
        <label class="compose__label" for="cText">내용</label>
        <textarea id="cText" rows="5" required maxlength="8000" placeholder="https://youtu.be/…  또는  오늘 회의에서 배운 것…"></textarea>
        <p class="compose__hint" id="cHint"></p>
        <label class="compose__label" for="cThought">💭 내 생각 <span class="muted">(선택)</span></label>
        <textarea id="cThought" rows="3" maxlength="4000" placeholder="왜 저장하는지, 어디에 써먹을지"></textarea>
        <div class="compose__row">
          <div class="seg seg--sm" role="group" aria-label="모드">
            <button type="button" data-cmode="PROFESSIONAL" aria-pressed="${cur !== 'EXAM_PREP'}">직장인</button>
            <button type="button" data-cmode="EXAM_PREP" aria-pressed="${cur === 'EXAM_PREP'}">수험생</button>
          </div>
          <span class="muted compose__msg" id="cMsg"></span>
          <button type="submit" class="btn btn--primary" id="cSave">저장</button>
        </div>
      </form>`);
    let mode = cur === 'EXAM_PREP' ? 'EXAM_PREP' : 'PROFESSIONAL';
    const text = $('cText');
    text.addEventListener('input', () => { $('cHint').textContent = kindHint(text.value); });
    $('modalBody').querySelectorAll('[data-cmode]').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.cmode;
      $('modalBody').querySelectorAll('[data-cmode]').forEach(x => x.setAttribute('aria-pressed', x === b));
    }));
    $('composeForm').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('composeForm').requestSubmit(); });
    $('composeForm').addEventListener('submit', async e => {
      e.preventDefault();
      const body = text.value.trim(); if (!body) return;
      const thought = $('cThought').value.trim();
      $('cSave').disabled = true;
      $('cMsg').textContent = YT_RE.test(body) || /https?:\/\//.test(body) ? '저장 중… 내용을 읽고 요약하고 있어요' : '저장 중…';
      try {
        const item = DEMO ? demoCreate(body, thought, mode) : (await api('/api/items', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: body, mode, source: 'chronicle-web', myInsight: thought || undefined, createdAt: new Date().toISOString() }),
        })).item;
        if (!item) throw new Error('응답이 비어 있어요');
        state.raw.unshift(fixDomain(item));
        const k = dateKey(item) || isoOf(new Date());
        state.year = Number(k.slice(0, 4)); state.selected = k; state.month = Number(k.slice(5, 7)) - 1;
        state.cat = ''; state.scope = 'day';
        regroup(); renderAll();
        openDetail(item.id);                          // 저장된 모습을 바로 보여 준다
      } catch (err) {
        $('cMsg').textContent = '저장하지 못했어요 — ' + (err.message || ''); $('cSave').disabled = false;
      }
    });
    text.focus();
  }

  /* 샘플 모드용 가짜 저장 — 서버 없이 비슷한 모양을 만든다 */
  function demoCreate(body, thought, mode) {
    const now = new Date();
    const base = { id: 'demo-' + now.getTime(), date: isoOf(now), createdAt: now.toISOString(), mode, source: 'chronicle-web',
                   ...(thought ? { myInsight: thought } : {}) };
    const yt = body.match(YT_RE);
    const url = (body.match(/https?:\/\/\S+/) || [])[0];
    const firstLine = body.split('\n')[0].slice(0, 60);
    const item = yt
      ? { ...base, type: 'youtube', domain: 'business', title: '(샘플) 저장한 유튜브 영상', channelName: '샘플 모드 — 실제 저장 시 채널명', source: url,
          thumbnail: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`, text: body,
          analysis: { title: '(샘플) 저장한 유튜브 영상', summary: '실제 계정에서는 영상 제목·요약이 자동으로 채워져요.' } }
      : { ...base, domain: url ? 'business' : 'psychology', text: body,
          analysis: { title: url ? '저장한 링크' : firstLine, summary: url ? '실제 계정에서는 기사 내용을 읽고 요약해요.' : '' } };
    const st = demoStore.read(); st.added = [...(st.added || []), item]; demoStore.write(st);
    return item;
  }

  /* ══ 노트 ══════════════════════════════════════
     노션처럼 쓰는 긴 글. 날짜에 걸려 연대기의 "쓴 것" 구획에 남는다.
     - 블록 단축키: "# " 큰 제목, "## " 작은 제목, "- " 목록, "1. " 번호, "[] " 체크, "> " 인용, "---"+Enter 구분선
     - "/" 블록 메뉴, "@" 저장한 기록 연결(누르면 그 카드 상세, 돌아오기 가능)
     - 자동 저장. 지금은 샘플 모드 전용 — localStorage(chronicle-demo-v1.notes). 서버 저장은 다음 단계. */
  let _noteBack = null;          // 노트에서 연결 카드를 열었을 때 돌아올 노트 id
  const NOTE_ICONS = ['📝','📚','🏰','💡','🧠','🎯','📈','🌏','✈️','🍳','🎬','🎧','🧭','🪴','⚙️','🧾','🗂️','🔖','💬','✨','🔥','🌙','☕','🏃'];
  const NOTE_COVERS = ['tile-1', 'tile-2', 'tile-3', 'tile-4', ''];
  const plainOf = html => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };
  const mentionIds = html => [...new Set([...String(html || '').matchAll(/data-id="([^"]+)"/g)].map(m => m[1]))];

  function noteCard(it) {
    const n = it.note || {};
    const text = plainOf(n.html);
    const links = mentionIds(n.html).length;
    return `<article class="entry entry--note">
        ${n.cover ? `<div class="note-card__cover" style="background:var(--${n.cover})"></div>` : ''}
        <div class="entry__body">
          <div class="note-card__icon">${esc(n.icon || '📝')}</div>
          <h3 class="entry__title">${esc(n.title || '제목 없음')}</h3>
          ${text ? `<p class="entry__text note-card__excerpt">${esc(text.slice(0, 160))}</p>` : ''}
          <div class="note-card__meta">
            ${(n.tags || []).map(t => `<span class="note-tag">${esc(t)}</span>`).join('')}
            ${links ? `<span class="muted">🔗 연결 ${links}</span>` : ''}
          </div>
        </div>
      </article>`;
  }

  /* 샘플 저장소의 노트 읽기/쓰기 */
  function saveNoteItem(it) {
    const st = demoStore.read();
    st.notes = (st.notes || []).filter(x => x.id !== it.id);
    st.notes.push(it);
    demoStore.write(st);
  }
  function deleteNoteItem(id) {
    const st = demoStore.read();
    st.notes = (st.notes || []).filter(x => x.id !== id);
    st.deletedNotes = [...new Set([...(st.deletedNotes || []), id])];
    demoStore.write(st);
    state.raw = state.raw.filter(x => x.id !== id);
  }

  function newNote() {
    if (!DEMO) {
      showModal(`<header class="md__head"><div class="md__kind">🗒 노트</div>
          <h3 class="md__title">노트는 샘플로 먼저 써 볼 수 있어요</h3>
          <p class="md__sub">내 계정에 저장하는 노트는 준비 중이에요. 샘플에서 쓰는 느낌을 먼저 보고 의견을 주세요.</p></header>
          <a class="btn btn--primary" href="chronicle.html?demo=1">샘플에서 노트 써 보기 →</a>`);
      return;
    }
    const now = new Date();
    const key = state.selected && state.scope === 'day' ? state.selected : isoOf(now);
    const it = { id: 'note-' + now.getTime(), type: 'note', mode: state.mode || 'PROFESSIONAL', domain: 'psychology',
                 date: key, createdAt: now.toISOString(), note: { icon: '📝', title: '', html: '', tags: [], cover: '' } };
    state.raw.unshift(it);
    saveNoteItem(it);
    openNote(it.id, true);
  }

  function openNote(id, fresh) {
    const it = state.raw.find(x => x.id === id);
    if (!it) return;
    const n = it.note;
    const dd = new Date(dateKey(it) + 'T00:00:00');
    showModal(`<div class="note">
        <div class="note__bar">
          <span class="note__crumb">🗒 노트 · ${dd.getMonth() + 1}월 ${dd.getDate()}일</span>
          <span class="note__status" id="noteStatus">${fresh ? '새 노트' : '저장됨 ✓'}</span>
          <button type="button" class="note__del" id="noteDel" title="노트 삭제">삭제</button>
        </div>
        <div class="note__cover${n.cover ? '' : ' is-empty'}" id="noteCover" ${n.cover ? `style="background:var(--${n.cover})"` : ''}>
          <button type="button" class="note__cover-btn" id="noteCoverBtn">${n.cover ? '커버 바꾸기' : '＋ 커버'}</button>
        </div>
        <div class="note__page">
          <button type="button" class="note__icon" id="noteIcon" title="아이콘 바꾸기">${esc(n.icon || '📝')}</button>
          <div class="note__icons" id="noteIcons" hidden>${NOTE_ICONS.map(e => `<button type="button">${e}</button>`).join('')}</div>
          <input class="note__title" id="noteTitle" placeholder="제목 없음" value="${esc(n.title || '')}" maxlength="120"/>
          <div class="note__props">
            <div class="note__prop"><span>📅 날짜</span><b>${dd.getFullYear()}년 ${dd.getMonth() + 1}월 ${dd.getDate()}일 ${DOW[dd.getDay()]}요일</b></div>
            <div class="note__prop"><span>🏷 태그</span><div class="note__tags" id="noteTags"></div></div>
            <div class="note__prop"><span>🔗 연결</span><div class="note__links" id="noteLinks"></div></div>
          </div>
          <div class="note__body" id="noteBody" contenteditable="true" spellcheck="false"
               data-placeholder="'/'를 눌러 블록을 고르거나, '@'로 저장한 기록을 연결하세요. 그냥 쓰기 시작해도 좋아요.">${n.html || ''}</div>
        </div>
        <div class="note__menu" id="noteMenu" hidden></div>
      </div>`, 'note');
    bindNote(it);
    (n.title ? $('noteBody') : $('noteTitle')).focus();
  }

  const BLOCKS = [
    { k: 'h1',     icon: 'H1', label: '큰 제목',   hint: '#' },
    { k: 'h2',     icon: 'H2', label: '작은 제목', hint: '##' },
    { k: 'ul',     icon: '•',  label: '글머리 목록', hint: '-' },
    { k: 'ol',     icon: '1.', label: '번호 목록', hint: '1.' },
    { k: 'todo',   icon: '☑',  label: '체크리스트', hint: '[]' },
    { k: 'quote',  icon: '❝',  label: '인용',      hint: '>' },
    { k: 'callout',icon: '💡', label: '강조 박스', hint: '' },
    { k: 'hr',     icon: '—',  label: '구분선',    hint: '---' },
    { k: 'p',      icon: '¶',  label: '본문',      hint: '' },
    { k: 'mention',icon: '@',  label: '기록 연결', hint: '@' },
  ];

  function bindNote(it) {
    const n = it.note, body = $('noteBody'), menu = $('noteMenu');
    let timer = null;
    const status = t => { const s = $('noteStatus'); if (s) s.textContent = t; };
    const save = () => {
      clearTimeout(timer);
      status('저장 중…');
      timer = setTimeout(() => {
        n.html = body.innerHTML.replace(/<br>$/, '');
        n.title = $('noteTitle').value.trim();
        saveNoteItem(it); renderLinks(); status('저장됨 ✓');
      }, 500);
    };
    const flush = () => { if (timer) { clearTimeout(timer); n.html = body.innerHTML; n.title = $('noteTitle').value.trim(); saveNoteItem(it); } };

    /* 속성: 태그 */
    const renderTags = () => {
      $('noteTags').innerHTML = (n.tags || []).map((t, i) => `<span class="note-tag">${esc(t)}<button type="button" data-i="${i}" aria-label="태그 지우기">×</button></span>`).join('')
        + `<input class="note__tag-input" placeholder="${(n.tags || []).length ? '' : '태그 추가'}" maxlength="20"/>`;
      $('noteTags').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { n.tags.splice(Number(b.dataset.i), 1); renderTags(); save(); }));
      const inp = $('noteTags').querySelector('input');
      inp.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
          e.preventDefault(); n.tags = [...(n.tags || []), inp.value.trim().replace(/^#/, '')].slice(0, 8); renderTags(); save();
          $('noteTags').querySelector('input').focus();
        } else if (e.key === 'Backspace' && !inp.value && (n.tags || []).length) { n.tags.pop(); renderTags(); save(); $('noteTags').querySelector('input').focus(); }
      });
    };
    /* 속성: 연결된 기록(본문의 @연결에서 자동) */
    const renderLinks = () => {
      const ids = mentionIds(body.innerHTML);
      $('noteLinks').innerHTML = ids.length ? ids.map(id => {
        const x = state.raw.find(r => String(r.id) === id); if (!x) return '';
        return `<button type="button" class="note-link" data-id="${esc(id)}">${esc(mentionLabel(x))}</button>`;
      }).join('') : '<span class="muted">본문에서 @로 저장한 기록을 연결하면 여기 모여요</span>';
      $('noteLinks').querySelectorAll('.note-link').forEach(b => b.addEventListener('click', () => { flush(); _noteBack = it.id; openDetail(b.dataset.id); }));
    };
    renderTags(); renderLinks();

    /* 아이콘·커버 */
    $('noteIcon').addEventListener('click', () => { $('noteIcons').hidden = !$('noteIcons').hidden; });
    $('noteIcons').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      n.icon = b.textContent; $('noteIcon').textContent = n.icon; $('noteIcons').hidden = true; save();
    }));
    $('noteCoverBtn').addEventListener('click', () => {
      n.cover = NOTE_COVERS[(NOTE_COVERS.indexOf(n.cover || '') + 1) % NOTE_COVERS.length];
      const c = $('noteCover');
      c.classList.toggle('is-empty', !n.cover);
      c.style.background = n.cover ? `var(--${n.cover})` : '';
      $('noteCoverBtn').textContent = n.cover ? '커버 바꾸기' : '＋ 커버';
      save();
    });
    $('noteTitle').addEventListener('input', save);
    $('noteTitle').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
    $('noteDel').addEventListener('click', () => {
      if (!confirm('이 노트를 지울까요?')) return;
      clearTimeout(timer); deleteNoteItem(it.id); closeDetail(); regroup(); renderAll();
    });
    /* 모달이 닫힐 때 마지막 입력을 저장하고 연대기를 갱신 */
    _onClose = () => { flush(); regroup(); renderAll(); };

    /* ── 본문 편집 ── */
    const sel = () => window.getSelection();
    /* 캐럿이 있는 가장 가까운 블록(크롬이 div를 겹겹이 넣어도 가장 안쪽 줄을 잡는다) */
    const blockOf = node => {
      while (node && node !== body && !(node.nodeType === 1 && /^(P|DIV|H2|H3|LI|BLOCKQUOTE)$/.test(node.tagName))) node = node.parentNode;
      return node === body ? null : node;
    };
    body.addEventListener('focus', () => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* 구형 브라우저 */ } });
    const textBeforeCaret = () => {
      const s = sel(); if (!s.rangeCount) return '';
      const r = s.getRangeAt(0).cloneRange(); const b = blockOf(r.startContainer);
      const pre = document.createRange(); pre.selectNodeContents(b || body); pre.setEnd(r.startContainer, r.startOffset);
      return pre.toString();
    };
    const deleteBack = n2 => { for (let i = 0; i < n2; i++) document.execCommand('delete'); };
    const ensureBlock = () => { if (!body.firstChild) { document.execCommand('formatBlock', false, 'p'); } };

    function apply(k) {
      body.focus(); ensureBlock();
      const cmd = (c, v) => document.execCommand(c, false, v);
      if (k === 'h1') cmd('formatBlock', 'h2');
      else if (k === 'h2') cmd('formatBlock', 'h3');
      else if (k === 'p') cmd('formatBlock', 'p');
      else if (k === 'quote') cmd('formatBlock', 'blockquote');
      else if (k === 'callout') { cmd('formatBlock', 'blockquote'); const b = blockOf(sel().anchorNode); if (b) b.classList.add('callout'); }
      else if (k === 'ul' || k === 'todo') {
        cmd('insertUnorderedList');
        const li = blockOf(sel().anchorNode); const ul = li && li.closest('ul');
        if (ul) ul.classList.toggle('todo', k === 'todo');
      } else if (k === 'ol') cmd('insertOrderedList');
      else if (k === 'hr') { cmd('insertHorizontalRule'); cmd('formatBlock', 'p'); }
      else if (k === 'mention') { cmd('insertText', '@'); openMention(); return; }
      save();
    }

    /* 블록 메뉴·연결 메뉴 공용 팝오버 */
    let mode = null, query = '', items = [], idx = 0, busy = false;
    const placeMenu = () => {
      const s = sel(); if (!s.rangeCount) return;
      const rect = s.getRangeAt(0).getBoundingClientRect();
      const box = $('modalBody').getBoundingClientRect();
      menu.style.left = Math.max(8, (rect.left || box.left + 40) - box.left) + 'px';
      menu.style.top = ((rect.bottom || box.top + 120) - box.top + $('modalBody').scrollTop + 6) + 'px';
    };
    const drawMenu = () => {
      if (!items.length) { menu.innerHTML = `<div class="note__menu-empty">${mode === 'mention' ? '찾는 기록이 없어요' : '맞는 블록이 없어요'}</div>`; return; }
      menu.innerHTML = `<div class="note__menu-title">${mode === 'mention' ? '저장한 기록 연결' : '블록'}</div>` + items.map((x, i) =>
        `<button type="button" class="note__menu-item${i === idx ? ' on' : ''}" data-i="${i}">
           <span class="note__menu-icon">${esc(x.icon)}</span><span>${esc(x.label)}</span>${x.hint ? `<small>${esc(x.hint)}</small>` : ''}</button>`).join('');
      menu.querySelectorAll('.note__menu-item').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); idx = Number(b.dataset.i); pick(); }));
    };
    const closeMenu = () => { mode = null; menu.hidden = true; };
    const filterItems = () => {
      const q = query.toLowerCase();
      if (mode === 'slash') items = BLOCKS.filter(b => !q || b.label.includes(query) || b.k.includes(q) || (b.hint || '').includes(q));
      else items = mentionCandidates(query);
      idx = Math.min(idx, Math.max(0, items.length - 1));
      drawMenu();
    };
    function openSlash() { mode = 'slash'; query = ''; idx = 0; filterItems(); menu.hidden = false; placeMenu(); }
    function openMention() { mode = 'mention'; query = ''; idx = 0; filterItems(); menu.hidden = false; placeMenu(); }
    function pick() {
      const x = items[idx]; if (!x) return closeMenu();
      const m = mode, len = query.length + 1; closeMenu();
      busy = true; deleteBack(len); busy = false;      // "/질의" 또는 "@질의" 지우기(그 사이 input 처리는 멈춤)
      if (m === 'slash') apply(x.k);
      else {
        /* insertHTML은 편집 불가 링크를 문단 밖으로 밀어내곤 해서, 캐럿 자리에 직접 끼운다 */
        const s = sel(); const r = s.getRangeAt(0);
        const a = document.createElement('a');
        a.className = 'mention'; a.contentEditable = 'false'; a.dataset.id = x.id; a.textContent = x.icon + ' ' + x.label;
        const sp = document.createTextNode(' ');
        r.deleteContents(); r.insertNode(sp); r.insertNode(a);
        r.setStartAfter(sp); r.collapse(true); s.removeAllRanges(); s.addRange(r);
        save();
      }
    }

    body.addEventListener('keydown', e => {
      if (mode) {
        if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % Math.max(1, items.length); drawMenu(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % Math.max(1, items.length); drawMenu(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
      }
      if (e.key === 'Enter' && !mode && textBeforeCaret() === '---') { e.preventDefault(); busy = true; deleteBack(3); busy = false; apply('hr'); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        /* 빈 제목/인용 줄에서 Enter면 본문으로 빠져나오기 */
        const b = blockOf(sel().anchorNode);
        if (b && /^(H2|H3|BLOCKQUOTE)$/.test(b.tagName) && !b.textContent.trim()) { e.preventDefault(); document.execCommand('formatBlock', false, 'p'); }
      }
    });
    /* 줄 맨 앞에 쓰는 마크다운 단축키 — 공백을 치는 순간 블록으로 바뀐다(IME·붙여넣기와 무관하게 input에서 판단) */
    const SHORT = { '#': 'h1', '##': 'h2', '-': 'ul', '*': 'ul', '1.': 'ol', '[]': 'todo', '>': 'quote' };
    body.addEventListener('input', e => {
      if (busy) return;
      const t = textBeforeCaret().replace(/ /g, ' ');
      const typed = e.inputType === 'insertText';
      const sc = !mode && typed && / $/.test(t) && SHORT[t.slice(0, -1)];
      if (sc) { busy = true; deleteBack(t.length); busy = false; apply(sc); return; }
      if (!mode && typed && /(^|\s)\/$/.test(t)) openSlash();
      else if (!mode && typed && /(^|\s)@$/.test(t)) openMention();
      else if (mode) {
        const t = textBeforeCaret(); const trig = mode === 'slash' ? '/' : '@';
        const at = t.lastIndexOf(trig);
        if (at < 0 || /\s{2}/.test(t.slice(at))) closeMenu();
        else { query = t.slice(at + 1); filterItems(); placeMenu(); }
      }
      save();
    });
    /* 체크리스트: 왼쪽 네모를 누르면 완료 표시 */
    body.addEventListener('click', e => {
      const a = e.target.closest('.mention');
      if (a) { flush(); _noteBack = it.id; openDetail(a.dataset.id); return; }
      const li = e.target.closest('ul.todo > li');
      if (li && e.clientX - li.getBoundingClientRect().left < 26) { li.classList.toggle('done'); save(); }
    });
    body.addEventListener('blur', () => setTimeout(closeMenu, 150));
  }

  /* 연결 후보 — 저장한 기록 중 제목·내용이 질의와 맞는 것(최근 순 8개) */
  function mentionLabel(x) {
    const v = learnedView(x);
    const kind = x.type === 'note' ? '🗒' : isLife(x) ? '📷' : v ? ({ english: '🔤', classic: '📜', history: '🏛', idiom: '📜', insight: '💡', wrong: '✏️' }[catOf(x)] || '📌') : '📌';
    const title = x.type === 'note' ? (x.note?.title || '제목 없음')
      : isLife(x) ? (lifeCaption(x).split('\n')[0] || '사진 기록')
      : v ? (v.title || v.quote || v.kind) : ([x.analysis?.title, x.title].find(t => t && !isUrl(t)) || '기록');
    return `${kind} ${String(title).slice(0, 36)}`;
  }
  function mentionCandidates(q) {
    const s = q.trim().toLowerCase();
    return state.raw.filter(x => !isAuto(x) && x.type !== 'note')
      .map(x => ({ id: x.id, icon: '', label: mentionLabel(x), hay: (mentionLabel(x) + ' ' + (x.text || '') + ' ' + JSON.stringify(x.feedData || '')).toLowerCase(), t: x.createdAt || '' }))
      .filter(x => !s || x.hay.includes(s))
      .sort((a, b) => String(b.t).localeCompare(String(a.t)))
      .slice(0, 8)
      .map(x => ({ ...x, icon: x.label.split(' ')[0], label: x.label.split(' ').slice(1).join(' ') }));
  }

  let _onClose = null;
  let _lastFocus = null;
  function showModal(html, variant) {
    if ($('modal').hidden) _lastFocus = document.activeElement;
    $('modal').classList.toggle('modal--note', variant === 'note');
    if (variant !== 'note' && _onClose) { const f = _onClose; _onClose = null; f(); }
    $('modalBody').innerHTML = html;
    $('modal').hidden = false;
    document.documentElement.classList.add('modal-open');
    $('modalBody').scrollTop = 0;
  }
  function openDetail(id) {
    const it = state.raw.find(x => String(x.id) === String(id));
    if (!it) return;
    if (it.type === 'note') return openNote(it.id);
    const back = _noteBack; _noteBack = null;
    showModal((back ? `<button type="button" class="md__back" id="mdBack">← 노트로 돌아가기</button>` : '') + detailHTML(it));
    if (back) $('mdBack').addEventListener('click', () => openNote(back));
    bindThought();
    $('modalBody').querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
      const t = document.getElementById(b.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    /* 사진 넘기기 */
    const g = $('modalBody').querySelector('.md__gallery');
    if (g && Number(g.dataset.n) > 1) {
      let i = 0; const n = Number(g.dataset.n);
      const show = k => {
        i = (k + n) % n;
        g.querySelectorAll('[data-i]').forEach(el2 => { el2.hidden = Number(el2.dataset.i) !== i; });
        g.querySelector('.md__count b').textContent = i + 1;
      };
      g.querySelector('.md__nav--prev').addEventListener('click', () => show(i - 1));
      g.querySelector('.md__nav--next').addEventListener('click', () => show(i + 1));
      g._show = d2 => show(i + d2);
    }
    $('modalClose').focus();
  }
  function closeDetail() {
    if (_onClose) { const f = _onClose; _onClose = null; f(); }
    $('modal').classList.remove('modal--note');
    $('modal').hidden = true;
    document.documentElement.classList.remove('modal-open');
    _lastFocus?.focus?.();
  }
  $('modalClose').addEventListener('click', closeDetail);
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeDetail(); });
  document.addEventListener('keydown', e => {
    if ($('modal').hidden) return;
    if (e.key === 'Escape') closeDetail();
    const g = $('modalBody').querySelector('.md__gallery');
    if (g?._show && e.key === 'ArrowRight') g._show(1);
    if (g?._show && e.key === 'ArrowLeft') g._show(-1);
  });

  function cardOf(it) {
    let html;
    if (it.type === 'note') html = noteCard(it);
    else if (isLife(it)) html = photoCard(it);
    else if (it.type === 'youtube') html = youtubeCard(it);
    else { const v = learnedView(it); html = v ? learnedCard(it, v) : textCard(it); }
    /* 팝업을 열 수 있도록 카드에 id를 붙인다(모든 카드 템플릿이 <article class="entry…">로 시작) */
    return html.replace('<article class="entry', `<article tabindex="0" data-id="${esc(it.id)}" class="entry is-openable`);
  }

  /* 추억(사진·일상)과 공부한 것을 섞지 않고 구획을 나눈다 — 한 날 안에서도 "무엇을 했나"와
     "무엇을 배웠나"는 다른 질문이다. 비어 있는 구획은 그리지 않는다. */
  const SECTIONS = [
    { key: 'memory', label: '추억',      note: '사진과 그날의 글',  test: it => catOf(it) === 'memory' },
    { key: 'note',   label: '쓴 것',     note: '내가 정리한 노트',  test: it => catOf(it) === 'note' },
    { key: 'study',  label: '공부한 것', note: '영어·지식·오답',    test: it => STUDY_CATS.has(catOf(it)) },
    { key: 'memo',   label: '메모·링크', note: '영상·기사 등',      test: it => catOf(it) === 'memo' },
  ];
  /* 공부한 것은 갈래별로 한 번 더 묶는다 — 영어·역사·고전이 한 격자에 섞이면 무엇을 얼마나 했는지 안 보인다.
     갈래가 하나뿐이면 소제목 없이 바로 카드. 순서는 매일 가장 많이 쌓이는 것부터. */
  const STUDY_ORDER = ['english', 'history', 'classic', 'idiom', 'insight', 'wrong'];
  const STUDY_COLOR = { english: 'language', history: 'humanities', classic: 'psychology', idiom: 'humanities', insight: 'business', wrong: 'science' };
  function studyGroupsHTML(list) {
    const groups = STUDY_ORDER.map(k => [k, list.filter(it => catOf(it) === k)]).filter(([, l]) => l.length);
    if (groups.length <= 1) return `<div class="entries enter">${list.map(cardOf).join('')}</div>`;
    return '<div class="sgroups">' + groups.map(([k, l]) => `<div class="sgroup">
        <div class="sgroup__head"><i class="dot" style="background:${dom(STUDY_COLOR[k]).color}"></i>${esc((CATS.find(c => c.key === k) || {}).label || k)}<small>${l.length}</small></div>
        <div class="entries enter">${l.map(cardOf).join('')}</div>
      </div>`).join('') + '</div>';
  }

  function sectionsHTML(items) {
    return SECTIONS.map(s => {
      const list = items.filter(s.test);
      if (!list.length) return '';
      return `<section class="dsec dsec--${s.key}">
          <h3 class="dsec__head">${s.label}<small>${list.length}</small><span>${s.note}</span></h3>
          ${s.key === 'study' ? studyGroupsHTML(list) : `<div class="entries enter">${list.map(cardOf).join('')}</div>`}
        </section>`;
    }).join('');
  }

  /* 선택한 날을 기준으로 범위의 날짜 키 목록 — 주는 월요일 시작 */
  function scopeKeys(key) {
    const [y, m, d] = key.split('-').map(Number);
    if (state.scope === 'month') {
      return Array.from({ length: daysInMonth(y, m - 1) }, (_, i) => `${y}-${pad2(m)}-${pad2(i + 1)}`);
    }
    if (state.scope === 'week') {
      const base = new Date(y, m - 1, d);
      const mon = new Date(base); mon.setDate(base.getDate() - ((base.getDay() + 6) % 7));
      return Array.from({ length: 7 }, (_, i) => { const t = new Date(mon); t.setDate(mon.getDate() + i); return isoOf(t); });
    }
    return [key];
  }
  const shortDate = k => `${Number(k.slice(5, 7))}월 ${Number(k.slice(8, 10))}일`;

  function renderDay() {
    const key = state.selected;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const keys = scopeKeys(key);
    const filled = keys.filter(k => (state.byDate[k] || []).length);
    const studyCount = filled.reduce((n, k) => n + state.byDate[k].filter(it => STUDY_CATS.has(catOf(it))).length, 0);

    const title = state.scope === 'day' ? `${m}월 ${d}일`
      : state.scope === 'week' ? `${shortDate(keys[0])} – ${shortDate(keys[6])}`
      : `${m}월 한 달`;
    const catLabel = state.cat ? (CATS.find(c => c.key === state.cat) || {}).label : '';

    const head = `<div class="day__head">
        <h2 class="day__date">${title}</h2>
        <span class="day__dow">${state.scope === 'day' ? DOW[date.getDay()] + '요일' : ''}${catLabel ? ` · ${esc(catLabel)}만` : ''}</span>
        ${state.scope === 'day' && isSeal(key) ? `<span class="day__seal"><i class="seal">記</i>자취를 남긴 날</span>` : ''}
      </div>
      <div class="day__tools">
        <div class="seg seg--sm" role="group" aria-label="보기 범위">
          ${[['day', '그날'], ['week', '그 주'], ['month', '그 달']].map(([k, l]) =>
            `<button type="button" data-scope="${k}" aria-pressed="${state.scope === k}">${l}</button>`).join('')}
        </div>
        ${studyCount ? `<label class="check"><input type="checkbox" id="quizToggle" ${state.quiz ? 'checked' : ''}/>
          <span>답 가리기 <em class="muted">— 카드를 누르면 보여요</em></span></label>` : ''}
      </div>`;

    let body;
    if (!filled.length) {
      body = `<div class="empty">${state.scope === 'day' ? '이날은' : '이 기간에는'} ${catLabel ? `${esc(catLabel)} 기록이 없어요.` : '비워 두었습니다.'}</div>`;
    } else if (state.scope === 'day') {
      body = sectionsHTML(state.byDate[key]);
    } else {
      /* 범위 보기 — 최근 날짜부터, 날짜마다 같은 구획 */
      body = filled.slice().reverse().map(k => {
        const dd = new Date(k + 'T00:00:00');
        return `<div class="dgroup">
            <button type="button" class="dgroup__date" data-key="${k}">${shortDate(k)} <span>${DOW[dd.getDay()]}</span></button>
            ${sectionsHTML(state.byDate[k])}
          </div>`;
      }).join('');
    }

    const box = $('day');
    box.classList.toggle('quiz', state.quiz && !!studyCount);
    box.innerHTML = head + body;

    box.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      state.scope = b.dataset.scope; renderDay();
    }));
    box.querySelector('#quizToggle')?.addEventListener('change', e => { state.quiz = e.target.checked; renderDay(); });
    box.querySelectorAll('.dgroup__date').forEach(b => b.addEventListener('click', () => {
      state.scope = 'day'; state.month = Number(b.dataset.key.slice(5, 7)) - 1; select(b.dataset.key);
    }));
    /* 카드를 누르면 상세 팝업. 답 가리기 중인 공부 카드는 첫 번째 누름에 답만 보여 주고, 다시 누르면 팝업 */
    box.querySelectorAll('.entry.is-openable').forEach(c => {
      const open = e => {
        if (e.target.closest('a')) return;   // 카드 안 링크는 링크대로
        if (box.classList.contains('quiz') && c.classList.contains('entry--learned') && !c.classList.contains('revealed')) {
          c.classList.add('revealed'); return;
        }
        openDetail(c.dataset.id);
      };
      c.addEventListener('click', open);
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    });
  }

  /* ── 렌더: 올해의 결 ─────────────────────── */
  function renderReview() {
    const keys = yearKeys().sort();
    const byMonth = Array(12).fill(0);
    const mix = {};
    let photos = 0;

    keys.forEach(k => {
      byMonth[Number(k.slice(5, 7)) - 1] += countOf(k);
      (state.byDate[k] || []).forEach(it => {
        mix[it.domain] = (mix[it.domain] || 0) + 1;
        if (isLife(it)) photos += (it.life?.photos || []).length;
      });
    });

    /* 최장 연속 기록일 */
    let best = 0, run = 0, prev = null;
    keys.forEach(k => {
      const t = new Date(k + 'T00:00:00').getTime();
      run = (prev !== null && t - prev === 86400000) ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    });

    const total = keys.reduce((s, k) => s + countOf(k), 0);
    const busy = byMonth.indexOf(Math.max(...byMonth));
    $('revBusy').innerHTML   = (total ? busy + 1 : '—') + '<small>월</small>';
    $('revStreak').innerHTML = best + '<small>일</small>';
    $('revPhoto').innerHTML  = photos + '<small>장</small>';

    const sum = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
    const ordered = Object.entries(mix).sort((a, b) => b[1] - a[1]);
    $('mixBar').innerHTML = ordered
      .map(([k, v]) => `<i style="flex:${v};background:${dom(k).color}"></i>`).join('');
    $('mixKey').innerHTML = ordered
      .map(([k, v]) => `<span><i class="dot" style="background:${dom(k).color}"></i>${esc(dom(k).label)} ${Math.round(v / sum * 100)}%</span>`)
      .join('') || '<span class="muted">아직 기록이 없어요</span>';

    renderTally();
    renderScenes();
    renderTravel();

    /* 월별 줄 */
    const maxM = Math.max(1, ...byMonth);
    $('monthsReview').innerHTML = byMonth.map((n, i) => {
      const seg = {};
      keys.filter(k => Number(k.slice(5, 7)) - 1 === i)
        .forEach(k => (state.byDate[k] || []).forEach(it => { seg[it.domain] = (seg[it.domain] || 0) + 1; }));
      const bars = Object.entries(seg).sort((a, b) => b[1] - a[1])
        .map(([d2, v]) => `<i style="width:${v / maxM * 100}%;background:${dom(d2).color}"></i>`).join('');
      return `<div class="mrow${n ? ' on' : ''}">
          <div class="mrow__label">${i + 1}월</div>
          <div class="mrow__bar">${bars}</div>
          <div class="mrow__n">${n ? n + '건' : ''}</div>
        </div>`;
    }).join('');
  }

  /* 올해 쌓은 것 — 내가 직접 저장한 것만 센다(자동 배달분은 "받은 것"이지 "쌓은 것"이 아니다).
     토글과 무관하게 같은 숫자를 보여야 연말에 비교가 된다. */
  const yearRaw = () => state.raw.filter(it => dateKey(it).startsWith(state.year + '-'));

  function renderTally() {
    const counts = {};
    const bump = k => { counts[k] = (counts[k] || 0) + 1; };
    let days = new Set();
    yearRaw().forEach(it => {
      if (isAuto(it)) return;
      days.add(dateKey(it));
      if (isLife(it)) return bump('자취');
      const v = learnedView(it);
      if (v) return bump(v.kind.startsWith('영어') ? '영어 표현' : v.kind.startsWith('오답') ? '오답노트' : v.kind);
      if (it.type === 'youtube') return bump('영상');
      bump('메모·기사');
    });
    const ORDER = ['자취', '영어 표현', '고전', '역사', '고사성어', '인사이트', '명언',
                   '오답노트', '수능 영단어', '한국사', '영상', '메모·기사'];
    const cells = ORDER.filter(k => counts[k])
      .map(k => `<div class="tally__cell"><b>${counts[k]}</b><span>${esc(k)}</span></div>`).join('');
    $('tally').innerHTML = cells
      ? cells
      : '<span class="muted">올해 직접 남긴 기록이 아직 없어요. 배달 카드에서 저장하거나 사진을 공유해 보세요.</span>';
    $('tallyDays').textContent = days.size ? `직접 남긴 날 ${days.size}일` : '';
  }

  /* 올해의 장면 — 글을 붙여 남긴 자취 가운데 최근 것부터. 누르면 그날로 간다 */
  function renderScenes() {
    const lifes = yearRaw().filter(isLife)
      .filter(it => lifeCaption(it) || (it.life?.photos || []).length)
      .sort((a, b) => dateKey(b).localeCompare(dateKey(a)))
      .slice(0, 8);
    const box = $('scenes');
    if (!lifes.length) {
      box.innerHTML = '<span class="muted">사진을 공유하거나 한 줄을 남기면 여기에 그 해의 장면들이 모입니다.</span>';
      return;
    }
    box.innerHTML = lifes.map(it => {
      const k = dateKey(it);
      const photo = (it.life?.photos || []).find(Boolean);
      /* 글이 없으면 기분·사진 수로 대신한다 — 빈 카드보다 "그날 뭔가 남겼다"는 흔적이 낫다 */
      const n = (it.life?.photos || []).length;
      const line = lifeCaption(it).split('\n')[0]
        || [it.life?.mood, n ? `사진 ${n}장` : ''].filter(Boolean).join(' ');
      /* 사진이 있으면 사진 타일, 없으면(또는 사진 파일이 사라졌으면) 그라데이션 텍스트 타일 */
      return `<button class="scene${photo ? '' : ' scene--text'}" data-key="${k}">
        ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" onerror="this.closest('.scene').classList.add('scene--text');this.remove()"/>` : ''}
        <span class="scene__date">${Number(k.slice(5, 7))}월 ${Number(k.slice(8, 10))}일</span>
        ${line ? `<span class="scene__line">${esc(line.length > 60 ? line.slice(0, 60) + '…' : line)}</span>` : ''}
      </button>`;
    }).join('');
    box.querySelectorAll('.scene').forEach(b => b.addEventListener('click', () => {
      setScope(true);
      select(b.dataset.key);
      $('day').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  /* ── 올해 다녀온 곳 ──────────────────────────
     추억 기록의 life.place(나라·도시 — 공유할 때 사진 GPS로 채울 자리)를 모아 여행 단위로 묶고,
     세계 지도에 칠한다. 지도 데이터(world-atlas 110m)와 d3-geo는 여행이 있을 때만 불러온다. */
  const shortMD = k => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`;
  function tripsOf() {
    const lifes = yearRaw().filter(it => isLife(it) && it.life?.place?.code)
      .sort((a, b) => dateKey(a).localeCompare(dateKey(b)) || String(a.createdAt).localeCompare(String(b.createdAt)));
    const trips = [];
    for (const it of lifes) {
      const k = dateKey(it), p = it.life.place, last = trips[trips.length - 1];
      const gap = last ? (new Date(k) - new Date(last.to)) / 86400000 : Infinity;
      if (last && last.place.code === p.code && gap <= 2) {   // 같은 나라, 이틀 이내면 같은 여행
        last.items.push(it); last.to = k; if (p.city) last.cities.add(p.city);
      } else {
        trips.push({ place: p, from: k, to: k, items: [it], cities: new Set(p.city ? [p.city] : []) });
      }
    }
    trips.forEach(t => {
      t.days = Math.round((new Date(t.to) - new Date(t.from)) / 86400000) + 1;
      t.photos = t.items.reduce((n, it) => n + (it.life.photos || []).length, 0);
      t.label = t.from === t.to ? shortMD(t.from) : `${shortMD(t.from)}–${shortMD(t.to)}`;
    });
    return trips;
  }

  let _geo = null;   // 지도 라이브러리·데이터는 한 번만
  function loadGeo() {
    if (_geo) return _geo;
    const js = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
    const CDN = 'https://cdn.jsdelivr.net/npm/';
    _geo = js(CDN + 'd3-array@3.2.4/dist/d3-array.min.js')
      .then(() => js(CDN + 'd3-geo@3.1.1/dist/d3-geo.min.js'))
      .then(() => js(CDN + 'topojson-client@3.1.0/dist/topojson-client.min.js'))
      .then(() => fetch(CDN + 'world-atlas@2.0.2/countries-110m.json'))
      .then(r => r.json())
      .then(topo => window.topojson.feature(topo, topo.objects.countries).features.filter(f => f.id !== '010'))  // 남극 제외
      .catch(e => { _geo = null; throw e; });
    return _geo;
  }

  function renderTravel() {
    const trips = tripsOf();
    $('travelBox').hidden = !trips.length;
    if (!trips.length) return;
    const countries = new Set(trips.map(t => t.place.code));
    const days = new Set(trips.flatMap(t => t.items.map(dateKey)));
    $('travelSum').textContent = `${countries.size}개국 · 여행 ${trips.length}번 · 기록한 날 ${days.size}일`;

    $('travelTrips').innerHTML = trips.slice().reverse().map((t, i) => `<button type="button" class="trip" data-t="${trips.length - 1 - i}">
        <span class="flag">${esc(t.place.flag || '📍')}</span>
        <span><b>${esc(t.place.name)}</b>${t.cities.size ? ` · ${esc([...t.cities].join('·'))}` : ''}</span>
        <small>${t.label} · 사진 ${t.photos}장</small></button>`).join('');
    $('travelTrips').querySelectorAll('.trip').forEach(b => b.addEventListener('click', () => openAlbum(trips[b.dataset.t])));

    $('travelMap').innerHTML = '<span class="muted">지도를 불러오는 중…</span>';
    loadGeo().then(features => drawMap(features, trips))
      .catch(() => { $('travelMap').innerHTML = '<span class="muted">지도를 불러오지 못했어요 — 아래 여행 목록은 그대로 볼 수 있어요.</span>'; });
  }

  function drawMap(features, trips) {
    const d3 = window.d3, W = 960, H = 480;
    const proj = d3.geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: 'FeatureCollection', features });
    const path = d3.geoPath(proj);
    const byIso = {}; trips.forEach(t => (byIso[t.place.iso] = byIso[t.place.iso] || []).push(t));
    const lands = features.map(f => `<path class="land${byIso[f.id] ? ' visited' : ''}" data-iso="${f.id}" d="${path(f)}"><title>${byIso[f.id] ? esc(byIso[f.id][0].place.name) : ''}</title></path>`).join('');
    /* 핀 — 나라 무게중심. 같은 나라를 여러 번 갔으면 날짜 라벨을 아래로 쌓는다.
       한국·일본처럼 가까운 나라는 라벨이 겹치므로, 이미 놓인 라벨과 겹치면 아래로 한 줄씩 민다.
       국기 이모지는 윈도우에서 글자(KR)로 보여 지도에선 빼고 날짜만(국기는 아래 여행 칩에). */
    const placed = [];
    const LINE = 13, CH = 6.4;
    const spot = (x, y, text) => {
      const w = text.length * CH;
      let yy = y;
      while (placed.some(r => x < r.x + r.w && x + w > r.x && Math.abs(yy - r.y) < LINE)) yy += LINE;
      placed.push({ x, y: yy, w });
      return yy;
    };
    const pinList = Object.entries(byIso).map(([iso, ts]) => {
      const f = features.find(x => x.id === iso); if (!f) return null;
      const [x, y] = proj(d3.geoCentroid(f));
      return { iso, ts, x, y };
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    const pins = pinList.map(({ iso, ts, x, y }) => {
      const labels = ts.map(t => { const yy = spot(x + 9, y + 4, t.label); return `<text x="${x + 9}" y="${yy}">${t.label}</text>`; }).join('');
      return `<g class="pin" data-iso="${iso}"><circle cx="${x}" cy="${y}" r="5.5"/>${labels}</g>`;
    }).join('');
    $('travelMap').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="올해 다녀온 나라 지도">${lands}${pins}</svg>`;
    const openIso = iso => { const ts = byIso[iso]; if (ts) openAlbum(ts[ts.length - 1]); };   // 여러 번이면 가장 최근 여행
    $('travelMap').querySelectorAll('.land.visited, .pin').forEach(el2 => el2.addEventListener('click', () => openIso(el2.dataset.iso)));
  }

  /* 여행 앨범 — 날짜별 사진 격자 + 그날의 글. 사진을 누르면 그 기록의 상세(크게 넘겨 보기) */
  function openAlbum(t) {
    const byDay = {};
    t.items.forEach(it => (byDay[dateKey(it)] = byDay[dateKey(it)] || []).push(it));
    const cover = albumCover(t);
    const html = `<header class="md__head">
        <div class="md__kind">${esc(t.place.flag || '📍')} 여행</div>
        <h3 class="md__title">${esc(t.place.name)}${t.cities.size ? ` · ${esc([...t.cities].join(' · '))}` : ''}</h3>
        <p class="md__sub">${shortDate(t.from)}${t.from !== t.to ? ` – ${shortDate(t.to)}` : ''} · ${t.days}일 · 사진 ${t.photos}장</p>
      </header>
      ${t.photos ? `<button type="button" class="album__play" id="albumPlayBtn">
        ${cover ? `<img src="${esc(cover)}" alt=""/>` : ''}<span><b>▶ 앨범 넘겨보기</b><small>사진 한 장씩, 그날의 이야기와 함께 천천히</small></span></button>` : ''}` + Object.keys(byDay).sort().map(k => {
        const dd = new Date(k + 'T00:00:00');
        const list = byDay[k];
        return `<div class="album__day"><h4>${shortDate(k)} ${DOW[dd.getDay()]}요일</h4>
            <div class="album__grid">${list.flatMap(it => (it.life.photos || []).map(p =>
              `<button type="button" data-id="${esc(it.id)}"><img src="${esc(p)}" alt="" loading="lazy" onerror="this.parentNode.remove()"/></button>`)).join('')}</div>
            ${list.filter(lifeCaption).map(it => `<p class="album__note">${esc(lifeCaption(it))}<small>${esc([it.life.place?.city, it.life.mood].filter(Boolean).join(' · '))}</small></p>`).join('')}
          </div>`;
      }).join('');
    showModal(html);
    $('modalBody').querySelectorAll('.album__grid button').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.id)));
    $('albumPlayBtn')?.addEventListener('click', () => playAlbum(t));
    $('modalClose').focus();
  }

  /* ── 앨범 넘겨보기 ──────────────────────────
     사진첩을 다시 꺼내 보는 경험 — 한 장씩 크게, 천천히 다가가는 화면(켄 번스),
     날마다 "Day N" 장(章) 표지, 아래에는 여정 줄(기록한 곳 순서대로 점이 따라간다),
     마지막 장에는 숫자로 본 여행과 표지 사진 고르기. 표지는 이 브라우저에만 저장한다. */
  const coverKey = t => `chronicle-album-cover:${t.place.code}:${t.from}`;
  function albumCover(t) {
    const all = t.items.flatMap(it => it.life.photos || []);
    let saved = null;
    try { saved = localStorage.getItem(coverKey(t)); } catch { /* 저장소를 못 쓰면 첫 사진 */ }
    return all.includes(saved) ? saved : all[0] || '';
  }
  /* "파리 · 개선문" → "개선문" (앞부분이 도시 이름이면 뗀다). 제목이 없으면 도시 */
  function siteOf(it) {
    const title = it.title && it.title !== DEFAULT_LIFE_TITLE ? String(it.title) : '';
    const parts = title.split(' · ');
    if (parts.length > 1 && parts[0] === it.life.place?.city) return parts.slice(1).join(' · ');
    return title || it.life.place?.city || '';
  }

  let _ap = null;   // 열린 앨범 플레이어 하나
  function playAlbum(t) {
    if (_ap) _ap.close();
    const byDay = {};
    t.items.forEach(it => (byDay[dateKey(it)] = byDay[dateKey(it)] || []).push(it));
    const dayKeys = Object.keys(byDay).sort();
    const stops = [];                         // 여정 줄의 정류장 = 기록 하나
    const slides = [{ kind: 'cover' }];
    dayKeys.forEach((k, di) => {
      slides.push({ kind: 'chapter', day: di + 1, key: k, list: byDay[k], stop: stops.length });
      byDay[k].forEach(it => {
        const photos = (it.life.photos || []);
        if (!photos.length) return;
        stops.push({ it, day: di + 1 });
        photos.forEach((src, n) => slides.push({ kind: 'photo', it, src, n, of: photos.length, stop: stops.length - 1 }));
      });
    });
    slides.push({ kind: 'end' });
    const photoSlides = slides.filter(s => s.kind === 'photo');

    const box = document.createElement('div');
    box.className = 'ap';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', `${t.place.name} 여행 앨범`);
    box.innerHTML = `<div class="ap__stage" id="apStage"></div>
      <div class="ap__top">
        <span class="ap__title">${esc(t.place.flag || '📍')} ${esc(t.place.name)} · ${t.label}</span>
        <span class="ap__count" id="apCount"></span>
        <button type="button" class="ap__btn" id="apPlay" aria-label="일시정지">❚❚</button>
        <button type="button" class="ap__btn" id="apClose" aria-label="닫기">✕</button>
      </div>
      <button type="button" class="ap__nav ap__nav--prev" id="apPrev" aria-label="이전">‹</button>
      <button type="button" class="ap__nav ap__nav--next" id="apNext" aria-label="다음">›</button>
      <div class="ap__route" aria-hidden="true">
        <div class="ap__line"></div><div class="ap__trail" id="apTrail"></div>
        ${stops.map((s, i) => `<span class="ap__stop" data-s="${i}" style="left:${stops.length > 1 ? i / (stops.length - 1) * 100 : 50}%">
          <i></i><em>${esc(siteOf(s.it))}</em></span>`).join('')}
        <span class="ap__dot" id="apDot"></span>
      </div>`;
    document.body.appendChild(box);
    document.documentElement.classList.add('ap-open');

    const stage = box.querySelector('#apStage');
    const S = { i: -1, playing: true, timer: null, last: document.activeElement };
    const DUR = { cover: 4200, chapter: 3600, photo: 5600 };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dateLine = k => { const d = new Date(k + 'T00:00:00'); return `${shortDate(k)} ${DOW[d.getDay()]}요일`; };

    /* 여정 줄 위치(0~1): 정류장 사이를 사진 장수만큼 나눠 조금씩 간다 */
    const posOf = s => {
      if (s.kind === 'cover') return 0;
      if (s.kind === 'end') return 1;
      const n = Math.max(stops.length - 1, 1);
      const frac = s.kind === 'photo' && s.of > 1 && s.stop < stops.length - 1 ? s.n / s.of : 0;
      return stops.length > 1 ? Math.min((s.stop + frac) / n, 1) : .5;
    };

    function slideHTML(s, idx) {
      if (s.kind === 'cover') {
        const c = albumCover(t);
        return `${c ? `<div class="ap__photo kb kb--0"><img class="ap__bg" src="${esc(c)}" alt=""/><img class="ap__img" src="${esc(c)}" alt=""/></div>` : ''}
          <div class="ap__card ap__card--cover">
            <div class="ap__kicker">${esc(t.place.flag || '')} ${t.from.slice(0, 4)}년의 여행</div>
            <h2>${esc(t.place.name)}</h2>
            <p>${esc([...t.cities].join(' · '))}</p>
            <p class="ap__meta">${shortDate(t.from)}${t.from !== t.to ? ` – ${shortDate(t.to)}` : ''} · ${t.days}일</p>
          </div>`;
      }
      if (s.kind === 'chapter') {
        const sites = s.list.map(siteOf).filter(Boolean);
        const cities = [...new Set(s.list.map(it => it.life.place?.city).filter(Boolean))];
        const bg = s.list.flatMap(it => it.life.photos || [])[0];
        return `${bg ? `<div class="ap__photo kb kb--2"><img class="ap__bg ap__bg--deep" src="${esc(bg)}" alt=""/></div>` : ''}
          <div class="ap__card ap__card--chapter">
            <div class="ap__kicker">Day ${s.day}</div>
            <h2>${dateLine(s.key)}</h2>
            <p>${esc(cities.join(' · '))}</p>
            <ol class="ap__sites">${sites.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
          </div>`;
      }
      if (s.kind === 'photo') {
        const it = s.it;
        const text = lifeCaption(it) === it.title ? '' : lifeCaption(it);
        return `<div class="ap__photo kb kb--${idx % 4}"><img class="ap__bg" src="${esc(s.src)}" alt=""/>
            <img class="ap__img" src="${esc(s.src)}" alt="${esc(siteOf(it))}"/></div>
          <figcaption class="ap__cap${s.n ? ' is-quiet' : ''}">
            <span class="ap__where">Day ${stops[s.stop].day} · ${esc(siteOf(it))}${s.of > 1 ? ` <small>${s.n + 1}/${s.of}</small>` : ''}</span>
            ${text && !s.n ? `<span class="ap__text">${esc(text).replace(/\n/g, '<br>')}</span>` : ''}
          </figcaption>`;
      }
      const cities = new Set(t.items.map(it => it.life.place?.city).filter(Boolean));
      const cur = albumCover(t);
      return `<div class="ap__card ap__card--end">
          <div class="ap__kicker">${esc(t.place.flag || '')} ${esc(t.place.name)}에서</div>
          <h2>${t.days}일 · 사진 ${photoSlides.length}장 · 기록 ${stops.length}개${cities.size > 1 ? ` · ${cities.size}개 도시` : ''}</h2>
          <p>표지로 남길 사진을 골라 주세요</p>
          <div class="ap__covers">${photoSlides.map(p => `<button type="button" data-cover="${esc(p.src)}" class="${p.src === cur ? 'is-on' : ''}"
            aria-label="${esc(siteOf(p.it))} 사진을 표지로"><img src="${esc(p.src)}" alt="" loading="lazy"/></button>`).join('')}</div>
          <div class="ap__actions">
            <button type="button" class="btn" data-act="again">처음부터 다시</button>
            <button type="button" class="btn btn--primary" data-act="close">앨범 닫기</button>
          </div>
        </div>`;
    }

    function go(idx) {
      idx = Math.max(0, Math.min(slides.length - 1, idx));
      if (idx === S.i) return;
      const back = idx < S.i;
      S.i = idx;
      const s = slides[idx];
      stage.querySelectorAll('.ap__layer').forEach(l => { l.classList.add('is-out'); setTimeout(() => l.remove(), 1000); });
      const layer = document.createElement('div');
      layer.className = `ap__layer ap__layer--${s.kind}${back ? ' is-back' : ''}`;
      layer.innerHTML = slideHTML(s, idx);
      stage.appendChild(layer);
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-in')));
      layer.querySelectorAll('[data-cover]').forEach(b => b.addEventListener('click', () => {
        try { localStorage.setItem(coverKey(t), b.dataset.cover); } catch { /* 이번 화면에만 반영 */ }
        layer.querySelectorAll('[data-cover]').forEach(x => x.classList.toggle('is-on', x === b));
      }));
      layer.querySelector('[data-act="again"]')?.addEventListener('click', () => { S.playing = true; paintPlay(); go(0); });
      layer.querySelector('[data-act="close"]')?.addEventListener('click', close);

      /* 다음 사진 미리 받기 */
      const nx = slides[idx + 1];
      if (nx?.kind === 'photo') new Image().src = nx.src;

      const pos = posOf(s) * 100;
      box.querySelector('#apDot').style.left = pos + '%';
      box.querySelector('#apTrail').style.width = pos + '%';
      const cur = s.kind === 'photo' ? s.stop : s.kind === 'end' ? stops.length : -1;
      box.querySelectorAll('.ap__stop').forEach(el2 => {
        const k = Number(el2.dataset.s);
        el2.classList.toggle('is-past', k < cur || s.kind === 'end');
        el2.classList.toggle('is-now', k === cur);
      });
      const pi = photoSlides.indexOf(s);
      box.querySelector('#apCount').textContent = pi >= 0 ? `${pi + 1} / ${photoSlides.length}` : '';
      box.querySelector('#apPrev').disabled = idx === 0;
      box.querySelector('#apNext').disabled = idx === slides.length - 1;
      schedule();
    }
    function schedule() {
      clearTimeout(S.timer);
      const s = slides[S.i];
      if (!S.playing || s.kind === 'end') return;
      S.timer = setTimeout(() => go(S.i + 1), DUR[s.kind] * (reduce ? 1.3 : 1));
    }
    function paintPlay() {
      const b = box.querySelector('#apPlay');
      b.textContent = S.playing ? '❚❚' : '▶';
      b.setAttribute('aria-label', S.playing ? '일시정지' : '자동 넘기기');
      box.classList.toggle('is-paused', !S.playing);
    }
    function toggle() { S.playing = !S.playing; paintPlay(); schedule(); }
    function close() {
      clearTimeout(S.timer);
      window.removeEventListener('keydown', onKey, true);
      box.classList.add('is-closing');
      setTimeout(() => box.remove(), 350);
      document.documentElement.classList.remove('ap-open');
      _ap = null;
      S.last?.focus?.();
    }
    function onKey(e) {
      const k = e.key;
      if (!['Escape', 'ArrowRight', 'ArrowLeft', ' ', 'Home', 'End'].includes(k)) return;
      if (k === ' ' && e.target.closest?.('button')) return;   // 버튼 위 스페이스는 버튼 몫
      e.preventDefault(); e.stopPropagation();                  // 아래 팝업이 같이 닫히거나 넘어가지 않게
      if (k === 'Escape') close();
      else if (k === 'ArrowRight') go(S.i + 1);
      else if (k === 'ArrowLeft') go(S.i - 1);
      else if (k === ' ') toggle();
      else if (k === 'Home') go(0);
      else go(slides.length - 1);
    }
    window.addEventListener('keydown', onKey, true);
    box.querySelector('#apClose').addEventListener('click', close);
    box.querySelector('#apPlay').addEventListener('click', toggle);
    box.querySelector('#apPrev').addEventListener('click', () => go(S.i - 1));
    box.querySelector('#apNext').addEventListener('click', () => go(S.i + 1));
    /* 화면 탭(왼쪽 3분의 1은 이전, 나머지는 다음)·옆으로 밀기 */
    let px = null;
    stage.addEventListener('pointerdown', e => { px = e.clientX; });
    stage.addEventListener('pointerup', e => {
      if (px === null || e.target.closest('button')) { px = null; return; }
      const dx = e.clientX - px; px = null;
      if (Math.abs(dx) > 40) return go(S.i + (dx < 0 ? 1 : -1));
      if (slides[S.i].kind === 'end') return;
      go(S.i + (e.clientX < window.innerWidth / 3 ? -1 : 1));
    });

    _ap = { close };
    go(0);
    box.querySelector('#apClose').focus();
  }

  /* ── 지식 지도 ──────────────────────────────
     연도와 상관없이 지금까지 배달받은 지식(GET /api/knowledge-map).
     가로 = 시대(앞 시대일수록 촘촘해 구간별로 나눈 눈금), 세로 = 지역 줄(한국·중국·일본·서양·과학).
     연재 하나 = 상자, 편 하나 = 점(받은 편은 채움, 아직 안 온 편은 빈 점). 아래 띠는 연재 밖 역사와 지혜.
     선 = 서로 다른 판의 지식이 같은 인물·사건·고사로 이어진 곳(양쪽 다 받았으면 실선, 한쪽만이면 점선).
     점이나 상자를 누르면 아래 칸에 그 지식과 이어진 이야기들. 샘플 모드에서는 그리지 않는다. */
  const KM_LANES = ['한국', '중국', '일본', '서양', '과학'];
  const KM_BREAKS = [-800, -200, 300, 1000, 1500, 1800, 2000];
  const km = { data: null, sel: null, links: {} };

  async function loadKmap() {
    if (DEMO || km.data) return;
    try {
      const d = await api('/api/knowledge-map?mode=PROFESSIONAL');
      if (!d.success || !Object.values(d.nodes).some(n => n.got)) return;
      km.data = d;
      km.links = {};
      d.links.forEach(l => { (km.links[l.a] = km.links[l.a] || []).push(l); (km.links[l.b] = km.links[l.b] || []).push(l); });
      $('kmap').hidden = false;
      renderKmapStats();
      renderKmap();
      kmPanel();
      if (location.hash === '#kmap') $('kmap').scrollIntoView({ block: 'start' });   // 앱 홈의 '지식 지도' 링크로 왔을 때
    } catch { /* 지도가 없어도 연대기는 그대로 */ }
  }

  function renderKmapStats() {
    const s = km.data.stats;
    const tile = (num, unit, label) => `<div><div class="figure__num">${num}<small>${unit}</small></div><div class="figure__label">${label}</div></div>`;
    $('kmapStats').innerHTML =
      tile(s.history, '편', '받은 역사') +
      tile(`${s.seriesDone}/${km.data.series.length}`, '', '끝까지 읽은 연재') +
      tile(s.wisdom, '장', '받은 지혜') +
      tile(s.linked, '줄', '이어진 이야기') +
      tile(`+${s.week}`, '', '이번 주');
  }

  function renderKmap() {
    const d = km.data, N = d.nodes;
    const W = 1000, X0 = 84, X1 = W - 20;
    const seg = (X1 - X0) / (KM_BREAKS.length - 1);
    const xOf = yr => {
      const y = Math.max(KM_BREAKS[0], Math.min(KM_BREAKS[KM_BREAKS.length - 1], yr));
      let i = 0; while (i < KM_BREAKS.length - 2 && y > KM_BREAKS[i + 1]) i++;
      return X0 + (i + (y - KM_BREAKS[i]) / (KM_BREAKS[i + 1] - KM_BREAKS[i])) * seg;
    };
    const weekAgo = isoOf(new Date(Date.now() - 7 * 86400000));
    const pos = {}, out = [], bg = [];   // bg = 줄 이름·구분선·눈금(선보다 아래)
    const dot = (id, x, y, r = 4.2) => {
      const n = N[id]; pos[id] = { x, y };
      const cls = ['km-dot', n.got ? 'is-got' : '', n.got && n.got >= weekAgo ? 'is-new' : '', n.saved ? 'is-saved' : '', km.links[id] ? 'is-linked' : ''].join(' ');
      return `<g class="${cls}" data-id="${esc(id)}"><circle class="km-hit" cx="${x}" cy="${y}" r="8"/><circle cx="${x}" cy="${y}" r="${r}"/>
        <title>${esc(n.title)}${n.got ? ` · ${shortDate(n.got)}` : ' · 아직'}</title></g>`;
    };
    let y = 14;
    const lanes = [...KM_LANES, ...new Set(d.series.map(s => s.lane))].filter((l, i, a) => a.indexOf(l) === i && d.series.some(s => s.lane === l));
    const ROW = 58, MINW = 150;
    for (const lane of lanes) {
      const rows = [];
      const placed = d.series.filter(s => s.lane === lane && s.items.length)
        .sort((a, b) => (a.from ?? 0) - (b.from ?? 0))
        .map(s => {
          let x1 = xOf(s.from ?? 0), x2 = xOf(s.to ?? s.from ?? 0);
          if (x2 - x1 < MINW) { const c = (x1 + x2) / 2; x1 = c - MINW / 2; x2 = c + MINW / 2; }
          if (x1 < X0) { x2 += X0 - x1; x1 = X0; }
          if (x2 > X1) { x1 -= x2 - X1; x2 = X1; }
          let r = rows.findIndex(right => right + 10 <= x1);
          if (r < 0) { r = rows.length; rows.push(0); }
          rows[r] = x2;
          return { s, x1, x2, r };
        });
      const top = y, h = rows.length * ROW + 8;
      bg.push(`<text class="km-lane" x="10" y="${top + h / 2 + 4}">${esc(lane)}</text>`,
               `<line class="km-sep" x1="0" x2="${W}" y1="${top + h}" y2="${top + h}"/>`);
      for (const { s, x1, x2, r } of placed) {
        const by = top + 6 + r * ROW, w = x2 - x1, n = s.items.length;
        const gotN = s.items.filter(id => N[id].got).length;
        const sp = n > 1 ? Math.min(14, (w - 24) / (n - 1)) : 0;
        const sx = x1 + (w - sp * (n - 1)) / 2;
        out.push(`<g class="km-series${gotN === n ? ' is-done' : gotN ? ' is-on' : ''}" data-series="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(s.title)} 연재 ${gotN}/${n}편">
          <rect x="${x1}" y="${by}" width="${w}" height="${ROW - 10}" rx="10"/>
          <text x="${x1 + 10}" y="${by + 15}">${esc(s.title)}<tspan dx="6">${gotN}/${n}${gotN === n ? ' ✓' : ''}</tspan></text></g>`);
        s.items.forEach((id, i) => out.push(dot(id, sx + i * sp, by + 33)));
      }
      y += h;
    }
    /* 연재 밖 역사 — 연도 자리에 작은 점 */
    const others = d.others.filter(id => N[id].year !== null && N[id].year !== undefined);
    if (others.length) {
      const top = y, h = 52;
      bg.push(`<text class="km-lane" x="10" y="${top + h / 2 + 4}">그 밖의<tspan x="10" dy="13">역사</tspan></text>`,
               `<line class="km-sep" x1="0" x2="${W}" y1="${top + h}" y2="${top + h}"/>`);
      others.forEach((id, i) => out.push(dot(id, xOf(N[id].year), top + 12 + (i % 3) * 14, 3.4)));
      y += h;
    }
    /* 시대 눈금 */
    KM_BREAKS.forEach((b, i) => {
      const x = X0 + i * seg;
      bg.push(`<line class="km-tick" x1="${x}" x2="${x}" y1="14" y2="${y}"/>`,
               `<text class="km-axis" x="${x}" y="${y + 15}" text-anchor="${i === 0 ? 'start' : i === KM_BREAKS.length - 1 ? 'end' : 'middle'}">${kmYearLabel(b)}</text>`);
    });
    y += 34;
    /* 지혜 — 갈래마다 받은 장을 점으로(전체 장수와 함께). 연도를 모르는 역사(경영·산업 이야기 등)도 이 띠에 */
    const noYear = d.others.filter(id => N[id].year === null || N[id].year === undefined);
    const groups = [...d.wisdom, ...(noYear.length ? [{ title: '연도 없는 역사', items: noYear, total: null }] : [])];
    const gw = (W - 20) / groups.length;
    let wh = 0;
    groups.forEach((g, gi) => {
      const gx = 10 + gi * gw, cols = Math.max(1, Math.floor((gw - 24) / 11));
      out.push(`<text class="km-wtitle" x="${gx + 4}" y="${y + 12}">${esc(g.title)}<tspan dx="6">${g.items.length}${g.total ? `/${g.total}` : ''}</tspan></text>`);
      g.items.forEach((id, i) => out.push(dot(id, gx + 10 + (i % cols) * 11, y + 30 + Math.floor(i / cols) * 11, 3.4)));
      wh = Math.max(wh, 30 + Math.ceil(g.items.length / cols) * 11);
    });
    const H = y + wh + 8;

    /* 선 — 점 아래에 깐다 */
    const lines = d.links.filter(l => pos[l.a] && pos[l.b]).map(l => {
      const a = pos[l.a], b = pos[l.b];
      const both = N[l.a].got && N[l.b].got;
      const my = Math.abs(a.y - b.y) < 20 ? Math.min(a.y, b.y) - 46 : (a.y + b.y) / 2;   // 같은 높이면 위로 둥글게
      return `<path class="km-link${both ? ' is-both' : ''}" data-a="${esc(l.a)}" data-b="${esc(l.b)}" d="M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}"/>`;
    });
    $('kmapBoard').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="지식 지도 — 시대와 지역별 연재, 이어진 이야기">
      ${bg.join('')}<g class="km-links">${lines.join('')}</g>${out.join('')}
    </svg>`;
    const svg = $('kmapBoard').querySelector('svg');
    svg.addEventListener('click', e => {
      const dt = e.target.closest('[data-id]'), sr = e.target.closest('[data-series]');
      if (dt) kmSelect(dt.dataset.id);
      else if (sr) kmSeries(sr.dataset.series);
      else { km.sel = null; kmHighlight(null); kmPanel(); }   // 빈 곳을 누르면 처음 상태로
    });
    svg.addEventListener('keydown', e => {
      const sr = e.target.closest('[data-series]');
      if (sr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); kmSeries(sr.dataset.series); }
    });
    if (km.sel) kmHighlight(km.sel);
  }
  const kmYearLabel = y => (y < 0 ? `기원전 ${-y}` : `${y}`);

  function kmHighlight(id) {
    const svg = $('kmapBoard').querySelector('svg'); if (!svg) return;
    const near = new Set((km.links[id] || []).map(l => (l.a === id ? l.b : l.a)));
    svg.classList.toggle('has-sel', !!id);
    svg.querySelectorAll('.km-link').forEach(p => p.classList.toggle('is-sel', p.dataset.a === id || p.dataset.b === id));
    svg.querySelectorAll('.km-dot').forEach(g => {
      g.classList.toggle('is-sel', g.dataset.id === id);
      g.classList.toggle('is-near', near.has(g.dataset.id));
    });
  }

  const kmWhere = n => {
    if (n.series) { const s = km.data.series.find(x => x.id === n.series); return `${s ? s.title : ''} · ${n.part}편`; }
    if (n.group) return { classic: '고전', idiom: '고사성어', insight: '인사이트' }[n.group] || '지혜';
    return n.era || '역사';
  };
  const kmItem = (id, extra = '') => {
    const n = km.data.nodes[id];
    return `<li><button type="button" class="km-row${n.got ? '' : ' is-yet'}" data-go="${esc(id)}">
      <span class="km-row__t">${esc(n.title)}</span>
      <span class="km-row__m">${extra}${n.got ? shortDate(n.got) : '아직'}</span></button></li>`;
  };
  function kmBindPanel() {
    $('kmapPanel').querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => kmSelect(b.dataset.go)));
    $('kmapPanel').querySelectorAll('[data-sgo]').forEach(b => b.addEventListener('click', () => kmSeries(b.dataset.sgo)));
  }

  /* 아무것도 고르지 않았을 때 — 가장 많이 이어진 지식부터 */
  function kmPanel() {
    const N = km.data.nodes;
    const top = Object.keys(km.links).filter(id => N[id].got)
      .sort((a, b) => km.links[b].length - km.links[a].length).slice(0, 6);
    $('kmapPanel').innerHTML = `<div class="km-panel__kicker">가장 많이 이어진 지식</div>
      <p class="km-panel__hint">점이나 연재 상자를 누르면, 그 지식이 다른 어떤 이야기와 이어지는지 보여 줘요.</p>
      <ul class="km-list">${top.map(id => kmItem(id, `${km.links[id].length}줄 · `)).join('')}</ul>`;
    kmBindPanel();
  }

  function kmSelect(id) {
    const N = km.data.nodes, n = N[id]; if (!n) return;
    km.sel = id;
    kmHighlight(id);
    const ls = (km.links[id] || []).slice().sort((a, b) => !!N[a.a === id ? a.b : a.a].got === !!N[b.a === id ? b.b : b.a].got ? 0 : N[a.a === id ? a.b : a.a].got ? -1 : 1);
    $('kmapPanel').innerHTML = `<div class="km-panel__kicker">${esc(kmWhere(n))}${n.series ? ` <button type="button" class="km-link-btn" data-sgo="${esc(n.series)}">연재 전체 보기</button>` : ''}</div>
      <h4 class="km-panel__title">${esc(n.title)}</h4>
      <p class="km-panel__meta">${n.got ? `${shortDate(n.got)}에 받았어요${n.saved ? ' · 서재에 담음' : ''}` : '아직 오지 않은 편이에요'}</p>
      ${n.got && n.lesson ? `<p class="km-panel__lesson">${esc(n.lesson)}</p>` : ''}
      ${ls.length ? `<div class="km-panel__sub">이어진 이야기 ${ls.length}</div>
        <ul class="km-list">${ls.map(l => kmItem(l.a === id ? l.b : l.a, `‘${esc(l.via.join('’·‘'))}’ · `)).join('')}</ul>`
        : `<p class="km-panel__hint">아직 다른 지식과 이어진 곳이 없어요 — 더 받다 보면 생겨요.</p>`}`;
    kmBindPanel();
  }

  function kmSeries(sid) {
    const s = km.data.series.find(x => x.id === sid); if (!s) return;
    const N = km.data.nodes;
    km.sel = null; kmHighlight(null);
    const gotN = s.items.filter(id => N[id].got).length;
    $('kmapPanel').innerHTML = `<div class="km-panel__kicker">${esc(s.lane)} · 연재</div>
      <h4 class="km-panel__title">${esc(s.title)}</h4>
      <p class="km-panel__meta">${s.from !== null ? `${kmYearLabel(s.from)} – ${kmYearLabel(s.to)}년 · ` : ''}${gotN}/${s.items.length}편${gotN === s.items.length ? ' — 끝까지 읽었어요' : ''}</p>
      <ol class="km-list km-list--num">${s.items.map(id => kmItem(id, km.links[id] ? `${km.links[id].length}줄 · ` : '')).join('')}</ol>`;
    kmBindPanel();
  }

  /* ── AI 총평 ─────────────────────────────── */
  $('aiBtn').addEventListener('click', async () => {
    /* '전체'는 직장인·수험생 기록을 한 해로 묶어 읽는다(연대기 전용 교차 조회) */
    const mode = state.mode || 'ALL';
    const cacheKey = `${state.year}|${mode}`;
    const btn = $('aiBtn'), body = $('aiBody'), kw = $('aiKw');

    if (state.aiCache[cacheKey]) return paintAI(state.aiCache[cacheKey]);

    btn.disabled = true; btn.textContent = '읽는 중…';
    body.innerHTML = '<span class="muted">한 해 기록을 훑어보고 있어요… (처음 생성은 시간이 좀 걸려요)</span>';
    kw.innerHTML = '';
    try {
      const data = await api(`/api/chronicle/review/${state.year}?mode=${encodeURIComponent(mode)}`);
      state.aiCache[cacheKey] = data;
      paintAI(data);
    } catch (e) {
      body.innerHTML = `<span class="muted">총평을 불러오지 못했어요 — ${esc(e.message)}</span>`;
    } finally {
      btn.disabled = false; btn.textContent = '다시 불러오기';
    }
  });

  /* 총평은 마크다운으로 오는 경우가 있는데 이 페이지는 평문으로 보여주므로 기호만 걷어낸다 */
  function stripMd(t) {
    return String(t || '')
      .replace(/^#{1,6}\s*/gm, '')      // 제목 기호
      .replace(/\*\*(.+?)\*\*/g, '$1')  // 굵게
      .replace(/^\s*[-*]\s+/gm, '· ')   // 목록
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function paintAI(data) {
    $('aiBody').textContent = stripMd(data.aiReview) || '아직 총평을 만들 만큼 기록이 쌓이지 않았어요.';
    const kws = (data.threads || []).slice(0, 12);
    $('aiKw').innerHTML = kws.map(k => `<span class="kw">${esc(k)}</span>`).join('');
    $('aiTitle').textContent = `${state.year}년, 헛살지 않았다`;
  }

  /* ── 컨트롤 ─────────────────────────────── */
  $('prevMonth').addEventListener('click', () => {
    state.month = (state.month + 11) % 12;
    renderMonth();
  });
  $('nextMonth').addEventListener('click', () => {
    state.month = (state.month + 1) % 12;
    renderMonth();
  });
  $('prevYear').addEventListener('click', () => { state.year--; state.selected = null; renderAll(); });
  $('nextYear').addEventListener('click', () => {
    if (state.year >= new Date().getFullYear()) return;
    state.year++; state.selected = null; renderAll();
  });

  $('scopeMonth').addEventListener('click', () => setScope(true));
  $('scopeYear').addEventListener('click', () => setScope(false));
  function setScope(monthOn) {
    $('scopeMonth').setAttribute('aria-pressed', monthOn);
    $('scopeYear').setAttribute('aria-pressed', !monthOn);
    $('monthView').hidden = !monthOn;
    $('yearView').hidden = monthOn;
    $('monthNav').style.visibility = monthOn ? 'visible' : 'hidden';
    if (monthOn) renderMonth();
  }

  document.querySelectorAll('.seg [data-mode]').forEach(b => {
    b.addEventListener('click', async () => {
      document.querySelectorAll('.seg [data-mode]').forEach(x =>
        x.setAttribute('aria-pressed', x === b));
      state.mode = b.dataset.mode;
      state.selected = null;
      await loadItems();
      renderAll();
    });
  });

  $('composeBtn').addEventListener('click', openCompose);
  $('noteBtn').addEventListener('click', newNote);

  /* 데모에서는 AI 총평을 만들지 않는다(가짜 기록으로 실제 API를 부르지 않게) */
  if (DEMO) {
    $('aiBtn').disabled = true;
    $('aiBody').innerHTML = '<span class="muted">샘플 미리보기에서는 AI 총평을 만들지 않아요. 내 연대기에서 눌러 보세요.</span>';
  }

  $('includeAuto').addEventListener('change', e => {
    state.includeAuto = e.target.checked;
    regroup();
    state.selected = null;
    renderAll();
  });

  /* ── 테마 전환 ──────────────────────────────
     저장 키('app-theme')는 모바일 앱과 공유한다 — 같은 오리진이라
     여기서 바꾸면 앱도, 앱에서 바꾸면 여기도 따라온다.
     첫 적용은 chronicle.html의 head 인라인 스크립트가 이미 했다(깜빡임 방지). */
  const THEME_LABEL = { dark: '먹지', light: '화이트' };

  function currentTheme() {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    /* 저장값이 없으면 시스템 설정을 따르는 중 */
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function paintThemeToggle() {
    const btn = $('themeToggle');
    if (!btn) return;
    /* 버튼은 '지금 무엇인지'가 아니라 '누르면 무엇이 되는지'를 보여준다 */
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    btn.querySelector('.themetoggle__icon').textContent  = next === 'dark' ? '☾' : '☀';
    btn.querySelector('.themetoggle__label').textContent = THEME_LABEL[next];
    btn.setAttribute('aria-label', `${THEME_LABEL[next]} 모드로 전환`);
  }

  $('themeToggle')?.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('app-theme', next); } catch { /* 저장 못 해도 이번 세션은 적용됨 */ }
    paintThemeToggle();
  });

  /* 아직 고른 적이 없어 시스템을 따르는 중이면, 시스템이 바뀔 때 라벨도 따라간다 */
  window.matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => { if (!document.documentElement.getAttribute('data-theme')) paintThemeToggle(); });

  paintThemeToggle();
  boot();
})();
