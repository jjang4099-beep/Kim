/**
 * feed.js — 지식 배달 (배달 카드 · 배달 뷰 · 배달 설정)
 * ────────────────────────────────────────────
 * 담당: 언어/시황/인문학(역사·명언·고사성어)/데일리 배달 카드 렌더 + 아코디언 토글 + 서재 저장,
 *       배달 뷰 로드/필터, 배달 설정 패널(피드 on/off·시간·테마)
 * 의존: core.js(Mob·state·el·toast·fetchJSON·FEED_CHIP_MAP)
 *       _catLabel 등 공통 헬퍼는 app_mobile.js에 정의됨 — 같은 Mob 객체라 호출 가능
 * 메서드는 두 Object.assign 블록으로 구성: ① 배달 카드  ② 배달 뷰 + 설정
 */

'use strict';

/* ① 배달 카드 렌더러 + 저장/토글 ───────────────────────────── */
Object.assign(Mob, {

  /** 배달 피드 — 언어 표현 카드 v53 (per-entry 아코디언) */
  _cardFeedLanguage(item) {
    const entries      = item.vocabEntries   || [];
    const subId        = item.subId          || '';
    const date         = item.date           || '';
    const theme        = item.theme          || item.subCategory || '';
    const dayOfWeek    = item.dayOfWeek      || '';
    const themeTitle   = item.themeTitle     || '';
    const themeTitleEn = item.themeTitleEn   || '';
    const masterPara   = item.masterParagraph || null;
    const langIcon     = item.label?.includes('중국') ? '🐉' : '🗽';
    const isThemePack  = !!themeTitle;

    /* ── 테마 타이틀 밴드 (팩 전용) ── */
    const themeBand = isThemePack ? `
    <div class="mob-fv-theme-band">
      <div class="mob-fv-theme-kicker">🏷️ 오늘의 테마 팩</div>
      <div class="mob-fv-theme-title">${themeTitle}</div>
      ${themeTitleEn ? `<div class="mob-fv-theme-title-en">${themeTitleEn}</div>` : ''}
    </div>` : '';

    /* ── 개별 어휘 항목 렌더링 ── */
    const vocabHTML = entries.map((e, i) => {
      const dlgLines = (e.dialogue || '').replace(/\\n/g, '\n').split('\n').map(l => l.trim()).filter(Boolean);
      const dlgHTML  = dlgLines.map(l => {
        /* 화자: 패턴 — A/B/甲/乙 및 임의 이름(Team Lead, You, Manager 등) */
        if (/^[A-Za-z가-힣\s]{1,24}:\s/.test(l)) {
          const ci = l.indexOf(':');
          const sp = l.slice(0, ci).trim();
          const tx = l.slice(ci + 1).trim();
          return `<div class="mob-fv-dlg-line"><span class="mob-fv-dlg-sp">${sp}</span><span>${tx}</span></div>`;
        }
        if (l.startsWith('[해석:') || l.startsWith('[解:'))
          return `<div class="mob-fv-dlg-tr">${l.replace(/^\[해석:|^\[解:/, '').replace(/\]$/, '').trim()}</div>`;
        return `<div class="mob-fv-dlg-line"><span>${l}</span></div>`;
      }).join('');

      const nuanceLbl = isThemePack ? '원어민 비밀 노트' : 'Nuance';
      const sects = [
        e.nuance         ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">${nuanceLbl}</div><div class="mob-fv-sect-txt">${e.nuance}</div></div>` : '',
        dlgHTML          ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">Dialogue</div><div class="mob-fv-dlg">${dlgHTML}</div></div>` : '',
        e.sourceSentence ? `<div class="mob-fv-sect"><div class="mob-fv-sect-lbl">Example</div><div class="mob-fv-sect-txt mob-fv-italic">"${e.sourceSentence}"</div>${e.practiceSentence ? `<div class="mob-fv-sect-txt mob-fv-practice">${e.practiceSentence}</div>` : ''}</div>` : ''
      ].filter(Boolean).join('');

      return `
      <div class="mob-fv-item">
        <div class="mob-fv-front">
          <span class="mob-fv-num">${i + 1}</span>
          <div class="mob-fv-main">
            <div class="mob-fv-expr">${e.expression || ''}</div>
            <div class="mob-fv-meaning">${e.meaning || ''}</div>
          </div>
          <div class="mob-fv-actions">
            <button class="mob-fv-save"
                    data-sub="${subId}" data-idx="${i}"
                    onclick="event.stopPropagation();Mob._saveVocabEntry(this)"
                    title="서재에 저장"><i class="ti ti-bookmark"></i></button>
            ${sects ? `<button class="mob-fv-toggle" onclick="event.stopPropagation();Mob._toggleFvEntry(this)"><i class="ti ti-chevron-down"></i></button>` : ''}
          </div>
        </div>
        ${sects ? `<div class="mob-fv-body">${sects}</div>` : ''}
      </div>`;
    }).join('');

    /* ── 마스터 패러그래프 (팩 전용) ── */
    const masterHTML = masterPara ? this._renderMasterParagraph(masterPara) : '';

    const isSavedLang = !!(item.saved || item.savedItemId);
    return `
    <div class="mob-card mob-card-feed" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-lang">${langIcon} ${item.label || '표현'}</span>
        ${dayOfWeek && !isThemePack ? `<span class="mob-feed-day-theme">${dayOfWeek}요일 · ${theme}</span>` : ''}
        <div class="mob-feed-card-hd-r">
          <span class="mob-feed-card-date">${date}</span>
          ${subId ? `<button class="mob-feed-card-save-btn${isSavedLang ? ' saved' : ''}"
              data-sub="${subId}" data-date="${date}"
              onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)"
              title="${isSavedLang ? '이미 저장됨' : '전체 서재에 저장'}"
              ${isSavedLang ? 'disabled' : ''}>
              <i class="ti ti-${isSavedLang ? 'bookmark-filled' : 'bookmark'}"></i>
            </button>` : ''}
        </div>
      </div>
      ${!isThemePack ? `<div class="mob-card-title">${item.title || '오늘의 표현'}</div>` : ''}
      ${!isThemePack && item.summary ? `<div class="mob-card-summary">${item.summary}</div>` : ''}
      ${themeBand}
      <div class="mob-feed-vocab-list">${vocabHTML}</div>
      ${masterHTML}
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn${isSavedLang ? ' saved' : ''}"
            onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)"
            ${isSavedLang ? 'disabled' : ''}>
          <i class="ti ti-device-floppy"></i> ${isSavedLang ? '저장됨' : '전체 저장'}
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : (item.pack_id ? '📦 테마팩' : '📋 DB')}</span>
      </div>
    </div>`;
  },

  /** 마스터 패러그래프 렌더링 — 5개 표현 하이라이트 포함 */
  _renderMasterParagraph(para) {
    const highlights = para.highlights || [];
    let txt = (para.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    highlights.forEach((h, idx) => {
      const escaped = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      txt = txt.replace(
        new RegExp(`(${escaped})`, 'gi'),
        `<mark class="mob-mpa-hl" data-n="${idx + 1}">$1</mark>`
      );
    });
    const trHTML = para.translation
      ? `<div class="mob-mpa-tr">${para.translation}</div>`
      : '';
    return `
    <div class="mob-master-para">
      <div class="mob-mpa-hd">
        <span class="mob-mpa-fire">🔥</span>
        <div class="mob-mpa-hd-text">
          <div class="mob-mpa-title">The Master Paragraph</div>
          <div class="mob-mpa-sub">오늘 배운 ${highlights.length}개 표현을 하나의 문맥으로 마스터하기</div>
        </div>
      </div>
      <div class="mob-mpa-collapse">
        <div class="mob-mpa-body">${txt}</div>
        ${trHTML}
      </div>
      <button class="mob-mpa-toggle" onclick="event.stopPropagation();Mob._toggleMasterPara(this)">
        <span>통합 지문 및 해석 보기</span><i class="ti ti-chevron-down"></i>
      </button>
    </div>`;
  },

  /** The Master Paragraph 접기/펼치기 토글 (max-height + opacity 트랜지션) */
  _toggleMasterPara(btn) {
    const wrap = btn.closest('.mob-master-para');
    const body = wrap?.querySelector('.mob-mpa-collapse');
    if (!body) return;
    const isOpen = wrap.classList.toggle('mpa-open');
    const lbl    = btn.querySelector('span');
    const icon   = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (wrap.classList.contains('mpa-open')) body.style.maxHeight = 'none';
      });
      if (lbl)  lbl.textContent = '지문 접기';
      if (icon) icon.className  = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (lbl)  lbl.textContent = '통합 지문 및 해석 보기';
      if (icon) icon.className  = 'ti ti-chevron-down';
    }
  },

  /** 표현 항목 아코디언 토글 */
  _toggleFvEntry(btn) {
    const item = btn.closest('.mob-fv-item');
    const body = item?.querySelector('.mob-fv-body');
    if (!body) return;
    const isOpen = item.classList.toggle('fv-open');
    const icon   = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (item.classList.contains('fv-open')) body.style.maxHeight = 'none';
      });
      if (icon) icon.className = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (icon) icon.className = 'ti ti-chevron-down';
    }
  },

  /** 어휘 표현 항목 1개만 서재에 저장 */
  async _saveVocabEntry(btn) {
    const subId = btn.dataset.sub;
    const idx   = parseInt(btn.dataset.idx);
    const feedItem = (state.feedItems || []).find(f => f.subId === subId);
    const entry    = feedItem?.vocabEntries?.[idx];
    if (!entry) { toast('표현 데이터 없음', 'err'); return; }

    const cat   = feedItem.category  || 'en';
    const topic = feedItem.subCategory || feedItem.label || '표현';

    btn.disabled  = true;
    btn.innerHTML = '<span class="mob-spin"></span>';

    try {
      const text = [
        `[${topic}] ${entry.expression}`,
        `뜻: ${entry.meaning}`,
        entry.nuance          ? `뉘앙스: ${entry.nuance}`                : '',
        entry.sourceSentence  ? `예문: ${entry.sourceSentence}`          : '',
        entry.practiceSentence? `연습: ${entry.practiceSentence}`        : ''
      ].filter(Boolean).join('\n');

      await fetchJSON('/api/items', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ text, category: cat, source: 'daily-feed-entry', mode: this._modeEnum() })
      });

      btn.innerHTML = '<i class="ti ti-check"></i>';
      btn.style.color = '#16a34a';
      toast(`"${entry.expression}" 서재에 저장됐습니다!`, 'ok');
    } catch {
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-bookmark"></i>';
      toast('저장 실패', 'err');
    }
  },

  // ══════════════════════════════════════════════
  //  인문학 피드 카드 렌더러 — v27
  //  역사(history) / 명언(quote) / 고사성어(idiom)
  // ══════════════════════════════════════════════

  /** 인문학 피드 카드 — subType 기반 분기 */
  _cardFeedHumanities(item) {
    const subType = item.subType || '';
    if (subType === 'history') return this._cardHumHistory(item);
    if (subType === 'quote')   return this._cardHumQuote(item);
    if (subType === 'idiom')   return this._cardHumIdiom(item);
    /* 알 수 없는 서브타입 폴백 */
    return `<div class="mob-card mob-hum-card"><div class="mob-hum-content"><div class="mob-hum-title">${item.title || '인문학 지식'}</div></div></div>`;
  },

  /** 역사 카드 v53 — Closed: 제목+교훈 / Expanded: Behind Story + Strategic Lesson */
  _cardHumHistory(item) {
    const s3Lines = (item.summary3 || '').replace(/\\n/g, '\n')
      .split('\n').map(l => l.trim().replace(/^[•\-·]\s*/, '')).filter(Boolean);

    const behindSect = item.behindStory ? `
      <div class="mob-hum-acc-sect">
        <div class="mob-hum-acc-lbl">Behind Story</div>
        <div class="mob-hum-acc-body">${item.behindStory}</div>
      </div>` : '';

    const lessonBullets = s3Lines.map(l => `
      <div class="mob-hum-acc-bullet"><span class="mob-hum-acc-dot"></span><span>${l}</span></div>`).join('');

    const lessonSect = (lessonBullets || (item.lesson && s3Lines.length === 0)) ? `
      <div class="mob-hum-acc-sect mob-hum-acc-lesson">
        <div class="mob-hum-acc-lbl">Strategic Lesson</div>
        ${lessonBullets || `<div class="mob-hum-acc-body">${item.lesson}</div>`}
      </div>` : '';

    const hasExpand = !!(behindSect || lessonSect);
    const frontLesson = item.lesson || s3Lines[0] || '';
    const subId = item.subId || '';
    const date  = item.date  || '';
    const isSaved = !!(item.saved || item.savedItemId);
    const saveBtn = subId ? `<button class="mob-hum-save-btn${isSaved ? ' saved' : ''}"
        data-sub="${subId}" data-date="${date}"
        onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)"
        title="${isSaved ? '이미 저장됨' : '서재에 저장'}"
        ${isSaved ? 'disabled' : ''}>
        <i class="ti ti-${isSaved ? 'bookmark-filled' : 'bookmark'}"></i>
      </button>` : '';

    return `
    <div class="mob-card mob-hum-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">🏛️ 역사 · ${item.era || '역사'}</span>
        <div class="mob-hum-badge-row-r">
          <span class="mob-hum-period">${item.period || ''}</span>
          ${saveBtn}
        </div>
      </div>
      <div class="mob-hum-content">
        <div class="mob-hum-title">${item.title || '오늘의 역사'}</div>
        ${frontLesson ? `
        <div class="mob-hum-lesson">
          <i class="ti ti-bulb" style="flex-shrink:0;font-size:15px;margin-top:1px;color:#d97706"></i>
          <span>${frontLesson}</span>
        </div>` : ''}
      </div>
      ${hasExpand ? `
      <button class="mob-hum-behind-btn" onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        ${behindSect}${lessonSect}
      </div>` : ''}
    </div>`;
  },

  /** 오늘의 명언 카드 */
  _cardHumQuote(item) {
    const behindBlock = item.behindStory ? `
      <button class="mob-hum-behind-btn"
              onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        <div class="mob-hum-behind-txt">${item.behindStory}</div>
        ${item.context ? `<div class="mob-hum-behind-context">📍 맥락: ${item.context}</div>` : ''}
      </div>` : '';
    const subId = item.subId || '';
    const date  = item.date  || '';
    const isSaved = !!(item.saved || item.savedItemId);
    const saveBtn = subId ? `<button class="mob-hum-save-btn${isSaved ? ' saved' : ''}"
        data-sub="${subId}" data-date="${date}"
        onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)"
        title="${isSaved ? '이미 저장됨' : '서재에 저장'}"
        ${isSaved ? 'disabled' : ''}>
        <i class="ti ti-${isSaved ? 'bookmark-filled' : 'bookmark'}"></i>
      </button>` : '';

    return `
    <div class="mob-card mob-hum-card mob-hum-quote-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">💡 오늘의 명언</span>
        <div class="mob-hum-badge-row-r">
          <span class="mob-hum-author-badge">${item.author || ''}</span>
          ${saveBtn}
        </div>
      </div>
      <div class="mob-hum-quote-wrap">
        <div class="mob-hum-quote-marks">"</div>
        <div class="mob-hum-quote-txt">${item.quoteKo || item.quote || ''}</div>
        ${item.quote && item.quoteKo ? `<div class="mob-hum-quote-orig">${item.quote}</div>` : ''}
        <div class="mob-hum-author-info">${item.authorInfo || item.author || ''}</div>
      </div>
      ${item.application ? `
      <div class="mob-hum-content">
        <div class="mob-hum-application">
          <i class="ti ti-sparkles" style="flex-shrink:0;font-size:14px;margin-top:1px"></i>
          <span>${item.application}</span>
        </div>
      </div>` : ''}
      ${behindBlock}
    </div>`;
  },

  /** 고사성어 카드 v53 — Closed: 성어+뜻+출처 / Expanded: 유래+Strategic Lesson */
  _cardHumIdiom(item) {
    const storySect = item.story ? `
      <div class="mob-hum-acc-sect">
        <div class="mob-hum-acc-lbl">유래 이야기</div>
        <div class="mob-hum-acc-body">${item.story}</div>
      </div>` : '';

    const behindSect = item.behindStory ? `
      <div class="mob-hum-acc-sect">
        <div class="mob-hum-acc-lbl">Behind Story</div>
        <div class="mob-hum-acc-body">${item.behindStory}</div>
      </div>` : '';

    const applSect = item.application ? `
      <div class="mob-hum-acc-sect mob-hum-acc-lesson">
        <div class="mob-hum-acc-lbl">Strategic Lesson</div>
        <div class="mob-hum-acc-body">${item.application}</div>
      </div>` : '';

    const hasExpand = !!(storySect || behindSect || applSect);
    const subId = item.subId || '';
    const date  = item.date  || '';
    const isSaved = !!(item.saved || item.savedItemId);
    const saveBtn = subId ? `<button class="mob-hum-save-btn${isSaved ? ' saved' : ''}"
        data-sub="${subId}" data-date="${date}"
        onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)"
        title="${isSaved ? '이미 저장됨' : '서재에 저장'}"
        ${isSaved ? 'disabled' : ''}>
        <i class="ti ti-${isSaved ? 'bookmark-filled' : 'bookmark'}"></i>
      </button>` : '';

    return `
    <div class="mob-card mob-hum-card mob-hum-idiom-card">
      <div class="mob-hum-badge-row">
        <span class="mob-hum-badge">📜 고사성어</span>
        <div class="mob-hum-badge-row-r">
          <span class="mob-hum-hanja">${item.hanja || ''}</span>
          ${saveBtn}
        </div>
      </div>
      <div class="mob-hum-content">
        <div class="mob-hum-idiom-title">${item.idiom || item.title || ''}</div>
        ${item.meaning ? `<div class="mob-hum-meaning">${item.meaning}</div>` : ''}
        ${item.origin ? `<div class="mob-hum-origin"><i class="ti ti-book-2" style="font-size:11px;color:#d97706"></i> ${item.origin}</div>` : ''}
      </div>
      ${hasExpand ? `
      <button class="mob-hum-behind-btn" onclick="event.stopPropagation();Mob._toggleBehindStory(this)">
        자세히 보기 🕵️ <i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-hum-behind-panel">
        ${storySect}${applSect}${behindSect}
      </div>` : ''}
    </div>`;
  },

  /** 비하인드 스토리 아코디언 토글 */
  _toggleBehindStory(btn) {
    const panel = btn.nextElementSibling;
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.innerHTML = isOpen
      ? '비하인드 스토리 접기 👆 <i class="ti ti-chevron-up"></i>'
      : '비하인드 스토리 보기 🕵️ <i class="ti ti-chevron-down"></i>';
  },

  /** 오늘의 지식 배달 카드 (type: 'daily_delivery') — v26 프리미엄 아카이브 리포트 */
  _cardDailyDelivery(item) {
    const id       = item._id || item.id || '';
    const title    = item.title   || '오늘의 지식';
    const concepts = item.concepts || [];
    const summary3 = (item.summary3 || item.text || '').replace(/\\n/g, '\n');
    const reminder = item.reminder || item.summary || '';
    const cat      = item.category || 'inbox';
    const catLabel = this._catLabel(cat);
    const rawD     = item.createdAt || item.savedAt || '';

    const catIconMap = { en:'🌐', history:'🏛️', economy:'📈', inbox:'📌', youtube:'▶️' };
    const catIcon    = catIconMap[cat] || '💡';

    const DOW     = ['일','월','화','수','목','금','토'];
    const dateStr = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '오늘' : `${d.getMonth()+1}/${d.getDate()}`; })()
      : '오늘';
    const dayName = rawD
      ? (() => { const d = new Date(rawD); return isNaN(d) ? '' : DOW[d.getDay()] + '요일'; })()
      : '';

    /* 미니 키워드 칩 — concepts 첫 2개 term, 접혔을 때도 항상 노출 */
    const kwChips = concepts.slice(0, 2)
      .filter(c => c.term)
      .map(c => `<span class="mob-dlv-kw-chip">${c.term}</span>`)
      .join('');

    /* 3줄 요약 bullet 파싱 */
    const s3Lines = summary3
      .split('\n')
      .map(l => l.trim().replace(/^[•\-·]\s*/, ''))
      .filter(Boolean);
    const s3HTML = s3Lines.map(l => `
      <div class="mob-dlv-s3-line">
        <span class="mob-dlv-s3-dot"></span>
        <span>${l}</span>
      </div>`).join('');

    /* 핵심 개념 카드 */
    const conceptsHTML = concepts.slice(0, 3).map(c => `
      <div class="mob-dlv-concept">
        <span class="mob-dlv-concept-term">${c.term || ''}</span>
        <span class="mob-dlv-concept-desc">${c.desc || ''}</span>
      </div>`).join('');

    return `
    <div class="mob-card mob-dlv-card" data-id="${id}">
      <div class="mob-dlv-badge-row">
        <span class="mob-dlv-badge">${catIcon} ${dayName ? dayName + ' · ' : ''}${catLabel}</span>
        <div class="mob-dlv-badge-right">
          <span class="mob-dlv-date">${dateStr}</span>
          <button class="mob-dlv-save-btn"
                  onclick="event.stopPropagation();Mob._saveDeliveryCard('${id}',this)"
                  title="서재에 저장">
            <i class="ti ti-bookmark"></i>
          </button>
        </div>
      </div>
      <div class="mob-dlv-title-row">
        <span class="mob-dlv-title-txt">${title}</span>
        <i class="ti ti-chevron-down mob-dlv-chevron"></i>
      </div>
      ${kwChips ? `<div class="mob-dlv-kw-row">${kwChips}</div>` : ''}
      <div class="mob-dlv-detail">
        ${s3HTML ? `<div class="mob-dlv-summary3">${s3HTML}</div>` : ''}
        ${conceptsHTML ? `<div class="mob-dlv-concepts">${conceptsHTML}</div>` : ''}
        ${reminder ? `
        <div class="mob-dlv-reminder">
          <span class="mob-dlv-reminder-icon">✨</span>
          <span>${reminder}</span>
        </div>` : ''}
      </div>
    </div>`;
  },

  /** 데일리 배달 카드 → 서재에 복사 저장 */
  async _saveDeliveryCard(id, btn) {
    const item = state.items.find(i => (i._id || i.id) === id);
    if (!item) { toast('데이터를 찾을 수 없습니다', 'err'); return; }

    btn.disabled  = true;
    btn.innerHTML = '<span class="mob-spin"></span>';

    try {
      const text = [
        item.title || '오늘의 지식',
        item.summary3 || '',
        ...(item.concepts || []).map(c => `▸ ${c.term}: ${c.desc}`),
        item.reminder ? `✨ ${item.reminder}` : ''
      ].filter(Boolean).join('\n');

      await fetchJSON('/api/items', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ text, category: item.category || 'inbox', source: 'daily-delivery', mode: this._modeEnum() })
      });

      btn.innerHTML = '<i class="ti ti-check"></i>';
      btn.style.color = '#16a34a';
      toast(`"${item.title}" 서재에 저장됐습니다!`, 'ok');
    } catch {
      btn.disabled  = false;
      btn.innerHTML = '<i class="ti ti-bookmark"></i>';
      toast('저장 실패', 'err');
    }
  },

  /** 배달 피드 — 시황 카드 v53 (지표 미니배너 + 아코디언 상세) */
  _cardFeedMarket(item) {
    const terms      = (item.aiEconomicKnowledge || []).slice(0, 3);
    const indicators = item.indicators || [];
    const subId      = item.subId || '';
    const date       = item.date  || '';
    const isUS       = (item.label || '').includes('미국') || (item.subId || '').includes('us');

    // 상단 지표 칩 (최대 3개)
    const topInds = indicators.slice(0, 3);
    const indMiniHTML = topInds.length ? `
    <div class="mob-mkt-ind-mini">
      ${topInds.map(ind => `
        <div class="mob-mkt-ind-chip ${ind.dir || ''}">
          <span class="mob-mkt-ind-name">${ind.name}</span>
          <span class="mob-mkt-ind-val">${ind.value}</span>
          <span class="mob-mkt-ind-chg">${ind.dir === 'up' ? '▲' : '▼'} ${ind.change}</span>
        </div>`).join('')}
    </div>` : '';

    // 전체 지표 배너 (펼침 내부)
    const indFullHTML = indicators.length ? `
    <div class="mob-feed-indicators">
      ${indicators.map(ind => `
        <div class="mob-feed-ind-item ${ind.dir || ''}">
          <div class="mob-feed-ind-name">${ind.name}</div>
          <div class="mob-feed-ind-value">${ind.value}</div>
          <div class="mob-feed-ind-change">${ind.dir === 'up' ? '▲' : '▼'} ${ind.change}</div>
        </div>`).join('')}
    </div>` : '';

    // 3줄 요약
    const s3Lines = (item.summary3 || '').replace(/\\n/g, '\n').split('\n').filter(l => l.trim());
    const summary3HTML = s3Lines.length ? `
    <div class="mob-feed-summary3">
      ${s3Lines.map(l => `<div class="mob-feed-s3-line">${l.trim()}</div>`).join('')}
    </div>` : '';

    // 체크포인트
    const checkpoints = item.checkpoints || [];
    const checkHTML = checkpoints.length ? `
    <div class="mob-feed-checkpoints">
      <div class="mob-feed-check-label"><i class="ti ti-checkbox"></i> 오늘 장 필수 체크</div>
      ${checkpoints.map((c, idx) => `
        <div class="mob-feed-check-item">
          <span class="mob-feed-check-num">${idx + 1}</span>
          <span>${c}</span>
        </div>`).join('')}
    </div>` : '';

    // 핵심 경제 용어
    const termsHTML = terms.map(t => `
      <div class="mob-feed-econ-item">
        <span class="mob-feed-econ-term">${t.term || ''}</span>
        <span class="mob-feed-econ-importance">${t.importance || ''}</span>
        ${t.connection ? `<span class="mob-feed-econ-connection">${t.connection}</span>` : ''}
      </div>`).join('');

    const hasDetail = !!(indFullHTML || summary3HTML || checkHTML || termsHTML);

    const isSavedMkt = !!(item.saved || item.savedItemId);
    return `
    <div class="mob-card mob-card-feed mob-card-feed-market" data-id="">
      <div class="mob-feed-card-hd">
        <span class="mob-feed-badge mob-feed-badge-market">${isUS ? '🗽' : '🐯'} ${item.label || '시황'}</span>
        <div class="mob-feed-card-hd-r">
          <span class="mob-feed-card-date">${date}</span>
          ${subId ? `<button class="mob-feed-card-save-btn${isSavedMkt ? ' saved' : ''}"
              data-sub="${subId}" data-date="${date}"
              onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)"
              title="${isSavedMkt ? '이미 저장됨' : '서재에 저장'}"
              ${isSavedMkt ? 'disabled' : ''}>
              <i class="ti ti-${isSavedMkt ? 'bookmark-filled' : 'bookmark'}"></i>
            </button>` : ''}
        </div>
      </div>
      <div class="mob-card-title">${item.title || '오늘의 시황'}</div>
      ${item.summary ? `<div class="mob-card-summary">${item.summary}</div>` : ''}
      ${indMiniHTML}
      ${hasDetail ? `
      <button class="mob-mkt-expand-btn" onclick="event.stopPropagation();Mob._toggleMarketCard(this)">
        <span>상세 분석 보기</span><i class="ti ti-chevron-down"></i>
      </button>
      <div class="mob-mkt-expand-body">
        ${indFullHTML}
        ${summary3HTML}
        ${checkHTML}
        ${termsHTML ? `<div class="mob-feed-econ-list">
          <div class="mob-feed-econ-label"><i class="ti ti-bookmark"></i> 오늘의 핵심 용어</div>
          ${termsHTML}
        </div>` : ''}
      </div>` : ''}
      <div class="mob-feed-card-ft">
        <button class="mob-feed-save-btn" onclick="event.stopPropagation();Mob._saveFeedToArchive('${subId}','${date}',this)">
          <i class="ti ti-device-floppy"></i> 서재에 저장
        </button>
        <span class="mob-feed-ai-tag">${item.aiGenerated ? '✨ AI 생성' : '📋 샘플'}</span>
      </div>
    </div>`;
  },

  _toggleMarketCard(btn) {
    const card = btn.closest('.mob-card-feed-market');
    const body = card?.querySelector('.mob-mkt-expand-body');
    if (!body) return;
    const isOpen = card.classList.toggle('mkt-open');
    const lbl    = btn.querySelector('span');
    const icon   = btn.querySelector('i');
    if (isOpen) {
      body.style.maxHeight = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function h() {
        body.removeEventListener('transitionend', h);
        if (card.classList.contains('mkt-open')) body.style.maxHeight = 'none';
      });
      if (lbl)  lbl.textContent = '접기';
      if (icon) icon.className  = 'ti ti-chevron-up';
    } else {
      if (body.style.maxHeight === 'none') body.style.maxHeight = body.scrollHeight + 'px';
      requestAnimationFrame(() => { body.style.maxHeight = '0'; });
      if (lbl)  lbl.textContent = '상세 분석 보기';
      if (icon) icon.className  = 'ti ti-chevron-down';
    }
  },

  /** 배달 피드 아이템 → 서재 저장 (아이콘 버튼 / 텍스트 버튼 공용) */
  async _saveFeedToArchive(subId, date, btn) {
    if (!subId || !date) return;
    const isIconBtn = btn.classList.contains('mob-hum-save-btn') ||
                      btn.classList.contains('mob-feed-card-save-btn');
    try {
      btn.disabled  = true;
      btn.innerHTML = isIconBtn ? '<span class="mob-spin"></span>' : '<span class="mob-spin"></span> 저장 중…';
      const data = await fetchJSON(`/api/daily-feed/${date}/${subId}/save`, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ mode: this._modeEnum() })
      });
      if (data.success) {
        btn.classList.add('saved');
        btn.innerHTML    = isIconBtn
          ? '<i class="ti ti-bookmark-filled"></i>'
          : '<i class="ti ti-check"></i> 저장됨';
        btn.style.cursor = 'default';
        btn.title        = '이미 저장됨';
        /* 같은 subId+date를 공유하는 모든 저장 버튼 동기화 */
        document.querySelectorAll(
          `[data-sub="${subId}"][data-date="${date}"]`
        ).forEach(b => {
          if (b === btn) return;
          b.disabled   = true;
          b.classList.add('saved');
          b.title      = '이미 저장됨';
          const isIco  = b.classList.contains('mob-hum-save-btn') ||
                         b.classList.contains('mob-feed-card-save-btn');
          b.innerHTML  = isIco
            ? '<i class="ti ti-bookmark-filled"></i>'
            : '<i class="ti ti-check"></i> 저장됨';
        });
        /* 서재 캐시 무효화 — 다음 서재 탭 진입 시 fresh fetch */
        state.libraryLoaded = false;
        toast('서재에 저장됐습니다!', 'ok');
      } else {
        throw new Error(data.error || '저장 실패');
      }
    } catch {
      btn.disabled  = false;
      btn.classList.remove('saved');
      btn.innerHTML = isIconBtn
        ? '<i class="ti ti-bookmark"></i>'
        : '<i class="ti ti-device-floppy"></i> 서재에 저장';
      toast('저장에 실패했습니다', 'error');
    }
  },

});


/* ② 배달 뷰 + 배달 설정 ───────────────────────────────────── */
Object.assign(Mob, {

  /* ══════════════════════════════════════════
     배달 뷰
  ══════════════════════════════════════════ */
  async _loadFeedView(forceRefresh = false) {
    const content = el('mobFeedViewContent');
    const dateEl  = el('feedViewDate');
    if (!content) return;

    /* 모드 격리: 배달 지식은 직장인 전용. 수험생 모드면 전문직 피드 원천 배제 */
    if (this._modeEnum() === 'EXAM_PREP') {
      state.feedItems = [];
      content.innerHTML = `<div class="mob-loading" style="flex-direction:column;gap:8px">
        <i class="ti ti-school" style="font-size:34px;color:var(--text-3)"></i>
        <span style="font-size:13px;color:var(--text-2)">수험생 모드에서는 일반 지식 배달이 제공되지 않습니다.</span>
        <small style="color:var(--text-3)">시험에 나오는 것만 — 오답노트와 학습에 집중하세요.</small>
      </div>`;
      return;
    }

    if (state.feedLoaded && !forceRefresh) {
      if (state.pendingFeedFilter) {
        state.activeFeedFilter  = state.pendingFeedFilter;
        state.pendingFeedFilter = null;
        this._renderFeedView();
      }
      return;
    }

    const today = new Date();
    if (dateEl) dateEl.textContent = today.toLocaleDateString('ko-KR',
      { year:'numeric', month:'long', day:'numeric', weekday:'long' });

    content.innerHTML = `<div class="mob-loading"><span class="mob-spin"></span> 불러오는 중…</div>`;

    try {
      /* ── 1단계: 캐시 상태 빠른 확인 (8초 타임아웃) ── */
      let allReady = false;
      try {
        const status = await fetchJSON('/api/daily-feed/status', {}, 8000);
        allReady = !!status?.allReady;
      } catch { /* 상태 확인 실패해도 계속 진행 */ }

      /* ── 2단계: 캐시 있으면 빠른 경로, 없으면 생성 안내 후 대기 ── */
      if (!allReady) {
        content.innerHTML = `<div class="mob-loading">
          <span class="mob-spin"></span>
          <span style="display:block;margin-top:8px;font-size:13px;color:var(--text-2)">
            AI 피드 생성 중…<br>
            <small style="color:var(--text-3)">최초 생성은 30~60초 걸릴 수 있어요</small>
          </span>
        </div>`;
      }

      /* 캐시 히트면 20초, 생성 필요하면 120초 */
      const timeoutMs = allReady ? 20000 : 120000;
      const data = await fetchJSON(`/api/daily-feed?mode=${this._modeEnum()}`, {}, timeoutMs);
      state.feedItems = parseFeedsArray(data.items ?? data.feeds ?? data);

      if (state.pendingFeedFilter) {
        state.activeFeedFilter  = state.pendingFeedFilter;
        state.pendingFeedFilter = null;
      }

      this._renderFeedView();
      state.feedLoaded = true;
      const badge = el('mobFeedBadge');
      if (badge) badge.hidden = true;

    } catch (e) {
      const isTimeout = e?.name === 'AbortError' || (e?.message || '').includes('abort');
      content.innerHTML = `
        <div class="mob-loading" style="color:#ef4444;gap:12px">
          <i class="ti ti-alert-circle" style="font-size:28px"></i>
          <span style="font-size:13.5px;font-weight:600">
            ${isTimeout ? '피드 생성 시간 초과' : '피드 불러오기 실패'}
          </span>
          <span style="font-size:12px;color:var(--text-3)">
            ${isTimeout ? '서버가 바쁘거나 AI 응답이 지연됐어요.' : (e?.message || '')}
          </span>
          <button onclick="Mob._loadFeedView(true)"
            style="margin-top:4px;padding:8px 20px;border-radius:8px;border:none;
                   background:#6366f1;color:#fff;font-size:13px;font-weight:600;cursor:pointer">
            🔄 다시 시도
          </button>
          <button onclick="Mob.switchView('manage',el('bnManage'))"
            style="padding:6px 16px;border-radius:8px;border:1.5px solid var(--border);
                   background:transparent;color:var(--text-2);font-size:12px;cursor:pointer">
            관리탭에서 지금 생성
          </button>
        </div>`;
    }
  },

  _renderFeedView() {
    const content = el('mobFeedViewContent');
    if (!content) return;

    const items = state.feedItems;
    if (!items || items.length === 0) {
      el('feedFilterBar').innerHTML = '';
      content.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i> 오늘의 배달 피드가 없어요.<br>
        <small style="color:var(--text-3);margin-top:6px;display:block">관리탭 → 지금 생성을 눌러보세요!</small>
      </div>`;
      return;
    }

    /* ── 필터 칩 바 빌드 ── */
    el('feedFilterBar').innerHTML = this._buildFeedFilterBar(items);

    /* ── 현재 필터에 맞는 아이템 렌더 ── */
    this._renderFeedItems(state.activeFeedFilter);

    /* ── 컨텐츠 영역 onclick 위임 (아코디언·비하인드·저장 등 기존 기능 전부 유지) ── */
    content.onclick = e => {
      const card = e.target.closest('.mob-card');
      if (!card) return;

      /* mob-dlv-card: 데일리 배달 카드 아코디언 */
      if (card.classList.contains('mob-dlv-card')) {
        card.classList.toggle('expanded');
        return;
      }
      /* mob-card-v: 세로형 아카이브 카드 */
      if (card.classList.contains('mob-card-v')) {
        if (!card.classList.contains('no-detail')) card.classList.toggle('expanded');
        return;
      }
      /* 기타 archive 카드 → 인라인 아코디언 확장 */
      const id = card.dataset.id;
      if (id) this._toggleDetail(card, id);
    };
  },

  /* 배달탭 필터 칩 HTML 빌드 */
  _buildFeedFilterBar(items) {
    const seen  = new Set();
    const chips = [];

    items.forEach(item => {
      const subId = item.subId || '';
      if (subId && !seen.has(subId)) {
        seen.add(subId);
        const c = FEED_CHIP_MAP[subId] || { icon: '📚', label: item.label || subId };
        chips.push({ subId, ...c });
      }
    });

    if (chips.length === 0) return '';

    const activeFilter = state.activeFeedFilter;

    let html = `<button class="mob-feed-chip${activeFilter === 'all' ? ' active' : ''}"
                        onclick="Mob._onFeedChip('all', this)">전체</button>`;
    chips.forEach(c => {
      const isActive = activeFilter === c.subId;
      /* inline style 금지 — active 토글 시 CSS 충돌 방지. 색상은 data 속성으로만 보관 */
      html += `<button class="mob-feed-chip${isActive ? ' active' : ''}"
                       data-color="${c.color}"
                       onclick="Mob._onFeedChip('${c.subId}', this)">
                 ${c.icon} ${c.label}
               </button>`;
    });
    return html;
  },

  /* 필터 칩 클릭 핸들러 */
  _onFeedChip(cat, chipEl) {
    if (state.activeFeedFilter === cat) return;  /* 동일 칩 재클릭 시 불필요한 재렌더 방지 */
    state.activeFeedFilter = cat;
    el('feedFilterBar')?.querySelectorAll('.mob-feed-chip').forEach(c => {
      c.classList.toggle('active', c === chipEl);
    });
    this._renderFeedItems(cat);
  },

  /* 현재 필터로 배달 피드 아이템 렌더 */
  _renderFeedItems(filter) {
    const content = el('mobFeedViewContent');
    if (!content) return;

    const items  = state.feedItems || [];
    const filtered = filter === 'all'
      ? items
      : items.filter(item => (item.subId || '') === filter);

    if (filtered.length === 0) {
      content.innerHTML = `<div class="mob-loading">
        <i class="ti ti-mood-empty"></i> 해당 카테고리 피드가 없어요
      </div>`;
      return;
    }

    let html = '';
    filtered.forEach(item => { html += this.cardHTML(item); });
    content.innerHTML = html;
  },

  async checkFeedBadge() {
    try {
      const data  = await fetchJSON('/api/daily-feed/status', {}, 10000);
      const badge = el('mobFeedBadge');
      if (badge && data.hasNew) badge.hidden = false;
    } catch {}
  },

  openFeed() { this.switchView('feed', el('bnFeed')); },

  /* ══════════════════════════════════════════
     배달 설정 패널 렌더링 v25 — 영어·중국어·미국시황·한국시황 4종 아코디언
  ══════════════════════════════════════════ */
  _renderDeliverySettings(data) {
    const user    = data?.user  || {};
    const feeds   = data?.available_feeds || [];
    const enabled = new Set(user.enabled_feeds || []);
    const cfg     = user.feed_settings || {};   /* { en_expr:{}, zh_expr:{}, us_market:{}, kr_market:{} } */

    /* 배달 시간 */
    const timeInput = el('dpDeliveryTime');
    if (timeInput) timeInput.value = user.delivery_time || '07:30';

    /* 허용 피드: 7종 (언어 2 + 시황 2 + 인문학 3) */
    const ALLOWED_IDS = ['en_expr', 'zh_expr', 'us_market', 'kr_market', 'hist_daily', 'quote_daily', 'idiom_daily'];
    const filtered         = feeds.filter(f => ALLOWED_IDS.includes(f.id));
    const langFeeds        = filtered.filter(f => f.type === 'language'   || f.id.includes('expr'));
    const marketFeeds      = filtered.filter(f => f.type === 'market'     || f.id.includes('market'));
    const humanitiesFeeds  = filtered.filter(f => f.type === 'humanities' || ['hist_daily','quote_daily','idiom_daily'].includes(f.id));

    /* ── 공통: 아코디언 행 + 패널 래퍼 생성기 ── */
    const wrapPanel = (sub, badgeTxt, panelBody) => `
      <div class="mvw-dp-sub-item mvw-dp-sub-item--cfg" id="${sub.id}Row">
        <div class="mvw-dp-sub-info" style="cursor:pointer"
             onclick="Mob._toggleFeedDetail('${sub.id}')">
          <span class="mvw-dp-sub-icon">${sub.icon || '📌'}</span>
          <div class="mvw-dp-sub-text">
            <div class="mvw-dp-sub-name">${sub.label}
              <span class="mvw-en-cfg-badge" id="${sub.id}Badge">${badgeTxt}</span>
            </div>
            <div class="mvw-dp-sub-desc">${sub.desc || ''}</div>
          </div>
          <i class="ti ti-chevron-down mvw-en-detail-chevron" id="${sub.id}Chevron"></i>
        </div>
        <label class="mvw-dp-toggle" style="flex-shrink:0">
          <input type="checkbox" id="sub_${sub.id}" ${enabled.has(sub.id) ? 'checked' : ''}/>
          <span class="mvw-dp-toggle-track"><span class="mvw-dp-toggle-thumb"></span></span>
        </label>
      </div>
      <div class="mvw-en-panel" id="${sub.id}Panel">
        <div class="mvw-en-inner">
          ${panelBody}
          <button class="mvw-en-save-btn" id="${sub.id}SaveBtn"
                  onclick="Mob._saveFeedSettings('${sub.id}')">
            <i class="ti ti-device-floppy"></i> 상세 옵션 저장
          </button>
        </div>
      </div>`;

    /* ── 언어 피드(영어/중국어) 패널 본문 ── */
    const langPanelBody = (feedId, themeOpts, defCount) => {
      const c = cfg[feedId]?.count  || defCount;
      const l = cfg[feedId]?.level  || 'intermediate';
      const t = cfg[feedId]?.themes || [];
      return `
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">📦 배달 개수</div>
          <div class="mvw-chip-group" id="${feedId}CountChips">
            ${[5,7,10].map(n => `
            <button class="mvw-chip-btn${c===n?' active':''}" data-val="${n}"
                    onclick="Mob._selectChip(this,'${feedId}CountChips')">${n}개</button>`).join('')}
          </div>
        </div>
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">🎯 집중 테마
            <span class="mvw-en-note">중복 선택 가능</span></div>
          <div class="mvw-theme-list">
            ${themeOpts.map(o => `
            <label class="mvw-theme-item">
              <input type="checkbox" value="${o.val}" ${t.includes(o.val)?'checked':''}/>
              <span class="mvw-theme-item-txt">${o.label}</span>
            </label>`).join('')}
          </div>
        </div>
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">📊 난이도</div>
          <div class="mvw-level-group">
            <label class="mvw-level-item${l==='intermediate'?' active':''}">
              <input type="radio" name="${feedId}Level" value="intermediate"
                     ${l==='intermediate'?'checked':''}
                     onchange="this.closest('.mvw-level-group').querySelectorAll('.mvw-level-item').forEach(x=>x.classList.remove('active'));this.closest('.mvw-level-item').classList.add('active')"/>
              <span>🌱 초중급 <small>(Intermediate)</small></span>
            </label>
            <label class="mvw-level-item${l==='advanced'?' active':''}">
              <input type="radio" name="${feedId}Level" value="advanced"
                     ${l==='advanced'?'checked':''}
                     onchange="this.closest('.mvw-level-group').querySelectorAll('.mvw-level-item').forEach(x=>x.classList.remove('active'));this.closest('.mvw-level-item').classList.add('active')"/>
              <span>🔥 고급 <small>(Advanced)</small></span>
            </label>
          </div>
        </div>`;
    };

    /* ── 시황 피드(미국/한국) 패널 본문 ── */
    const marketPanelBody = (feedId) => {
      const mc = cfg[feedId]?.is_market_centric !== false;  /* 기본 true */
      const ma = cfg[feedId]?.is_macro_centric  !== false;  /* 기본 true */
      return `
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">🎯 분석 집중도
            <span class="mvw-en-note">중복 선택 가능</span></div>
          <div class="mvw-theme-list">
            <label class="mvw-theme-item">
              <input type="checkbox" value="market_centric" ${mc?'checked':''}/>
              <span class="mvw-theme-item-txt">📊 증시/데이터 중심</span>
            </label>
            <div class="mvw-theme-item-hint">주요 지수·등락률·주요 종목 움직임 위주 드라이한 데이터 요약</div>
            <label class="mvw-theme-item">
              <input type="checkbox" value="macro_centric" ${ma?'checked':''}/>
              <span class="mvw-theme-item-txt">🌐 거시경제(Macro) 중심</span>
            </label>
            <div class="mvw-theme-item-hint">연준 금리·환율·유가·채권·지정학적 리스크 등 경제 흐름 서사형 분석</div>
          </div>
        </div>`;
    };

    /* ── 배지 텍스트 계산 ── */
    const langBadge   = (id, def) => {
      const c = cfg[id]?.count || def;
      const l = cfg[id]?.level || 'intermediate';
      return `${c}개 · ${l === 'advanced' ? '고급' : '초중급'}`;
    };
    const marketBadge = (id) => {
      const mc = cfg[id]?.is_market_centric !== false;
      const ma = cfg[id]?.is_macro_centric  !== false;
      if (mc && ma) return '증시+Macro';
      if (mc)       return '증시 중심';
      if (ma)       return 'Macro 중심';
      return '테마 없음';
    };
    const histBadge   = () => cfg['hist_daily']?.era || '상관없음';

    /* ── 테마 옵션 상수 ── */
    const EN_THEMES = [
      { val:'business_meeting', label:'💼 비즈니스 미팅'   },
      { val:'office_email',     label:'📧 오피스 이메일'   },
      { val:'daily_travel',     label:'✈️ 일상/여행 회화'  },
      { val:'drama_spoken',     label:'🎬 미드 구어체'     }
    ];
    const ZH_THEMES = [
      { val:'biz_hsk',     label:'💼 비즈니스 HSK 실무'   },
      { val:'biz_trip',    label:'✈️ 출장/식사 접대'       },
      { val:'daily_shop',  label:'🛍️ 일상 회화 및 쇼핑'   },
      { val:'drama_slang', label:'🎬 중드/유행어'          }
    ];

    /* ── 역사 피드 패널 본문 ── */
    const histPanelBody = () => {
      const era = cfg['hist_daily']?.era || '상관없음';
      const opts = [
        { val: '한국사',  label: '🐯 한국사' },
        { val: '세계사',  label: '🌍 세계사'  },
        { val: '상관없음', label: '🔀 상관없음' }
      ];
      return `
        <div class="mvw-en-section">
          <div class="mvw-en-section-title">🗓️ 역사 시대 선호</div>
          <div class="mvw-level-group">
            ${opts.map(o => `
            <label class="mvw-level-item${era === o.val ? ' active' : ''}">
              <input type="radio" name="hist_dailyEra" value="${o.val}"
                     ${era === o.val ? 'checked' : ''}
                     onchange="this.closest('.mvw-level-group').querySelectorAll('.mvw-level-item').forEach(x=>x.classList.remove('active'));this.closest('.mvw-level-item').classList.add('active')"/>
              <span>${o.label}</span>
            </label>`).join('')}
          </div>
        </div>`;
    };

    /* ── 간단 구독 행 (설정 없는 피드용 — toggle 만) ── */
    const wrapSimpleSub = (sub) => `
      <div class="mvw-dp-sub-item" id="${sub.id}Row">
        <div class="mvw-dp-sub-info">
          <span class="mvw-dp-sub-icon">${sub.icon || '📌'}</span>
          <div class="mvw-dp-sub-text">
            <div class="mvw-dp-sub-name">${sub.label}</div>
            <div class="mvw-dp-sub-desc">${sub.desc || ''}</div>
          </div>
        </div>
        <label class="mvw-dp-toggle" style="flex-shrink:0">
          <input type="checkbox" id="sub_${sub.id}" ${enabled.has(sub.id) ? 'checked' : ''}/>
          <span class="mvw-dp-toggle-track"><span class="mvw-dp-toggle-thumb"></span></span>
        </label>
      </div>`;

    /* ── 렌더링 ── */
    const subsList = el('dpSubsList');
    if (!subsList) return;

    if (filtered.length) {
      const en   = langFeeds.find(f => f.id === 'en_expr');
      const zh   = langFeeds.find(f => f.id === 'zh_expr');
      const hist = humanitiesFeeds.find(f => f.id === 'hist_daily');
      const quot = humanitiesFeeds.find(f => f.id === 'quote_daily');
      const idio = humanitiesFeeds.find(f => f.id === 'idiom_daily');

      subsList.innerHTML = `
        <div class="mvw-dp-group-label">🎓 언어 학습</div>
        ${en ? wrapPanel(en, langBadge('en_expr', 7),  langPanelBody('en_expr', EN_THEMES, 7)) : ''}
        ${zh ? wrapPanel(zh, langBadge('zh_expr', 5),  langPanelBody('zh_expr', ZH_THEMES, 5)) : ''}
        <div class="mvw-dp-group-label">📊 시황 분석</div>
        ${marketFeeds.map(mf => wrapPanel(mf, marketBadge(mf.id), marketPanelBody(mf.id))).join('')}
        <div class="mvw-dp-group-label">🏛️ 인문학</div>
        ${hist ? wrapPanel(hist, histBadge(), histPanelBody()) : ''}
        ${quot ? wrapSimpleSub(quot) : ''}
        ${idio ? wrapSimpleSub(idio) : ''}`;
    } else {
      subsList.innerHTML = `<div style="padding:12px 0;font-size:13px;color:var(--text-3)">설정 로드 실패</div>`;
    }

    /* 상태 칩 */
    const chip = el('dpStatusChip');
    if (chip) chip.textContent = `배달: ${user.delivery_time || '07:30'}`;
  },

  /* ── 피드별 상세 패널 토글 (범용) ── */
  _toggleFeedDetail(feedId) {
    const panel   = el(`${feedId}Panel`);
    const chevron = el(`${feedId}Chevron`);
    if (!panel) return;
    const open = panel.classList.toggle('open');
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  },

  /* ── 칩 단일 선택 (범용) ── */
  _selectChip(btn, groupId) {
    el(groupId)?.querySelectorAll('.mvw-chip-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  },

  /* ── 피드 상세 설정 저장 (영어·중국어·미국시황·한국시황 통합) ── */
  async _saveFeedSettings(feedId) {
    let settings = {};

    if (feedId === 'en_expr' || feedId === 'zh_expr') {
      const countBtn = el(`${feedId}CountChips`)?.querySelector('.mvw-chip-btn.active');
      settings.count  = countBtn ? Number(countBtn.dataset.val) : (feedId === 'zh_expr' ? 5 : 7);
      settings.themes = [...document.querySelectorAll(
        `#${feedId}Panel .mvw-theme-list input[type="checkbox"]:checked`)].map(cb => cb.value);
      const lvl       = document.querySelector(`#${feedId}Panel input[name="${feedId}Level"]:checked`);
      settings.level  = lvl?.value || 'intermediate';
    } else if (feedId === 'us_market' || feedId === 'kr_market') {
      /* 시황 피드 */
      const checked = [...document.querySelectorAll(
        `#${feedId}Panel .mvw-theme-list input[type="checkbox"]:checked`)].map(cb => cb.value);
      settings.is_market_centric = checked.includes('market_centric');
      settings.is_macro_centric  = checked.includes('macro_centric');
    } else if (feedId === 'hist_daily') {
      /* 역사 피드 — 시대 선호 */
      const eraInput = document.querySelector(`#hist_dailyPanel input[name="hist_dailyEra"]:checked`);
      settings.era   = eraInput?.value || '상관없음';
    } else {
      /* quote_daily, idiom_daily — 상세 설정 없음 */
      settings = {};
    }

    const btn = el(`${feedId}SaveBtn`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> 저장 중…'; }

    try {
      await fetchJSON('/api/delivery-settings/all', {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ feedId, settings })
      });

      /* 배지 실시간 업데이트 */
      const badge = el(`${feedId}Badge`);
      if (badge) {
        if (feedId === 'en_expr' || feedId === 'zh_expr') {
          badge.textContent = `${settings.count}개 · ${settings.level === 'advanced' ? '고급' : '초중급'}`;
        } else if (feedId === 'us_market' || feedId === 'kr_market') {
          const { is_market_centric: mc, is_macro_centric: ma } = settings;
          badge.textContent = (mc && ma) ? '증시+Macro' : mc ? '증시 중심' : ma ? 'Macro 중심' : '테마 없음';
        } else if (feedId === 'hist_daily') {
          badge.textContent = settings.era || '상관없음';
        }
      }
      state.feedLoaded = false;  /* 다음 배달탭 진입 시 최신 설정으로 강제 재생성 */
      toast('✅ 설정 저장! 배달탭에서 새 피드를 확인하세요.', 'ok', 4000);
    } catch {
      toast('설정 저장 실패', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> 상세 옵션 저장'; }
    }
  },

  /* ── 배달 옵션 패널 슬라이드 토글 ── */
  _toggleDeliveryOptions() {
    const panel   = el('dpOptionsPanel');
    const chevron = el('dpOptionsChevron');
    if (!panel) return;
    const open = panel.classList.toggle('open');
    if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
  },

  /* 배달 설정 저장 */
  async _saveDeliverySettings() {
    const delivTime = el('dpDeliveryTime')?.value || '07:30';
    /* 구독 토글만 수집 — 상세 패널 안의 테마 체크박스(sub_ 접두사 없음)는 제외 */
    const cbs = document.querySelectorAll('#dpSubsList input[type="checkbox"][id^="sub_"]');
    const enabled_feeds = [...cbs].filter(c => c.checked).map(c => c.id.replace('sub_',''));

    const btn = el('dpSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> 저장 중…'; }

    try {
      await fetchJSON('/api/user/settings', {
        method : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ delivery_time: delivTime, enabled_feeds })
      });
      const chip = el('dpStatusChip');
      if (chip) chip.textContent = `배달: ${delivTime}`;
      toast('✅ 배달 설정이 저장됐습니다!', 'ok');
    } catch {
      toast('설정 저장 실패', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-device-floppy"></i> 설정 저장'; }
    }
  },

  /* 피드 지금 생성 (수동 트리거) */
  async _generateFeedNow() {
    const btn = el('dpGenBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="mob-spin"></span> AI 생성 중…'; }

    try {
      const data = await fetchJSON('/api/daily-feed/generate', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ force: true })
      }, 180000); /* Gemini + Claude 백업 최대 3분 */

      state.feedLoaded = false; /* 배달탭 진입 시 서버에서 새 데이터 로드 */
      toast(`✅ ${data.count || 0}개 피드 생성 완료! 배달탭으로 이동합니다 🚀`, 'ok', 3000);

      /* 1초 후 배달탭으로 자동 이동 */
      setTimeout(() => this.switchView('feed', el('bnFeed')), 1000);
    } catch {
      toast('피드 생성 실패 — API 키 또는 네트워크 확인', 'err');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-refresh"></i> 지금 생성'; }
    }
  },

});
