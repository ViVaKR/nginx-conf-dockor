// fixture-docs.js
// 지시어 생성기 테스트용 샘플 XML(nginx.org 문서와 같은 형식)을 임시 폴더에 만들어 준다.
// 파일로 두지 않고 코드에 내장한 이유: fixtures 폴더를 따로 복사하다 빠뜨리는 사고 방지.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const CORE_XML = "<?xml version=\"1.0\"?>\n<module name=\"Core functionality\" link=\"/en/docs/ngx_core_module.html\" lang=\"en\">\n<section id=\"directives\" name=\"Directives\">\n\n<directive name=\"daemon\">\n<syntax>on | off</syntax>\n<default>daemon on;</default>\n<context>main</context>\n<para>Determines whether nginx should become a daemon.</para>\n</directive>\n\n<directive name=\"events\">\n<syntax block=\"yes\"/>\n<default/>\n<context>main</context>\n<para>Provides the configuration file context in which the directives that affect connection processing are specified.</para>\n</directive>\n\n</section>\n</module>\n";

const HTTP_XML = "<?xml version=\"1.0\"?>\n<module name=\"Module ngx_http_sample_module\" link=\"/en/docs/http/ngx_http_sample_module.html\" lang=\"en\">\n<section id=\"directives\" name=\"Directives\">\n\n<directive name=\"listen\">\n<syntax><value>address</value>[:<value>port</value>] [<literal>default_server</literal>];</syntax>\n<syntax><value>port</value> [<literal>ssl</literal>];</syntax>\n<default>listen *:80 | *:8000;</default>\n<context>server</context>\n<para>Sets the <literal>address</literal> and <literal>port</literal> &amp; more; use &lt;value&gt;.</para>\n<para>두번째 문단은 무시된다.</para>\n</directive>\n\n<directive name=\"location\">\n<syntax block=\"yes\">[ <literal>=</literal> | <literal>~</literal> ] <value>uri</value></syntax>\n<default/>\n<context>server, location</context>\n<para>Sets configuration depending on a request URI.</para>\n</directive>\n\n<directive name=\"return\">\n<syntax><value>code</value> [<value>text</value>]</syntax>\n<default/>\n<context>server, location, if in server, if in location</context>\n<para>Stops processing and returns the specified code.</para>\n</directive>\n\n</section>\n<section id=\"variables\" name=\"Embedded Variables\">\n<list type=\"tag\">\n<tag-name id=\"var_host\"><literal>$host</literal></tag-name>\n<tag-desc>in this order of precedence: host name from the request line.</tag-desc>\n<tag-name id=\"var_arg_\"><literal>$arg_<value>name</value></literal></tag-name>\n<tag-desc>argument <value>name</value> in the request line</tag-desc>\n</list>\n</section>\n</module>\n";

/** @returns { dir: string } 임시 docs 루트 (core 1개 + http 1개) */
function makeFixtureDocs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ngx-docs-'));
  fs.mkdirSync(path.join(dir, 'http'));
  fs.writeFileSync(path.join(dir, 'ngx_core_module.xml'), CORE_XML);
  fs.writeFileSync(path.join(dir, 'http', 'ngx_http_sample_module.xml'), HTTP_XML);
  return dir;
}

module.exports = { makeFixtureDocs };
