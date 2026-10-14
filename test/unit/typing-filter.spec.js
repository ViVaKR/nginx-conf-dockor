'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { suppressWhileTyping } = require('../../src/nginx/typing-filter');

const semi = { code: 'missing-semicolon', start: 10, end: 13 };
const other = { code: 'unclosed-block', start: 10, end: 11 };

test('커서가 토큰 끝에 있으면 세미콜론 누락을 숨긴다', () => {
  assert.deepEqual(suppressWhileTyping([semi], [13]), []);
});
test('커서가 토큰 안/앞 경계에 있어도 숨긴다', () => {
  assert.deepEqual(suppressWhileTyping([semi], [11]), []);
  assert.deepEqual(suppressWhileTyping([semi], [10]), []);
});
test('커서가 떠나면 다시 보인다', () => {
  assert.deepEqual(suppressWhileTyping([semi], [14]), [semi]);
  assert.deepEqual(suppressWhileTyping([semi], [9]), [semi]);
});
test('알 수 없는 지시어도 입력 중에는 숨긴다', () => {
  const unk = { code: 'unknown-directive', start: 10, end: 13 };
  assert.deepEqual(suppressWhileTyping([unk], [13]), []);
  assert.deepEqual(suppressWhileTyping([unk], [20]), [unk]);
});
test('다른 종류의 진단은 숨기지 않는다', () => {
  assert.deepEqual(suppressWhileTyping([other], [10]), [other]);
});
test('커서 정보가 없으면 그대로', () => {
  assert.deepEqual(suppressWhileTyping([semi], []), [semi]);
  assert.deepEqual(suppressWhileTyping([semi], undefined), [semi]);
});
test('멀티 커서: 하나라도 걸치면 숨김', () => {
  assert.deepEqual(suppressWhileTyping([semi], [0, 12]), []);
});
