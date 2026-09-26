/**
 * SJ 지식 서재 — Service Worker v1
 *
 * 역할:
 *   1. 핵심 자산 오프라인 캐싱 (Cache-First)
 *   2. Web Push 알림 수신 및 표시
 *   3. 푸시 알림 클릭 → 앱 포커스 / 열기
 *   4. Share Target: /share-handler → 백그라운드 POST
 */

'use strict';

/* ★ 배포 시 index_mobile.html의 ?v=XX와 함께 반드시 올려야 함
   — 이 파일이 바뀌어야 브라우저가 새 SW를 설치하고 구 캐시를 비움
   (07-26: 로그인/멀티유저 배포 때 이 버전을 못 올려서 이미 설치된 PWA들이
    구 서비스워커+구 페이지 상태로 남아 로그인 없이 API를 호출 → 전부 401 나던 버그 발생) */
const CACHE_NAME    = 'sj-library-v44';
const STATIC_ASSETS = [
  '/index_mobile.html',
  '/css/style_mobile.css?v=94',
  '/js/core.js?v=13',
  '/js/pwa.js?v=3',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,600&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css'
];

// ── Install: 핵심 자산 사전 캐시 ──
self.addEventListener('install', event => {
  console.log('[SW] install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 개별 실패가 전체를 막지 않도록 Promise.allSettled 사용
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] 캐시 실패:', url, e.message))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: 구 버전 캐시 정리 ──
self.addEventListener('activate', event => {
  console.log('[SW] activate');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache-First (API는 네트워크 우선) ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── Share Target 수신 처리 ──
  // manifest의 share_target.action = "/share-handler"
  if (url.pathname === '/share-handler') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // API 요청: Network-First (캐시 안 함)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({ success: false, error: 'offline' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    ));
    return;
  }

  // ★ HTML(페이지 이동): Network-First — 항상 최신 버전 먼저, 오프라인일 때만 캐시
  //   (Cache-First로 두면 새 배포가 영원히 반영되지 않는 업데이트 갇힘 발생)
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => caches.match(event.request)
        .then(c => c || caches.match('/index_mobile.html')))
    );
    return;
  }

  // 정적 자산(CSS/JS/이미지): Cache-First — URL에 ?v=버전이 붙어 있어 안전
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (event.request.method === 'GET' && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// ════════════════════════════════════════════
//  Share Target 핸들러
//  manifest: GET /share-handler?title=&text=&url=
// ════════════════════════════════════════════

async function handleShareTarget(request) {
  /* manifest가 POST/multipart로 바뀌었으므로 사진 공유는 이쪽으로 들어온다.
     GET(옛 링크 공유)도 계속 지원 — 구버전 매니페스트가 캐시된 클라이언트가 있을 수 있다. */
  if (request.method === 'POST') {
    return handleSharedPhotos(request);
  }

  const url    = new URL(request.url);
  const title  = url.searchParams.get('title') || '';
  const text   = url.searchParams.get('text')  || '';
  const shared = url.searchParams.get('url')   || '';

  // 전송할 텍스트 조합: url > text > title 우선순위
  const content = shared || text || title;

  console.log('[SW] Share Target 수신:', { title, text, shared });

  // 백그라운드로 /api/inbox에 POST
  let success = false;
  let errorMsg = '';
  try {
    const res = await fetch('/api/inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:    content,
        source:  'share-sheet',
        title:   title || undefined
      })
    });
    success = res.ok;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorMsg = body.error || `HTTP ${res.status}`;
    }
  } catch (e) {
    errorMsg = e.message;
    console.error('[SW] Share POST 실패:', e.message);
  }

  // 이미 열려있는 앱 창이 있으면 포커스 + 메시지 전달
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({
      type:    'SHARE_RESULT',
      success,
      content,
      errorMsg
    });
    client.focus();
  }

  // 앱이 열려있지 않으면 share-result 페이지로 redirect
  if (clients.length === 0) {
    const redirectUrl = success
      ? `/?view=mobile&share_ok=1&content=${encodeURIComponent(content.slice(0, 60))}`
      : `/?view=mobile&share_err=${encodeURIComponent(errorMsg)}`;
    return Response.redirect(redirectUrl, 303);
  }

  // 클라이언트에 전달 완료 후 share-result 페이지로
  return Response.redirect(`/?view=mobile&share_ok=1`, 303);
}

/**
 * 사진 공유 수신 (POST multipart) → 라이프 기록으로 저장.
 *
 * 사진이 없으면(링크·텍스트만 공유한 경우) 기존 인박스 경로로 넘긴다 —
 * manifest가 POST로 바뀌면서 링크 공유도 이 함수로 들어오기 때문이다.
 *
 * ⚠️ 여러 장을 한 번에 공유해도 기록은 하나로 묶는다. 사진 한 장이 곧 하루가 아니라,
 *    "그날"이 하나의 기록이어야 연대기에서 의미가 있다.
 */
async function handleSharedPhotos(request) {
  let photos = [], text = '', title = '', shared = '';
  try {
    const form = await request.formData();
    photos = form.getAll('photos').filter(f => f && f.size > 0);
    text   = form.get('text')  || '';
    title  = form.get('title') || '';
    shared = form.get('url')   || '';
  } catch (e) {
    console.error('[SW] 공유 폼 파싱 실패:', e.message);
    return Response.redirect('/index_mobile.html?share_err=' + encodeURIComponent('공유 내용을 읽지 못했어요'), 303);
  }

  /* 사진이 없으면 링크/텍스트 공유 — 기존 인박스 경로 그대로 */
  if (!photos.length) {
    return saveSharedLink(shared || text || title, title);
  }

  console.log(`[SW] 사진 공유 수신: ${photos.length}장`);
  const body = new FormData();
  photos.forEach(p => body.append('photos', p, p.name || 'photo.jpg'));
  if (text) body.append('text', text);

  try {
    const res  = await fetch('/api/items/life', { method: 'POST', body });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      const msg = data.error || `HTTP ${res.status}`;
      return Response.redirect('/index_mobile.html?share_err=' + encodeURIComponent(msg), 303);
    }
    /* 저장은 이미 끝났다. 앱을 열어 '한 줄 남기기'를 띄운다 —
       여기서 건너뛰어도 사진은 남아 있어야 한다. */
    const id = data.item?.id || '';
    return Response.redirect(
      `/index_mobile.html?life_added=${encodeURIComponent(id)}&photos=${photos.length}`, 303
    );
  } catch (e) {
    console.error('[SW] 사진 저장 실패:', e.message);
    return Response.redirect('/index_mobile.html?share_err=' + encodeURIComponent(e.message), 303);
  }
}

/** 링크·텍스트 공유를 인박스에 저장 (GET/POST 공용) */
async function saveSharedLink(content, title) {
  let success = false, errorMsg = '';
  try {
    const res = await fetch('/api/inbox', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: content, source: 'share-sheet', title: title || undefined }),
    });
    success = res.ok;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errorMsg = body.error || `HTTP ${res.status}`;
    }
  } catch (e) {
    errorMsg = e.message;
  }
  const q = success
    ? `share_ok=1&content=${encodeURIComponent((content || '').slice(0, 60))}`
    : `share_err=${encodeURIComponent(errorMsg)}`;
  return Response.redirect(`/index_mobile.html?${q}`, 303);
}

// ════════════════════════════════════════════
//  Web Push 수신
// ════════════════════════════════════════════

self.addEventListener('push', event => {
  console.log('[SW] Push 수신');
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: '📚 SJ 서재', body: event.data?.text() || '새 알림이 도착했습니다.' };
  }

  const title   = payload.title   || '📚 SJ 지식 서재';
  const options = {
    body:    payload.body    || '오늘의 지식 배달이 도착했습니다!',
    icon:    '/icons/icon.svg',
    badge:   '/icons/icon.svg',
    tag:     payload.tag     || 'sj-daily-feed',   // 같은 tag면 기존 알림 교체
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url:      payload.url      || '/?view=mobile&action=feed',
      dateTime: new Date().toISOString()
    },
    actions: [
      { action: 'open-feed',  title: '📖 지금 보기' },
      { action: 'dismiss',    title: '나중에'       }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── 푸시 알림 클릭 ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/?view=mobile&action=feed';

  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // 이미 열린 창이 있으면 포커스
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'OPEN_FEED' });
          return;
        }
      }
      // 없으면 새 창 오픈
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── 푸시 구독 만료 ──
self.addEventListener('pushsubscriptionchange', event => {
  console.log('[SW] Push 구독 만료 — 재구독 시도');
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(sub => fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub)
      }))
  );
});
