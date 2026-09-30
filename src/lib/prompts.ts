// AI 작업별 시스템/사용자 프롬프트. 모든 작업에 rules.ts 규칙이 주입된다.
import type { AiRequest } from './ai'
import { PROMPT_RULES, RULES, TYPE_LABEL, rulesFor, type ElementType } from './rules'
import { ymd } from './utils'

const BASE_TEXT = `너는 미리캔버스 디자인허브와 툴디(한국 디자인 플랫폼)에 '요소'를 판매하는 기여자(YESDELIGHT)의 기획 파트너야.
판매 타입은 배경(background), PNG 요소(png), SVG 요소(svg), 동영상(video) 4가지이고 템플릿은 만들지 않아.
미리캔버스 사용자는 주로 한국의 학생·교사·소상공인·마케터·직장인으로 PPT, 카드뉴스, 포스터, SNS 게시물, 상세페이지를 만든다.
- SVG 요소: 색 ${5}개 이하의 단순한 플랫 일러스트, 단일 피사체. 색 변경이 가능해 수요가 높음.
- PNG 요소: 단일 피사체, 3D·그라데이션·질감 있는 일러스트.
- 배경: 피사체(인물·동물·사물) 없는 그래픽/추상 또는 조화로운 패턴. 실사 사진 금지.
- 모든 요소: 글자·로고·브랜드·캐릭터·실존 인물·유명 건축물·미술품 금지.
- 거절 잘 되는 것(제안 금지): 기본 도형·선·화살표·말풍선·단순 블롭·폭발 모양처럼 미리캔버스 무료 요소로 대체되는 단순한 형태, 이미 너무 흔한 스테디셀러 꾸미기 요소(기본 하트·별·리본 등). 단순한 소재라도 쓰려면 분명한 디테일·개성·용도를 더해야 함.
- 자주 거절되는 이유: 크롭 실수, 중복 요소(색만 바꾼 것 포함), 색상 정리 미흡, 기본 도형, 품질 문제, 잘못된 키워드.
- 띠·라인·프레임·테두리처럼 늘려 쓰는 요소는 미리캔버스 '확장형 요소'로 올려야 하니, 그런 아이디어는 notes에 "확장형"이라고 표시.
- 같은 요소를 툴디(Tooldi)에도 올릴 수 있으니 한국 디자인 플랫폼 전반에서 쓰임새 있는 소재를 선호.
답변은 한국어로, 요청한 JSON 형식만 코드블록(\`\`\`json) 하나에 출력해. 설명 문장은 쓰지 말고 각 항목은 짧게.`

/** 오늘 날짜를 알려줘야 AI가 '지금'을 기준으로 계획한다 */
const base = () => `${BASE_TEXT}\n오늘 날짜: ${ymd()}`

export function ideasRequest(opts: { focus: string; count: number; existing: string[] }): AiRequest {
  return {
    system: base(),
    prompt: `다음 주제/시기에 맞춰 미리캔버스에서 잘 쓰일 요소 아이디어 ${opts.count}개를 제안해줘.
주제/시기: ${opts.focus}
이미 가진 아이디어(겹치지 않게): ${opts.existing.slice(0, 60).join(', ') || '없음'}

- 하나의 아이디어 = 하나의 단일 피사체(또는 하나의 배경).
- 같은 소재를 구도만 바꾼 것 말고, 실제 디자인에서 쓰임새가 다른 것으로.
- 각 아이디어에 가장 잘 맞는 타입(svg/png/background/video)을 1~2개 골라.
JSON: [{"title":"짧은 이름","types":["svg"],"notes":"쓰임새·스타일 팁 한 줄(40자 이내)","tags":["태그"]}]`,
    effort: 'low',
  }
}

export function trendRequest(opts: { existing: string[] }): AiRequest {
  return {
    system: base(),
    webSearch: true,
    prompt: `웹 검색으로 오늘(${ymd()}) 기준 한국에서 뜨고 있거나 앞으로 6~8주 안에 수요가 커질 디자인 소재·색·스타일 트렌드를 조사해줘.
(예: 시즌 이벤트, 유행하는 밈이 아닌 일반 소재, 인기 컬러, 카드뉴스/SNS에서 많이 쓰는 스타일)
브랜드·캐릭터·연예인·저작물 관련은 제외. 이미 가진 아이디어와 겹치지 않게: ${opts.existing.slice(0, 60).join(', ') || '없음'}
각 트렌드를 바로 만들 수 있는 요소 아이디어로 바꿔서 10개.
JSON: [{"title":"요소 이름","types":["svg"],"notes":"왜 뜨는지 한 줄(40자 이내)","tags":["트렌드 키워드"]}]`,
    effort: 'medium',
  }
}

export function planRequest(opts: { start: string; end: string; seasons: string[]; existingPlans: string[] }): AiRequest {
  return {
    system: base(),
    prompt: `${opts.start}부터 ${opts.end}까지 주 단위 제작 캘린더를 짜줘. 주는 월요일에 시작해.
스톡은 사용 시점보다 4~8주 먼저 올려야 해. 그러니 각 주에는 그 주보다 4~8주 뒤 시즌 요소를 만들도록 배치해.
참고 시즌(날짜): ${opts.seasons.join(', ') || '없음'}
이미 잡힌 테마(겹치지 않게): ${opts.existingPlans.join(', ') || '없음'}
주마다 테마 1개, notes에 그 주에 만들 요소 3~5개를 쉼표로(설명 없이 이름만).
JSON: [{"title":"주간 테마","start":"YYYY-MM-DD","end":"YYYY-MM-DD","types":["svg","png"],"notes":"요소1, 요소2, 요소3"}]`,
    effort: 'medium',
  }
}

export function imagePromptsRequest(opts: { topic: string; type: ElementType; count: number; previous: string[]; style?: string }): AiRequest {
  return {
    system: base(),
    prompt: `'${opts.topic}'를 ${TYPE_LABEL[opts.type]}로 만들 이미지 생성 프롬프트(영어) ${opts.count}개를 써줘.
${opts.style ? `원하는 스타일: ${opts.style}\n` : ''}반드시 지킬 규칙:
${PROMPT_RULES[opts.type]}

어뷰징 방지: ${opts.count}개 프롬프트는 서로 소재 디테일·구도·포즈·스타일이 확실히 달라야 하고, 아래 기존 프롬프트와도 달라야 해(같은 프롬프트 반복 생성은 거부 사유).
기존 프롬프트: ${opts.previous.slice(-15).join(' || ') || '없음'}
JSON: [{"prompt":"영어 프롬프트","memo":"한국어로 이 버전의 차별점"}]`,
    effort: 'low',
  }
}

export function metadataRequest(opts: { topic: string; type: ElementType; prompt?: string }): AiRequest {
  return {
    system: base(),
    prompt: `미리캔버스 ${TYPE_LABEL[opts.type]} '${opts.topic}'의 업로드 정보를 써줘.
${opts.prompt ? `생성 프롬프트: ${opts.prompt}\n` : ''}- 제목: 한국어, 짧고 검색되는 명사형(예: "단풍잎 플랫 일러스트").
- 키워드: 한국어 20~30개. 요소와 직접 관련 없는 키워드는 거절 사유(잘못된 키워드)이니 넣지 마. 사용자가 실제 검색할 단어(소재, 용도, 시즌, 분위기, 색, 스타일). 영어 1~3개 섞어도 됨.
- 작가명·캐릭터명·브랜드명·"~풍", "~스타일로" 금지. 중복·무관한 키워드 금지.
JSON: {"title":"...","keywords":["..."]}`,
    effort: 'low',
  }
}

export function reviewRequest(type: ElementType): AiRequest {
  const aiRules = rulesFor(type).filter((r) => r.mode === 'ai')
  return {
    system: base() + '\n너는 엄격한 디자인허브 심사자야. 애매하면 통과시키지 말고 문제를 지적해.',
    prompt: `첨부한 ${TYPE_LABEL[type]} 이미지를 아래 규칙으로 심사해줘.
${aiRules.map((r) => `- [${r.id}] ${r.text}${r.detail ? ` (${r.detail})` : ''}`).join('\n')}
추가로 AI 생성물 특유의 결함(뭉개진 선, 이상한 글자, 손가락, 비대칭, 잔여 점)을 찾아줘.
JSON: {"results":[{"ruleId":"...","ok":true,"note":"근거"}],"issues":["발견한 결함"],"verdict":"pass|fix|reject","summary":"한 줄 총평"}`,
    effort: 'medium',
  }
}

export function allRulesText() {
  return RULES.map((r) => `- ${r.text}`).join('\n')
}
