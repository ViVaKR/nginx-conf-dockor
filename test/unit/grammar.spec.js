'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFixtureDocs } = require('./fixture-docs');
const { generate } = require('../../scripts/gen-directives');
const { buildGrammar } = require('../../scripts/gen-grammar');

const grammar = buildGrammar(generate(makeFixtureDocs()).result);
const repo = grammar.repository;

// 규칙의 match 정규식을 JS 로 돌려 캡처/매칭 결과를 본다 (TextMate 의 Oniguruma 와
// 이 파일에서 쓰는 문법 범위에서는 동일하게 동작).
const all = (rule, text) => [...text.matchAll(new RegExp(rule.match, 'gm'))].map((m) => m[1] ?? m[0]);

test('최상위 구조', () => {
  assert.equal(grammar.scopeName, 'source.nginx');
  assert.ok(Array.isArray(grammar.patterns) && grammar.patterns.length > 5);
  // 모든 include 가 repository 에 존재 (source.lua 같은 외부 문법은 제외)
  const refs = JSON.stringify(grammar).match(/"include":"#[^"]+"/g).map((s) => s.slice(12, -1));
  for (const r of refs) assert.ok(repo[r], `repository 에 ${r} 없음`);
});

test('모든 정규식이 유효하다', () => {
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      for (const k of ['match', 'begin', 'end']) if (typeof o[k] === 'string') new RegExp(o[k], 'm');
      Object.values(o).forEach(walk);
    }
  };
  walk(grammar);
});

test('지시어: 문장 시작에서만 색칠 (줄 시작, ; { } 뒤)', () => {
  assert.deepEqual(all(repo.directives, '  listen 80;'), ['listen']);
  // directives 규칙은 블록 지시어 이름도 포함한다. 실제 문법에서는 block-directives 가
  // patterns 에서 먼저 나열돼 있어 같은 위치에서는 그쪽(블록 색)이 이긴다.
  assert.deepEqual(all(repo.directives, 'location / { return 200; }'), ['location', 'return']);
  assert.deepEqual(all(repo.directives, 'x; listen 80; return 1;'), ['listen', 'return']);
  // 인자 자리의 같은 단어는 색칠하지 않는다
  assert.deepEqual(all(repo.directives, 'proxy_pass listen;'), []);
  // 접두어가 같은 더 긴 이름의 일부로 매칭되지 않는다
  assert.deepEqual(all(repo.directives, 'listen_foo 1;'), []);
});

test('블록 지시어 규칙이 일반 지시어 규칙보다 먼저 시도된다', () => {
  const order = grammar.patterns.map((p) => p.include);
  assert.ok(order.indexOf('#block-directives') < order.indexOf('#directives'));
});

test('블록 지시어는 별도 규칙', () => {
  assert.deepEqual(all(repo['block-directives'], 'location / {'), ['location']);
  assert.deepEqual(all(repo['block-directives'], 'listen 80;'), []);
});

test('모르는 이름은 색칠하지 않는다 (오타 가시화)', () => {
  assert.deepEqual(all(repo.directives, '  lisen 80;'), []);
});

test('변수', () => {
  const texts = (text) => repo.variables.patterns.flatMap((p) => all(p, text));
  assert.deepEqual(texts('proxy_set_header Host $host;'), ['$host']);
  assert.deepEqual(texts('x ${upstream_name} y'), ['${upstream_name}']);
  assert.deepEqual(texts('rewrite ^/(.*) /$1;').includes('$1'), true);
});

test('숫자: 단위 포함, IP 는 제외', () => {
  assert.deepEqual(all(repo.numbers, 'listen *:8000;'), ['8000']);
  assert.deepEqual(all(repo.numbers, 'expires 30s; client_max_body_size 10m;'), ['30s', '10m']);
  assert.deepEqual(all(repo.numbers, 'allow 192.168.0.1;'), []);
});

test('연산자: 공백으로 둘러싸인 경우만', () => {
  assert.deepEqual(all(repo.operators, 'location ~* \\.php$ {'), ['~*']);
  assert.deepEqual(all(repo.operators, 'location = /x {'), ['=']);
  assert.deepEqual(all(repo.operators, 'if (-f $request_filename) {'), ['-f']);
  assert.deepEqual(all(repo.operators, 'resolver x valid=300s;'), []);
});

test('on/off 상수', () => {
  assert.deepEqual(all(repo.constants, 'gzip on; sendfile off;'), ['on', 'off']);
  assert.deepEqual(all(repo.constants, 'proxy_pass http://on.example.com;'), []);
});

test('주석은 토큰 시작에서만', () => {
  assert.deepEqual(all(repo.comments, 'listen 80; # 설명'), ['# 설명']);
  assert.deepEqual(all(repo.comments, 'set $a b#c;'), []);
});

test('빈 데이터에서도 안전 (빈 alternation 규칙이 생기지 않음)', () => {
  const g = buildGrammar({ directives: [] });
  assert.equal(g.repository.directives, undefined);
  assert.equal(g.repository['block-directives'], undefined);
});
