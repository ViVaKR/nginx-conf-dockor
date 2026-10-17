'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { format, formatLines } = require('../../src/nginx/format');

const S4 = { tabSize: 4, insertSpaces: true };
const lines = (s) => s.split('\n');

test('블록 깊이대로 들여쓴다 (탭/공백이 뒤섞인 입력 → 공백 4칸)', () => {
  const src = 'http {\n\t\tgzip on;\n   server {\n listen 80;\n\t\t\tlocation / {\n return 200;\n  }\n}\n    }\n';
  const expected = [
    'http {',
    '    gzip on;',
    '    server {',
    '        listen 80;',
    '        location / {',
    '            return 200;',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
  assert.equal(format(src, S4), expected);
});

test('탭 옵션: insertSpaces=false 면 탭으로', () => {
  const out = format('http {\n    server {\n  listen 80;\n }\n}\n', { tabSize: 4, insertSpaces: false });
  assert.equal(out, 'http {\n\tserver {\n\t\tlisten 80;\n\t}\n}\n');
});

test('tabSize 2 도 지원', () => {
  assert.equal(format('http {\nserver {\n}\n}\n', { tabSize: 2, insertSpaces: true }), 'http {\n  server {\n  }\n}\n');
});

test('이어지는 줄(gzip_types 목록)은 한 단계 더', () => {
  const src = 'http {\ngzip_types\napplication/json\n   text/css;\ngzip on;\n}\n';
  assert.deepEqual(lines(format(src, S4)), [
    'http {',
    '    gzip_types',
    '        application/json',
    '        text/css;',
    '    gzip on;',
    '}',
    '',
  ]);
});

test('Allman 스타일: { 만 있는 줄은 지시어와 같은 깊이', () => {
  assert.equal(format('server\n    {\nlisten 80;\n  }\n', S4), 'server\n{\n    listen 80;\n}\n');
});

test('주석 줄은 위치의 깊이를 따른다 (} 앞의 주석 포함)', () => {
  const src = '# top\nserver {\n# in\nlisten 80;\n   # last\n}\n# after\n';
  assert.equal(format(src, S4), '# top\nserver {\n    # in\n    listen 80;\n    # last\n}\n# after\n');
});

test('map 같은 데이터 블록의 행도 한 단계 안쪽', () => {
  assert.equal(format('map $a $b {\ndefault 0;\n"~x" 1;\n}\n', S4), 'map $a $b {\n    default 0;\n    "~x" 1;\n}\n');
});

test('여러 줄 문자열의 "안쪽" 줄은 건드리지 않는다', () => {
  const src = 'server {\nreturn 200 "line1\n   keep   this  \nline3";\n}\n';
  const out = format(src, S4);
  assert.equal(out, 'server {\n    return 200 "line1\n   keep   this  \nline3";\n}\n');
});

test('lua 본문: 여는 줄이 움직인 만큼 통째로 이동, 닫는 } 는 구조대로', () => {
  const src = 'server {\n          content_by_lua_block {\n                local t = {1, 2}\n\n                ngx.say("hi")\n          }\n}\n';
  assert.deepEqual(lines(format(src, S4)), [
    'server {',
    '    content_by_lua_block {',
    '                local t = {1, 2}'.replace(/^ {16}/, ' '.repeat(10)), // 16 + (4-10) = 10
    '',
    '          ngx.say("hi")',
    '    }',
    '}',
    '',
  ]);
});

test('줄 끝 { 앞 공백 보정, 줄 끝이 아닌 {} (정규식) 는 건드리지 않는다', () => {
  assert.equal(format('location /{\n}\n', S4), 'location / {\n}\n');
  assert.equal(format('location ~ ^/a{2}$ {\n}\n', S4), 'location ~ ^/a{2}$ {\n}\n');
  assert.equal(format('location /{ # 주석\n}\n', S4), 'location / { # 주석\n}\n');
  assert.equal(format('set $x ${host};\n', S4), 'set $x ${host};\n'); // ${ } 는 { 토큰이 아님
});

test('줄 끝 공백 제거, 공백만 있는 줄은 빈 줄, CRLF 보존', () => {
  assert.equal(format('listen 80;   \n   \n', S4), 'listen 80;\n\n');
  assert.equal(format('server {\r\n  listen 80;  \r\n\r\n}\r\n', S4), 'server {\r\n    listen 80;\r\n\r\n}\r\n');
});

test('줄 수는 바뀌지 않는다', () => {
  const src = 'a {\n\n\nb 1;\n  }\n';
  assert.equal(lines(format(src, S4)).length, lines(src).length);
});

test('멱등: 두 번 돌려도 결과가 같다 (복합 샘플)', () => {
  const src = `user www-data;
events {
\tworker_connections 2048; # 주석
}
http {
\tlog_format main '$a'
\t\t\t\t'$b';
\tgzip_types
\t\tapplication/json
\t\ttext/css;
\tmap $http_upgrade $connection_upgrade {
\t\tdefault upgrade;
\t\t'' keep-alive;
\t}
\tserver
\t{
\t\tlisten 80;
\t\t# 설명
\t\tlocation /api/{
\t\t\tif ($a) { return 403; }
\t\t\tcontent_by_lua_block {
\t\t\t\tlocal t = {1, 2}
\t\t\t\tngx.say("}")
\t\t\t}
\t\t}
\t\treturn 200 "a
   b";
\t}
}
`;
  const once = format(src, S4);
  assert.equal(format(once, S4), once);
  const onceTab = format(src, { tabSize: 4, insertSpaces: false });
  assert.equal(format(onceTab, { tabSize: 4, insertSpaces: false }), onceTab);
});

test('이미 정리된 파일은 changed 가 모두 false', () => {
  const ok = 'http {\n    server {\n        listen 80;\n    }\n}\n';
  assert.deepEqual(formatLines(ok, S4).changed.filter(Boolean), []);
});

test('중괄호가 안 맞아도 죽지 않고, 음수 들여쓰기가 없다', () => {
  assert.doesNotThrow(() => format('}\nlisten 80;\n}\n}\n', S4));
  assert.equal(format('}\nlisten 80;\n', S4), '}\nlisten 80;\n');
  const open = format('http {\nserver {\nlisten 80;\n', S4);
  assert.equal(open, 'http {\n    server {\n        listen 80;\n');
});

test('세미콜론이 빠진 줄도 파서 판단으로 새 문장에 정렬 (지시어 데이터가 있을 때)', () => {
  const known = new Set(['listen', 'server_name', 'server']);
  const src = 'server {\nlisten 80\nserver_name x;\n}\n';
  const withDb = format(src, { ...S4, isKnownDirective: (n) => known.has(n) });
  assert.equal(withDb, 'server {\n    listen 80\n    server_name x;\n}\n');
});

test('language-configuration.json: Enter 자동 들여쓰기 규칙이 올바른 정규식', () => {
  const cfg = require('../../language-configuration.json');
  const inc = new RegExp(cfg.indentationRules.increaseIndentPattern);
  const dec = new RegExp(cfg.indentationRules.decreaseIndentPattern);
  assert.ok(inc.test('server {'));
  assert.ok(inc.test('location / {   # 주석'));
  assert.ok(!inc.test('listen 80;'));
  assert.ok(dec.test('    }'));
  assert.ok(!dec.test('    listen 80;'));
});

test('안전성: 포맷은 공백만 바꾼다 (토큰 열이 완전히 동일)', () => {
  const { tokenize } = require('../../src/nginx/tokenizer');
  // lua 본문(raw)은 블록 위치에 맞춰 일부러 이동하므로 공백만 무시하고 비교, 나머지 토큰은 글자 하나까지 동일해야 한다.
  const sig = (t) =>
    tokenize(t)
      .tokens.map((x) => `${x.type}:${x.type === 'raw' ? x.value.replace(/\s+/g, ' ').trim() : x.value}`)
      .join('\u0001');
  const src = `http {
\tlog_format main '$a'
\t\t\t'$b';
\tmap $x $y {
default 0;
\t}
\tserver
\t{
location /{
content_by_lua_block {
   local t = {1, "}"}
}
return 200 "a
  b"; # c
}
}
`;
  for (const o of [S4, { tabSize: 4, insertSpaces: false }, { tabSize: 2, insertSpaces: true }]) {
    assert.equal(sig(format(src, o)), sig(src));
  }
});
