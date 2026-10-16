# publish


```bash
# =========================================================================
# 🩺 Hun Nginx 설정 닥터 출정 스크립트 (v0.0.2)
# =========================================================================

# 📦 1단계: VSIX 빌드로 마지막 점검 (이미 해 보았으니 가볍게)
npx vsce package
# → nginx-conf-doctor-0.0.2.vsix 가 정갈하게 산출됨

# 🐙 2단계: Git 스테이징 및 대제독의 수려한 커밋 집도
git add package.json README.md LICENSE extension.js icon_256.png

git commit -m "feat: Hun Nginx 설정 닥터 얼굴 단장 및 마켓플레이스 출정 준비 🩺🎨 (v0.0.2)
- 확장의 얼굴을 새로 빚다
  - 중괄호 { } 와 심전도 선을 형상화한 독자 아이콘(icon_256.png) 제작 — nginx 공식 로고와 저작권 시비를 원천 차단
  - displayName을 'Hun Nginx 설정 닥터'로 확정하고, 한글/영문 병기 description으로 검색 노출 강화
- README 상단 대개편
  - 설치·소스·피드백 버튼과 버전/라이선스/커밋 배지, 목차 링크, 진단 예시를 갖춘 마켓플레이스 소개 페이지로 재탄생
  - 서비스가 종료된 마켓플레이스 배지 대신 정적 배지를 사용하여 'retired badge' 오표시 방지
- package.json: 배포 규격 정비
  - galleryBanner, capabilities(신뢰하지 않는 작업 공간 / 가상 작업 공간 지원), qna, keywords 보강
  - lint / test / package 스크립트 및 @vscode/vsce 개발 의존성 추가
  - 배포 규격에 맞추어 버전을 v0.0.2로 상향 조정"

# 🏷️ 3단계: 영광스러운 깃 태그 생성 및 origin 푸시 감행
git tag -a v0.0.2 -m "Hun Nginx 설정 닥터 아이콘·소개 페이지·배포 규격 정비 — v0.0.2"
git push origin main --follow-tags

# 🚀 4단계: GitHub 릴리스 생성 및 VSIX 전송 작전
gh release create v0.0.2 nginx-conf-doctor-0.0.2.vsix \
  --title "v0.0.2" \
  --notes "### 🩺 v0.0.2 Hun Nginx 설정 닥터 단장 패치 내역
1. **독자 아이콘 탑재:** 중괄호와 심전도 선으로 '설정 파일의 의사'를 형상화했습니다. nginx 공식 로고와는 무관한 오리지널 디자인입니다.
2. **마켓플레이스 소개 페이지 대개편:** 설치/소스/피드백 버튼, 배지, 목차, 진단 예시가 담긴 새 README로 거듭났습니다.
3. **배포 규격 정비:** 갤러리 배너, 작업 공간 지원 선언, 키워드 보강 및 패키징·테스트 스크립트를 갖추었습니다."

# 🛍️ 5단계: VS Code Marketplace 최종 게시 (천하 선포)
vsce publish
# package.json에 반영된 v0.0.2 규격 그대로 마켓플레이스에 게시됩니다.
```
