'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../../src/nginx/parser');
const { lintUnknownDirectives, suggest, editDistance } = require('../../src/nginx/lint');

const NAMES = ['server', 'listen', 'server_name', 'location', 'return', 'proxy_pass', 'proxy_set_header', 'map', 'if', 'index', 'include'];
const known = new Set(NAMES);
const isKnownDirective = (n) => known.has(n);
const lint = (src, extra) => lintUnknownDirectives(parse(src, { isKnownDirective }).root, { isKnownDirective, names: NAMES, extra });
const slice = (src, d) => src.slice(d.start, d.end);

test('편집 거리: 전치는 1', () => {
  assert.equal(editDistance('lisetn', 'listen', 2), 1);
  assert.equal(editDistance('lisen', 'listen', 2), 1);
  assert.equal(editDistance('abc', 'xyz', 2) > 2, true);
});

test('오타 → 후보 (listen)', () => {
  const src = 'server {\n  lisen 8080;\n}\n';
  const r = lint(src);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, 'unknown-directive');
  assert.equal(slice(src, r[0]), 'lisen');
  assert.deepEqual(r[0].suggestions, ['listen']);
  assert.match(r[0].message, /'listen'/);
});

test('전치 오타 / 글자 누락 / 대소문자', () => {
  assert.deepEqual(suggest('lisetn', NAMES), ['listen']);
  assert.deepEqual(suggest('proxy_pas', NAMES), ['proxy_pass']);
  assert.deepEqual(suggest('Listen', NAMES), ['listen']);
});

test('가까운 후보가 없으면 설정 안내 문구', () => {
  const r = lint('zzzzqq 1;\n');
  assert.deepEqual(r[0].suggestions, []);
  assert.match(r[0].message, /extraDirectives/);
});

test('extraDirectives 로 허용하면 경고 없음', () => {
  assert.equal(lint('more_set_headers "X: y";\n', new Set(['more_set_headers'])).length, 0);
  assert.equal(lint('more_set_headers "X: y";\n').length, 1);
});

test('OpenResty(lua_*, *_by_lua*)는 기본 허용', () => {
  const src = `lua_package_path "/x/?.lua";
location /a {
  content_by_lua_block { ngx.say("hi") }
  access_by_lua_file /x/a.lua;
}
`;
  assert.equal(lint(src).length, 0);
});

test('데이터 블록 안쪽은 검사하지 않음, 일반 블록 안쪽은 검사', () => {
  assert.equal(lint('map $a $b { weird_key 1; }\n').length, 0);
  const r = lint('location / {\n  if ($x) { lisen 1; }\n}\n');
  assert.equal(r.length, 1);
});

test('알려진 지시어는 경고 없음 / 이름 없는 블록은 건너뜀', () => {
  assert.equal(lint('server { listen 80; server_name x; }\n').length, 0);
  assert.doesNotThrow(() => lint('{ listen 80; }\n'));
});

test('최소 거리가 같은 후보만, 최대 3개', () => {
  const s = suggest('serve', NAMES);
  assert.deepEqual(s, ['server']);
  assert.ok(suggest('inde', ['index', 'indey', 'indez', 'indew', 'indev']).length <= 3);
});
