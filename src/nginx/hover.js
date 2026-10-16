// hover.js — 마우스 오버 문서의 순수 로직 (vscode 비의존)
//   - 지시어 이름 위: 문법/기본값/허용 컨텍스트/설명/공식 문서 링크 (현재 블록에 맞는 항목 우선)
//   - $변수 위(문자열 안 포함): 변수 설명 ($arg_xxx 같은 접두어 변수도 인식)
'use strict';

const { parse } = require('./parser');
const { TokenType: T } = require('./tokenizer');
const { findChain, familyOf, contextKeyOf, familyOk, contextMatches, renderDoc, moduleLabel } = require('./completion');

function findNameToken(children, tokenStart, chain = []) {
  for (const d of children) {
    if (d.nameToken && d.nameToken.start === tokenStart) return { node: d, chain };
    if (d.block && !d.block.dataBlock && !d.block.raw) {
      const r = findNameToken(d.block.children, tokenStart, [...chain, d.name]);
      if (r) return r;
    }
  }
  return null;
}

/** 현재 블록 체인에 맞는 entry 만 (없으면 family → 전체 순으로 완화) */
function entriesFor(db, name, chain) {
  const all = db.get(name);
  if (!all.length || chain.length === 0) return all;
  const family = familyOf(chain);
  const key = contextKeyOf(chain);
  const byFamily = all.filter((e) => familyOk(e, family));
  const exact = byFamily.filter((e) => contextMatches(e, key));
  if (exact.length) return exact;
  return byFamily.length ? byFamily : all;
}

function findVariable(db, name, chainFamily) {
  const ok = (v) => !chainFamily || v.family === 'core' || v.family === chainFamily;
  const vars = (db.variables || []).filter(ok);
  return (
    vars.find((v) => v.name === name) ||
    vars.find((v) => v.prefix && name.startsWith(v.prefix) && name.length > v.prefix.length) ||
    null
  );
}

function renderVariable(v, typed) {
  const parts = [`**${typed}**${v.prefix ? ` _(접두어 변수: \`${v.name}\`)_` : ''}`];
  if (v.module) parts.push(`모듈: \`${moduleLabel(v.module)}\``);
  if (v.description) parts.push(v.description);
  return parts.join('\n\n');
}

/**
 * @returns {null | { markdown: string, start: number, end: number }}
 */
function hoverAt(db, text, offset) {
  const parsed = parse(text);
  const tok = parsed.tokens.find(
    (t) => (t.type === T.WORD || t.type === T.STRING) && t.start <= offset && offset < t.end,
  );
  if (!tok) return null;

  // 1) 지시어 이름
  if (tok.type === T.WORD) {
    const hit = findNameToken(parsed.root.children, tok.start);
    if (hit) {
      const entries = entriesFor(db, hit.node.name, hit.chain);
      if (!entries.length) return null;
      return { markdown: renderDoc({ name: hit.node.name, entries }), start: tok.start, end: tok.end };
    }
  }

  // 2) $변수 (단어/문자열 어디서든)
  const re = /\$\{?([A-Za-z0-9_]+)\}?/g;
  let m;
  while ((m = re.exec(tok.text))) {
    const start = tok.start + m.index;
    const end = start + m[0].length;
    if (offset < start || offset >= end) continue;
    const name = `$${m[1]}`;
    const chain = findChain(parsed.root.children, offset).map((d) => d.name);
    const v = findVariable(db, name, chain.length ? familyOf(chain) : null);
    if (!v) return null;
    return { markdown: renderVariable(v, name), start, end };
  }
  return null;
}

module.exports = { hoverAt, entriesFor };
