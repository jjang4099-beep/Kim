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
   — 이 파일이 바뀌어야 브라우저가 새 SW를 설치하고 구 캐시를 비움 */
const CACHE_NAME    = 'sj-library-v31';
const STATIC_ASSETS = [
  '/index_mobile.html',
  '/css/style_mobile.css?v=31',
  '/js/app_mobile.js?v=31',
  '/js/pwa.js?v=1',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,600&display=swap',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
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
