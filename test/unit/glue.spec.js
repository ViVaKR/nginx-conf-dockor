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
  const completionProviders = [];
  const hoverProviders = [];
  const collection = { last: null, set(uri, d) { this.last = d; }, delete() {}, dispose() {} };
  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range { constructor(a, b) { this.start = a; this.end = b; } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; } }
  class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
  class CompletionList { constructor(items, incomplete) { this.items = items; this.isIncomplete = incomplete; } }
  class Hover { constructor(contents, range) { this.contents = contents; this.range = range; } }
  class SnippetString { constructor(value) { this.value = value; } }
  class MarkdownString { constructor(value) { this.value = value; } }
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
    CompletionItem, CompletionList, SnippetString, MarkdownString, Hover,
    CompletionItemKind: { Keyword: 13, Struct: 21, Variable: 5 },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CodeActionKind: { QuickFix: 'quickfix' },
    languages: {
      createDiagnosticCollection: () => collection,
      registerCodeActionsProvider: (sel, p) => { providers.push(p); return { dispose() {} }; },
      registerHoverProvider: (sel, p) => { hoverProviders.push(p); return { dispose() {} }; },
      registerCompletionItemProvider: (sel, p) => { completionProviders.push(p); return { dispose() {} }; },
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
  return { vscode, doc, collection, cfg, handlers, providers, completionProviders, hoverProviders };
}

function load(fake) {
  const orig = Module._load;
  Module._load = function (req, ...rest) {
    return req === 'vscode' ? fake.vscode : orig.call(this, req, ...rest);
  };
  for (const k of Object.keys(require.cache)) if (/[\\/]src[\\/](diagnostics|quickfix|completion|hover)\.js$|[\\/]extension\.js$/.test(k)) delete require.cache[k];
  try {
    return {
      diagnostics: require('../../src/diagnostics'),
      quickfix: require('../../src/quickfix'),
      completion: require('../../src/completion'),
      hover: require('../../src/hover'),
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

const E = (name, family, contexts, block = false) => ({
  name, family, module: 'm', contexts, block, default: null, description: `${name} 설명`, docUrl: null,
  syntaxes: [{ text: block ? '' : 'arg', block, line: `${name};` }],
});
const dbC = createDirectiveDb({
  directives: [
    E('http', 'http', ['main'], true),
    E('server', 'http', ['http'], true),
    E('listen', 'http', ['server']),
    E('proxy_pass', 'http', ['location']),
    E('gzip', 'http', ['http', 'server', 'location']),
  ],
  variables: [{ name: '$host', prefix: null, family: 'http', module: 'ngx_http_core_module', description: 'host' }],
});

test('자동완성: server 블록 안에서 lis → 컨텍스트에 맞는 지시어만 + 스니펫', () => {
  const fake = makeFake();
  fake.doc.text = 'http {\n  server {\n    lis\n  }\n}\n';
  const { completion } = load(fake);
  completion.registerCompletion({ subscriptions: [] }, dbC);

  const offset = fake.doc.text.indexOf('lis') + 3;
  const list = fake.completionProviders[0].provideCompletionItems(fake.doc, fake.doc.positionAt(offset));
  const labels = list.items.map((i) => i.label);
  assert.deepEqual(labels, ['gzip', 'listen']); // proxy_pass(location 전용), http/server 는 제외
  const listen = list.items.find((i) => i.label === 'listen');
  assert.equal(listen.insertText.value, 'listen ${1};$0');
  assert.equal(listen.range.inserting.start.character, 4);
  assert.equal(listen.range.inserting.end.character, 7);
  assert.ok(listen.documentation.value.includes('listen'));
});

test('자동완성: 주석 안에서는 아무것도 제안하지 않는다', () => {
  const fake = makeFake();
  fake.doc.text = 'server {\n  # lis\n}\n';
  const { completion } = load(fake);
  completion.registerCompletion({ subscriptions: [] }, dbC);
  const offset = fake.doc.text.indexOf('lis') + 3;
  assert.equal(fake.completionProviders[0].provideCompletionItems(fake.doc, fake.doc.positionAt(offset)), undefined);
});

test('자동완성: $ 변수', () => {
  const fake = makeFake();
  fake.doc.text = 'server {\n  return 200 "$ho";\n}\n';
  const { completion } = load(fake);
  completion.registerCompletion({ subscriptions: [] }, dbC);
  const offset = fake.doc.text.indexOf('$ho') + 3;
  const list = fake.completionProviders[0].provideCompletionItems(fake.doc, fake.doc.positionAt(offset));
  assert.deepEqual(list.items.map((i) => i.label), ['$host']);
  assert.equal(list.items[0].insertText, '$host');
});

test('자동완성: db 가 없으면 등록하지 않는다', () => {
  const fake = makeFake();
  const { completion } = load(fake);
  completion.registerCompletion({ subscriptions: [] }, null);
  assert.equal(fake.completionProviders.length, 0);
});

test('hover: listen 위에서 문서가 나오고, 인자 위에서는 나오지 않는다', () => {
  const fake = makeFake();
  fake.doc.text = 'http {\n  server {\n    listen 80;\n  }\n}\n';
  const { hover } = load(fake);
  hover.registerHover({ subscriptions: [] }, dbC);

  const on = fake.doc.text.indexOf('listen') + 2;
  const h = fake.hoverProviders[0].provideHover(fake.doc, fake.doc.positionAt(on));
  assert.ok(h.contents.value.includes('listen'));
  assert.equal(h.range.start.character, 4);
  assert.equal(h.range.end.character, 10);

  const arg = fake.doc.text.indexOf('80');
  assert.equal(fake.hoverProviders[0].provideHover(fake.doc, fake.doc.positionAt(arg)), undefined);
});

test('진단: 컨텍스트 오류(server 안의 proxy_pass)가 경고로 나오고, 설정으로 끌 수 있다', () => {
  const fake = makeFake();
  fake.doc.text = 'http {\n  server {\n    proxy_pass x;\n  }\n}\n';
  const { diagnostics } = load(fake);
  diagnostics.registerDiagnostics({ subscriptions: [] }, dbC);

  const d = fake.collection.last.find((x) => x.code === 'directive-not-allowed');
  assert.ok(d);
  assert.equal(d.severity, 1); // Warning
  assert.equal(d.range.start.line, 2);

  fake.cfg.contextSeverity = 'off';
  fake.handlers.config({ affectsConfiguration: () => true });
  assert.equal(fake.collection.last.some((x) => x.code === 'directive-not-allowed'), false);
});
