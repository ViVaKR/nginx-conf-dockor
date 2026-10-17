<p align="center">
  <img src="https://raw.githubusercontent.com/ViVaKR/nginx-conf-doctor/main/icon_256.png" width="112" alt="Hun Nginx 설정 닥터 아이콘">
</p>

<h1 align="center">Hun Nginx 설정 닥터</h1>

<p align="center">
  <b>nginx 설정의 컨텍스트를 읽는 진단 · 자동완성 · hover 문서</b><br>
  <sub>Context-aware diagnostics, IntelliSense and hover docs for nginx configuration files</sub>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=buddham-hq.nginx-conf-doctor"><img alt="Install" src="https://img.shields.io/badge/INSTALL-VS%20Code%20Marketplace-38bdf8?style=for-the-badge&labelColor=0b1220&logo=visualstudiocode&logoColor=38bdf8"></a>
  <a href="https://github.com/ViVaKR/nginx-conf-doctor"><img alt="GitHub" src="https://img.shields.io/badge/SOURCE-GitHub-f43f9a?style=for-the-badge&labelColor=0b1220&logo=github&logoColor=f43f9a"></a>
  <a href="https://github.com/ViVaKR/nginx-conf-doctor/issues"><img alt="Issues" src="https://img.shields.io/badge/FEEDBACK-Issues-a78bfa?style=for-the-badge&labelColor=0b1220&logo=githubissues&logoColor=a78bfa"></a>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-0.0.2-38bdf8?labelColor=0b1220">
  <img alt="vscode" src="https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.90-38bdf8?labelColor=0b1220&logo=visualstudiocode&logoColor=white">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-f43f9a?labelColor=0b1220">
  <img alt="last commit" src="https://img.shields.io/github/last-commit/ViVaKR/nginx-conf-doctor?color=38bdf8&labelColor=0b1220">
  <img alt="stars" src="https://img.shields.io/github/stars/ViVaKR/nginx-conf-doctor?style=flat&color=f43f9a&labelColor=0b1220">
</p>

<p align="center">
  <a href="#-주요-기능">기능</a> ·
  <a href="#-지원-파일">지원 파일</a> ·
  <a href="#️-설정">설정</a> ·
  <a href="#️-알려진-제한">알려진 제한</a> ·
  <a href="#-릴리스-노트">릴리스 노트</a>
</p>

---

## 🚀 설치

VS Code 에서 `Ctrl+P` (macOS `Cmd+P`) 를 누르고 아래를 붙여 넣으세요.

```
ext install buddham-hq.nginx-conf-doctor
```

## 👀 이렇게 알려 줍니다

```nginx
server {
    worker_processes 4;   # ⚠ 'worker_processes' 는 이 위치(server)에서 쓸 수 없습니다
    listen 80
    server_name example.com;   # ✖ 앞 줄에 세미콜론(;)이 빠졌습니다
}
```

---

nginx 설정 파일(`nginx.conf`, `conf.d/*.conf` 등)을 편집할 때 **구문 강조, 오류 진단, 자동완성, hover 문서**를 제공하는 VS Code 확장입니다.

단순히 색만 입히는 것이 아니라, 지시어가 **어느 컨텍스트(`http`, `server`, `location` 등)에 쓰였는지**를 읽어서 "이 위치에서는 쓸 수 없는 지시어"까지 알려 줍니다.

## ✨ 주요 기능

### 구문 강조
- nginx 전용 TextMate 문법으로 지시어, 변수, 문자열, 주석을 구분해 표시합니다.
- Lua 블록(`*_by_lua_block` 등)은 내부를 Lua 문법으로 강조합니다.

### 진단 (Diagnostics)
저장하기 전에, 입력하는 즉시 문제를 표시합니다.

| 진단 | 설명 |
|------|------|
| 구조 오류 | 닫히지 않은 중괄호, 빠진 세미콜론, 닫히지 않은 따옴표 |
| 컨텍스트 오류 | 현재 위치에서 쓸 수 없는 지시어 (예: `server` 안에 `worker_processes`) |
| 알 수 없는 지시어 | 데이터베이스에 없는 지시어 (오타 발견에 유용) |

> 지시어 데이터를 읽지 못하는 경우에도 **구조 진단(중괄호/세미콜론/따옴표)은 계속 동작**합니다.

### 빠른 수정 (Quick Fix)
진단된 문제 위에서 `Ctrl+.` (macOS `Cmd+.`)로 제안되는 수정을 적용할 수 있습니다.

### 자동완성
현재 컨텍스트에서 사용할 수 있는 지시어를 제안합니다.

### Hover 문서
지시어에 마우스를 올리면 설명을 볼 수 있습니다.

## 📂 지원 파일

아래 파일은 자동으로 `nginx` 언어로 인식됩니다.

- 파일명: `nginx.conf`, `mime.types`, `fastcgi_params`, `scgi_params`, `uwsgi_params`
- 확장자: `.nginx`, `.nginx.conf`
- 경로 패턴: `**/nginx/**/*.conf`, `**/conf.d/*.conf`, `**/sites-available/*`, `**/sites-enabled/*`, `**/snippets/*.conf`

그 밖의 파일은 우측 하단 언어 모드에서 `Nginx`를 직접 선택하면 됩니다.

### 사용자 지정 파일 연결 (settings.json)

특정 확장자나 사용자 정의 파일을 항상 nginx 언어로 연결하려면 VS Code 설정(settings.json)에 아래 내용을 추가하세요.

```json
"files.associations": {
  "*.zone": "nginx",
  "*.conf": "nginx",
  "*.conf.d": "nginx"
}
```

---

## ⚙️ 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `nginx-conf-doctor.extraDirectives` | `[]` | 서드파티 모듈 등 이 확장이 모르는 지시어 이름. 여기에 적으면 "알 수 없는 지시어" 경고가 사라집니다. |
| `nginx-conf-doctor.contextSeverity` | `warning` | "이 위치에서는 쓸 수 없는 지시어" 경고의 표시 수준 (`error` / `warning` / `information` / `off`) |
| `nginx-conf-doctor.unknownDirectiveSeverity` | `warning` | 알 수 없는 지시어의 표시 수준 (`error` / `warning` / `information` / `off`) |

---

### 권장 VS Code 설정 (settings.json)



```json
"[nginx]": {
  "editor.suggest.insertMode": "insert",
  "editor.insertSpaces": true,
  "editor.tabSize": 4,
  "editor.autoIndent": "full",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "buddham-hq.nginx-conf-doctor"
}
```

### 예: 서드파티 모듈 지시어 허용

```json
{
  "nginx-conf-doctor.extraDirectives": [
    "more_set_headers",
    "brotli",
    "brotli_types"
  ]
}
```

## 📋 요구 사항

- VS Code `1.90.0` 이상

## ⚠️ 알려진 제한

- nginx를 실제로 실행해서 검사하는 도구가 아닙니다. 최종 검증은 서버에서 `nginx -t`로 하세요.
- `include`로 불러오는 다른 파일의 내용은 분석하지 않습니다.
- 서드파티 모듈 지시어는 `extraDirectives`에 등록해야 경고가 사라집니다.

## 🛠️ 개발

```bash
npm install

npm run gen:grammar      # 구문 강조 문법 생성
npm run gen:directives   # 지시어 데이터 생성
npm run check            # 설정 파일 점검 스크립트
npm run mutate           # 변이 검사
npm run test:unit        # 단위 테스트
```

패키징은 아래 명령을 사용합니다.

```bash
npx vsce package
```

## 📝 릴리스 노트

### 0.0.6

- Nginx 전용 포맷터(Document Formatting Provider) 들여쓰기 규칙 개선
- 버그 수정, tests 153

### 0.0.5

- Nginx 전용 포맷터(Document Formatting Provider) 탑재 및 들여쓰기 규칙 개선

- README.md 내 포맷터 권장 설정([nginx]) 및 파일 연관(files.associations) 안내 추가

### 0.0.3

- 마우스 호버 도움말 안내문 버그 수정

배포 키워드 목록 보강

### 0.0.2

- 아이콘 및 마켓플레이스 소개 페이지 정비

### 0.0.1

- 최초 릴리스
- 구문 강조, 구조/컨텍스트/알 수 없는 지시어 진단, 빠른 수정, 자동완성, hover 문서

## 📄 라이선스

[MIT](LICENSE)
