#!/usr/bin/env node
// gen-directives.js
// -----------------------------------------------------------------------
// nginx 공식 문서 저장소의 XML(ngx_*_module.xml)을 읽어서
// data/nginx-directives.json 을 만든다. 이 JSON 이 hover / completion /
// diagnostics / (나중엔) tmLanguage 생성의 단일 진실 공급원이 된다.
//
// 사용법:
//   git clone --depth 1 https://github.com/nginx/nginx.org
//   node scripts/gen-directives.js ./nginx.org/xml/en/docs
//   node scripts/gen-directives.js ./nginx.org/xml/en/docs --out data/nginx-directives.json
//
// 외부 의존성 없음 (XML 파서 대신 필요한 태그만 뽑는 가벼운 추출기).
// 같은 이름의 지시어가 http / stream / mail 에 각각 있으므로(listen, server,
// proxy_pass …) 이름만으로 키를 잡지 않고 family 와 함께 entry 배열로 저장한다.
// 인자 개수(arity)는 일부러 추출하지 않는다 — syntax 문자열 휴리스틱은
// 오탐을 만들기 쉬워서, 진단(0.5)을 만들 때 별도로 다룬다.
// -----------------------------------------------------------------------
'use strict';

const fs = require('fs');
const path = require('path');

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–' };

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

function stripTags(xml, { backticks = false } = {}) {
  let s = xml || '';
  // <link doc="../server_names.xml"/> 처럼 내용 없는 링크는 태그를 지우면 빈 따옴표만 남으므로
  // 지시어 id 또는 문서 파일명으로 대체한다.
  s = s.replace(/<link\b([^>]*?)\/>/g, (_, attrs) => {
    const a = parseAttrs(attrs);
    if (a.id) return backticks ? `\`${a.id}\`` : a.id;
    return a.doc ? path.basename(a.doc, '.xml') : '';
  });
  if (backticks) s = s.replace(/<literal>([\s\S]*?)<\/literal>/g, '`$1`');
  s = s.replace(/<[^>]+>/g, '');
  return decode(s).replace(/\s+/g, ' ').trim();
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(str || ''))) attrs[m[1]] = decode(m[2]);
  return attrs;
}

// <tag a="1">내용</tag> 또는 <tag a="1"/> 전부 찾기
function findAll(xml, tag) {
  const re = new RegExp(`<${tag}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push({ attrs: parseAttrs(m[1]), content: m[2] || '' });
  return out;
}

// 폐기된 모듈 (nginx 1.9.5 에서 제거됨, 지시어가 없어 경고만 발생)
const SKIP_FILES = new Set(['ngx_http_spdy_module.xml']);

// 문서 XML 에 context 가 구조화돼 있지 않은 지시어의 수동 보정.
// include 는 설정 파일 어디서든 쓸 수 있다 → 'any'
const CONTEXT_FALLBACK = { include: ['any'] };

function familyOf(relPath) {
  const first = relPath.split(path.sep)[0];
  return first === 'http' || first === 'stream' || first === 'mail' ? first : 'core';
}

function parseSyntaxes(name, content) {
  return findAll(content, 'syntax').map(({ attrs, content: c }) => {
    let text = stripTags(c).replace(/;\s*$/, '');
    if (text.startsWith(name + ' ')) text = text.slice(name.length + 1);
    if (text === name) text = '';
    let block = attrs.block === 'yes';
    if (/\{\s*\.\.\.\s*\}\s*$/.test(text)) {
      block = true;
      text = text.replace(/\{\s*\.\.\.\s*\}\s*$/, '').trim();
    }
    const line = [name, text].filter(Boolean).join(' ') + (block ? ' { ... }' : ';');
    return { text, block, line };
  });
}

/**
 * 모듈 XML 하나를 파싱한다.
 * @param {string} xml
 * @param {{ family: string, file: string }} meta
 */
function parseModuleXml(xml, meta) {
  const warnings = [];
  const modTag = findAll(xml, 'module')[0];
  const moduleName = modTag ? modTag.attrs.name || path.basename(meta.file) : path.basename(meta.file);
  const moduleLink = modTag ? modTag.attrs.link || '' : '';

  const directives = [];
  for (const { attrs, content } of findAll(xml, 'directive')) {
    const name = attrs.name;
    if (!name) continue;

    const syntaxes = parseSyntaxes(name, content);
    const contexts = findAll(content, 'context')
      .flatMap((c) => stripTags(c.content).split(','))
      .map((s) => s.trim())
      .filter(Boolean);
    if (contexts.length === 0 && CONTEXT_FALLBACK[name]) contexts.push(...CONTEXT_FALLBACK[name]);
    if (contexts.length === 0) warnings.push(`${meta.file}: '${name}' 에 context 가 없음`);

    const def = findAll(content, 'default')[0];
    const para = findAll(content, 'para')[0];

    directives.push({
      name,
      family: meta.family,
      module: moduleName,
      syntaxes,
      block: syntaxes.some((s) => s.block),
      contexts,
      default: def ? stripTags(def.content) || null : null,
      description: para ? stripTags(para.content, { backticks: true }) : '',
      docUrl: moduleLink ? `https://nginx.org${moduleLink}#${name}` : null,
    });
  }

  // 내장 변수 (best-effort): <tag-name id="var_..."> + <tag-desc>
  const variables = [];
  const varRe = /<tag-name\s+id="var_[^"]*"[^>]*>([\s\S]*?)<\/tag-name>\s*<tag-desc>([\s\S]*?)<\/tag-desc>/g;
  let vm;
  while ((vm = varRe.exec(xml))) {
    const rawName = vm[1];
    const name = stripTags(rawName);
    if (!name.startsWith('$')) continue;
    const hasValue = /<value>/.test(rawName);
    variables.push({
      name,
      prefix: hasValue ? stripTags(rawName.slice(0, rawName.indexOf('<value>'))) : null,
      family: meta.family,
      module: moduleName,
      description: stripTags(vm[2], { backticks: true }),
    });
  }

  return { moduleName, directives, variables, warnings };
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/^ngx_.*_module\.xml$/.test(entry.name) && !SKIP_FILES.has(entry.name)) out.push(full);
  }
  return out;
}

function generate(rootDir) {
  const files = walk(rootDir).sort();
  const result = { schemaVersion: 1, modules: [], directives: [], variables: [] };
  const warnings = [];

  for (const file of files) {
    const rel = path.relative(rootDir, file);
    const family = familyOf(rel);
    const parsed = parseModuleXml(fs.readFileSync(file, 'utf8'), { family, file: rel });
    result.modules.push({ name: parsed.moduleName, family, file: rel.split(path.sep).join('/') });
    result.directives.push(...parsed.directives);
    result.variables.push(...parsed.variables);
    warnings.push(...parsed.warnings);
    if (parsed.directives.length === 0 && parsed.variables.length === 0) {
      warnings.push(`${rel}: 지시어/변수가 하나도 추출되지 않음 (XML 형식 확인 필요)`);
    }
  }

  const byNameFamily = (a, b) => a.name.localeCompare(b.name) || a.family.localeCompare(b.family);
  result.directives.sort(byNameFamily);
  result.variables.sort(byNameFamily);
  return { result, warnings, fileCount: files.length };
}

function main(argv) {
  const args = argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args.splice(outIdx, 2)[1] : path.join(__dirname, '..', 'data', 'nginx-directives.json');
  const root = args[0];
  if (!root || !fs.existsSync(root)) {
    console.error('사용법: node scripts/gen-directives.js <nginx.org/xml/en/docs 경로> [--out 파일]');
    process.exit(1);
  }

  const { result, warnings, fileCount } = generate(root);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');

  const count = {};
  for (const d of result.directives) count[d.family] = (count[d.family] || 0) + 1;
  console.log(`모듈 파일 ${fileCount}개 → 지시어 ${result.directives.length}개, 변수 ${result.variables.length}개`);
  console.log('family별 지시어:', count);
  console.log(`출력: ${outPath}`);
  if (warnings.length) {
    console.warn(`\n⚠ 경고 ${warnings.length}건`);
    warnings.slice(0, 30).forEach((w) => console.warn('  - ' + w));
    if (warnings.length > 30) console.warn(`  … 외 ${warnings.length - 30}건`);
  }
}

if (require.main === module) main(process.argv);

module.exports = { parseModuleXml, generate, stripTags, findAll };
