// format.js — nginx 설정 포매터의 순수 로직 (vscode 비의존)
//
// 규칙
//   - 들여쓰기 = 블록 깊이 × 들여쓰기 단위. '}' 로 시작하는 줄은 한 단계 덜 들여쓴다.
//   - 지시어가 여러 줄에 걸치면 이어지는 줄은 한 단계 더 (gzip_types 목록 등).
//   - '{' 만 있는 줄(Allman 스타일)은 지시어와 같은 깊이.
//   - 주석 줄은 그 위치의 깊이를 따른다.
//   - 여러 줄 문자열 "안쪽" 줄은 내용이므로 건드리지 않는다.
//   - lua_block 본문은 여는 줄이 움직인 만큼 통째로 이동 (상대 들여쓰기 유지).
//   - 줄 끝 '{' 앞에 공백이 없으면 넣는다 (`location /{` → `location / {`).
//     단, 줄 끝이 아닌 '{' (예: 따옴표 없는 정규식 ^/a{2}) 는 의미가 바뀔 수 있어 건드리지 않는다.
//   - 줄 끝 공백 제거. 줄 수는 절대 바꾸지 않는다 (접힘/커서/diff 안정).
//   - 문장 시작 판단은 파서(AST)가 한다 → 세미콜론이 빠진 줄도 새 문장으로 정렬된다.
//   - 멱등: 이미 정리된 파일을 다시 돌리면 변화가 없다.
'use strict';

const { parse } = require('./parser');
const { TokenType: T } = require('./tokenizer');

// @ts-ignore
function visualWidth(ws, tabSize) {
  let w = 0;
  for (const c of ws) w += c === '\t' ? tabSize - (w % tabSize) : 1;
  return w;
}

// @ts-ignore
function makeIndent(width, { tabSize, insertSpaces }) {
  if (insertSpaces) return ' '.repeat(width);
  return '\t'.repeat(Math.floor(width / tabSize)) + ' '.repeat(width % tabSize);
}

// @ts-ignore
function collectStarts(children, set) {
  for (const d of children) {
    if (d.nameToken) set.add(d.nameToken.start);
    if (d.block && !d.block.raw) collectStarts(d.block.children, set);
  }
}

/**
 * @param {string} text
 * @param {{ tabSize?: number, insertSpaces?: boolean, isKnownDirective?: (n: string) => boolean }} [opts]
 * @returns {{ lines: string[], changed: boolean[] }} lines 는 원래 줄 끝의 \r 을 보존한다.
 */
function formatLines(text, opts = {}) {
  const o = { tabSize: opts.tabSize || 4, insertSpaces: opts.insertSpaces !== false };
  const unit = o.insertSpaces ? o.tabSize : o.tabSize; // 한 단계의 "폭" (탭이면 tabSize 칸으로 계산)

  const parsed = parse(text, { isKnownDirective: opts.isKnownDirective });
  const { tokens, positionAt } = parsed;
  // @ts-ignore
  const lineOf = (off) => positionAt(off).line;

  const rawLines = text.split('\n');
  const lineStarts = [];
  let acc = 0;
  for (const l of rawLines) {
    lineStarts.push(acc);
    acc += l.length + 1;
  }

  const stmtStarts = new Set();
  collectStarts(parsed.root.children, stmtStarts);

  // 줄별 "첫 토큰 + 그 시점의 깊이/문장 진행 여부", 여러 줄 토큰, 줄별 '{' 토큰
  const info = new Map();
  // @ts-ignore
  const multi = [];
  const lbraces = new Map();
  let depth = 0;
  let stmtOpen = false;
  for (const t of tokens) {
    const ln = lineOf(t.start);
    if (!info.has(ln)) info.set(ln, { tok: t, depth, stmtOpen });
    if ((t.type === T.STRING || t.type === T.RAW) && t.text.includes('\n')) multi.push(t);
    switch (t.type) {
      case T.LBRACE:
        if (!lbraces.has(ln)) lbraces.set(ln, []);
        lbraces.get(ln).push(t);
        depth++;
        stmtOpen = false;
        break;
      case T.RBRACE:
        depth = Math.max(0, depth - 1);
        stmtOpen = false;
        break;
      case T.SEMI:
        stmtOpen = false;
        break;
      case T.COMMENT:
      case T.RAW:
        break;
      default:
        stmtOpen = true;
    }
  }

  // @ts-ignore
  const insideToken = (probe, lineStart) =>
    // @ts-ignore
    multi.find((t) => t.start < lineStart && probe >= t.start && probe < t.end);

  const out = new Array(rawLines.length);
  const widths = new Array(rawLines.length); // 구조 줄의 { old, neu } (lua 본문 이동량 계산용)

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const cr = raw.endsWith('\r') ? '\r' : '';
    let body = cr ? raw.slice(0, -1) : raw;
    // @ts-ignore
    const ws = /^[ \t]*/.exec(body)[0];
    const lineStart = lineStarts[i];
    const inside = insideToken(lineStart + ws.length, lineStart);

    if (inside) {
      if (inside.type === T.STRING || body.trim() === '') {
        out[i] = raw; // 문자열 내용은 그대로
      } else {
        // lua 본문: 여는 줄이 이동한 만큼 이동
        const open = widths[lineOf(inside.start - 1)];
        const delta = open ? open.neu - open.old : 0;
        const w = Math.max(0, visualWidth(ws, o.tabSize) + delta);
        out[i] = makeIndent(w, o) + body.slice(ws.length) + cr;
      }
      continue;
    }

    if (body.trim() === '') {
      out[i] = cr; // 공백만 있는 줄은 빈 줄로
      continue;
    }

    const entry = info.get(i);
    if (!entry) {
      out[i] = raw; // 방어: 판단 불가면 건드리지 않음
      continue;
    }

    // 1) 줄 끝 '{' 앞 공백 보정
    const inserts = [];
    for (const t of lbraces.get(i) || []) {
      const col = t.start - lineStart;
      const rest = body.slice(col + 1).trim();
      const prev = body[col - 1];
      if (col > ws.length && prev !== undefined && !/\s/.test(prev) && (rest === '' || rest.startsWith('#'))) {
        inserts.push(col);
      }
    }
    for (const col of inserts.sort((a, b) => b - a)) body = body.slice(0, col) + ' ' + body.slice(col);

    // 2) 깊이 계산
    const { tok, depth: d, stmtOpen: open } = entry;
    let level;
    switch (tok.type) {
      case T.RBRACE:
        level = Math.max(0, d - 1);
        break;
      case T.LBRACE:
        level = d;
        break;
      case T.COMMENT:
        level = open ? d + 1 : d;
        break;
      default:
        level = open && !stmtStarts.has(tok.start) ? d + 1 : d;
    }

    const content = body.slice(ws.length).replace(/[ \t]+$/, '');
    const neuWidth = level * unit;
    widths[i] = { old: visualWidth(ws, o.tabSize), neu: neuWidth };
    out[i] = makeIndent(neuWidth, o) + content + cr;
  }

  return { lines: out, changed: out.map((l, i) => l !== rawLines[i]) };
}

// @ts-ignore
function format(text, opts) {
  return formatLines(text, opts).lines.join('\n');
}

module.exports = { format, formatLines };
