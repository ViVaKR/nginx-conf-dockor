'use strict';

const { registerDiagnostics } = require('./src/diagnostics');

function activate(context) {
  registerDiagnostics(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
