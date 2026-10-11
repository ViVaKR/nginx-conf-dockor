// tokenizer.js
// -----------------------------------------------------------------------
// nginx 설정 파일 토크나이저. vscode API에 의존하지 않는 순수 모듈이라
// `node --test` 만으로 단위 테스트가 가능하다.
//
// nginx 원본(ngx_conf_read_token)과 다르게 만든 점 (진단 품질을 위해 의도함):
//   - '}' 도 단어를 끝낸다. nginx 는 `return 200 ok}` 를 "ok}" 한 단어로
//     읽어버려서 엉뚱한 줄을 오류로 가리킨다. 여기선 '}' 를 분리해서
//     파서가 "세미콜론 누락"을 정확한 위치에 보고할 수 있게 한다.
//   - 닫는 따옴표가 없으면 파일 끝까지 삼키지 않고 "그 줄 끝"에서 복구한다.
//     (닫는 따옴표가 뒤에 어딘가 있으면 nginx처럼 여러 줄 문자열로 인정)
//
// nginx 원본과 같게 처리하는 점:
//   - '#' 은 토큰 시작 위치에서만 주석이다. (`a#b` 는 한 단어)
//   - `${var}` 는 중괄호까지 한 단어의 일부다.
//   - 백슬래시는 다음 한 글자를 이스케이프한다.
//   - OpenResty `*_by_lua_block { ... }` 의 본문은 Lua 코드이므로 RAW
//     토큰 하나로 통째로 건너뛴다 (Lua 문자열/주석 안의 중괄호는 무시).
// -----------------------------------------------------------------------
'use strict';

const TokenType = Object.freeze({
  WORD: 'word',
  STRING: 'string',
  SEMI: 'semi',
  LBRACE: 'lbrace',
  RBRACE: 'rbrace',
  COMMENT: 'comment',
  RAW: 'raw', // lua_block 본문
});

const LUA_BLOCK_RE = /_by_lua_block$/;

function isSpace(c) {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

// offset -> {line, character} (0-based, character 는 UTF-16 단위 = vscode와 동일)
function positionAt(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

function unescapeQuoted(raw) {
  return raw.replace(/\\(["'\\trn])/g, (_, c) => {
    if (c === 't') return '\t';
    if (c === 'r') return '\r';
    if (c === 'n') return '\n';
    return c;
  });
}

// `[=*[` 로 시작하면 레벨(= 개수), 아니면 -1
function longBracketLevel(text, i) {
  let j = i + 1;
  let level = 0;
  while (text[j] === '=') {
    level++;
    j++;
  }
  return text[j] === '[' ? level : -1;
}

// 닫는 `]=*]` 바로 다음 위치. 없으면 -1
function findLongBracketEnd(text, i, level) {
  const closing = ']' + '='.repeat(level) + ']';
  const k = text.indexOf(closing, i + 2 + level);
  return k === -1 ? -1 : k + closing.length;
}

// Lua 본문에서 짝이 맞는 '}' 의 위치. 없으면 -1.
function scanLuaBlock(text, from) {
  const n = text.length;
  let depth = 1;
  let i = from;
  while (i < n) {
    const c = text[i];
    if (c === '-' && text[i + 1] === '-') {
      const level = text[i + 2] === '[' ? longBracketLevel(text, i + 2) : -1;
      if (level >= 0) {
        const e = findLongBracketEnd(text, i + 2, level);
        i = e === -1 ? n : e;
      } else {
        while (i < n && text[i] !== '\n') i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      i++;
      while (i < n && text[i] !== c && text[i] !== '\n') {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === '[') {
      const level = longBracketLevel(text, i);
      if (level >= 0) {
        const e = findLongBracketEnd(text, i, level);
        i = e === -1 ? n : e;
        continue;
      }
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function prevSignificant(tokens, from) {
  for (let k = from; k >= 0; k--) {
    if (tokens[k].type !== TokenType.COMMENT) return tokens[k];
  }
  return null;
}

/**
 * @param {string} text
 * @returns {{
 *   tokens: Array<{type: string, start: number, end: number, text: string, value: string, unterminated?: boolean}>,
 *   errors: Array<{code: string, message: string, start: number, end: number}>,
 *   positionAt: (offset: number) => {line: number, character: number}
 * }}
 */
function tokenize(text) {
  const n = text.length;
  const tokens = [];
  const errors = [];
  const lineStarts = buildLineStarts(text);

  const push = (type, start, end, value) => {
    const t = {
      type,
      start,
      end,
      text: text.slice(start, end),
      value: value === undefined ? text.slice(start, end) : value,
    };
    tokens.push(t);
    return t;
  };
  const err = (code, message, start, end) => errors.push({ code, message, start, end });

  let i = 0;
  while (i < n) {
    const ch = text[i];

    if (isSpace(ch)) {
      i++;
      continue;
    }

    if (ch === '#') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      const e = j > i && text[j - 1] === '\r' ? j - 1 : j;
      push(TokenType.COMMENT, i, e);
      i = j;
      continue;
    }

    if (ch === ';') {
      push(TokenType.SEMI, i, i + 1);
      i++;
      continue;
    }

    if (ch === '}') {
      push(TokenType.RBRACE, i, i + 1);
      i++;
      continue;
    }

    if (ch === '{') {
      const lb = push(TokenType.LBRACE, i, i + 1);
      i++;
      const prev = prevSignificant(tokens, tokens.length - 2);
      if (prev && prev.type === TokenType.WORD && LUA_BLOCK_RE.test(prev.value)) {
        const close = scanLuaBlock(text, i);
        if (close === -1) {
          err('unterminated-lua-block', 'Lua 블록의 닫는 `}` 가 없습니다.', lb.start, lb.end);
          if (n > i) push(TokenType.RAW, i, n);
          i = n;
        } else {
          if (close > i) push(TokenType.RAW, i, close);
          push(TokenType.RBRACE, close, close + 1);
          i = close + 1;
        }
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const c = text[j];
        if (c === '\\') {
          j += 2;
          continue;
        }
        if (c === ch) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (closed) {
        push(TokenType.STRING, i, j, unescapeQuoted(text.slice(i + 1, j - 1)));
        i = j;
      } else {
        err('unterminated-string', `닫는 따옴표(${ch})가 없습니다.`, i, i + 1);
        let e = i + 1;
        while (e < n && text[e] !== '\n') e++;
        if (e > i + 1 && text[e - 1] === '\r') e--;
        push(TokenType.STRING, i, e, text.slice(i + 1, e)).unterminated = true;
        i = e;
      }
      continue;
    }

    // 일반 단어
    let j = i;
    while (j < n) {
      const c = text[j];
      if (isSpace(c) || c === ';' || c === '{' || c === '}') break;
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '$' && text[j + 1] === '{') {
        let k = j + 2;
        while (k < n && text[k] !== '}' && !isSpace(text[k]) && text[k] !== ';') k++;
        if (text[k] === '}') {
          j = k + 1;
          continue;
        }
        err('unterminated-variable', '변수 `${` 의 닫는 `}` 가 없습니다.', j, k);
        j = k;
        break;
      }
      j++;
    }
    if (j > n) j = n;
    push(TokenType.WORD, i, j);
    i = j;
  }

  return { tokens, errors, positionAt: (offset) => positionAt(lineStarts, offset) };
}

module.exports = { tokenize, TokenType, positionAt, buildLineStarts };
