'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, TokenType: T } = require('../../src/nginx/tokenizer');

const types = (r) => r.tokens.map((t) => t.type);
const values = (r) => r.tokens.map((t) => t.value);

test('기본 지시어와 블록', () => {
  const r = tokenize('server {\n  listen 80;\n}\n');
  assert.deepEqual(types(r), [T.WORD, T.LBRACE, T.WORD, T.WORD, T.SEMI, T.RBRACE]);
  assert.deepEqual(values(r).filter((v) => /\w/.test(v)), ['server', 'listen', '80']);
  assert.deepEqual(r.errors, []);
});

test('# 는 토큰 시작에서만 주석', () => {
  const r = tokenize('listen 80;# 끝줄 주석\nset $a b#c;');
  const comment = r.tokens.filter((t) => t.type === T.COMMENT);
  assert.equal(comment.length, 1);
  assert.equal(comment[0].value, '# 끝줄 주석');
  assert.ok(r.tokens.some((t) => t.value === 'b#c'));
});

test('따옴표 문자열과 이스케이프', () => {
  const r = tokenize(`add_header X "a \\"q\\" b";\nset $x 'it\\'s';`);
  const strs = r.tokens.filter((t) => t.type === T.STRING);
  assert.equal(strs[0].value, 'a "q" b');
  assert.equal(strs[1].value, "it's");
  assert.deepEqual(r.errors, []);
});

test('따옴표 안의 중괄호/세미콜론은 구조에 영향 없음', () => {
  const r = tokenize('location ~ "^/a{2};$" { }');
  assert.equal(r.tokens.filter((t) => t.type === T.SEMI).length, 0);
  assert.equal(r.tokens.filter((t) => t.type === T.LBRACE).length, 1);
});

test('여러 줄 문자열 허용 (닫는 따옴표가 있으면)', () => {
  const r = tokenize('return 200 "line1\nline2";');
  assert.equal(r.tokens[2].value, 'line1\nline2');
  assert.deepEqual(r.errors, []);
});

test('닫는 따옴표 없음 → 오류 + 그 줄 끝에서 복구', () => {
  const r = tokenize('add_header X "oops;\nlisten 80;');
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].code, 'unterminated-string');
  const bad = r.tokens.find((t) => t.unterminated);
  assert.equal(bad.text, '"oops;');
  // 다음 줄은 정상 토큰화
  assert.deepEqual(values(r).slice(-3), ['listen', '80', ';']);
});

test('${var} 는 한 단어, $var 도 한 단어', () => {
  const r = tokenize('proxy_pass http://${upstream}/x$uri;');
  assert.equal(r.tokens[1].value, 'http://${upstream}/x$uri');
  assert.deepEqual(r.errors, []);
});

test('${ 가 안 닫히면 오류', () => {
  const r = tokenize('set $a ${oops;');
  assert.equal(r.errors[0].code, 'unterminated-variable');
});

test("'}' 는 단어를 끝낸다 (세미콜론 누락 진단용)", () => {
  const r = tokenize('location / { return 200 ok}');
  assert.deepEqual(values(r).slice(-3), ['200', 'ok', '}']);
  assert.equal(r.tokens[r.tokens.length - 1].type, T.RBRACE);
});

test('정규식의 { 는 단어를 끝낸다 (따옴표 안 쓴 경우 nginx 와 동일하게 분리)', () => {
  const r = tokenize('location ~ ^/a{2}$ {}');
  assert.equal(r.tokens[2].value, '^/a');
  assert.equal(r.tokens[3].type, T.LBRACE);
});

test('백슬래시 이스케이프로 ; 를 단어에 포함', () => {
  const r = tokenize('set $a x\\;y;');
  assert.equal(r.tokens[2].value, 'x\\;y');
  assert.equal(r.tokens[3].type, T.SEMI);
});

test('lua_block 본문은 RAW 하나, 문자열/주석 속 중괄호 무시', () => {
  const src = [
    'content_by_lua_block {',
    '  local s = "}"  -- 닫는 중괄호 }',
    '  local t = { a = 1, b = { 2 } }',
    "  local l = [[ } ]]",
    '  ngx.say(s)',
    '}',
    'listen 80;',
  ].join('\n');
  const r = tokenize(src);
  assert.deepEqual(types(r).slice(0, 4), [T.WORD, T.LBRACE, T.RAW, T.RBRACE]);
  assert.deepEqual(values(r).slice(-3), ['listen', '80', ';']);
  assert.deepEqual(r.errors, []);
});

test('lua_block 이 안 닫히면 오류', () => {
  const r = tokenize('init_by_lua_block { local a = 1');
  assert.equal(r.errors[0].code, 'unterminated-lua-block');
});

test('위치 변환: CRLF 와 유니코드', () => {
  const r = tokenize('# 한글\r\nlisten 80;');
  const listen = r.tokens.find((t) => t.value === 'listen');
  assert.deepEqual(r.positionAt(listen.start), { line: 1, character: 0 });
  const semi = r.tokens.find((t) => t.type === T.SEMI);
  assert.deepEqual(r.positionAt(semi.start), { line: 1, character: 9 });
  const c = r.tokens[0];
  assert.equal(c.value, '# 한글'); // \r 제외
});

test('빈 입력 / 공백만', () => {
  assert.deepEqual(tokenize('').tokens, []);
  assert.deepEqual(tokenize(' \n\t ').tokens, []);
});
