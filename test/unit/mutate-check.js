#!/usr/bin/env node
// mutate-check.js — "세미콜론 누락 감지"의 재현율(recall)을 실제 설정 파일로 측정한다.
//   npm run mutate -- ./내설정.conf [--data other.json]
//
// 원리: 정상 파일의 문장 종결 ';' 를 하나씩 지워 보고(변이), 파서가 그 줄에서
//       missing-semicolon 을 보고하는지 확인한다. (줄 수는 변하지 않으므로 같은 줄 비교 가능)
//   detected   : 지운 줄에서 정확히 보고함
//   misplaced  : 보고는 했지만 다른 줄
//   other      : missing-semicolon 은 아니고 다른 진단만 발생
//   missed     : 아무 진단도 없음 (놓침)
'use strict';

const fs = require('fs');
const path = require('path');
const { tokenize, TokenType } = require('../src/nginx/tokenizer');
const { parse } = require('../src/nginx/parser');
const { createDirectiveDb } = require('../src/nginx/directive-db');

function mutateAll(text, isKnownDirective) {
  const { tokens, positionAt } = tokenize(text);
  const lines = text.split(/\r\n|\n/);
  const out = [];
  for (const s of tokens.filter((t) => t.type === TokenType.SEMI)) {
    const mutated = text.slice(0, s.start) + text.slice(s.end);
    const line = positionAt(s.start).line;
    const r = parse(mutated, { isKnownDirective });
    const semis = r.diagnostics.filter((d) => d.code === 'missing-semicolon');
    let status = 'missed';
    if (semis.some((d) => r.positionAt(d.start).line === line)) status = 'detected';
    else if (semis.length) status = 'misplaced';
    else if (r.diagnostics.length) status = 'other';
    out.push({ line: line + 1, status, source: (lines[line] || '').trim().slice(0, 90) });
  }
  return out;
}

function main(argv) {
  const args = argv.slice(2);
  const di = args.indexOf('--data');
  const dataPath = di >= 0 ? args.splice(di, 2)[1] : path.join(__dirname, '..', 'data', 'nginx-directives.json');
  const target = args[0];
  if (target && !fs.existsSync(target)) {
    console.error(`경로를 찾을 수 없습니다: ${target}`);
    process.exit(1);
  }
  if (!target) {
    console.error('사용법: npm run mutate -- <설정파일> [--data 지시어.json]');
    process.exit(1);
  }
  let isKnown = () => false;
  try {
    isKnown = createDirectiveDb(JSON.parse(fs.readFileSync(dataPath, 'utf8'))).isKnownDirective;
  } catch (e) {
    console.warn(`⚠ 지시어 데이터를 못 읽음(${e.message}) — 다음 줄 추정이 꺼진 상태로 측정됩니다.\n`);
  }

  const results = mutateAll(fs.readFileSync(target, 'utf8'), isKnown);
  const count = (s) => results.filter((r) => r.status === s).length;
  const bad = results.filter((r) => r.status !== 'detected');
  for (const r of bad) console.log(`  L${r.line}  ${r.status.padEnd(9)} | ${r.source}`);
  if (bad.length) console.log('');
  console.log(
    `변이 ${results.length}개 → detected ${count('detected')} / misplaced ${count('misplaced')} / other ${count('other')} / missed ${count('missed')}`,
  );
}

if (require.main === module) main(process.argv);

module.exports = { mutateAll };
