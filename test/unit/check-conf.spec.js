'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanText } = require('../../scripts/check-conf');

const known = new Set(['server', 'listen', 'server_name', 'location', 'return', 'map']);
const isKnown = (n) => known.has(n);

test('진단에 줄/열/원문이 붙는다', () => {
  const { diagnostics } = scanText('server {\n  listen 80\n  server_name x;\n}\n', isKnown);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].line, 2);
  assert.equal(diagnostics[0].col, 10);
  assert.equal(diagnostics[0].source, 'listen 80');
});

test('모르는 지시어 이름 집계 (데이터 블록 안쪽은 제외)', () => {
  const src = `server {
  mystery_a 1;
  mystery_a 2;
  location / { other_b on; }
}
map $a $b { default 0; weird_key 1; }
`;
  const { unknown } = scanText(src, isKnown);
  assert.equal(unknown.get('mystery_a'), 2);
  assert.equal(unknown.get('other_b'), 1);
  assert.equal(unknown.has('weird_key'), false);
});
