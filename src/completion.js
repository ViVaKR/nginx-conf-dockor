// completion.js — 자동완성 vscode 연결부 (얇게 유지: 판단은 src/nginx/completion.js 가 한다)
'use strict';

const vscode = require('vscode');
const {
  analyzeCompletionContext,
  directiveCandidates,
  variableCandidates,
  buildInsert,
  variableInsert,
  renderDoc,
  detailOf,
  moduleLabel,
} = require('./nginx/completion');

const LANGUAGE_ID = 'nginx';

function registerCompletion(context, db) {
  if (!db) return;

  const provider = {
    provideCompletionItems(doc, position) {
      const offset = doc.offsetAt(position);
      const ctx = analyzeCompletionContext(doc.getText(), offset, { fileName: doc.fileName || '' });
      if (ctx.mode === 'none') return undefined;

      const start = doc.positionAt(ctx.wordStart);
      const range = {
        inserting: new vscode.Range(start, position),
        replacing: new vscode.Range(start, doc.positionAt(ctx.wordEnd)),
      };
      const asInsert = ({ text, snippet }) => (snippet ? new vscode.SnippetString(text) : text);

      let items;
      if (ctx.mode === 'variable') {
        items = variableCandidates(db, ctx).map((v) => {
          const item = new vscode.CompletionItem(v.name, vscode.CompletionItemKind.Variable);
          item.detail = moduleLabel(v.module);
          if (v.description) item.documentation = new vscode.MarkdownString(v.description);
          item.insertText = asInsert(variableInsert(v, ctx));
          // ${ 안에서는 '$' 없이 이름만 치므로 필터 기준도 맞춘다
          item.filterText = ctx.braced ? v.name.slice(1) : v.name;
          item.range = range;
          return item;
        });
      } else {
        items = directiveCandidates(db, ctx).map((g) => {
          const isBlock = g.entries.some((e) => e.block);
          const kind = isBlock ? vscode.CompletionItemKind.Struct : vscode.CompletionItemKind.Keyword;
          const item = new vscode.CompletionItem(g.name, kind);
          item.detail = detailOf(g);
          item.documentation = new vscode.MarkdownString(renderDoc(g));
          item.insertText = asInsert(buildInsert(g, ctx));
          item.range = range;
          return item;
        });
      }
      return new vscode.CompletionList(items, false);
    },
  };

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(LANGUAGE_ID, provider, '$'),
  );
}

module.exports = { registerCompletion };
