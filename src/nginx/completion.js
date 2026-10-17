// completion.js — 컨텍스트 인식 자동완성의 순수 로직 (vscode 비의존)
//
// 하는 일:
//   1) 커서가 "지시어 이름 자리"인지 / "$변수 자리"인지 / 자동완성이 필요 없는 자리(주석, 문자열
//      안의 지시어 자리, 인자 자리, map 같은 데이터 블록, lua 본문)인지 판별
//   2) 커서가 속한 블록 체인(http > server > location …)에서 "지금 쓸 수 있는" 지시어만 추려냄
//   3) 삽입 텍스트(스니펫)와 문서(마크다운)를 만들어 준다
//
// 컨텍스트 규칙:
//   - 최상위: nginx.conf 로 보이면 'main' 지시어만. 조각 파일(conf.d/*.conf, snippets 등)은
//     어디에 include 될지 모르므로 필터하지 않는다 (놓치는 것보다 많이 보이는 게 낫다).
//   - 블록 안: 가장 안쪽 블록 이름이 컨텍스트 (if 는 'if in <부모>').
//   - family(http/stream/mail): 체인에 stream/mail 이 있으면 그쪽, 아니면 http. core 는 항상 허용.
'use strict';

const { parse } = require('./parser');
const { TokenType: T } = require('./tokenizer');

const MAIN_BLOCKS = new Set(['http', 'events', 'stream', 'mail']);
const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);

// 블록 이름만으로는 insert 형태를 알 수 없는 것들의 스니펫 (나머지는 generic 규칙)
const BLOCK_SNIPPETS = {
  location: 'location ${1:/} {\n\t$0\n}',
  upstream: 'upstream ${1:name} {\n\t$0\n}',
  if: 'if (${1:condition}) {\n\t$0\n}',
  map: 'map ${1:\\$source} ${2:\\$variable} {\n\t$0\n}',
  limit_except: 'limit_except ${1:GET} {\n\t$0\n}',
};

const NONE = (reason) => ({ mode: 'none', reason });

/** nginx.conf 본체인가? (파일명이 nginx.conf 이거나, 최상위에 http/events/stream/mail 블록이 있음) */
function isMainFile(root, fileName = '') {
  const base = fileName.split(/[\\/]/).pop();
  return base === 'nginx.conf' || root.children.some((d) => MAIN_BLOCKS.has(d.name) && d.block);
}

/** 문서의 모듈명은 'Module ngx_http_core_module' 형태라 앞의 'Module ' 을 뗀다. */
const moduleLabel = (m) => (m || '').replace(/^Module\s+/i, '');

/** offset 이 속한 블록 체인 (바깥 → 안쪽). 닫히지 않은 블록은 파일 끝까지로 본다. */
function findChain(children, offset) {
  for (const d of children) {
    if (!d.block) continue;
    const start = d.block.open.end;
    const end = d.block.close ? d.block.close.start : Infinity;
    if (offset >= start && offset <= end) return [d, ...findChain(d.block.children, offset)];
  }
  return [];
}

function familyOf(names) {
  if (names.includes('stream')) return 'stream';
  if (names.includes('mail')) return 'mail';
  return 'http';
}

function contextKeyOf(names) {
  const cur = names[names.length - 1];
  if (cur === 'if') return `if in ${names[names.length - 2] || 'server'}`;
  return cur;
}

/**
 * @param {string} text
 * @param {number} offset 커서 위치
 * @param {{ fileName?: string }} [opts]
 */
function analyzeCompletionContext(text, offset, opts = {}) {
  const parsed = parse(text);
  const tokens = parsed.tokens;

  // 1) 주석 / lua 본문 / 문자열 안인가?
  let inString = false;
  for (const t of tokens) {
    if (t.type === T.COMMENT && offset > t.start && offset <= t.end) return NONE('comment');
    if (t.type === T.RAW && offset >= t.start && offset <= t.end) return NONE('raw');
    if (t.type === T.STRING && offset > t.start && (t.unterminated ? offset <= t.end : offset < t.end)) inString = true;
  }

  // 2) $변수 자리 (문자열 안에서도 허용)
  const before = text.slice(0, offset);
  const vm = /\$(\{?)([A-Za-z0-9_]*)$/.exec(before);
  let wordStart;
  let mode;
  let braced = false;
  if (vm) {
    mode = 'variable';
    braced = vm[1] === '{';
    wordStart = vm.index + (braced ? 2 : 0);
  } else {
    if (inString) return NONE('string');
    wordStart = offset;
    while (wordStart > 0 && isWordChar(text[wordStart - 1])) wordStart--;
    mode = 'directive';
  }
  let wordEnd = offset;
  while (wordEnd < text.length && isWordChar(text[wordEnd])) wordEnd++;
  const closed = braced && text[wordEnd] === '}';

  // 3) 지시어 이름 자리인가? (직전 의미 토큰이 없거나 ; { } 이어야 함)
  if (mode === 'directive') {
    const prevChar = text[wordStart - 1];
    if (wordStart > 0 && !/[\s;{}]/.test(prevChar)) return NONE('mid-token');
    let prev = null;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i].type !== T.COMMENT && tokens[i].end <= wordStart) {
        prev = tokens[i];
        break;
      }
    }
    if (prev && ![T.SEMI, T.LBRACE, T.RBRACE, T.RAW].includes(prev.type)) return NONE('args');
  }

  // 4) 블록 체인과 컨텍스트
  const chain = findChain(parsed.root.children, offset);
  const names = chain.map((d) => d.name);
  const inner = chain[chain.length - 1];
  if (inner && (inner.block.dataBlock || inner.block.raw)) return NONE('data-block');

  let contextKey = null;
  let family = null;
  let filtered = true;
  if (names.length === 0) {
    if (isMainFile(parsed.root, opts.fileName)) contextKey = 'main';
    else filtered = false; // 조각 파일: 어디에 include 될지 모름
  } else {
    contextKey = contextKeyOf(names);
    family = familyOf(names);
  }

  const lineEnd = text.indexOf('\n', wordEnd);
  const rest = text.slice(wordEnd, lineEnd === -1 ? text.length : lineEnd).trim();
  const restHasContent = rest !== '' && !rest.startsWith('#');

  return { mode, chain: names, contextKey, family, filtered, wordStart, wordEnd, braced, closed, restHasContent };
}

const familyOk = (entry, family) => !family || entry.family === 'core' || entry.family === family;

/** 문서의 context 표기는 'if in location' 과 그냥 'if' 두 형태가 섞여 있으므로 둘 다 허용한다. */
const contextMatches = (entry, key) =>
  !entry.contexts || entry.contexts.length === 0 || // context 정보가 없으면 "모름" → 걸러내지 않는다
  entry.contexts.some((c) => c === key || c === 'any' || (key.startsWith('if in ') && c === 'if'));

/** @returns {Array<{ name: string, entries: any[] }>} 이름 순 정렬 */
function directiveCandidates(db, ctx) {
  const groups = new Map();
  for (const e of db.all()) {
    if (ctx.filtered) {
      if (!familyOk(e, ctx.family)) continue;
      if (!contextMatches(e, ctx.contextKey)) continue;
    }
    if (!groups.has(e.name)) groups.set(e.name, []);
    groups.get(e.name).push(e);
  }
  return [...groups.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function variableCandidates(db, ctx) {
  const seen = new Map();
  for (const v of db.variables || []) {
    if (ctx.filtered && !familyOk(v, ctx.family)) continue;
    if (!seen.has(v.name)) seen.set(v.name, v);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const esc = (s) => s.replace(/[$}\\]/g, '\\$&');

/** 지시어 삽입 텍스트. 같은 줄 뒤에 이미 내용이 있으면 이름만 넣는다. */
function buildInsert(group, ctx) {
  const { name } = group;
  if (ctx.restHasContent) return { text: name, snippet: false };
  const block = group.entries.find((e) => e.block);
  if (block) {
    if (BLOCK_SNIPPETS[name]) return { text: BLOCK_SNIPPETS[name], snippet: true };
    const hasArgs = block.syntaxes[0] && block.syntaxes[0].text;
    return { text: `${name}${hasArgs ? ' ${1:args}' : ''} {\n\t$0\n}`, snippet: true };
  }
  const hasArgs = group.entries.some((e) => e.syntaxes.some((s) => s.text));
  return { text: hasArgs ? `${name} \${1};$0` : `${name};$0`, snippet: true };
}

/** $변수 삽입 텍스트 ($arg_ 처럼 뒤에 이름이 붙는 접두어 변수는 자리표시자 포함) */
function variableInsert(v, ctx) {
  const lead = ctx.braced ? '' : '$';
  const full = v.name.startsWith('$') ? v.name.slice(1) : v.name;
  const tail = ctx.braced && !ctx.closed ? '}' : '';
  if (v.prefix) {
    const p = v.prefix.startsWith('$') ? v.prefix.slice(1) : v.prefix;
    return { text: `${lead}${esc(p)}\${1:${esc(full.slice(p.length) || 'name')}}${tail}$0`, snippet: true };
  }
  return { text: `${lead}${full}${tail}`, snippet: false };
}

function renderDoc(group) {
  const parts = [];
  for (const e of group.entries) {
    // family 표시는 코드 블록 "앞"의 별도 줄에 둔다. 닫는 펜스(```) 뒤에 글자가 붙으면
    // 마크다운이 펜스를 닫지 않아 이후 내용 전체가 코드 블록으로 렌더링된다.
    if (group.entries.length > 1) parts.push(`_(${e.family})_`);
    parts.push(`\`\`\`nginx\n${e.syntaxes.map((s) => s.line).join('\n')}\n\`\`\``);
    if (e.default) parts.push(`**기본값:** \`${e.default}\``);
    if (e.contexts && e.contexts.length) parts.push(`**컨텍스트:** ${e.contexts.map((c) => `\`${c}\``).join(', ')}`);
    if (e.description) parts.push(e.description);
    if (e.docUrl) parts.push(`[공식 문서](${e.docUrl})`);
  }
  return parts.join('\n\n');
}

function detailOf(group) {
  const ctxs = [...new Set(group.entries.flatMap((e) => e.contexts || []))];
  return ctxs.join(', ');
}

module.exports = {
  analyzeCompletionContext,
  directiveCandidates,
  variableCandidates,
  buildInsert,
  variableInsert,
  renderDoc,
  detailOf,
  findChain,
  isMainFile,
  moduleLabel,
  familyOf,
  contextKeyOf,
  familyOk,
  contextMatches,
};
