'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFixtureDocs } = require('./fixture-docs');
const { generate } = require('../../scripts/gen-directives');
const { createDirectiveDb } = require('../../src/nginx/directive-db');

const db = createDirectiveDb(generate(makeFixtureDocs()).result);

test('알려진/모르는 지시어', () => {
  assert.equal(db.isKnownDirective('listen'), true);
  assert.equal(db.isKnownDirective('no_such_directive'), false);
});

test('get 은 family 별 entry 배열', () => {
  const e = db.get('listen');
  assert.equal(e.length, 1);
  assert.equal(e[0].family, 'http');
  assert.deepEqual(db.get('nope'), []);
});

test('all() 은 family 별 entry 를 모두 돌려준다', () => {
  assert.ok(db.all().length >= 2);
  assert.ok(db.all().every((e) => e.name && e.family));
});
