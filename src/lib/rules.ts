// 미리캔버스 디자인허브 기여자 규칙 — 앱 전체의 단일 기준(Single source of truth).
// 이 파일을 바꾸면 자동 검수·체크리스트·AI 프롬프트가 모두 같이 바뀐다.
// 원문 요약은 RULES.md 참고.

export type ElementType = 'background' | 'png' | 'svg' | 'video'

export const TYPE_LABEL: Record<ElementType, string> = {
  background: '배경',
  png: 'PNG 요소',
  svg: 'SVG 요소',
  video: '동영상',
}

export const TYPE_FOLDER: Record<ElementType, string> = {
  background: '배경',
  png: 'PNG',
  svg: 'SVG',
  video: '동영상',
}

export interface FileSpec {
  ext: string
  mime: string
  minDpi: number | null
  /** 긴 변 기준 최소 px */
  minPx: number | null
  /** PNG 요소: 아이콘·이모티콘·캐릭터 사이즈일 때 최소 px */
  minPxSmall?: number
  /** 긴 변 기준 최대 px */
  maxPx: number | null
  maxMB: number
  maxSeconds?: number
}

// 파일 규격 확인하기 표
export const SPECS: Record<ElementType, FileSpec> = {
  background: { ext: 'jpg', mime: 'image/jpeg', minDpi: 120, minPx: 2500, maxPx: 9800, maxMB: 50 },
  png: { ext: 'png', mime: 'image/png', minDpi: 120, minPx: 1500, minPxSmall: 700, maxPx: 9800, maxMB: 50 },
  svg: { ext: 'svg', mime: 'image/svg+xml', minDpi: 72, minPx: null, maxPx: 6000, maxMB: 0.15 },
  video: { ext: 'mp4', mime: 'video/mp4', minDpi: null, minPx: null, maxPx: null, maxMB: 120, maxSeconds: 30 },
}

/** SVG 요소: 색상 5개 이하 */
export const SVG_MAX_COLORS = 5
/** 요소 크롭: 사방 여백 허용치(긴 변 대비 비율) — "여백 거의 없게" */
export const CROP_MARGIN_MAX_RATIO = 0.01
/** 잔여 픽셀로 볼 조각 크기(전체 불투명 면적 대비) */
export const SPECK_RATIO = 0.0015

export const ASPECTS = [
  { id: '16:9', w: 16, h: 9, note: '프레젠테이션·유튜브 썸네일' },
  { id: '9:16', w: 9, h: 16, note: '릴스·쇼츠·스토리' },
  { id: '1:1', w: 1, h: 1, note: 'SNS 피드' },
  { id: '4:5', w: 4, h: 5, note: '인스타 세로 피드' },
  { id: '4:3', w: 4, h: 3, note: '문서·슬라이드' },
  { id: '3:4', w: 3, h: 4, note: '세로 포스터' },
  { id: 'A4', w: 210, h: 297, note: 'A4 세로 문서' },
] as const
export type AspectId = (typeof ASPECTS)[number]['id']

export interface Rule {
  id: string
  group: 'ai-before' | 'ai-upload' | 'ai-reject' | 'quality' | 'legal' | 'type'
  types: ElementType[] | 'all'
  text: string
  detail?: string
  /** auto: 앱이 자동 판정 / manual: 사람이 확인해야 체크 가능 / ai: AI 비전 검수 대상(사람 확인도 필요) */
  mode: 'auto' | 'manual' | 'ai'
}

const ALL: 'all' = 'all'
const ELEMENTS: ElementType[] = ['png', 'svg']
const IMAGES: ElementType[] = ['background', 'png', 'svg']

export const GROUP_LABEL: Record<Rule['group'], string> = {
  'ai-before': 'AI 요소 제작 전',
  'ai-upload': 'AI 요소 업로드 전',
  'ai-reject': 'AI 요소 대표 거부사유',
  quality: '품질 가이드',
  legal: '법률 가이드',
  type: '타입별 가이드',
}

export const RULES: Rule[] = [
  // 📌 AI 요소 제작 전
  { id: 'tos', group: 'ai-before', types: ALL, mode: 'manual', text: '사용한 AI 생성 프로그램의 약관·라이선스상 상업적 이용이 가능하다', detail: '약관 미검토로 타인의 권리를 침해하면 협의·보상 책임은 기여자 본인에게 있음' },
  { id: 'guide-meet', group: 'ai-before', types: ALL, mode: 'manual', text: 'AI로 만들었어도 이용가이드 기준을 모두 충족한다', detail: '기준 미충족 시 거부, 법적 책임은 기여자 본인' },

  // 📌 AI 요소 업로드 전
  { id: 'ai-flag', group: 'ai-upload', types: ALL, mode: 'manual', text: "업로드 시 '생성형 AI로 만든 콘텐츠라면 체크해주세요'를 체크한다", detail: '디자인 프로그램으로 편집했더라도 AI로 시작했으면 반드시 체크' },
  { id: 'own-prompt', group: 'ai-upload', types: ALL, mode: 'auto', text: '내가 직접 작성한 프롬프트로 만들었고, 프롬프트 기록이 저장돼 있다', detail: '관리자 요청 시 증빙 필요 — 앱이 프롬프트 기록을 저장' },

  // ⛔️ 대표 거부사유
  { id: 'no-deform', group: 'ai-reject', types: ALL, mode: 'ai', text: '일그러지거나 상식에 반하는 불완전한 형태가 없다', detail: '손가락 개수, 뭉개진 선, 이상한 글자, 비대칭 눈 등' },
  { id: 'no-uncanny', group: 'ai-reject', types: ALL, mode: 'ai', text: '불쾌한 골짜기·불쾌감·혐오감을 주는 과도한 표현이 없다' },
  { id: 'no-prompt-abuse', group: 'ai-reject', types: ALL, mode: 'auto', text: '같은 프롬프트로 찍어낸 유사 요소가 아니다(독창성)', detail: '기존 프롬프트·이미지와 유사도를 자동 비교' },

  // 품질 가이드
  { id: 'no-phone', group: 'quality', types: ALL, mode: 'manual', text: '스마트폰으로 촬영한 콘텐츠가 아니다' },
  { id: 'fit-service', group: 'quality', types: ALL, mode: 'manual', text: '미리캔버스 디자인에 실제로 쓸 만한 콘텐츠다' },
  { id: 'recognizable', group: 'quality', types: ALL, mode: 'ai', text: '형태를 알아볼 수 있다' },
  { id: 'no-transparency', group: 'quality', types: IMAGES, mode: 'auto', text: '투명도가 과도하게 적용되지 않았다' },
  { id: 'no-filter', group: 'quality', types: ALL, mode: 'manual', text: '필터가 적용되지 않았다' },

  // 법률 가이드
  { id: 'no-portrait', group: 'legal', types: ALL, mode: 'ai', text: '실존 인물의 초상이 확인되지 않는다(초상권 계약 불필요)' },
  { id: 'no-property', group: 'legal', types: ALL, mode: 'ai', text: '재산권 있는 피사체(유명 건물·빌딩·자동차 등)가 없다' },
  { id: 'no-artwork', group: 'legal', types: ALL, mode: 'ai', text: '미술품·조각·건축 등 저작물이 포함되지 않았다' },
  { id: 'no-logo', group: 'legal', types: ALL, mode: 'ai', text: '제3자 로고·상표·워터마크·글자가 없다' },
  { id: 'no-names', group: 'legal', types: ALL, mode: 'auto', text: '제목·키워드에 작가명·캐릭터명·브랜드명이 없다' },
  { id: 'commercial', group: 'legal', types: ALL, mode: 'manual', text: '상업적으로 사용할 수 있다' },
  { id: 'not-client', group: 'legal', types: ALL, mode: 'manual', text: '고객 의뢰로 만들어 고객이 저작권을 가진 콘텐츠가 아니다' },
  { id: 'no-illegal', group: 'legal', types: ALL, mode: 'ai', text: '불법·음란·명예훼손 내용이 없다' },

  // 타입별 가이드
  { id: 'single-object', group: 'type', types: [...ELEMENTS, 'video'], mode: 'auto', text: '한 파일에 하나의 피사체만 있다(단일 객체로 분리)' },
  { id: 'bg-removed', group: 'type', types: ELEMENTS, mode: 'auto', text: '배경이 완벽하게 제거됐다(흰 테두리·잔여 픽셀 없음)' },
  { id: 'tight-crop', group: 'type', types: ELEMENTS, mode: 'auto', text: '요소 사이즈 크롭 — 사방 여백이 거의 없다' },
  { id: 'svg-colors', group: 'type', types: ['svg'], mode: 'auto', text: `색상이 ${SVG_MAX_COLORS}개 이하다` },
  { id: 'svg-simple', group: 'type', types: ['svg'], mode: 'manual', text: '복잡하지 않은 형태다(3D·그라데이션은 PNG로)' },
  { id: 'svg-crack', group: 'type', types: ['svg'], mode: 'manual', text: '도형 사이 틈(크랙)이 보이지 않는다', detail: '확대해서 경계선 사이 흰 틈 확인' },
  { id: 'svg-no-raster', group: 'type', types: ['svg'], mode: 'auto', text: 'SVG 안에 비트맵 이미지·텍스트 객체가 없다' },
  { id: 'one-format', group: 'type', types: ELEMENTS, mode: 'auto', text: '같은 디자인을 SVG/PNG 두 타입으로 중복 업로드하지 않는다', detail: '가급적 색상 변경이 가능한 SVG 권장' },
  { id: 'no-recolor', group: 'type', types: ALL, mode: 'auto', text: '디자인 수정 없이 색만 바꾼 동일 요소가 아니다' },
  { id: 'png-type', group: 'type', types: ['png'], mode: 'manual', text: '실사 느낌이면 “배경 제거 사진”, 그림·아트·3D·그라데이션이면 PNG 요소로 분류했다' },
  { id: 'bg-no-photo', group: 'type', types: ['background'], mode: 'ai', text: '실사 사진이 아니다(사진은 “사진” 타입으로 제출)' },
  { id: 'bg-no-subject', group: 'type', types: ['background'], mode: 'ai', text: '인물·동물·사물 등 피사체가 없다(그래픽/추상 또는 조화로운 패턴만)' },
  { id: 'bg-rect', group: 'type', types: ['background'], mode: 'auto', text: '투명 영역 없는 사각형이며 선택한 비율과 맞다' },
  { id: 'spec', group: 'type', types: ALL, mode: 'auto', text: '파일 규격(확장자·해상도·DPI·용량·길이)을 지킨다' },
]

export function rulesFor(type: ElementType): Rule[] {
  return RULES.filter((r) => r.types === 'all' || r.types.includes(type))
}

/** 키워드·제목에 쓰면 안 되는 단어(캐릭터·브랜드·작가) — 설정에서 추가 가능 */
export const BANNED_WORDS = [
  '디즈니', 'disney', '마블', 'marvel', '포켓몬', 'pokemon', '피카츄', '산리오', 'sanrio', '헬로키티', 'hello kitty',
  '카카오', '카카오프렌즈', '라이언', '춘식이', '라인프렌즈', 'bt21', '짱구', '뽀로로', '핑크퐁', '아기상어', '지브리', 'ghibli',
  '토토로', '미피', 'miffy', '스누피', 'snoopy', '도라에몽', '원피스', '나이키', 'nike', '아디다스', 'adidas', '애플', 'apple',
  '삼성', 'samsung', '스타벅스', 'starbucks', '코카콜라', 'coca cola', '맥도날드', '샤넬', 'chanel', '루이비통', '구찌', 'gucci',
  '레고', 'lego', '바비', 'barbie', '미키', 'mickey', '반고흐', 'van gogh', '고흐', '피카소', 'picasso', '모네', 'monet',
  'greg rutkowski', 'in the style of', '스타일로', '풍으로',
]

/** 프롬프트 생성 시 AI에게 강제로 주입되는 규칙 */
export const PROMPT_RULES: Record<ElementType, string> = {
  png: [
    'Output: ONE single isolated subject only (never a group scene, never multiple separate objects).',
    'Pure flat white (#FFFFFF) background, no shadow on the ground, no frame, no border, subject fully inside the canvas with small even padding.',
    'Illustration / art / 3D / gradient allowed. Clean, complete anatomy and shapes (no deformed hands, no extra fingers, no melted details).',
    'Absolutely no text, letters, numbers, logos, watermarks, signatures, brand marks.',
    'No real people likeness, no famous buildings, cars, artworks or copyrighted characters. Never write "in the style of <artist>".',
    'Friendly, commercially usable, not creepy (avoid uncanny valley).',
  ].join('\n'),
  svg: [
    'Output: ONE single isolated subject only.',
    `Flat vector illustration, simple bold shapes, at most ${SVG_MAX_COLORS} solid colors, NO gradients, NO textures, NO shading, NO noise, NO 3D.`,
    'Pure flat white (#FFFFFF) background, no drop shadow, no frame, subject fully inside the canvas with small even padding.',
    'Thick clean outlines or clean filled shapes, few small details (it will be auto-traced to SVG).',
    'Absolutely no text, letters, numbers, logos, watermarks, brand marks, copyrighted characters, real people likeness.',
  ].join('\n'),
  background: [
    'Output: a full-bleed rectangular BACKGROUND that fills the entire canvas edge to edge.',
    'ALLOWED: abstract graphic illustration with NO subject (shapes, gradients, waves, blobs, textures, sky/nature-like color fields without objects), OR a harmonious repeating pattern where no single subject stands out.',
    'FORBIDDEN: photographs or photorealism, any people, animals, characters, or prominent objects/scenes (e.g. a beach scene with furniture, a lab with bottles).',
    'Leave calm space so text can be placed on top. No text, letters, logos, watermarks, frames, borders.',
  ].join('\n'),
  video: [
    'Output: a short loopable motion clip under 30 seconds, one clear subject or abstract motion graphic.',
    'No text, logos, watermarks, real people likeness, famous landmarks or copyrighted characters.',
    'Smooth, clean, commercially usable, no uncanny faces.',
  ].join('\n'),
}
