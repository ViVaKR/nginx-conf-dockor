'use strict';

const { loadDefaultDb } = require('./src/nginx/directive-db');
const { registerDiagnostics } = require('./src/diagnostics');
const { registerQuickFix } = require('./src/quickfix');
const { registerCompletion } = require('./src/completion');
const { registerHover } = require('./src/hover');

function activate(context) {
  // 지시어 데이터가 없어도 구조 진단(중괄호/세미콜론/따옴표)은 동작한다.
  let db = null;
  try {
    db = loadDefaultDb();
  } catch (e) {
    console.warn(`[nginx-conf-doctor] 지시어 데이터를 읽지 못했습니다: ${e.message}`);
  }
  registerDiagnostics(context, db);
  registerQuickFix(context, db);
  registerCompletion(context, db);
  registerHover(context, db);
}

function deactivate() {}

module.exports = { activate, deactivate };
