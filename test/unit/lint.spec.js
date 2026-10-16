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

// ---------------------------------------------------------------------------
// 컨텍스트 오류 (directive-not-allowed)
// ---------------------------------------------------------------------------
const { lintContexts } = require('../../src/nginx/lint');
const { createDirectiveDb } = require('../../src/nginx/directive-db');

const D = (name, family, contexts, block = false) => ({ name, family, contexts, block, syntaxes: [{ text: '', block, line: name }] });
const ctxDb = createDirectiveDb({
  directives: [
    D('http', 'http', ['main'], true),
    D('stream', 'stream', ['main'], true),
    D('events', 'core', ['main'], true),
    D('worker_processes', 'core', ['main']),
    D('worker_connections', 'core', ['events']),
    D('include', 'core', ['any']),
    D('server', 'http', ['http'], true),
    D('server', 'stream', ['stream'], true),
    D('upstream', 'http', ['http'], true),
    D('location', 'http', ['server', 'location'], true),
    D('if', 'http', ['server', 'location'], true),
    D('limit_except', 'http', ['location'], true),
    D('listen', 'http', ['server']),
    D('listen', 'stream', ['server']),
    D('proxy_pass', 'http', ['location', 'if in location', 'limit_except']),
    D('proxy_pass', 'stream', ['server']),
    D('return', 'http', ['server', 'location', 'if']),
    D('gzip', 'http', ['http', 'server', 'location', 'if in location']),
    D('deny', 'http', ['http', 'server', 'location', 'limit_except']),
    D('keepalive', 'http', ['upstream']),
    D('map', 'http', ['http'], true),
  ],
});
const ctxLint = (src, isMain = true) =>
  lintContexts(parse(src, { isKnownDirective: ctxDb.isKnownDirective }).root, { db: ctxDb, isMain });
const msgNames = (src, isMain) => ctxLint(src, isMain).map((d) => src.slice(d.start, d.end));

test('컨텍스트: 올바른 설정은 경고 0건', () => {
  const src = `worker_processes 1;
events { worker_connections 1024; }
http {
  gzip on;
  upstream app { keepalive 8; }
  server {
    listen 80;
    include x.conf;
    location / {
      proxy_pass http://app;
      if ($a) { return 403; }
      limit_except GET { deny all; }
    }
  }
}
`;
  assert.deepEqual(ctxLint(src), []);
});

test('컨텍스트: server 안의 proxy_pass / location 안의 listen', () => {
  const src = 'http {\n  server {\n    proxy_pass http://a;\n    location / { listen 80; }\n  }\n}\n';
  const r = ctxLint(src);
  assert.deepEqual(msgNames(src), ['proxy_pass', 'listen']);
  assert.equal(r[0].code, 'directive-not-allowed');
  assert.match(r[0].message, /'server' 안에서 사용할 수 없습니다.*location/);
});

test('컨텍스트: stream 의 proxy_pass 는 server 안에서 허용 (family 구분)', () => {
  assert.deepEqual(ctxLint('stream {\n  server { listen 1; proxy_pass b; }\n}\n'), []);
  // stream 안에서 http 전용 지시어
  const src = 'stream {\n  server { gzip on; }\n}\n';
  assert.deepEqual(msgNames(src), ['gzip']);
  assert.match(ctxLint(src)[0].message, /stream 영역에서 쓸 수 없는 지시어.*http 전용/);
});

test('컨텍스트: 조각 파일은 family 를 모르므로 어느 family 든 허용되면 통과', () => {
  // stream 에 include 될 조각의 server { proxy_pass } — http 기준이면 오류지만 stream 이면 정상
  assert.deepEqual(ctxLint('server {\n  proxy_pass b;\n}\n', false), []);
});

test('컨텍스트: 조각 파일의 최상위 지시어는 검사하지 않고, 메인 파일은 검사한다', () => {
  assert.deepEqual(ctxLint('listen 80;\n', false), []);
  assert.deepEqual(msgNames('listen 80;\nworker_processes 1;\n', true), ['listen']);
});

test("컨텍스트: if 블록 — 'if' 표기와 'if in location' 표기 모두 인정", () => {
  assert.deepEqual(ctxLint('http { server { if ($a) { return 403; } } }\n'), []); // 'if'
  assert.deepEqual(ctxLint('http { server { location / { if ($a) { gzip on; proxy_pass x; } } } }\n'), []); // 'if in location'
  // server 안의 if 에서 proxy_pass 는 불가
  assert.deepEqual(msgNames('http { server { if ($a) { proxy_pass x; } } }\n'), ['proxy_pass']);
});

test('컨텍스트: any(include) 는 어디서든 허용', () => {
  assert.deepEqual(ctxLint('http { server { location / { include a.conf; } } }\ninclude b.conf;\n'), []);
});

test('컨텍스트: 알 수 없는 지시어 / 서드파티 블록 / 데이터 블록 / lua 본문은 건드리지 않음', () => {
  assert.deepEqual(ctxLint('http { server { mystery 1; } }\n'), []);
  assert.deepEqual(ctxLint('http { server { acme_like_block { listen 80; proxy_pass x; } } }\n'), []);
  assert.deepEqual(ctxLint('http { map $a $b { listen 1; } }\n'), []);
  assert.deepEqual(ctxLint('http { server { content_by_lua_block { listen = 1 } } }\n'), []);
});

test('컨텍스트: keepalive 는 upstream 에서만', () => {
  assert.deepEqual(msgNames('http { server { keepalive 8; } }\n'), ['keepalive']);
});

test('컨텍스트: 이름이 같은 server 는 http/stream 어느 쪽 컨텍스트든 맞으면 통과', () => {
  assert.deepEqual(ctxLint('http { server { } }\nstream { server { } }\n'), []);
});
