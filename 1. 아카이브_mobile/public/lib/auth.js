'use strict';
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'sj_token';
const MAX_AGE_MS  = 30 * 24 * 60 * 60 * 1000; // 30일

function generateToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   MAX_AGE_MS,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

/** userId는 req.userId에만 부착 — 전역 변수 없음, 요청마다 새로 검증 */
function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ success: false, error: '로그인이 필요해요' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ success: false, error: '세션이 만료됐어요. 다시 로그인해주세요' });
  }
}

module.exports = { COOKIE_NAME, generateToken, setAuthCookie, clearAuthCookie, requireAuth };
