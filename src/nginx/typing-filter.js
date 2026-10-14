// typing-filter.js
// 사용자가 지금 입력 중인 토큰에 대한 "세미콜론 누락 / 알 수 없는 지시어" 는 숨긴다.
// (예: `ser|` 를 치는 도중에 빨간/노란 줄이 번쩍이는 것을 방지.)
// 커서가 그 토큰을 벗어나면 다시 보이므로, 엔터를 치고 다음 줄로 가는 순간 표시된다.
'use strict';

const HIDE_WHILE_TYPING = new Set(['missing-semicolon', 'unknown-directive']);

function suppressWhileTyping(diagnostics, cursorOffsets) {
  if (!cursorOffsets || cursorOffsets.length === 0) return diagnostics;
  return diagnostics.filter(
    (d) => !(HIDE_WHILE_TYPING.has(d.code) && cursorOffsets.some((c) => c >= d.start && c <= d.end)),
  );
}

module.exports = { suppressWhileTyping };
