// format.js — 포매터 vscode 연결부 (판단은 src/nginx/format.js 가 한다)
//   - 문서 전체 포맷 / 선택 영역 포맷
//   - 줄 수를 바꾸지 않으므로, 바뀐 줄만 TextEdit 로 돌려준다 (접힘/커서 안정, 최소 diff)
'use strict';

const vscode = require('vscode');
const { formatLines } = require('./nginx/format');

const LANGUAGE_ID = 'nginx';

// @ts-ignore
function registerFormatter(context, db) {
  const isKnownDirective = db ? db.isKnownDirective : undefined;

  // @ts-ignore
  function toEdits(doc, options, range) {
    const text = doc.getText();
    const { lines } = formatLines(text, {
      tabSize: options.tabSize,
      insertSpaces: options.insertSpaces,
      isKnownDirective,
    });
    const oldLines = text.split('\n');
    const first = range ? range.start.line : 0;
    const last = Math.min(range ? range.end.line : lines.length - 1, lines.length - 1);

    const edits = [];
    for (let i = first; i <= last; i++) {
      if (lines[i] === oldLines[i]) continue;
      // VS Code 의 Position 은 줄바꿈(CRLF 의 \r 포함)을 제외한 글자 수 기준
      const endCol = oldLines[i].length - (oldLines[i].endsWith('\r') ? 1 : 0);
      const range1 = new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, endCol));
      edits.push(vscode.TextEdit.replace(range1, lines[i].replace(/\r$/, '')));
    }
    return edits;
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(LANGUAGE_ID, {
      provideDocumentFormattingEdits: (doc, options) => toEdits(doc, options, null),
    }),
    vscode.languages.registerDocumentRangeFormattingEditProvider(LANGUAGE_ID, {
      provideDocumentRangeFormattingEdits: (doc, range, options) => toEdits(doc, options, range),
    }),
  );
}

module.exports = { registerFormatter };
