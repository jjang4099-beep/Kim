#!/usr/bin/env node
/**
 * 운영 서버(sj-archive) 계정 비밀번호 재설정 — 소유자가 직접 실행한다.
 *
 *   cd "1. 아카이브_mobile" && node scripts/reset-password.js
 *
 * 1) 이메일과 새 비밀번호를 묻는다(비밀번호는 화면에 표시되지 않음, 두 번 입력).
 * 2) 이 컴퓨터에서 bcrypt 해시를 만들어 임시 파일에 쓴다 — 평문 비밀번호는 어디에도 저장하지 않는다.
 * 3) flyctl로 서버 볼륨(/data/pw_reset.json)에 올리고 앱을 재시작한다. 서버가 부팅 때 적용하고 파일을 지운다.
 * 4) 로컬 임시 파일을 지운다.
 * 사전 조건: flyctl auth login 이 되어 있을 것.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const bcrypt = require('bcryptjs');

const APP = 'sj-archive';
const DEFAULT_EMAIL = 'jjang4099@gmail.com';

function ask(q, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(q, ans => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(ans); });
  });
}

(async () => {
  const email = ((await ask(`이메일 [${DEFAULT_EMAIL}]: `)) || DEFAULT_EMAIL).trim().toLowerCase();
  const pw1 = await ask('새 비밀번호: ', { hidden: true });
  const pw2 = await ask('새 비밀번호 확인: ', { hidden: true });
  if (pw1 !== pw2) { console.error('두 비밀번호가 다릅니다. 다시 실행해 주세요.'); process.exit(1); }
  if (pw1.length < 8) { console.error('비밀번호는 8자 이상으로 해 주세요.'); process.exit(1); }

  const tmp = path.join(os.tmpdir(), `pw_reset_${Date.now()}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ email, password_hash: bcrypt.hashSync(pw1, 10) }));
  try {
    console.log('서버에 올리는 중…');
    execFileSync('flyctl', ['ssh', 'sftp', 'put', '-a', APP, tmp, '/data/pw_reset.json'], { stdio: 'inherit' });
    console.log('앱 재시작 중…');
    execFileSync('flyctl', ['apps', 'restart', APP], { stdio: 'inherit' });
    console.log('\n완료. 20초쯤 뒤 https://sj-archive.fly.dev 에서 새 비밀번호로 로그인하세요.');
  } catch (e) {
    console.error('실패:', e.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
})();
