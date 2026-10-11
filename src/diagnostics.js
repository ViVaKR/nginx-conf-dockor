// diagnostics.js — vscode 연결부 (얇게 유지: 실제 분석은 src/nginx/ 순수 모듈이 한다)
'use strict';

const vscode = require('vscode');
const { parse } = require('./nginx/parser');
const { loadDefaultDb } = require('./nginx/directive-db');

const LANGUAGE_ID = 'nginx';
const SOURCE = 'nginx-conf-doctor';
const DEBOUNCE_MS = 250;

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

function registerDiagnostics(context) {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  const timers = new Map();

  let isKnownDirective;
  try {
    isKnownDirective = loadDefaultDb().isKnownDirective;
  } catch (e) {
    // data/nginx-directives.json 이 없으면 "다음 줄 지시어 추정" 만 꺼지고 나머지 진단은 동작
    console.warn(`[${SOURCE}] 지시어 데이터를 읽지 못했습니다: ${e.message}`);
  }

  function refresh(doc) {
    if (doc.languageId !== LANGUAGE_ID) return;
    const { diagnostics } = parse(doc.getText(), { isKnownDirective });
    collection.set(
      doc.uri,
      diagnostics.map((d) => {
        const range = new vscode.Range(doc.positionAt(d.start), doc.positionAt(d.end));
        const diag = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity] ?? SEVERITY.error);
        diag.source = SOURCE;
        diag.code = d.code;
        return diag;
      }),
    );
  }

  function schedule(doc) {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => refresh(doc), DEBOUNCE_MS));
  }

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
  );

  vscode.workspace.textDocuments.forEach(refresh);
}

module.exports = { registerDiagnostics };
