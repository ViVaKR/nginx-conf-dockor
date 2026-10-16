'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirectiveDb } = require('../../src/nginx/directive-db');
const { hoverAt } = require('../../src/nginx/hover');

const E = (name, family, contexts, { block = false, text = 'arg', def = null } = {}) => ({
  name, family, module: `ngx_${family}_core_module`, contexts, block, default: def,
  syntaxes: [{ text, block, line: `${name}${text ? ' ' + text : ''}${block ? ' { ... }' : ';'}` }],
  description: `${name} 설명`,
  docUrl: `https://nginx.org/#${name}`,
});
const db = createDirectiveDb({
  directives: [
    E('http', 'http', ['main'], { block: true, text: '' }),
    E('stream', 'stream', ['main'], { block: true, text: '' }),
    E('server', 'http', ['http'], { block: true, text: '' }),
    E('server', 'stream', ['stream'], { block: true, text: '' }),
    E('map', 'http', ['http'], { block: true, text: 'string $variable' }),
    E('listen', 'http', ['server'], { def: 'listen *:80 | *:8000;' }),
    E('listen', 'stream', ['server']),
    E('listen', 'mail', ['server']),
    E('set', 'http', ['server', 'location', 'if']),
  ],
  variables: [
    { name: '$host', prefix: null, family: 'http', module: 'Module ngx_http_core_module', description: '요청 호스트' },
    { name: '$http_name', prefix: '$http_', family: 'http', module: 'ngx_http_core_module', description: '요청 헤더 필드' },
    { name: '$protocol', prefix: null, family: 'stream', module: 'ngx_stream_core_module', description: '프로토콜' },
  ],
});

// 'xx|yy' 처럼 | 로 마우스 위치 표시
const hover = (src) => {
  const offset = src.indexOf('|');
  const text = src.slice(0, offset) + src.slice(offset + 1);
  const r = hoverAt(db, text, offset);
  return r && { ...r, word: text.slice(r.start, r.end) };
};

test('지시어 이름 위: 문법/기본값/컨텍스트/링크, 현재 family 항목만', () => {
  const r = hover('http {\n  server {\n    lis|ten 80;\n  }\n}\n');
  assert.equal(r.word, 'listen');
  assert.match(r.markdown, /listen arg;/);
  assert.match(r.markdown, /\*\*기본값:\*\*/);
  assert.match(r.markdown, /\[공식 문서\]\(https:\/\/nginx\.org\/#listen\)/);
  assert.ok(!r.markdown.includes('_(stream)_')); // http 안이므로 stream/mail 항목은 숨김
});

test('stream 안에서는 stream 항목', () => {
  const r = hover('stream {\n  server {\n    lis|ten 80;\n  }\n}\n');
  assert.ok(r.markdown.includes('ngx_stream') === false); // 모듈명은 본문에 안 쓰지만
  assert.match(r.markdown, /listen arg;/);
  assert.ok(!r.markdown.includes('기본값')); // stream 항목은 기본값 없음 → http 항목과 구별됨
});

test('조각 파일 최상위: 모든 family 항목을 보여준다', () => {
  const r = hover('lis|ten 80;\n');
  assert.ok(r.markdown.includes('_(http)_') && r.markdown.includes('_(stream)_') && r.markdown.includes('_(mail)_'));
});

test("문서가 'if' 로만 적은 지시어도 if 블록 안에서 정확히 매칭", () => {
  const r = hover('http {\n server {\n  if ($a) {\n   s|et $x 1;\n  }\n }\n}\n');
  assert.equal(r.word, 'set');
  assert.match(r.markdown, /`if`/);
});

test('인자 / 주석 / 알 수 없는 지시어 / 데이터 블록 행 / 지시어 이름이 아닌 단어는 hover 없음', () => {
  assert.equal(hover('listen 8|0;\n'), null);
  assert.equal(hover('# lis|ten 설명\n'), null);
  assert.equal(hover('lis|en 80;\n'), null);
  assert.equal(hover('map $a $b {\n  def|ault 0;\n}\n'), null);
  assert.equal(hover('listen 80 de|fault_server;\n'), null);
});

test('$변수: 단어 / 문자열 안 / ${ } 형태', () => {
  let r = hover('set $x $ho|st;\n');
  assert.equal(r.word, '$host');
  assert.match(r.markdown, /요청 호스트/);
  r = hover('return 200 "$ho|st";\n');
  assert.equal(r.word, '$host');
  r = hover('return 200 "${ho|st}";\n');
  assert.equal(r.word, '${host}');
  assert.match(r.markdown, /\*\*\$host\*\*/);
});

test('접두어 변수($http_xxx)와 family 필터', () => {
  const r = hover('http {\n server {\n  return 200 "$http_or|igin";\n }\n}\n');
  assert.equal(r.word, '$http_origin');
  assert.match(r.markdown, /접두어 변수: `\$http_name`/);
  // stream 컨텍스트에서는 http 변수($host)가 아니므로 hover 없음
  assert.equal(hover('stream {\n server {\n  return "$ho|st";\n }\n}\n'), null);
});

test('모르는 변수는 hover 없음', () => {
  assert.equal(hover('set $a $nothin|g;\n'), null);
});

test("모듈명은 'Module ' 접두어 없이 표시", () => {
  const r = hover('set $x $ho|st;\n');
  assert.match(r.markdown, /모듈: `ngx_http_core_module`/);
  assert.ok(!r.markdown.includes('Module ngx'));
});
