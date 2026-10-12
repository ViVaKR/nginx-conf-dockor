#!/usr/bin/env node
// gen-grammar.js
// -----------------------------------------------------------------------
// data/nginx-directives.json  →  syntaxes/nginx.tmLanguage.json
//
// 구문 강조용 지시어 목록을 손으로 옮겨 적지 않고 데이터에서 생성한다.
// (훈 확장에서 standard-mnemonics 정규식이 arm64-data.js 와 어긋났던 문제를
//  구조적으로 없애기 위함. 데이터를 갱신하면 이 스크립트만 다시 돌리면 끝.)
//
// 사용법:  npm run gen:grammar
//
// 색칠 원칙:
//   - "알려진 지시어"만 문장 시작 위치에서 색칠한다. 모르는 이름(오타 포함)은
//     색이 안 입혀져서 눈으로도 구분된다.
//   - 문장 시작 = 줄 시작, 또는 ; { } 바로 뒤.
//   - 블록 지시어(server, location …)와 일반 지시어는 서로 다른 scope.
// -----------------------------------------------------------------------
'use strict';

const fs = require('fs');
const path = require('path');

const byLengthDesc = (a, b) => b.length - a.length || a.localeCompare(b);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (names) => names.map(escapeRe).join('|');

const START = '(?:^|(?<=[;{}]))[ \\t]*';
const NAME_END = '(?![A-Za-z0-9_])';

function buildGrammar(json) {
  const all = [...new Set((json.directives || []).map((d) => d.name))].sort(byLengthDesc);
  const blocks = [...new Set((json.directives || []).filter((d) => d.block).map((d) => d.name))].sort(byLengthDesc);

  const repository = {
    comments: {
      name: 'comment.line.number-sign.nginx',
      match: '(?<=^|[\\s;{}])#.*$',
    },
    'string-double': stringRule('"', 'string.quoted.double.nginx'),
    'string-single': stringRule("'", 'string.quoted.single.nginx'),
    'lua-block': {
      begin: '(?:^|(?<=[;{}]))[ \\t]*(\\w*_by_lua_block)[ \\t]*(\\{)',
      beginCaptures: {
        1: { name: 'entity.name.function.block.nginx' },
        2: { name: 'punctuation.section.block.begin.nginx' },
      },
      end: '\\}',
      endCaptures: { 0: { name: 'punctuation.section.block.end.nginx' } },
      name: 'meta.embedded.block.lua',
      patterns: [{ include: '#lua-nested' }, { include: 'source.lua' }],
    },
    'lua-nested': {
      begin: '\\{',
      end: '\\}',
      patterns: [{ include: '#lua-nested' }, { include: 'source.lua' }],
    },
    variables: {
      patterns: [
        { name: 'variable.other.nginx', match: '\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}' },
        { name: 'variable.other.nginx', match: '\\$[A-Za-z_][A-Za-z0-9_]*' },
        { name: 'variable.other.capture.nginx', match: '\\$[0-9]+' },
      ],
    },
    operators: {
      name: 'keyword.operator.nginx',
      match: '(?<=^|[\\s(])(?:!~\\*|!~|~\\*|~|\\^~|!=|=|!?-[fdex])(?=\\s)',
    },
    constants: {
      name: 'constant.language.nginx',
      match: '(?<![\\w$./-])(?:on|off)(?![\\w./-])',
    },
    numbers: {
      name: 'constant.numeric.nginx',
      match: '(?<![\\w$./-])\\d+(?:\\.\\d+)?(?:ms|[smhdwMy]|[kKmMgG]|r/[sm])?(?![\\w./-])',
    },
    punctuation: {
      patterns: [
        { name: 'punctuation.section.block.begin.nginx', match: '\\{' },
        { name: 'punctuation.section.block.end.nginx', match: '\\}' },
        { name: 'punctuation.terminator.statement.nginx', match: ';' },
      ],
    },
  };

  const patterns = [
    { include: '#comments' },
    { include: '#string-double' },
    { include: '#string-single' },
    { include: '#lua-block' },
  ];

  // 목록이 비면 `()` 가 모든 곳에 매칭되므로 규칙 자체를 만들지 않는다.
  if (blocks.length) {
    repository['block-directives'] = {
      match: `${START}(${alt(blocks)})${NAME_END}`,
      captures: { 1: { name: 'keyword.control.block.nginx' } },
    };
    patterns.push({ include: '#block-directives' });
  }
  if (all.length) {
    repository.directives = {
      match: `${START}(${alt(all)})${NAME_END}`,
      captures: { 1: { name: 'keyword.other.directive.nginx' } },
    };
    patterns.push({ include: '#directives' });
  }
  patterns.push(
    { include: '#variables' },
    { include: '#operators' },
    { include: '#constants' },
    { include: '#numbers' },
    { include: '#punctuation' },
  );

  return {
    comment: '자동 생성 파일 — 직접 수정하지 마세요. `npm run gen:grammar` 로 재생성.',
    name: 'Nginx',
    scopeName: 'source.nginx',
    patterns,
    repository,
  };
}

function stringRule(quote, scope) {
  return {
    name: scope,
    begin: quote,
    end: quote,
    beginCaptures: { 0: { name: 'punctuation.definition.string.begin.nginx' } },
    endCaptures: { 0: { name: 'punctuation.definition.string.end.nginx' } },
    patterns: [{ name: 'constant.character.escape.nginx', match: '\\\\.' }, { include: '#variables' }],
  };
}

function main(argv) {
  const root = path.join(__dirname, '..');
  const input = argv[2] || path.join(root, 'data', 'nginx-directives.json');
  const output = argv[3] || path.join(root, 'syntaxes', 'nginx.tmLanguage.json');
  if (!fs.existsSync(input)) {
    console.error(`지시어 데이터가 없습니다: ${input}\n먼저 npm run gen:directives 를 실행하세요.`);
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(input, 'utf8'));
  const grammar = buildGrammar(json);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(grammar, null, 2) + '\n');
  const nAll = new Set(json.directives.map((d) => d.name)).size;
  const nBlock = new Set(json.directives.filter((d) => d.block).map((d) => d.name)).size;
  console.log(`지시어 이름 ${nAll}개 (블록 ${nBlock}개) → ${output}`);
}

if (require.main === module) main(process.argv);

module.exports = { buildGrammar };
