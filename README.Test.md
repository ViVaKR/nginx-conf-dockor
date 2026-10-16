# Test


```bash

npm run check -- ./nginx
npm run mutate -- ./nginx/nginx.conf

npx @vscode/vsce ls        # 패키지에 들어갈 파일 목록
npx @vscode/vsce package   # .vsix 생성

git ls-files | grep -E '\.conf$|^nginx/'
git rm -r --cached nginx kimbumjun.com.conf test.nginx.conf

npx vsce package
code --install-extension nginx-conf-doctor-0.0.1.vsix

```

- F5 수동 확인 중 아직 못 본 것들

- listen 80;을 location 안에 넣으면 노란 밑줄이 뜨고, hover에 사용 가능한 위치가 나오는지.

- server 안에서 proxy_pass가 자동완성에 안 뜨고 location 안에서는 뜨는지.

- 자동완성에서 location을 골랐을 때 location / { } 스니펫이 들어가는지.

- nginx.conf 최상위의 빈 줄에서는 user, events, http 같은 main 지시어만 나오는지.

- hover를 server나 location 블록 이름과 "$http_origin" 위에 올렸을 때 설명이 나오는지.

- 설정 화면(Cmd+,)에서 nginx-conf-doctor를 검색하면 항목이 3개 보이는지.
