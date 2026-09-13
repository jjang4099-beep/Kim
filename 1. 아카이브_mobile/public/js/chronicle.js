/**
 * chronicle.js — 개인 연대기 (PC 웹)
 * ────────────────────────────────────────────
 * 모바일 SPA(Mob 네임스페이스)와 완전히 독립된 별도 페이지 스크립트.
 * 데이터는 같은 도메인의 기존 API를 그대로 사용한다 — 별도 백엔드/DB 없음.
 *   GET  /api/auth/me                      세션 확인
 *   POST /api/auth/login                   로그인
 *   GET  /api/items?mode=&limit=           기록 전체(연대기 재료)
 *   GET  /api/summary/yearly/:year?mode=   연말 AI 총평(캐시됨)
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
  const dom = d => DOMAIN[d] || { label: '기타', color: 'var(--paper-faint)' };

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
  };

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
  }

  /* ── 데이터 ─────────────────────────────── */
  async function loadItems() {
    /* 모드 격리 규칙에 따라 모드를 지정할 땐 반드시 파라미터로 명시.
       '전체'는 연대기 전용(직장인+수험생을 한 타임라인에 얹기 위함) — 이때만 생략. */
    const q = state.mode ? `?mode=${encodeURIComponent(state.mode)}&limit=2000` : '?limit=2000';
    const data = await api('/api/items' + q);
    state.raw = Array.isArray(data.items) ? data.items : [];
    regroup();
  }

  function regroup() {
    const map = {};
    for (const it of state.raw) {
      if (!state.includeAuto && isAuto(it)) continue;
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
    renderMonth();
    renderWave();
    renderDay();
    renderReview();
    renderFilterNote();
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
    centerSelectedDay(false);
  }

  /* 고른 날짜를 스트립 가운데로.
     scrollIntoView는 가로 컨테이너를 제대로 안 움직이고 페이지까지 스크롤시키는 경우가 있어
     컨테이너 scrollLeft를 직접 계산한다. */
  function centerSelectedDay(smooth) {
    const strip = $('monthStrip');
    const sel = strip.querySelector('[aria-selected="true"]');
    if (!sel) return;
    strip.scrollTo({
      left: sel.offsetLeft - (strip.clientWidth - sel.offsetWidth) / 2,
      behavior: smooth ? 'smooth' : 'auto'
    });
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
      bar.style.background = isSeal(key) ? 'var(--jusa)' : (main ? dom(main).color : 'var(--ink-line)');
      if (date.getDate() === 1) bar.style.boxShadow = '-1px 0 0 var(--ink-line-soft)';
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
      centerSelectedDay(true);
    }
    renderDay();
  }

  function photoCard(it) {
    const photos = (it.life?.photos || []).filter(Boolean);
    const meta = [it.life?.mood, it.life?.location, it.life?.weather].filter(Boolean).join(' · ');
    const caption = it.text || it.title || '';
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
        ${(caption || meta) ? `<figcaption>${esc(caption)}${meta ? `<div class="entry__meta">${esc(meta)}</div>` : ''}</figcaption>` : ''}
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

    let body = it.myInsight || a.summary || it.summary || it.text || '';
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
        ${link ? `<a class="entry__link" href="${esc(link)}" target="_blank" rel="noopener">원문 열기 ↗</a>` : ''}
      </div>
    </article>`;
  }

  function renderDay() {
    const key = state.selected;
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const items = state.byDate[key] || [];

    const head = `<div class="day__head">
        <h2 class="day__date">${m}월 ${d}일</h2>
        <span class="day__dow">${DOW[date.getDay()]}요일</span>
        ${isSeal(key) ? `<span class="day__seal"><i class="seal">記</i>자취를 남긴 날</span>` : ''}
      </div>`;

    if (!items.length) {
      $('day').innerHTML = head + `<div class="empty">이날은 비워 두었습니다.</div>`;
      return;
    }
    const cards = items.map(it =>
      isLife(it) ? photoCard(it) : (it.type === 'youtube' ? youtubeCard(it) : textCard(it))
    ).join('');
    $('day').innerHTML = head + `<div class="entries enter">${cards}</div>`;
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

  /* ── AI 총평 ─────────────────────────────── */
  $('aiBtn').addEventListener('click', async () => {
    const mode = state.mode || 'PROFESSIONAL';
    const cacheKey = `${state.year}|${mode}`;
    const btn = $('aiBtn'), body = $('aiBody'), kw = $('aiKw');

    if (state.aiCache[cacheKey]) return paintAI(state.aiCache[cacheKey]);

    btn.disabled = true; btn.textContent = '읽는 중…';
    body.innerHTML = '<span class="muted">한 해 기록을 훑어보고 있어요… (처음 생성은 시간이 좀 걸려요)</span>';
    kw.innerHTML = '';
    try {
      const data = await api(`/api/summary/yearly/${state.year}?mode=${encodeURIComponent(mode)}`);
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
    const s = data.stats || {};
    $('aiBody').textContent = stripMd(data.aiReview) || '아직 총평을 만들 만큼 기록이 쌓이지 않았어요.';
    const kws = (s.topKeywords || []).slice(0, 12);
    $('aiKw').innerHTML = kws.map(k => `<span class="kw">${esc(k.word || k)}</span>`).join('');
    $('aiTitle').textContent = `${state.year}년, 무엇을 배웠나`;
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

  $('includeAuto').addEventListener('change', e => {
    state.includeAuto = e.target.checked;
    regroup();
    state.selected = null;
    renderAll();
  });

  boot();
})();
