// directive-db.js
// -----------------------------------------------------------------------
// data/nginx-directives.json 을 조회하는 순수 레이어 (vscode 비의존).
// hover / completion / diagnostics 가 전부 이 모듈 하나만 바라본다.
// 같은 이름이 http/stream/mail 에 따로 있으므로 get() 은 entry 배열을 돌려준다.
// -----------------------------------------------------------------------
'use strict';

const fs = require('fs');
const path = require('path');

function createDirectiveDb(json) {
  const byName = new Map();
  for (const d of json.directives || []) {
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d);
  }
  return {
    /** 어떤 family 에든 존재하는 지시어 이름인가 */
    isKnownDirective: (name) => byName.has(name),
    /** @returns {Array} 같은 이름의 entry 목록 (http/stream/mail/core) */
    get: (name) => byName.get(name) || [],
    names: () => Array.from(byName.keys()),
    /** @returns {Array} 모든 지시어 entry (family 별로 따로) */
    all: () => json.directives || [],
    variables: json.variables || [],
  };
}

function loadDefaultDb() {
  const file = path.join(__dirname, '..', '..', 'data', 'nginx-directives.json');
  return createDirectiveDb(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { createDirectiveDb, loadDefaultDb };
