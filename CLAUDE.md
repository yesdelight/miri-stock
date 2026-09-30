# YESDELIGHT Stock Studio (저장소·폴더 이름은 miri-stock 그대로)

미리캔버스 디자인허브에 올릴 **요소**(배경·PNG·SVG·동영상)를 기획→제작→검수→관리하는 개인용 웹앱. 템플릿은 다루지 않는다.

## 절대 규칙
- 디자인허브 규칙은 `src/lib/rules.ts`(판정 기준)와 `RULES.md`(원문 요약)에 있다. 기능을 바꿀 때 규칙을 느슨하게 만들지 말 것.
  규칙을 바꾸면 두 파일을 같이 고친다.
- “업로드 준비 완료”는 자동 검수 실패 0, 경고는 사용자 확인, 직접 확인 항목 전부 체크일 때만 활성화된다(`Workbench.tsx` ReviewStep의 gate).
- AI 생성물은 항상 AI 체크 대상. 프롬프트 기록(`promptLog`)은 증빙이므로 지우지 않는다.

## 구조
- Vite + React + TypeScript, 서버 없음. 데이터는 브라우저 IndexedDB(Dexie, `src/lib/db.ts`), 설정·API 키는 localStorage.
- 파일은 IndexedDB에 **Blob으로 넣지 않는다**(Safari/맥 Dock 웹앱에서 저장·읽기 실패). 항상 `putBlob`/`getBlob`을 쓰고, 업로드된 File은 `toMemoryBlob`으로 복사해서 쓴다. 시작 시 `migrateBlobs`가 예전 형식을 변환한다.
- `src/lib/imaging.ts` 배경 제거·크롭·DPI 기록·dHash / `vectorize.ts` SVG 변환 / `checks.ts` 자동 검수 / `ai.ts` Claude(SDK)·OpenAI·Gemini / `drive.ts` Google Drive.
- 올리는 사이트(디자인허브·툴디·Adobe Stock…)는 설정의 `sites`. 요소의 심사는 사이트별 `item.sites[id]`에 기록하고, `item.status`(심사 중·판매 중·거부됨)는 `summarizeSites`로 계산한다 — 직접 바꾸지 말고 `src/lib/sites.ts`의 `sitePatch`를 쓴다. 검수 규칙은 디자인허브 기준.
- 화면: 대시보드·캘린더(`Dashboard`, `Planner`), 작업대(`Workbench`), 보관함·수익(`Library`, `Revenue`), 규칙, 설정.

## 명령
- `npm run dev` / `npm run build` / `npx tsc -b` / `npx oxlint`
- main에 푸시하면 `.github/workflows/deploy.yml`이 GitHub Pages로 배포.
