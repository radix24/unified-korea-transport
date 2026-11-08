// 철도 운영사: 남측 코레일, 북측 KPRail (합병하면 하나의 통합 공사).
// 코레일 로고는 실제 로고(위키미디어 공용, 상표)이고, KPRail·통합 공사는 게임 속 가상 회사라 게임에서 그린 표시다.
import { badgeStyle } from './color.js';

export const OPERATORS = {
  korail: { name: '코레일', en: 'KORAIL', color: '#163E7A', logo: 'assets/brand/korail.svg' },
  kprail: { name: 'KPRail', en: 'KPRail', color: '#8E1F2C', logo: 'assets/brand/kprail.svg' },
  merged: { name: '통합 철도공사', en: 'K-RAIL', color: '#4B2A78', logo: 'assets/brand/merged.svg' },
};

/** 운영사별 운임·비용 보정: 북측은 운임이 낮고(통합도만큼 오른다), 인건비·전력비도 낮다 */
export const OP_FACTORS = {
  kpFare: (integration) => 0.3 + 0.7 * integration,
  kpCost: 0.6,          // 열차 운행비 (인건비·전력비가 낮다)
  kpTrackCost: 0.3,     // 선로 유지비: 북측은 보수 수준이 낮고 인건비가 싸다 (첫해 영업계수가 수천이 되지 않게)
  kpMinTrains: 0.25,    // 북측은 지금 운행 횟수가 적다 (최소 운행 열차를 이만큼만, 하루 4회 남짓)
  mergedCost: 0.95,     // 합병 뒤 중복 조직·차량기지 정리
};

export const RAIL_START = { korailCash: 10000, kprailCash: 0 };   // 억원
export const MERGE_MIN_INTEGRATION = 0.4;
export const EQUITY_STEP = 5000;   // 출자 한 번 (억원)

export function initRail(state) {
  state.rail ||= {
    merged: false, name: '', fund: 'gov',
    ops: { korail: { cash: RAIL_START.korailCash, hist: [] }, kprail: { cash: RAIL_START.kprailCash, hist: [] } },
  };
  return state.rail;
}

/** 링크를 맡는 운영사 id (철도가 아니면 null) */
export function operatorOf(state, link) {
  if (!link || link.mode !== 1 || link.ext) return null;
  if (state.rail?.merged) return 'merged';
  return link.kp ? 'kprail' : 'korail';
}

export function opInfo(state, op) {
  const o = OPERATORS[op];
  return op === 'merged' && state.rail?.name ? { ...o, name: state.rail.name } : o;
}

export function opBadge(state, op) {
  if (!op) return '';
  const o = opInfo(state, op);
  return `<span class="op-badge" style="${badgeStyle(o.color)}" title="${o.name}">${op === 'merged' ? o.name : o.en}</span>`;
}

// 도시철도 운영 기관 (2026.11 메일 건의): 지방공기업·민자 운영사를 노선 이름과 자리로 가른다 (표시용, 재정은 정부 예산과 같이 센다)
export const METRO_OPERATORS = {
  seoul: { name: '서울교통공사', en: 'Seoul Metro', color: '#1E5AA8' },
  metro9: { name: '서울시메트로9호선', en: 'Metro 9', color: '#BDB092' },
  busan: { name: '부산교통공사', en: 'Humetro', color: '#E8423A' },
  daegu: { name: '대구교통공사', en: 'DTRO', color: '#2E8B57' },
  incheon: { name: '인천교통공사', en: 'Incheon TC', color: '#4C7CC0' },
  gwangju: { name: '광주교통공사', en: 'GRTC', color: '#009A44' },
  daejeon: { name: '대전교통공사', en: 'DJET', color: '#007448' },
  pyongyang: { name: '평양지하철관리국', en: 'Pyongyang Metro', color: '#B5232A' },
};
// 광역시 자리 (경도·위도 상자): 이름으로 못 가른 도시철도 구간
const METRO_AREAS = [
  ['seoul', 126.76, 37.42, 127.19, 37.71], ['incheon', 126.35, 37.33, 126.79, 37.62], ['busan', 128.85, 35.03, 129.3, 35.4],
  ['daegu', 128.45, 35.75, 128.75, 36.0], ['gwangju', 126.7, 35.05, 127.0, 35.27], ['daejeon', 127.25, 36.2, 127.5, 36.5],
  ['pyongyang', 125.6, 38.9, 125.9, 39.15],
];
export function metroOperatorOf(link) {
  if (!link || link.mode !== 2) return null;
  const n = link.name || '';
  const key = /9호선/.test(n) && !/부산|대구|인천|광주|대전/.test(n) ? 'metro9'
    : /^서울|우이신설|신림선/.test(n) ? 'seoul' : /^부산/.test(n) ? 'busan' : /^대구/.test(n) ? 'daegu'
    : /^인천/.test(n) ? 'incheon' : /^광주/.test(n) ? 'gwangju' : /^대전/.test(n) ? 'daejeon'
    : /천리마|혁신|평양/.test(n) ? 'pyongyang' : null;
  if (key) return METRO_OPERATORS[key];
  const x = link.geom?.[0], y = link.geom?.[1];
  const hit = METRO_AREAS.find(([, x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
  return hit ? METRO_OPERATORS[hit[0]] : null;
}
export function metroOpBadge(link) {
  const o = metroOperatorOf(link);
  return o ? `<span class="op-badge" style="${badgeStyle(o.color)}" title="${o.name}">${o.name}</span>` : '';
}

// 국외 철도 운영사 (국제 열차 운행 현황): 로고는 위키미디어 공용의 공용 영역 파일이며 각 회사의 상표다 (비상업 식별용).
export const FOREIGN_OPERATORS = {
  CN: { name: '중국국가철로', en: 'China Railway', color: '#B22222', logo: 'assets/brand/cr.svg' },
  JP: { name: 'JR', en: 'JR', color: '#1E7B4A', logo: 'assets/brand/jr.svg' },
  RU: { name: '러시아철도', en: 'RZD', color: '#7A1E1E', logo: 'assets/brand/rzd.svg' },
};

export function foreignOpBadge(country) {
  const o = FOREIGN_OPERATORS[country];
  return o ? `<span class="op-badge" style="${badgeStyle(o.color)}" title="${o.name}">${o.en}</span>` : '';
}
