/**
 * SJ 서재 — pwa.js v1
 *
 * 역할:
 *   1. Service Worker 등록
 *   2. Web Push 구독 초기화 (권한 요청 → 서버 등록)
 *   3. SW → 앱 메시지 수신 처리 (SHARE_RESULT, OPEN_FEED)
 *   4. URL 파라미터로 넘어온 공유 결과 처리 (?share_ok, ?share_err)
 *   5. 홈 화면 설치 안내 배너 (beforeinstallprompt)
 */

'use strict';

// ══════════════════════════════════════════
//  Service Worker 등록
// ══════════════════════════════════════════

async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.warn('[PWA] Service Worker 미지원 브라우저');
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[PWA] SW 등록 완료:', reg.scope);

    // 업데이트 감지
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker?.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          console.log('[PWA] 새 SW 버전 감지 — 다음 방문 시 적용');
        }
      });
    });

    return reg;
  } catch (e) {
    console.error('[PWA] SW 등록 실패:', e.message);
    return null;
  }
}

// ══════════════════════════════════════════
//  Web Push 구독 (Base64 유틸)
// ══════════════════════════════════════════

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

async function subscribePush(reg) {
  if (!('PushManager' in window)) {
    console.warn('[Push] PushManager 미지원');
    return;
  }

  // 이미 구독 중인지 확인
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    console.log('[Push] 기존 구독 활성 — 서버 재확인');
    await syncSubscription(existing);
    return;
  }

  // 알림 권한 요청 (이미 granted면 바로 통과)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('[Push] 알림 권한 거부됨:', permission);
    return;
  }

  // VAPID 공개키 가져오기
  let vapidKey;
  try {
    const res = await fetch('/api/push/vapid-key');
    const data = await res.json();
    if (!data.success || !data.publicKey) {
      console.warn('[Push] VAPID 키 없음 — 구독 스킵');
      return;
    }
    vapidKey = data.publicKey;
  } catch (e) {
    console.error('[Push] VAPID 키 요청 실패:', e.message);
    return;
  }

  // Push 구독 생성
  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey)
    });
    await syncSubscription(sub);
    console.log('[Push] 구독 등록 완료');

    // 처음 구독 성공 시 환영 토스트
    if (typeof toast === 'function') {
      toast('🔔 배달 알림이 설정됐어요!', 'ok');
    }
  } catch (e) {
    console.error('[Push] 구독 생성 실패:', e.message);
  }
}

async function syncSubscription(sub) {
  try {
    await fetch('/api/push/subscribe', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ subscription: sub.toJSON(), userId: 'sj' })
    });
  } catch (e) {
    console.error('[Push] 구독 동기화 실패:', e.message);
  }
}

// ══════════════════════════════════════════
//  SW 메시지 수신 처리
// ══════════════════════════════════════════

function listenSWMessages() {
  if (!navigator.serviceWorker) return;

  navigator.serviceWorker.addEventListener('message', event => {
    const { type, success, content, errorMsg } = event.data || {};
    console.log('[PWA] SW 메시지 수신:', type);

    switch (type) {

      // 공유 시트에서 수집된 결과
      case 'SHARE_RESULT':
        if (success) {
          if (typeof toast === 'function') {
            toast('📥 인박스에 성공적으로 수집되었습니다!', 'ok');
          }
          // 피드 뱃지 갱신
          if (window.Mob?.checkFeedBadge) {
            setTimeout(() => Mob.checkFeedBadge(), 800);
          }
        } else {
          if (typeof toast === 'function') {
            toast('⚠️ 수집 실패: ' + (errorMsg || '다시 시도해주세요'), 'err');
          }
        }
        break;

      // 푸시 알림 클릭 → 배달 피드 열기
      case 'OPEN_FEED':
        if (window.Mob?.openFeed) {
          Mob.openFeed();
        }
        break;
    }
  });
}

// ══════════════════════════════════════════
//  URL 파라미터 기반 공유 결과 처리
//  SW가 /share-handler?share_ok=1 로 redirect한 경우
// ══════════════════════════════════════════

function handleShareQueryParams() {
  const params = new URLSearchParams(location.search);

  if (params.has('share_ok')) {
    // 히스토리에서 파라미터 제거 (뒤로가기 방지)
    const cleanUrl = location.pathname + (params.has('view') ? `?view=${params.get('view')}` : '');
    history.replaceState({}, '', cleanUrl);

    // DOMContentLoaded 이후 토스트 표시
    const showToast = () => {
      if (typeof toast === 'function') {
        toast('📥 인박스에 성공적으로 수집되었습니다!', 'ok');
      }
    };

    if (document.readyState === 'complete') {
      setTimeout(showToast, 500);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(showToast, 500));
    }
  }

  if (params.has('share_err')) {
    const errMsg = params.get('share_err');
    history.replaceState({}, '', location.pathname);

    const showErr = () => {
      if (typeof toast === 'function') {
        toast('⚠️ 수집 실패: ' + decodeURIComponent(errMsg || ''), 'err');
      }
    };

    if (document.readyState === 'complete') {
      setTimeout(showErr, 500);
    } else {
      document.addEventListener('DOMContentLoaded', () => setTimeout(showErr, 500));
    }
  }

  // 홈 화면 바로가기 shortcuts 처리
  if (params.get('action') === 'feed') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { if (window.Mob?.openFeed) Mob.openFeed(); }, 600);
    });
  }
  if (params.get('action') === 'add') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => { if (window.Mob?.openAdd) Mob.openAdd(); }, 600);
    });
  }
}

// ══════════════════════════════════════════
//  홈 화면 설치 배너 (A2HS)
// ══════════════════════════════════════════

let _installPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _installPrompt = e;
  console.log('[PWA] 설치 프롬프트 저장됨');

  // 이미 설치됐거나 거부한 경우 배너 숨김
  if (localStorage.getItem('pwa-install-dismissed')) return;

  showInstallBanner();
});

function showInstallBanner() {
  if (document.getElementById('pwaInstallBanner')) return;

  const banner = document.createElement('div');
  banner.id    = 'pwaInstallBanner';
  banner.style.cssText = `
    position: fixed; bottom: calc(66px + env(safe-area-inset-bottom) + 8px);
    left: 12px; right: 12px; z-index: 200;
    background: #1e3a8a; color: #fff;
    border-radius: 14px; padding: 14px 16px;
    display: flex; align-items: center; gap: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    font-family: 'DM Sans', sans-serif;
    animation: slideUp 0.3s ease;
  `;

  // 슬라이드업 애니메이션
  const styleTag = document.createElement('style');
  styleTag.textContent = `@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`;
  document.head.appendChild(styleTag);

  banner.innerHTML = `
    <span style="font-size:28px">📚</span>
    <div style="flex:1">
      <div style="font-size:14px;font-weight:700">홈 화면에 추가하기</div>
      <div style="font-size:12px;opacity:0.8;margin-top:2px">배달 알림과 빠른 공유를 사용할 수 있어요</div>
    </div>
    <button id="pwaInstallBtn" style="background:#fff;color:#1e3a8a;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer">설치</button>
    <button id="pwaInstallClose" style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:20px;cursor:pointer;padding:4px;line-height:1">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
    if (!_installPrompt) return;
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    console.log('[PWA] 설치 결과:', outcome);
    _installPrompt = null;
    banner.remove();
    if (outcome === 'accepted') {
      localStorage.setItem('pwa-install-dismissed', '1');
      if (typeof toast === 'function') toast('📲 홈 화면에 추가됐어요!', 'ok');
    }
  });

  document.getElementById('pwaInstallClose')?.addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pwa-install-dismissed', '1');
  });
}

// ══════════════════════════════════════════
//  Feature 7: 온라인 / 오프라인 상태 알림
// ══════════════════════════════════════════

window.addEventListener('online', () => {
  if (typeof toast === 'function') toast('🌐 온라인 연결됐습니다', 'ok');
  flushOfflineQueue();
});
window.addEventListener('offline', () => {
  if (typeof toast === 'function') toast('📴 오프라인 모드 — 저장 지식은 계속 열람 가능', '', 5000);
});

const OFFLINE_DB_NAME = 'sj-offline-queue';
const OFFLINE_STORE   = 'posts';

function _openOfflineDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore(OFFLINE_STORE, { autoIncrement: true });
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

async function queueOfflinePost(url, body) {
  try {
    const db = await _openOfflineDB();
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).add({ url, body, timestamp: Date.now() });
    console.log('[PWA] 오프라인 큐에 저장:', url);
  } catch (e) {
    console.warn('[PWA] 오프라인 큐 저장 실패:', e.message);
  }
}

async function flushOfflineQueue() {
  if (!navigator.onLine) return;
  let db;
  try { db = await _openOfflineDB(); } catch { return; }
  const tx    = db.transaction(OFFLINE_STORE, 'readwrite');
  const store = tx.objectStore(OFFLINE_STORE);
  const all   = await new Promise(res => {
    const req = store.getAll(); req.onsuccess = () => res(req.result);
  });
  if (!all.length) return;
  console.log(`[PWA] 오프라인 큐 플러시 (${all.length}개)`);
  for (const entry of all) {
    try {
      await fetch(entry.url, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify(entry.body)
      });
    } catch {}
  }
  db.transaction(OFFLINE_STORE, 'readwrite').objectStore(OFFLINE_STORE).clear();
  if (typeof toast === 'function') toast(`✅ 오프라인 저장 ${all.length}개 전송됨`, 'ok');
}

// ══════════════════════════════════════════
//  초기화 진입점
// ══════════════════════════════════════════

(async function initPWA() {
  // 1. URL 파라미터 먼저 처리 (토스트는 DOM 준비 후)
  handleShareQueryParams();

  // 2. SW 등록
  const reg = await registerSW();

  // 3. Push 구독 (SW 등록 성공 + 알림 권한 있을 때)
  if (reg) {
    listenSWMessages();

    // 이미 권한이 있으면 자동 구독, 없으면 사용자 동작 대기
    if (Notification.permission === 'granted') {
      await subscribePush(reg);
    } else if (Notification.permission === 'default') {
      // 첫 방문: 앱 로드 2초 후 권한 요청
      setTimeout(async () => {
        // 배달 시간 5분 전이거나, 첫 방문자에게만 요청 (UX 배려)
        const asked = localStorage.getItem('push-permission-asked');
        if (!asked) {
          localStorage.setItem('push-permission-asked', Date.now().toString());
          await subscribePush(reg);
        }
      }, 2000);
    }
  }

  console.log('[PWA] 초기화 완료');
})();
