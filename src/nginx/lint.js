// lint.js — 알 수 없는 지시어 경고 + "혹시 이걸 말씀하신 건가요?" 후보 (vscode 비의존)
//
// 원칙: 오탐보다 놓침이 낫다. 그래서
//   - map/geo/num_map 같은 데이터 블록 안쪽, lua 블록 본문은 검사하지 않고
//   - OpenResty 계열(lua_*, *_by_lua*)은 기본 허용하며
//   - 서드파티 모듈 지시어는 설정(extraDirectives)으로 사용자가 직접 허용한다.
'use strict';

const { familyOk, contextMatches, contextKeyOf } = require('./completion');

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

// 체인에 http/stream/mail 이 "명시적으로" 있을 때만 family 를 정한다.
// (조각 파일의 server { } 는 http 인지 stream 인지 알 수 없으므로 family 필터를 끈다.)
function explicitFamily(names) {
  for (const f of ['stream', 'mail', 'http']) if (names.includes(f)) return f;
  return null;
}

/**
 * "이 위치에서는 쓸 수 없는 지시어" 경고 (nginx -t 의 `directive is not allowed here` 에 해당).
 * 오탐 방지 원칙:
 *   - 알 수 없는 지시어/알 수 없는 블록(서드파티)/데이터 블록/lua 본문은 검사하지 않는다.
 *   - 조각 파일의 최상위 지시어는 어디에 include 될지 모르므로 검사하지 않는다.
 *   - 조각 파일에서 family 를 알 수 없으면 어느 family 든 허용되면 통과.
 * @param {{ db: { get: Function, all: Function }, isMain?: boolean }} opts
 */
function lintContexts(root, { db, isMain = false }) {
  const knownContexts = new Set();
  for (const e of db.all()) for (const c of e.contexts || []) knownContexts.add(c);

  const out = [];
  const check = (d, chain) => {
    const tok = d.nameToken;
    if (!tok || tok.type !== 'word') return;
    const entries = db.get(d.name);
    if (entries.length === 0) return; // 알 수 없는 이름은 unknown-directive 가 담당

    let key;
    let family = null;
    if (chain.length === 0) {
      if (!isMain) return;
      key = 'main';
    } else {
      key = contextKeyOf(chain);
      if (!knownContexts.has(key) && !key.startsWith('if in ')) return; // 서드파티 블록 등
      family = explicitFamily(chain);
    }

    const familyEntries = entries.filter((e) => familyOk(e, family));
    if (familyEntries.some((e) => contextMatches(e, key))) return;

    const where = key === 'main' ? "최상위(main)" : `'${key}'`;
    let message;
    if (familyEntries.length === 0) {
      const fams = [...new Set(entries.map((e) => e.family))].join('/');
      message = `'${d.name}' 은(는) ${family} 영역에서 쓸 수 없는 지시어입니다 (${fams} 전용).`;
    } else {
      const allowed = [...new Set(familyEntries.flatMap((e) => e.contexts || []))].join(', ');
      message = `'${d.name}' 은(는) ${where} 안에서 사용할 수 없습니다. 사용 가능한 위치: ${allowed}`;
    }
    out.push({ code: 'directive-not-allowed', message, start: tok.start, end: tok.end, severity: 'warning' });
  };

  const visit = (children, chain) => {
    for (const d of children) {
      check(d, chain);
      if (d.block && !d.block.dataBlock && !d.block.raw) visit(d.block.children, [...chain, d.name]);
    }
  };
  visit(root.children, []);
  return out;
}

module.exports = { lintUnknownDirectives, lintContexts, suggest, editDistance };
