// quickfix.js — 알 수 없는 지시어에 "'listen' 로 바꾸기" 빠른 수정을 제공 (vscode 연결부)
'use strict';

const vscode = require('vscode');
const { suggest } = require('./nginx/lint');

const LANGUAGE_ID = 'nginx';
const SOURCE = 'nginx-conf-doctor';

function registerQuickFix(context, db) {
  if (!db) return;
  const names = db.names();
  const provider = {
    provideCodeActions(doc, _range, ctx) {
      const actions = [];
      for (const d of ctx.diagnostics) {
        if (d.source !== SOURCE || d.code !== 'unknown-directive') continue;
        // Diagnostic 객체에 사용자 데이터를 실을 수 없어서, 범위의 원문으로 후보를 다시 계산한다.
        const typed = doc.getText(d.range);
        suggest(typed, names).forEach((s, i) => {
          const action = new vscode.CodeAction(`'${s}' 로 바꾸기`, vscode.CodeActionKind.QuickFix);
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(doc.uri, d.range, s);
          action.diagnostics = [d];
          action.isPreferred = i === 0;
          actions.push(action);
        });
      }
      return actions;
    },
  };
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(LANGUAGE_ID, provider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
  );
}

module.exports = { registerQuickFix };
