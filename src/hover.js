// hover.js — hover vscode 연결부 (판단은 src/nginx/hover.js 가 한다)
'use strict';

const vscode = require('vscode');
const { hoverAt } = require('./nginx/hover');

const LANGUAGE_ID = 'nginx';

function registerHover(context, db) {
  if (!db) return;
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(LANGUAGE_ID, {
      provideHover(doc, position) {
        const r = hoverAt(db, doc.getText(), doc.offsetAt(position));
        if (!r) return undefined;
        const range = new vscode.Range(doc.positionAt(r.start), doc.positionAt(r.end));
        return new vscode.Hover(new vscode.MarkdownString(r.markdown), range);
      },
    }),
  );
}

module.exports = { registerHover };
