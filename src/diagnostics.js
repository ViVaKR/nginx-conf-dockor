// diagnostics.js — vscode 연결부 (얇게 유지: 실제 분석은 src/nginx/ 순수 모듈이 한다)
'use strict';

const vscode = require('vscode');
const { parse } = require('./nginx/parser');
const { lintUnknownDirectives } = require('./nginx/lint');
const { suppressWhileTyping } = require('./nginx/typing-filter');

const LANGUAGE_ID = 'nginx';
const SOURCE = 'nginx-conf-doctor';
const CONFIG = 'nginx-conf-doctor';
const DEBOUNCE_MS = 250;

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  info: vscode.DiagnosticSeverity.Information,
};

/** @param {{ isKnownDirective: Function, names: () => string[] } | null} db */
function registerDiagnostics(context, db) {
  const collection = vscode.languages.createDiagnosticCollection(SOURCE);
  const timers = new Map();
  const names = db ? db.names() : [];

  function readConfig() {
    const cfg = vscode.workspace.getConfiguration(CONFIG);
    return {
      extra: new Set(cfg.get('extraDirectives', [])),
      unknownSeverity: cfg.get('unknownDirectiveSeverity', 'warning'),
    };
  }

  // 이 문서를 보고 있는 모든 에디터의 커서 위치 (입력 중인 토큰 판별용)
  function cursorOffsets(doc) {
    return vscode.window.visibleTextEditors
      .filter((e) => e.document === doc)
      .flatMap((e) => e.selections.map((sel) => doc.offsetAt(sel.active)));
  }

  function refresh(doc) {
    if (doc.languageId !== LANGUAGE_ID) return;
    const isKnownDirective = db ? db.isKnownDirective : undefined;
    const parsed = parse(doc.getText(), { isKnownDirective });
    const { extra, unknownSeverity } = readConfig();

    let all = parsed.diagnostics;
    if (db && unknownSeverity !== 'off') {
      const linted = lintUnknownDirectives(parsed.root, { isKnownDirective, names, extra }).map((d) => ({
        ...d,
        severity: unknownSeverity,
      }));
      all = all.concat(linted).sort((a, b) => a.start - b.start || a.end - b.end);
    }

    const diagnostics = suppressWhileTyping(all, cursorOffsets(doc));
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
    // 커서가 입력 중이던 토큰을 벗어나면 숨겼던 진단을 다시 보여준다
    vscode.window.onDidChangeTextEditorSelection((e) => schedule(e.textEditor.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      timers.delete(doc.uri.toString());
      collection.delete(doc.uri);
    }),
    // 설정(extraDirectives / 심각도)을 바꾸면 열려 있는 문서를 즉시 다시 검사
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG)) vscode.workspace.textDocuments.forEach(refresh);
    }),
  );

  vscode.workspace.textDocuments.forEach(refresh);
}

module.exports = { registerDiagnostics };
