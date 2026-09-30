# Miri Stock

미리캔버스 디자인허브에 올릴 **요소**(배경·PNG·SVG·동영상)를 기획→제작→검수→관리하는 개인용 웹앱. 템플릿은 다루지 않는다.

## 절대 규칙
- 디자인허브 규칙은 `src/lib/rules.ts`(판정 기준)와 `RULES.md`(원문 요약)에 있다. 기능을 바꿀 때 규칙을 느슨하게 만들지 말 것.
  규칙을 바꾸면 두 파일을 같이 고친다.
- “업로드 준비 완료”는 자동 검수 실패 0, 경고는 사용자 확인, 직접 확인 항목 전부 체크일 때만 활성화된다(`Workbench.tsx` ReviewStep의 gate).
- AI 생성물은 항상 AI 체크 대상. 프롬프트 기록(`promptLog`)은 증빙이므로 지우지 않는다.

## 구조
- Vite + React + TypeScript, 서버 없음. 데이터는 브라우저 IndexedDB(Dexie, `src/lib/db.ts`), 설정·API 키는 localStorage.
- `src/lib/imaging.ts` 배경 제거·크롭·DPI 기록·dHash / `vectorize.ts` SVG 변환 / `checks.ts` 자동 검수 / `ai.ts` Claude(SDK)·OpenAI·Gemini / `drive.ts` Google Drive.
- 화면: 대시보드·캘린더(`Dashboard`, `Planner`), 작업대(`Workbench`), 보관함·수익(`Library`, `Revenue`), 규칙, 설정.

## 명령
- `npm run dev` / `npm run build` / `npx tsc -b` / `npx oxlint`
- main에 푸시하면 `.github/workflows/deploy.yml`이 GitHub Pages로 배포.
