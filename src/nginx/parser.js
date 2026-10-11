// parser.js
// -----------------------------------------------------------------------
// 토큰 목록을 AST 로 만들고, 구조 오류를 진단으로 모은다. (vscode 비의존)
//
//   root.children[] = directive
//   directive = { type, name, nameToken, args[], block|null, semi|null, start, end }
//   block     = { open, close|null, children[], raw|null, dataBlock? }
//
// 0.2 에서 잡는 것:
//   - 짝이 안 맞는 { }            (unclosed-block / unexpected-close-brace)
//   - 이름 없는 { , 홀로 있는 ;    (unexpected-open-brace / unexpected-semicolon)
//   - 세미콜론 누락               (missing-semicolon)
//   - 토크나이저 오류 전달         (unterminated-string 등)
//
// 세미콜론 누락 판정 (nginx -t 는 엉뚱한 줄을 가리키지만 여기선 "그 줄"을 가리킴):
//   ① 인자 수집 중 '}' 를 만났다            → 직전 토큰 뒤에 ; 누락
//   ② 파일 끝에 도달                         → 직전 토큰 뒤에 ; 누락
//   ③ 다음 줄이 "알려진 지시어 이름"으로 시작하고, 그 줄의 들여쓰기가 현재
//      문장 첫 줄의 들여쓰기 이하일 때       → 직전 토큰 뒤에 ; 누락
//   ③ 의 들여쓰기 조건 덕분에 아래처럼 정상적인 여러 줄 인자는 오탐하지 않는다.
//        rewrite ^/a /b
//            break;          ← break 는 지시어 이름이기도 하지만 더 깊게 들여썼으므로 이어지는 인자
//
// map/geo/types 같은 "데이터 블록" 안은 `키 값;` 형태라 ③ 을 적용하지 않는다.
// 한계: 다음 줄이 "모르는 이름"이면 ③ 이 못 잡는다 (0.5 의 인자 개수 검사에서 보완 예정).
// -----------------------------------------------------------------------
'use strict';

const { tokenize, TokenType: T } = require('./tokenizer');

const DATA_BLOCKS = new Set(['map', 'geo', 'types', 'split_clients', 'charset_map', 'match']);

/**
 * @param {string} text
 * @param {{ isKnownDirective?: (name: string) => boolean }} [options]
 */
function parse(text, options = {}) {
  const isKnown = options.isKnownDirective || (() => false);
  const { tokens: all, errors: tokenErrors, positionAt } = tokenize(text);
  const comments = all.filter((t) => t.type === T.COMMENT);
  const tokens = all.filter((t) => t.type !== T.COMMENT);

  const diagnostics = tokenErrors.map((e) => ({ ...e, severity: 'error' }));
  const diag = (code, message, start, end, severity = 'error') =>
    diagnostics.push({ code, message, start, end, severity });

  const lineOf = (offset) => positionAt(offset).line;
  const indentOf = (offset) => {
    const lineStart = offset - positionAt(offset).character;
    let k = lineStart;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
    return k - lineStart;
  };

  const root = { type: 'root', children: [] };
  let p = 0;

  function missingSemicolon(last, nextTok) {
    let msg = '세미콜론(;)이 빠진 것 같습니다.';
    if (nextTok) msg += ` 다음 줄의 '${nextTok.value}' 은(는) 새 지시어로 보입니다.`;
    else msg += ' 문장이 끝나지 않은 채 블록/파일이 끝났습니다.';
    diag('missing-semicolon', msg, last.start, last.end);
  }

  function parseStatements(parent, depth) {
    while (p < tokens.length) {
      const t = tokens[p];

      if (t.type === T.RBRACE) {
        if (depth > 0) return; // 호출한 블록이 소비
        diag('unexpected-close-brace', "짝이 되는 '{' 가 없는 '}' 입니다.", t.start, t.end);
        p++;
        continue;
      }
      if (t.type === T.SEMI) {
        diag('unexpected-semicolon', "불필요한 ';' 입니다 (빈 문장).", t.start, t.end);
        p++;
        continue;
      }
      if (t.type === T.LBRACE) {
        diag('unexpected-open-brace', "지시어 이름 없이 '{' 가 나왔습니다.", t.start, t.end);
        const anon = newDirective(null);
        p++;
        parseBlock(anon, depth, t);
        parent.children.push(anon);
        continue;
      }
      if (t.type === T.RAW) {
        p++; // 정상 흐름에선 오지 않음 (방어)
        continue;
      }
      parent.children.push(parseDirective(parent));
    }
  }

  function newDirective(nameTok) {
    return {
      type: 'directive',
      name: nameTok ? nameTok.value : '',
      nameToken: nameTok,
      args: [],
      block: null,
      semi: null,
      start: nameTok ? nameTok.start : 0,
      end: nameTok ? nameTok.end : 0,
    };
  }

  function parseDirective(parent) {
    const nameTok = tokens[p++];
    const node = newDirective(nameTok);
    const inData = Boolean(parent.dataBlock);
    const startIndent = indentOf(nameTok.start);
    let last = nameTok;

    while (p < tokens.length) {
      const t = tokens[p];

      if (t.type === T.SEMI) {
        node.semi = t;
        node.end = t.end;
        p++;
        return node;
      }
      if (t.type === T.LBRACE) {
        p++;
        parseBlock(node, depthOf(parent), t);
        return node;
      }
      if (t.type === T.RBRACE) {
        missingSemicolon(last, null); // ① (닫는 } 는 소비하지 않음)
        return node;
      }

      // ③ 다음 줄이 새 지시어로 보이는가?
      if (
        !inData &&
        t.type === T.WORD &&
        lineOf(t.start) > lineOf(Math.max(last.end - 1, last.start)) &&
        isKnown(t.value) &&
        indentOf(t.start) <= startIndent
      ) {
        missingSemicolon(last, t);
        return node;
      }

      node.args.push(t);
      node.end = t.end;
      last = t;
      p++;
    }

    missingSemicolon(last, null); // ②
    return node;
  }

  // depth 는 parseStatements 호출 때만 필요해서 블록 객체에 심어 둔다.
  function depthOf(parent) {
    return parent.depth || 0;
  }

  function parseBlock(node, depth, openTok) {
    const block = {
      open: openTok,
      close: null,
      children: [],
      raw: null,
      dataBlock: DATA_BLOCKS.has(node.name),
      depth: depth + 1,
    };
    node.block = block;

    if (p < tokens.length && tokens[p].type === T.RAW) {
      block.raw = tokens[p];
      p++;
    } else {
      parseStatements(block, depth + 1);
    }

    if (p < tokens.length && tokens[p].type === T.RBRACE) {
      block.close = tokens[p];
      node.end = tokens[p].end;
      p++;
    } else {
      diag('unclosed-block', "블록의 닫는 '}' 가 없습니다.", openTok.start, openTok.end);
    }
  }

  parseStatements(root, 0);

  diagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
  return { root, diagnostics, comments, tokens: all, positionAt };
}

module.exports = { parse, DATA_BLOCKS };
