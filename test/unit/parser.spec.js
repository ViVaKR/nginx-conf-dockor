'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../../src/nginx/parser');

const KNOWN = new Set([
  'http', 'server', 'location', 'listen', 'server_name', 'return', 'root', 'index',
  'proxy_pass', 'include', 'rewrite', 'break', 'set', 'add_header', 'internal',
  'log_format', 'access_log', 'gzip', 'map',
]);
const opts = { isKnownDirective: (n) => KNOWN.has(n) };
const run = (src) => parse(src, opts);
const codes = (r) => r.diagnostics.map((d) => d.code);
const slice = (src, d) => src.slice(d.start, d.end);

test('정상 설정은 진단 0건', () => {
  const src = `http {
  server {
    listen 80;
    # 주석
    location / {
      return 200 "ok";
    }
  }
}
`;
  const r = run(src);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.root.children[0].name, 'http');
  assert.equal(r.root.children[0].block.children[0].block.children.length, 2);
});

test('세미콜론 누락: 다음 줄이 같은 들여쓰기의 알려진 지시어', () => {
  const src = `server {
  listen 80
  server_name example.com;
}
`;
  const r = run(src);
  assert.deepEqual(codes(r), ['missing-semicolon']);
  assert.equal(slice(src, r.diagnostics[0]), '80');
  const kids = r.root.children[0].block.children;
  assert.deepEqual(kids.map((k) => k.name), ['listen', 'server_name']);
  assert.equal(kids[0].semi, null);
});

test('세미콜론 누락: 인자 없는 지시어 뒤 줄바꿈', () => {
  const src = `location / {
  internal
  return 404;
}
`;
  const r = run(src);
  assert.deepEqual(codes(r), ['missing-semicolon']);
  assert.equal(slice(src, r.diagnostics[0]), 'internal');
});

test('세미콜론 누락: } 바로 앞', () => {
  const src = 'location / {\n  return 200 ok\n}\n';
  const r = run(src);
  assert.deepEqual(codes(r), ['missing-semicolon']);
  assert.equal(slice(src, r.diagnostics[0]), 'ok');
  assert.equal(r.root.children[0].block.close.value, '}');
});

test('세미콜론 누락: 파일 끝', () => {
  const src = 'listen 80';
  const r = run(src);
  assert.deepEqual(codes(r), ['missing-semicolon']);
  assert.equal(slice(src, r.diagnostics[0]), '80');
});

test('세미콜론 누락: 사이에 주석이 있어도 감지', () => {
  const src = 'server {\n  listen 80 # 포트\n  server_name x;\n}\n';
  assert.deepEqual(codes(run(src)), ['missing-semicolon']);
});

test('더 깊게 들여쓴 이어지는 인자는 오탐하지 않음 (break 는 지시어 이름이기도 함)', () => {
  const src = `location / {
  rewrite ^/a /b
      break;
}
`;
  assert.deepEqual(run(src).diagnostics, []);
});

test('여러 줄 따옴표 인자는 정상', () => {
  const src = `log_format main '$a'
                '$b';
`;
  assert.deepEqual(run(src).diagnostics, []);
});

test('Allman 스타일 중괄호 허용', () => {
  const src = 'server\n{\n  listen 80;\n}\n';
  assert.deepEqual(run(src).diagnostics, []);
});

test('짝 없는 } ', () => {
  const src = 'server { }\n}\n';
  const r = run(src);
  assert.deepEqual(codes(r), ['unexpected-close-brace']);
  assert.equal(r.diagnostics[0].start, src.lastIndexOf('}'));
});

test('안 닫힌 { 는 여는 중괄호 위치에 표시', () => {
  const src = 'http {\n  server {\n    listen 80;\n  }\n';
  const r = run(src);
  assert.deepEqual(codes(r), ['unclosed-block']);
  assert.equal(r.diagnostics[0].start, src.indexOf('{'));
});

test('홀로 있는 ; 와 이름 없는 {', () => {
  assert.deepEqual(codes(run('listen 80;;\n')), ['unexpected-semicolon']);
  assert.deepEqual(codes(run('{ listen 80; }\n')), ['unexpected-open-brace']);
});

test('map 같은 데이터 블록 안은 지시어 추정 안 함', () => {
  const src = `map $a $b {
  default 0;
  include maps.conf;
  hostnames;
}
`;
  const r = run(src);
  assert.deepEqual(r.diagnostics, []);
  assert.equal(r.root.children[0].block.dataBlock, true);
});

test('lua_block 본문은 통째로 건너뜀', () => {
  const src = `location /x {
  content_by_lua_block {
    local t = {1, 2}
    ngx.say("}")
  }
}
`;
  const r = run(src);
  assert.deepEqual(r.diagnostics, []);
  const lua = r.root.children[0].block.children[0];
  assert.equal(lua.name, 'content_by_lua_block');
  assert.ok(lua.block.raw);
});

test('토크나이저 오류가 진단으로 전달됨', () => {
  const r = run('add_header X "oops;\nlisten 80;\n');
  assert.ok(codes(r).includes('unterminated-string'));
});

test('데이터 없이도(지시어 추정 끔) 구조 진단은 동작', () => {
  const r = parse('server {\n  listen 80\n}\n'); // isKnownDirective 없음
  assert.deepEqual(codes(r), ['missing-semicolon']); // } 앞 누락은 데이터와 무관
});

test('진단은 위치순으로 정렬', () => {
  const r = run('a {\n  listen 80\n  server_name x\n}\n}\n');
  const starts = r.diagnostics.map((d) => d.start);
  assert.deepEqual(starts, [...starts].sort((x, y) => x - y));
  assert.equal(r.diagnostics.length, 3);
});
