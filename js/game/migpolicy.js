// 이주 정책 (메일 건의로 개편): 북→남, 남→북, 북측 안 이주를 따로 정한다.
// 정책마다 해마다 통합도(integ, 0~1 단위)와 지지율 요인(appr, 점)이 붙고, 계산 워커에는 이주 배율·인구 이동을 넘긴다.

export const MIG_POLICY = {
  ns: {
    label: '북→남 이주', key: 'policy', def: 'limited',
    opts: {
      free: { label: '자유 이주', integ: 0.006, appr: -3, hint: '남하가 크게 늘어 통합은 빨라지지만 남측 주거·일자리 부담으로 지지율이 내립니다' },
      limited: { label: '이주 허가제', integ: 0.002, appr: -1, hint: '허가받은 만큼만 남하합니다' },
      closed: { label: '이주 통제', integ: -0.004, appr: 2, hint: '북측 인구는 지켜지지만 통합이 더뎌집니다' },
    },
  },
  sn: {
    label: '남→북 이주', key: 'policySN', def: 'permit',
    opts: {
      free: { label: '자유 이주', integ: 0.004, appr: -2, mult: 1.5, hint: '북측 개발지로 가는 남측 인구가 늡니다' },
      permit: { label: '이주 허가제', integ: 0.002, appr: 1, mult: 1, hint: '지금과 같습니다' },
      forced: { label: '강제 이주 (공공기관·군 이전)', integ: 0.006, appr: -4, mult: 2.5, hint: '공공기관·군부대·공기업 인력을 북측으로 보냅니다. 통합은 빨라지지만 반발이 큽니다' },
    },
  },
  nn: {
    label: '북측 안 이주', key: 'policyNN', def: 'permit',
    opts: {
      free: { label: '자유 이주', integ: -0.003, appr: 2, hint: '도 중심도시와 평양으로 사람이 몰립니다. 15년에 걸쳐 접근성 0.05 이하 지역은 인구 −70%, 0.15 이하 −50%, 0.25 이하 −25%가 되고 그만큼 접근성 높은 곳(0.5 넘으면 두 배)으로 옮깁니다. 시·구역은 30% 넘게 줄지 않고, 시작 인구의 1.3배를 넘은 곳은 집이 모자라 덜 옵니다. 처음 10년은 원산·함흥·청진이 빨리 큽니다' },
      permit: { label: '이주 허가제', integ: 0.002, appr: -1, hint: '지금과 같은 정도의 인구 변화' },
    },
  },
};

/** 그 축의 지금 정책 (예전 저장에는 남→북·북측 안이 없다) */
export function migOpt(state, axis) {
  const A = MIG_POLICY[axis], k = state[A.key] || A.def;
  return A.opts[k] || A.opts[A.def];
}

/** 해마다 더할 통합도 */
export function migIntegration(state) {
  return Object.keys(MIG_POLICY).reduce((t, a) => t + migOpt(state, a).integ, 0);
}

/** 지지율 요인 */
export function migApproval(state) {
  return Object.keys(MIG_POLICY).reduce((t, a) => t + migOpt(state, a).appr, 0);
}

// 북측 안 자유 이주: 몰리는 도 중심도시(자료 이름)와 평양
const CENTERS = ['신의주시', '사리원시', '해주시', '원산시', '함흥시', '청진시'];
// 접근성이 낮아도 자유 이주 처음 10년은 인구가 빨리 느는 동해안 중심도시 (메일 건의)
const EAST = ['원산시', '함흥시', '청진시'];

/**
 * 계산 워커에 넘길 이주 설정. zoneProps: 존 자료 (도·시 이름은 자료 그대로 본다: 량강도·자강도가 없는 시나리오에서도 그 땅)
 * @returns {{sn:number, centers:number[], boost:number, shift:{from:number[], frac:number, to:number[]}[], acc?:{years:number, east:number[]}}}
 */
export function migCtx(state, zoneProps) {
  const out = { sn: migOpt(state, 'sn').mult ?? 1, centers: [], boost: 1, shift: [] };
  if ((state.policyNN || 'permit') !== 'free') return out;
  // 평양은 시가지(구역)만 중심이다: 강동군·강남군 같은 평양시의 군까지 세 배로 끌어 교외가 두세 배로 불었다 (메일 건의)
  const isCenter = (z) => z.country === 'KP' && ((z.province === '평양시' && /구역$/.test(z.name || '')) || CENTERS.includes(z.name) || CENTERS.includes(z.city));
  zoneProps.forEach((z, i) => { if (!z.ext && isCenter(z)) out.centers.push(i); });
  out.boost = 3;
  // 자유 이주를 몇 해째 하고 있나: 해 넘기기에서 먼저 하나 세고(state.js) 이 값을 쓰므로 첫해가 0
  const n = Math.max(0, (state.nnFreeYears || 1) - 1);
  // 산간·오지의 인구 감소는 접근성 기준으로 계산이 맡는다 (model.accessDrift: 예전 량강도·자강도 고정 감소를 대신한다)
  const east = [];
  zoneProps.forEach((z, i) => { if (!z.ext && z.country === 'KP' && (EAST.includes(z.name) || EAST.includes(z.city))) east.push(i); });
  out.acc = { years: n, east };
  return out;
}
