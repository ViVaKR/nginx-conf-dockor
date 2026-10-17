'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirectiveDb } = require('../../src/nginx/directive-db');
const C = require('../../src/nginx/completion');

const E = (name, family, contexts, { block = false, text = 'arg', def = null } = {}) => ({
  name, family, module: 'm', contexts, block, default: def,
  syntaxes: [{ text, block, line: `${name}${text ? ' ' + text : ''}${block ? ' { ... }' : ';'}` }],
  description: `${name} 설명`,
  docUrl: `https://nginx.org/#${name}`,
});

const db = createDirectiveDb({
  directives: [
    E('user', 'core', ['main']),
    E('events', 'core', ['main'], { block: true, text: '' }),
    E('worker_connections', 'core', ['events']),
    E('include', 'core', ['any']),
    E('http', 'http', ['main'], { block: true, text: '' }),
    E('stream', 'stream', ['main'], { block: true, text: '' }),
    E('server', 'http', ['http'], { block: true, text: '' }),
    E('server', 'stream', ['stream'], { block: true, text: '' }),
    E('upstream', 'http', ['http'], { block: true, text: 'name' }),
    E('location', 'http', ['server', 'location'], { block: true, text: 'uri' }),
    E('if', 'http', ['server', 'location'], { block: true, text: '(condition)' }),
    E('geo', 'http', ['http'], { block: true, text: 'address variable' }),
    E('listen', 'http', ['server'], { def: 'listen *:80 | *:8000;' }),
    E('listen', 'stream', ['server']),
    E('proxy_pass', 'http', ['location', 'if in location', 'limit_except']),
    E('return', 'http', ['server', 'location', 'if in server', 'if in location']),
    E('gzip', 'http', ['http', 'server', 'location', 'if in location']),
    E('internal', 'http', ['location'], { text: '' }),
    E('keepalive', 'http', ['upstream']),
    E('set', 'http', ['server', 'location', 'if']),
  ],
  variables: [
    { name: '$host', prefix: null, family: 'http', module: 'ngx_http_core_module', description: 'host name' },
    { name: '$arg_name', prefix: '$arg_', family: 'http', module: 'ngx_http_core_module', description: 'argument' },
    { name: '$protocol', prefix: null, family: 'stream', module: 'ngx_stream_core_module', description: 'protocol' },
  ],
});

// 'xx|yy' 처럼 | 로 커서 위치를 표시
function at(src) {
  const offset = src.indexOf('|');
  return { text: src.slice(0, offset) + src.slice(offset + 1), offset };
}
const ctxOf = (src, fileName = 'nginx.conf') => {
  const { text, offset } = at(src);
  return { text, offset, ctx: C.analyzeCompletionContext(text, offset, { fileName }) };
};
const names = (src, fileName) => C.directiveCandidates(db, ctxOf(src, fileName).ctx).map((g) => g.name);

test('최상위(nginx.conf): main 컨텍스트 지시어만', () => {
  const n = names('|');
  for (const x of ['user', 'http', 'events', 'stream', 'include']) assert.ok(n.includes(x), x);
  for (const x of ['listen', 'proxy_pass', 'server']) assert.ok(!n.includes(x), x);
});

test('http 안: server/upstream/gzip, main·server 전용은 제외', () => {
  const n = names('http {\n  |\n}\n');
  for (const x of ['server', 'upstream', 'gzip', 'include', 'geo']) assert.ok(n.includes(x), x);
  for (const x of ['user', 'listen', 'worker_connections', 'proxy_pass']) assert.ok(!n.includes(x), x);
});

test('server 안: listen 은 http 항목만, http 전용 블록은 제외', () => {
  const src = 'http {\n  server {\n    |\n  }\n}\n';
  const groups = C.directiveCandidates(db, ctxOf(src).ctx);
  const n = groups.map((g) => g.name);
  for (const x of ['listen', 'location', 'return', 'gzip', 'if', 'include']) assert.ok(n.includes(x), x);
  for (const x of ['http', 'upstream', 'proxy_pass']) assert.ok(!n.includes(x), x);
  const listen = groups.find((g) => g.name === 'listen');
  assert.deepEqual(listen.entries.map((e) => e.family), ['http']);
});

test('location 안', () => {
  const n = names('http {\n server {\n  location / {\n   |\n  }\n }\n}\n');
  for (const x of ['proxy_pass', 'return', 'gzip', 'internal']) assert.ok(n.includes(x), x);
  assert.ok(!n.includes('listen'));
});

test('if 안: "if in location" 컨텍스트', () => {
  const { ctx } = ctxOf('http {\n server {\n  location /x {\n   if ($a) {\n    |\n   }\n  }\n }\n}\n');
  assert.equal(ctx.contextKey, 'if in location');
  const n = C.directiveCandidates(db, ctx).map((g) => g.name);
  for (const x of ['return', 'proxy_pass', 'gzip']) assert.ok(n.includes(x), x);
  assert.ok(!n.includes('listen'));
});

test("문서가 'if' 로만 적은 지시어(set 등)도 if 블록 안에서 제안된다", () => {
  const n = names('http {\n server {\n  if ($a) {\n   |\n  }\n }\n}\n');
  assert.ok(n.includes('set'));
  assert.ok(n.includes('return')); // 'if in server' 표기
  assert.ok(!n.includes('listen'));
});

test('stream 안: family 가 stream 으로 바뀐다', () => {
  const groups = C.directiveCandidates(db, ctxOf('stream {\n  server {\n    |\n  }\n}\n').ctx);
  const listen = groups.find((g) => g.name === 'listen');
  assert.deepEqual(listen.entries.map((e) => e.family), ['stream']);
  assert.ok(!groups.some((g) => g.name === 'location'));
});

test('events 안', () => {
  const n = names('events {\n  |\n}\n');
  assert.ok(n.includes('worker_connections'));
  assert.ok(!n.includes('listen'));
});

test('조각 파일 최상위: 필터하지 않는다 / 내용에 http 블록이 있으면 main 으로 본다', () => {
  const frag = ctxOf('|', 'snippet.conf').ctx;
  assert.equal(frag.filtered, false);
  const n = C.directiveCandidates(db, frag).map((g) => g.name);
  assert.ok(n.includes('listen') && n.includes('proxy_pass'));
  const main = ctxOf('http {\n}\n|', 'foo.conf').ctx;
  assert.equal(main.filtered, true);
  assert.equal(main.contextKey, 'main');
});

test('주석 / 문자열 / 인자 / 토큰 중간에서는 지시어 자동완성 없음', () => {
  assert.equal(ctxOf('# lis|').ctx.reason, 'comment');
  assert.equal(ctxOf('return 200 "lis|";').ctx.reason, 'string');
  assert.equal(ctxOf('server {\n  listen 80 |\n}\n').ctx.reason, 'args');
  assert.equal(ctxOf('proxy_pass http://a-lis|').ctx.reason, 'mid-token');
});

test('; 바로 뒤나 줄 시작은 지시어 자리', () => {
  assert.equal(ctxOf('server {\n  listen 80; |\n}\n').ctx.mode, 'directive');
  assert.equal(ctxOf('server {\n  |\n}\n').ctx.mode, 'directive');
});

test('단어 범위: 입력 중인 단어 / 단어 중간에 커서가 있는 경우', () => {
  let r = ctxOf('server {\n  lis|\n}\n');
  assert.equal(r.text.slice(r.ctx.wordStart, r.ctx.wordEnd), 'lis');
  r = ctxOf('server {\n  lis|ten 80;\n}\n');
  assert.equal(r.text.slice(r.ctx.wordStart, r.ctx.wordEnd), 'listen');
  assert.equal(r.ctx.restHasContent, true);
});

test('map 같은 데이터 블록 / lua 본문 안에서는 없음', () => {
  assert.equal(ctxOf('map $a $b {\n  |\n}\n').ctx.reason, 'data-block');
  assert.equal(ctxOf('content_by_lua_block {\n  ng|\n}\n').ctx.reason, 'raw');
});

test('닫히지 않은 블록(입력 중)에서도 체인을 잡는다', () => {
  const { ctx } = ctxOf('http {\n  server {\n    |');
  assert.deepEqual(ctx.chain, ['http', 'server']);
  assert.equal(ctx.contextKey, 'server');
});

test('$변수: 후보와 family 필터', () => {
  const http = ctxOf('http {\n server {\n  location / {\n   proxy_set_header Host $ho|;\n  }\n }\n}\n').ctx;
  assert.equal(http.mode, 'variable');
  const hn = C.variableCandidates(db, http).map((v) => v.name);
  assert.deepEqual(hn, ['$arg_name', '$host']);

  const stream = ctxOf('stream {\n server {\n  return "$pr|";\n }\n}\n').ctx;
  assert.equal(stream.mode, 'variable'); // 문자열 안에서도 변수는 허용
  assert.deepEqual(C.variableCandidates(db, stream).map((v) => v.name), ['$protocol']);
});

test('$변수 삽입: 일반 / 접두어 변수 / ${ } 안', () => {
  const host = db.variables[0];
  const arg = db.variables[1];
  const plain = ctxOf('return 200 "$ho|";\n').ctx;
  assert.deepEqual(C.variableInsert(host, plain), { text: '$host', snippet: false });
  assert.deepEqual(C.variableInsert(arg, plain), { text: '$arg_${1:name}$0', snippet: true });

  const open = ctxOf('return 200 "${ho|";\n').ctx;
  assert.equal(open.braced, true);
  assert.equal(open.closed, false);
  assert.deepEqual(C.variableInsert(host, open), { text: 'host}', snippet: false });
  const closed = ctxOf('return 200 "${ho|}";\n').ctx;
  assert.equal(closed.closed, true);
  assert.deepEqual(C.variableInsert(host, closed), { text: 'host', snippet: false });
});

const group = (name) => ({ name, entries: db.get(name) });

test('삽입 텍스트: 일반 지시어 / 인자 없는 지시어 / 블록 / 특수 블록', () => {
  const ctx = { restHasContent: false };
  assert.deepEqual(C.buildInsert(group('listen'), ctx), { text: 'listen ${1};$0', snippet: true });
  assert.deepEqual(C.buildInsert(group('internal'), ctx), { text: 'internal;$0', snippet: true });
  assert.deepEqual(C.buildInsert(group('server'), ctx), { text: 'server {\n\t$0\n}', snippet: true });
  assert.deepEqual(C.buildInsert(group('location'), ctx), { text: 'location ${1:/} {\n\t$0\n}', snippet: true });
  assert.deepEqual(C.buildInsert(group('geo'), ctx), { text: 'geo ${1:args} {\n\t$0\n}', snippet: true });
});

test('같은 줄 뒤에 내용이 있으면 이름만 삽입 (세미콜론 중복 방지)', () => {
  assert.deepEqual(C.buildInsert(group('listen'), { restHasContent: true }), { text: 'listen', snippet: false });
});

test('문서/상세', () => {
  const doc = C.renderDoc(group('listen'));
  assert.match(doc, /listen arg;/);
  assert.match(doc, /\*\*기본값:\*\* `listen \*:80 \| \*:8000;`/);
  assert.match(doc, /\*\*컨텍스트:\*\* `server`/);
  assert.match(doc, /\[공식 문서\]\(https:\/\/nginx\.org\/#listen\)/);
  assert.match(C.renderDoc(group('listen')), /_\(http\)_/); // 여러 family 면 표시
  assert.equal(C.detailOf(group('return')), 'server, location, if in server, if in location');
});

test('문서 마크다운이 올바르게 닫힌다 (여러 family 항목이어도 코드 펜스가 깨지지 않음)', () => {
  const md = C.renderDoc(group('listen')); // http / stream 두 항목
  const fenceLines = md.split('\n').filter((l) => l.trimStart().startsWith('```'));
  assert.equal(fenceLines.length % 2, 0, '여는/닫는 펜스 개수가 짝이 맞아야 한다');
  // 닫는 펜스 줄에는 펜스 말고 다른 글자가 없어야 한다
  fenceLines.filter((_, i) => i % 2 === 1).forEach((l) => assert.equal(l.trim(), '```'));
  assert.match(md, /^_\(http\)_$/m); // family 표시는 자기 줄에
});
