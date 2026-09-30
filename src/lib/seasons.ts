// 한국 시즌·기념일 기본 캘린더. 스톡은 시즌 4~8주 전에 올려야 검색·사용이 붙는다.
import { pad } from './utils'

export interface SeasonEvent {
  title: string
  start: string // YYYY-MM-DD
  end: string
  ideas: string[]
}

// 음력 명절은 연도별 고정 표
const LUNAR: Record<number, { seollal: [string, string]; chuseok: [string, string] }> = {
  2026: { seollal: ['02-16', '02-18'], chuseok: ['09-24', '09-26'] },
  2027: { seollal: ['02-05', '02-07'], chuseok: ['09-14', '09-16'] },
  2028: { seollal: ['01-25', '01-27'], chuseok: ['10-02', '10-04'] },
}

const FIXED: { md: [string, string]; title: string; ideas: string[] }[] = [
  { md: ['01-01', '01-07'], title: '새해·신년', ideas: ['해돋이 그래픽 배경', '떡국 아이콘', '새해 복 주머니', '달력 아이콘'] },
  { md: ['02-14', '02-14'], title: '밸런타인데이', ideas: ['하트 초콜릿', '리본 선물상자', '핑크 하트 패턴 배경'] },
  { md: ['03-01', '03-07'], title: '개학·새 학기', ideas: ['책가방', '연필·노트', '칠판 그래픽 배경', '입학 꽃다발'] },
  { md: ['03-14', '03-14'], title: '화이트데이', ideas: ['사탕', '막대사탕', '파스텔 캔디 패턴'] },
  { md: ['03-25', '04-15'], title: '봄·벚꽃', ideas: ['벚꽃 가지', '벚꽃 패턴 배경', '튤립', '나비'] },
  { md: ['05-01', '05-08'], title: '가정의 달(어린이날·어버이날)', ideas: ['카네이션', '풍선', '장난감 블록', '가족 손하트'] },
  { md: ['05-15', '05-15'], title: '스승의 날', ideas: ['카네이션 꽃다발', '사과와 책'] },
  { md: ['06-20', '08-20'], title: '여름·휴가', ideas: ['수박', '튜브', '파도 그래픽 배경', '선글라스', '아이스크림'] },
  { md: ['10-31', '10-31'], title: '할로윈', ideas: ['잭오랜턴', '유령', '마녀모자', '보라·주황 패턴 배경'] },
  { md: ['09-20', '11-15'], title: '가을·단풍', ideas: ['단풍잎', '도토리', '밤송이', '가을 톤 추상 배경'] },
  { md: ['11-11', '11-11'], title: '빼빼로데이', ideas: ['막대과자', '리본 포장'] },
  { md: ['11-10', '11-20'], title: '수능', ideas: ['합격 부적', '엿', '응원 깃발'] },
  { md: ['12-01', '12-25'], title: '크리스마스', ideas: ['트리', '양말', '선물상자', '눈꽃 패턴 배경', '루돌프', '진저브레드'] },
  { md: ['12-20', '12-31'], title: '연말·송년', ideas: ['샴페인', '폭죽', '골드 반짝이 배경'] },
  { md: ['12-01', '02-28'], title: '겨울', ideas: ['눈사람', '벙어리장갑', '눈 결정 패턴', '붕어빵'] },
]

export function seasonEvents(year: number): SeasonEvent[] {
  const out: SeasonEvent[] = []
  for (const f of FIXED) {
    const endYear = f.md[1] < f.md[0] ? year + 1 : year
    out.push({ title: f.title, start: `${year}-${f.md[0]}`, end: `${endYear}-${f.md[1]}`, ideas: f.ideas })
  }
  const l = LUNAR[year]
  if (l) {
    out.push({ title: '설날', start: `${year}-${l.seollal[0]}`, end: `${year}-${l.seollal[1]}`, ideas: ['복주머니', '한복 저고리', '윷놀이', '세뱃돈 봉투', '전통 문양 배경'] })
    out.push({ title: '추석', start: `${year}-${l.chuseok[0]}`, end: `${year}-${l.chuseok[1]}`, ideas: ['송편', '보름달', '토끼', '감', '전통 문양 배경'] })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start))
}

export function monthKey(y: number, m: number) {
  return `${y}-${pad(m + 1)}`
}
