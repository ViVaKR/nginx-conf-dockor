'use strict';

const { loadDefaultDb } = require('./src/nginx/directive-db');
const { registerDiagnostics } = require('./src/diagnostics');
const { registerQuickFix } = require('./src/quickfix');
const { registerCompletion } = require('./src/completion');
const { registerHover } = require('./src/hover');
const { registerFormatter } = require('./src/format');

// @ts-ignore
function activate(context) {

  let db = null;
  try {
    db = loadDefaultDb();
  } catch (e) {
    // @ts-ignore
    console.warn(`[nginx-conf-doctor] 지시어 데이터를 읽지 못했습니다: ${e.message}`);
  }
  registerDiagnostics(context, db);
  registerQuickFix(context, db);
  registerCompletion(context, db);
  registerHover(context, db);
  registerFormatter(context, db);
}

function deactivate() { }

module.exports = { activate, deactivate };
