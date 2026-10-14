'use strict';
// 가짜 vscode 모듈로 연결부(diagnostics.js / quickfix.js / extension.js)를 실제로 실행해 본다.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const { createDirectiveDb } = require('../../src/nginx/directive-db');

function makeFake() {
  const handlers = {};
  const cfg = {};
  const providers = [];
  const collection = { last: null, set(uri, d) { this.last = d; }, delete() {}, dispose() {} };
  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range { constructor(a, b) { this.start = a; this.end = b; } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; } }
  class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } }
  const sub = (name) => (fn) => { handlers[name] = fn; return { dispose() {} }; };
  const doc = { languageId: 'nginx', uri: { toString: () => 'file:///t.nginx.conf' }, text: '' };
  const offsetAt = (p) => {
    const lines = doc.text.split('\n');
    return lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  };
  doc.getText = (range) => (range ? doc.text.slice(offsetAt(range.start), offsetAt(range.end)) : doc.text);
  doc.offsetAt = offsetAt;
  doc.positionAt = (o) => {
    const before = doc.text.slice(0, o).split('\n');
    return new Position(before.length - 1, before[before.length - 1].length);
  };
  const vscode = {
    Position, Range, Diagnostic, CodeAction, WorkspaceEdit,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CodeActionKind: { QuickFix: 'quickfix' },
    languages: {
      createDiagnosticCollection: () => collection,
      registerCodeActionsProvider: (sel, p) => { providers.push(p); return { dispose() {} }; },
    },
    workspace: {
      textDocuments: [doc],
      onDidOpenTextDocument: sub('open'),
      onDidChangeTextDocument: sub('change'),
      onDidCloseTextDocument: sub('close'),
      onDidChangeConfiguration: sub('config'),
      getConfiguration: () => ({ get: (k, d) => (k in cfg ? cfg[k] : d) }),
    },
    window: { visibleTextEditors: [], onDidChangeTextEditorSelection: sub('selection') },
  };
  return { vscode, doc, collection, cfg, handlers, providers };
}

function load(fake) {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    return req === 'vscode' ? fake.vscode : orig.call(this, req, ...rest);
  };
  for (const k of Object.keys(require.cache)) if (/[\\/]src[\\/](diagnostics|quickfix)\.js$|[\\/]extension\.js$/.test(k)) delete require.cache[k];
  try {
    return {
      diagnostics: require('../../src/diagnostics'),
      quickfix: require('../../src/quickfix'),
    };
  } finally {
    Module._load = orig;
  }
}

const db = createDirectiveDb({
  directives: ['server', 'listen', 'server_name'].map((name) => ({ name, family: 'http' })),
});

test('열자마자 진단: 세미콜론 누락 + 알 수 없는 지시어(경고)', () => {
  const fake = makeFake();
  fake.doc.text = 'server {\n  listen 80;\n  lisen 8080;\n  server_name x\n}\n';
  const { diagnostics } = load(fake);
  diagnostics.registerDiagnostics({ subscriptions: [] }, db);

  const d = fake.collection.last;
  assert.deepEqual(d.map((x) => x.code).sort(), ['missing-semicolon', 'unknown-directive']);
  const unknown = d.find((x) => x.code === 'unknown-directive');
  assert.equal(unknown.severity, 1); // Warning
  assert.equal(unknown.range.start.line, 2);
  assert.equal(unknown.source, 'nginx-conf-doctor');
});

test('빠른 수정: lisen → listen', () => {
  const fake = makeFake();
  fake.doc.text = 'server {\n  lisen 8080;\n}\n';
  const { diagnostics, quickfix } = load(fake);
  diagnostics.registerDiagnostics({ subscriptions: [] }, db);
  quickfix.registerQuickFix({ subscriptions: [] }, db);

  const actions = fake.providers[0].provideCodeActions(fake.doc, null, { diagnostics: fake.collection.last });
  assert.equal(actions.length, 1);
  assert.match(actions[0].title, /listen/);
  assert.equal(actions[0].edit.edits[0].text, 'listen');
  assert.equal(actions[0].isPreferred, true);
});

test('설정: 심각도 off / extraDirectives 로 즉시 재검사', () => {
  const fake = makeFake();
  fake.doc.text = 'server {\n  lisen 8080;\n}\n';
  const { diagnostics } = load(fake);
  diagnostics.registerDiagnostics({ subscriptions: [] }, db);
  assert.equal(fake.collection.last.length, 1);

  fake.cfg.extraDirectives = ['lisen'];
  fake.handlers.config({ affectsConfiguration: () => true });
  assert.equal(fake.collection.last.length, 0);

  fake.cfg.extraDirectives = [];
  fake.cfg.unknownDirectiveSeverity = 'off';
  fake.handlers.config({ affectsConfiguration: () => true });
  assert.equal(fake.collection.last.length, 0);
});

test('지시어 데이터(db) 없이도 구조 진단은 동작, 알 수 없는 지시어는 검사 안 함', () => {
  const fake = makeFake();
  fake.doc.text = 'server {\n  lisen 8080\n}\n';
  const { diagnostics } = load(fake);
  diagnostics.registerDiagnostics({ subscriptions: [] }, null);
  assert.deepEqual(fake.collection.last.map((x) => x.code), ['missing-semicolon']);
});
