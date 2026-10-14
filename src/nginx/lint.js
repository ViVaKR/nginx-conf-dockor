// lint.js — 알 수 없는 지시어 경고 + "혹시 이걸 말씀하신 건가요?" 후보 (vscode 비의존)
//
// 원칙: 오탐보다 놓침이 낫다. 그래서
//   - map/geo/num_map 같은 데이터 블록 안쪽, lua 블록 본문은 검사하지 않고
//   - OpenResty 계열(lua_*, *_by_lua*)은 기본 허용하며
//   - 서드파티 모듈 지시어는 설정(extraDirectives)으로 사용자가 직접 허용한다.
'use strict';

const LUA_RE = /^lua_|_by_lua(?:_block|_file)?$/;

// 전치(ab→ba)를 1로 세는 편집 거리(OSA). max 를 넘으면 조기 종료.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2 = new Array(b.length + 1).fill(0);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
  }
  return prev[b.length];
}

/** 가장 가까운 후보들(최소 거리가 같은 것만, 최대 limit 개). 대소문자 실수는 거리 0 으로 취급. */
function suggest(name, names, limit = 3) {
  const lower = name.toLowerCase();
  const max = lower.length <= 4 ? 1 : 2;
  let best = max + 1;
  let found = [];
  for (const n of names) {
    const d = editDistance(lower, n, max);
    if (d > max) continue;
    if (d < best) {
      best = d;
      found = [n];
    } else if (d === best) found.push(n);
  }
  found.sort((x, y) => (x[0] === lower[0] ? 0 : 1) - (y[0] === lower[0] ? 0 : 1) || x.localeCompare(y));
  return found.slice(0, limit);
}

/**
 * @param {{children: any[]}} root parser.parse() 의 root
 * @param {{ isKnownDirective: (n: string) => boolean, names?: string[], extra?: Set<string> }} opts
 */
function lintUnknownDirectives(root, { isKnownDirective, names = [], extra = new Set() }) {
  const out = [];
  const visit = (children) => {
    for (const d of children) {
      const tok = d.nameToken;
      if (
        tok &&
        tok.type === 'word' &&
        !isKnownDirective(d.name) &&
        !extra.has(d.name) &&
        !LUA_RE.test(d.name)
      ) {
        const suggestions = suggest(d.name, names);
        const message = suggestions.length
          ? `알 수 없는 지시어 '${d.name}' 입니다. 혹시 ${suggestions.map((s) => `'${s}'`).join(' / ')} 을(를) 말씀하신 건가요?`
          : `알 수 없는 지시어 '${d.name}' 입니다. (서드파티 모듈 지시어라면 설정 'nginx-conf-doctor.extraDirectives' 에 추가하세요)`;
        out.push({ code: 'unknown-directive', message, start: tok.start, end: tok.end, severity: 'warning', suggestions });
      }
      if (d.block && !d.block.dataBlock && !d.block.raw) visit(d.block.children);
    }
  };
  visit(root.children);
  return out;
}

module.exports = { lintUnknownDirectives, suggest, editDistance };
