#!/usr/bin/env node
// check-conf.js
// -----------------------------------------------------------------------
// F5 없이 터미널에서 실제 nginx 설정 파일들을 파서로 검사한다.
//   npm run check -- /opt/homebrew/etc/nginx
//   npm run check -- ./nginx.conf
//   npm run check -- ./dir --all          (확장자 상관없이 모든 파일)
//   npm run check -- ./dir --data other.json
//
// 출력: 파일별 진단(줄:열, 코드, 해당 줄 원문) + 요약 + "모르는 지시어 이름" 상위 목록.
// 모르는 지시어 목록은 (1) 데이터에 빠진 이름 (2) 서드파티 모듈 지시어 (3) 오타 를
// 가려내는 용도이고, 0.5 단계(알 수 없는 지시어 경고) 설계의 재료가 된다.
// -----------------------------------------------------------------------
'use strict';

const fs = require('fs');
const path = require('path');
const { parse } = require('../src/nginx/parser');
const { createDirectiveDb } = require('../src/nginx/directive-db');
const { lintContexts } = require('../src/nginx/lint');
const { isMainFile } = require('../src/nginx/completion');

const CONF_RE = /\.(conf|nginx|types)$|^(fastcgi|scgi|uwsgi)_params$|^fastcgi\.conf$/;

function collectFiles(target, all, out = []) {
  const st = fs.statSync(target);
  if (st.isFile()) {
    out.push(target);
  } else if (st.isDirectory()) {
    for (const name of fs.readdirSync(target).sort()) {
      if (name === 'node_modules' || name.startsWith('.git')) continue;
      const full = path.join(target, name);
      let s;
      try {
        s = fs.statSync(full); // 심볼릭 링크(sites-enabled)도 따라감
      } catch {
        continue; // 깨진 링크
      }
      if (s.isDirectory()) collectFiles(full, all, out);
      else if (all || CONF_RE.test(name)) out.push(full);
    }
  }
  return out;
}

/** @returns {{ diagnostics: Array, unknown: Map<string, number> }} */
function scanText(text, isKnownDirective, db = null, fileName = '') {
  const r = parse(text, { isKnownDirective });
  const lines = text.split(/\r\n|\n/);
  const all = db ? r.diagnostics.concat(lintContexts(r.root, { db, isMain: isMainFile(r.root, fileName) })) : r.diagnostics;
  all.sort((a, b) => a.start - b.start);
  const diagnostics = all.map((d) => {
    const pos = r.positionAt(d.start);
    return {
      code: d.code,
      message: d.message,
      line: pos.line + 1,
      col: pos.character + 1,
      source: (lines[pos.line] || '').trim().slice(0, 100),
    };
  });

  const unknown = new Map();
  const visit = (children) => {
    for (const d of children) {
      if (d.name && !isKnownDirective(d.name)) unknown.set(d.name, (unknown.get(d.name) || 0) + 1);
      if (d.block && !d.block.dataBlock && !d.block.raw) visit(d.block.children);
    }
  };
  visit(r.root.children);
  return { diagnostics, unknown };
}

function main(argv) {
  const args = argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args.splice(i, flag === '--all' ? 1 : 2)[1] : undefined;
  };
  const all = args.includes('--all');
  if (all) args.splice(args.indexOf('--all'), 1);
  const dataPath = take('--data') || path.join(__dirname, '..', 'data', 'nginx-directives.json');
  const target = args[0];

  if (target && !fs.existsSync(target)) {
    console.error(`경로를 찾을 수 없습니다: ${target}`);
    process.exit(1);
  }
  if (!target) {
    console.error('사용법: npm run check -- <파일 또는 폴더> [--all] [--data 지시어.json]');
    process.exit(1);
  }

  let isKnown = () => false;
  let db = null;
  try {
    db = createDirectiveDb(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
    isKnown = db.isKnownDirective;
  } catch (e) {
    console.warn(`⚠ 지시어 데이터를 못 읽음(${e.message}) — 다음 줄 추정/모르는 지시어 목록이 비활성화됩니다.\n`);
  }

  const files = collectFiles(target, all);
  const byCode = {};
  const unknownTotal = new Map();
  let filesWithIssues = 0;
  let total = 0;

  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const { diagnostics, unknown } = scanText(text, isKnown, db, file);
    for (const [k, v] of unknown) unknownTotal.set(k, (unknownTotal.get(k) || 0) + v);
    if (diagnostics.length === 0) continue;
    filesWithIssues++;
    console.log(file);
    for (const d of diagnostics) {
      total++;
      byCode[d.code] = (byCode[d.code] || 0) + 1;
      console.log(`  L${d.line}:${d.col}  ${d.code}  | ${d.source}`);
    }
    console.log('');
  }

  console.log(`검사 파일 ${files.length}개 / 진단이 있는 파일 ${filesWithIssues}개 / 진단 ${total}건`);
  if (total) console.log('코드별:', byCode);
  if (unknownTotal.size) {
    const top = [...unknownTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    console.log('\n데이터에 없는 지시어 이름 (상위 30):');
    console.log('  ' + top.map(([k, v]) => `${k}(${v})`).join('  '));
  }
}

if (require.main === module) main(process.argv);

module.exports = { scanText, collectFiles };
