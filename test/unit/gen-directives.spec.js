'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFixtureDocs } = require('./fixture-docs');
const { generate, stripTags } = require('../../scripts/gen-directives');

const { result, warnings } = generate(makeFixtureDocs());
const find = (name, family) => result.directives.find((d) => d.name === name && d.family === family);

test('모듈 두 개를 읽고 경고가 없다', () => {
  assert.equal(result.modules.length, 2);
  assert.deepEqual(warnings, []);
});

test('family: 루트 파일은 core, http/ 아래는 http', () => {
  assert.equal(find('daemon', 'core').module, 'Core functionality');
  assert.ok(find('listen', 'http'));
});

test('block="yes" 자기닫힘 syntax → block: true', () => {
  const ev = find('events', 'core');
  assert.equal(ev.block, true);
  assert.equal(ev.syntaxes[0].line, 'events { ... }');
  assert.equal(ev.default, null);
});

test('syntax 여러 개 + 세미콜론 정리', () => {
  const l = find('listen', 'http');
  assert.equal(l.syntaxes.length, 2);
  assert.equal(l.syntaxes[0].line, 'listen address[:port] [default_server];');
  assert.equal(l.block, false);
});

test('block 속성 + 인자가 같이 있는 syntax', () => {
  const loc = find('location', 'http');
  assert.equal(loc.syntaxes[0].line, 'location [ = | ~ ] uri { ... }');
  assert.deepEqual(loc.contexts, ['server', 'location']);
});

test('context 의 "if in location" 같은 값 보존', () => {
  assert.deepEqual(find('return', 'http').contexts, ['server', 'location', 'if in server', 'if in location']);
});

test('설명: 첫 문단만, literal 은 백틱, 엔티티 디코딩', () => {
  assert.equal(find('listen', 'http').description, 'Sets the `address` and `port` & more; use <value>.');
});

test('docUrl', () => {
  assert.equal(find('listen', 'http').docUrl, 'https://nginx.org/en/docs/http/ngx_http_sample_module.html#listen');
});

test('내장 변수 추출 + 접두어 패턴 변수', () => {
  const host = result.variables.find((v) => v.name === '$host');
  assert.ok(host && host.prefix === null);
  const arg = result.variables.find((v) => v.name === '$arg_name');
  assert.equal(arg.prefix, '$arg_');
});

test('자기닫힘 <link/> 는 문서/지시어 이름으로 대체 (빈 따옴표 방지)', () => {
  assert.equal(stripTags('in the “<link doc="../server_names.xml"/>” document'), 'in the “server_names” document');
  assert.equal(stripTags('see <link id="listen"/>.', { backticks: true }), 'see `listen`.');
  assert.equal(stripTags('a <link id="x">text</link> b'), 'a text b'); // 내용 있는 링크는 그대로
});
