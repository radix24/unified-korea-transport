// 도시 개발 구역: 재개발(시군·구마다), 산업단지, 업무단지. 역세권 개발·경제특구와 같은 사업 틀 (사업비 → 공기 → 완공 때 효과).
// 재개발은 낡은 주거지를 고밀로 다시 지어 인구가 늘고(같은 쪽 다른 곳에서 옮겨 온다) 분양 수익이 예산으로 돌아온다.
// 산업단지·업무단지는 일자리를 만들어 소득이 오르고(목표·수렴 속도) 사람이 모인다. 금액 단위 억원.
import { regionClass } from '../game/devel.js';
import { canAfford, startProject } from '../game/state.js';
import { formatWon } from '../game/catalog.js';
import { powerPct } from '../game/mega.js';
import { esc, result, state, zoneProps } from './core.js';
import { subArea } from './mapdata.js';
import { toModelSub } from './risplit.js';
import { zoneName } from './year.js';

export const ZONE_DEV = {
  // 재개발: 인구의 6%만큼 더 산다 (3천~6만 명). 1명당 0.5억 (북측 0.3억). 밀도 2,000명/km² 넘는 시가지만. 같은 곳은 15년에 한 번
  redev: { label: '도시 재개발', years: 5, share: 0.06, min: 3000, max: 60000, perPerson: 0.5, kpPerPerson: 0.3, minDensity: 2000, happy: 3, again: 15 },
  // 산업단지: 일자리 → 소득 목표 +6%, 수렴 ×1.3, 해마다 편의 +0.01. 노동자 8천 명 유입
  ind: { label: '산업단지 조성', years: 4, cost: 5000, kpCost: 3000, persons: 8000, income: 1.06, conv: 1.3, amenity: 0.01 },
  // 업무단지(도심 사무단지): 밀도 3,000명/km² 넘는 도심만. 소득 목표 +5%, 수렴 ×1.2, 편의 +0.015, 3천 명 유입
  office: { label: '업무단지 조성', years: 4, cost: 7000, kpCost: 4000, persons: 3000, income: 1.05, conv: 1.2, amenity: 0.015, minDensity: 3000 },
};
// 정해진 자리의 대형 도시 개발 사업 (그 시군 창의 도시 개발에 나온다). 인구는 같은 쪽 다른 곳에서 옮겨 오고, 완공되면 정부 청사가 선다
export const SPECIAL_DEV = {
  // 부산 북항 재개발 2단계: 자성대 부두·부산역 철도 부지 일대 228만 m², 사업비 약 20조 원, 2030년 완공 목표. 상주인구 약 10만 명
  'busan-bukhang2': { label: '부산 북항 재개발 2단계', where: ['부산광역시', '동구'], years: 4, cost: 200000, kpCost: 200000, persons: 100000,
    income: 1.04, conv: 1.2, amenity: 0.02, happy: 3, cat: '부산항 재개발', hall: { name: '정부부산지방합동청사', lon: 129.0618, lat: 35.1262 },
    desc: '자성대 부두와 부산역·부산진역 철도 부지를 주거·업무·해양 관광 지구로 (2026년 착공하면 2030년 완공). 상주인구 약 10만 명, 사업 지구 안에 정부부산지방합동청사' },
  // 세종시 개발 (메일 건의 3): 1~3생활권은 이미 지어졌고, 남은 4생활권(해밀동)·5생활권(집현동)·6생활권(반곡동)을 차례로 (앞 생활권을 다 지은 뒤)
  'sejong-4': { label: '세종시 4생활권 개발 (해밀동)', where: ['세종특별자치시', '세종시'], years: 5, cost: 25000, kpCost: 25000, persons: 50000,
    income: 1.02, conv: 1.1, amenity: 0.01, happy: 2, cat: '세종시 개발', desc: '행정중심복합도시 4생활권(해밀동 일대) 주거·대학·산업 지구. 인구 5만 명 증가' },
  'sejong-5': { label: '세종시 5생활권 개발 (집현동)', where: ['세종특별자치시', '세종시'], years: 5, cost: 30000, kpCost: 30000, persons: 60000, after: 'sejong-4',
    income: 1.03, conv: 1.1, amenity: 0.01, happy: 2, cat: '세종시 개발', desc: '5생활권(집현동 일대) 의료·복지·연구 지구. 인구 6만 명 증가 (4생활권을 다 지은 뒤)' },
  'sejong-6': { label: '세종시 6생활권 개발 (반곡동)', where: ['세종특별자치시', '세종시'], years: 5, cost: 45000, kpCost: 45000, persons: 90000, after: 'sejong-5',
    income: 1.03, conv: 1.1, amenity: 0.01, happy: 2, cat: '세종시 개발', desc: '6생활권(반곡동 일대) 첨단지식기반 지구. 인구 9만 명 증가 (5생활권을 다 지은 뒤)' },
  // 평양 만수대 광장 일대를 정비하고 통일 정부의 평양정부청사(중앙 부처 분원)를 짓는다
  'pyongyang-mansudae': { label: '평양 만수대 광장 재개발', where: ['평양시', '중구역'], years: 4, cost: 30000, kpCost: 30000, persons: 15000,
    income: 1.05, conv: 1.2, amenity: 0.02, happy: 2, cat: '평양권 재개발', hall: { name: '평양정부청사', lon: 125.7508, lat: 39.0318 },
    desc: '만수대 광장 일대를 정비하고 평양정부청사를 조성합니다. 공무원·업무 인구 약 1만 5천 명이 들어옵니다' },
  // ---- 북측 대형 도시 개발 (메일 건의: 평양대도시권 개발은 LH 연구를 바탕으로 재구성). zones: 효과·입주를 나누는 존들 [도, 이름, 덮어쓸 값],
  // after: 먼저 다 지어야 하는 단계, from: 늘어난 인구를 덜어 오는 도 (자료의 도 이름), net: 새로 느는 몫, needHDI: [도, HDI]
  'py-1': { label: '평양 대개발 1단계 (형제산·보통강·모란봉·평천)', where: ['평양시', '보통강구역'], years: 5, cost: 150000, kpCost: 150000, persons: 100000,
    zones: [['평양시', '형제산구역'], ['평양시', '보통강구역'], ['평양시', '모란봉구역'], ['평양시', '평천구역']], from: ['평안남도', '황해남도', '황해북도'], net: 0.3,
    income: 1.02, conv: 1.1, amenity: 0.01, happy: 3, cat: '평양권 재개발',
    desc: '낡은 시가지를 재개발하고 녹지를 개발하는 20년 장기 계획(20만 호)의 1단계. 5만 호 공급, 인구 10만 명 증가 (늘어난 인구의 70%는 평안남도·황해도에서 옮겨 온다)' },
  'py-2': { label: '평양 대개발 2단계 (서성·화성·룡성·대성·삼석)', where: ['평양시', '서성구역'], years: 5, cost: 150000, kpCost: 150000, persons: 100000, after: 'py-1',
    zones: [['평양시', '서성구역'], ['평양시', '화성구역'], ['평양시', '룡성구역'], ['평양시', '대성구역'], ['평양시', '삼석구역']], from: ['평안남도', '황해남도', '황해북도'], net: 0.3,
    income: 1.02, conv: 1.1, amenity: 0.01, happy: 3, cat: '평양권 재개발',
    desc: '평양 대개발 2단계. 5만 호 공급, 인구 10만 명 증가 (1단계를 다 지은 뒤)' },
  'py-3': { label: '평양 대개발 3단계 (락랑·칠골)', where: ['평양시', '락랑구역'], years: 5, cost: 150000, kpCost: 150000, persons: 100000, after: 'py-2',
    zones: [['평양시', '락랑구역'], ['평양시', '만경대구역']], from: ['평안남도', '황해남도', '황해북도'], net: 0.3,
    income: 1.02, conv: 1.1, amenity: 0.01, happy: 3, cat: '평양권 재개발',
    desc: '평양 대개발 3단계 (칠골은 만경대구역). 5만 호 공급, 인구 10만 명 증가 (2단계를 다 지은 뒤)' },
  'py-4': { label: '평양 대개발 4단계 (력포·사동)', where: ['평양시', '력포구역'], years: 5, cost: 150000, kpCost: 150000, persons: 100000, after: 'py-3',
    zones: [['평양시', '력포구역'], ['평양시', '사동구역']], from: ['평안남도', '황해남도', '황해북도'], net: 0.3,
    income: 1.02, conv: 1.1, amenity: 0.01, happy: 3, cat: '평양권 재개발',
    desc: '평양 대개발 4단계. 5만 호 공급, 인구 10만 명 증가 (3단계를 다 지은 뒤)' },
  'py-industry': { label: '평양 공업지구 이전', where: ['평양시', '평천구역'], years: 5, cost: 80000, kpCost: 80000, persons: 90000, needHDI: ['평양시', 0.9],
    zones: [['평양시', '만경대구역', { income: 1.08, persons: 6000 }], ['평양시', '보통강구역', { income: 1.08, persons: 6000 }], ['평양시', '평천구역', { income: 1.08, persons: 6000 }],
      ['평양시', '선교구역', { income: 1.08, persons: 6000 }], ['평양시', '대동강구역', { income: 1.08, persons: 6000 }],
      ['남포시', '와우도구역', { income: 1.06, persons: 20000 }], ['남포시', '항구구역', { income: 1.06, persons: 20000 }], ['황해북도', '송림시', { income: 1.06, persons: 20000 }]],
    income: 1.06, conv: 1.2, amenity: 0.01, happy: 2, cat: '평양권 재개발',
    desc: '평양 공업지구(만경대·보통강·평천·선교·대동강구역)의 공장을 송림과 남포 일대로 옮기고 그 자리에 3차 산업을 들입니다. 평양 다섯 구역은 소득이 크게 오르고 인구가 조금 늘며, 남포(와우도·항구구역)와 송림은 인구와 소득이 늡니다' },
  'hamhung-redev': { label: '함흥 지역 재개발', where: ['함경남도', '함흥시'], years: 5, cost: 80000, kpCost: 80000, persons: 50000, net: 0.5,
    income: 1.05, conv: 1.2, amenity: 0.01, happy: 3, cat: '관북권 재개발', desc: '주택 공급과 산업 현대화. 인구 5만 명 증가, HDI·1인당 소득 증가' },
  'hungnam-redev': { label: '흥남 지역 재개발', where: ['함경남도', '함흥시'], years: 5, cost: 80000, kpCost: 80000, persons: 50000, net: 0.5,
    income: 1.05, conv: 1.2, amenity: 0.01, happy: 3, cat: '관북권 재개발', desc: '주택 공급과 산업·항만 현대화 (흥남은 함흥시에 든다). 인구 5만 명 증가, HDI·1인당 소득 증가' },
  'chongjin-redev': { label: '청진시 재개발', where: ['함경북도', '청진시'], years: 5, cost: 80000, kpCost: 80000, persons: 50000, net: 0.5,
    income: 1.05, conv: 1.2, amenity: 0.01, happy: 3, cat: '관북권 재개발', desc: '주택 공급과 산업·항만 현대화. 인구 5만 명 증가, HDI·1인당 소득 증가' },
  'sinuiju-redev': { label: '신의주 재개발', where: ['평안북도', '신의주시'], years: 5, cost: 80000, kpCost: 80000, persons: 50000, net: 0.5,
    income: 1.05, conv: 1.2, amenity: 0.01, happy: 3, cat: '국경도시 재개발', desc: '주택 공급과 산업 현대화. 인구 5만 명 증가, HDI·1인당 소득 증가' },
  'rason-redev': { label: '나선 재개발', where: ['라선시', '라선시'], years: 5, cost: 80000, kpCost: 80000, persons: 50000, net: 0.5,
    income: 1.05, conv: 1.2, amenity: 0.01, happy: 3, cat: '국경도시 재개발', desc: '주택 공급과 산업 현대화. 인구 5만 명 증가, HDI·1인당 소득 증가' },
  // ---- 관광거점도시 개발 (메일 건의): 숙박·관광 기반을 갖춰 소득이 오르고 관광객이 늘어난다. tour: 완공 뒤 늘어나는 연 관광객(백만 명, 통합도만큼 찾아온다)
  'tour-wonsan': { label: '원산–금강산 관광거점도시', where: ['강원도', '원산시'], years: 4, cost: 25000, kpCost: 25000, persons: 20000, tour: 2, tourZones: [['강원도', '원산시'], ['강원도', '금강군']],
    income: 1.05, conv: 1.2, amenity: 0.02, happy: 2, cat: '관광거점도시', desc: '갈마 해안관광지구와 금강산 관광을 잇는 숙박·관광 기반. 관광객 연 200만 명 증가 (원산·금강산), 소득 증가' },
  'tour-kaesong': { label: '개성 고려왕도 관광거점도시', where: ['개성시', '개성시'], years: 4, cost: 15000, kpCost: 15000, persons: 10000, tour: 1.5,
    income: 1.05, conv: 1.2, amenity: 0.02, happy: 2, cat: '관광거점도시', desc: '고려 왕도 유적(만월대·선죽교)과 개성 역사지구 관광 기반. 관광객 연 150만 명 증가, 소득 증가' },
  'tour-pyongyang': { label: '평양 역사관광 거점도시', where: ['평양시', '중구역'], years: 4, cost: 20000, kpCost: 20000, persons: 10000, tour: 2,
    income: 1.04, conv: 1.15, amenity: 0.02, happy: 2, cat: '관광거점도시', desc: '평양의 고구려·근현대 역사 유적을 묶은 관광 기반. 관광객 연 200만 명 증가, 소득 증가' },
  'tour-hyesan': { label: '혜산–개마고원 관광거점도시', where: ['량강도', '혜산시'], years: 4, cost: 12000, kpCost: 12000, persons: 8000, tour: 1,
    income: 1.06, conv: 1.25, amenity: 0.02, happy: 2, cat: '관광거점도시', desc: '개마고원 고원·산악 관광의 관문 도시. 관광객 연 100만 명 증가, 소득 증가' },
  'tour-samjiyon': { label: '삼지연–백두산 관광거점도시', where: ['량강도', '삼지연시'], years: 4, cost: 12000, kpCost: 12000, persons: 8000, tour: 1.5,
    income: 1.06, conv: 1.25, amenity: 0.02, happy: 2, cat: '관광거점도시', desc: '백두산(천지)과 삼지연 관광 기반. 관광객 연 150만 명 증가, 소득 증가' },
};
/** 존 찾기 (자료의 도·이름) */
const zoneAt = (prov, name) => zoneProps.findIndex((z) => !z.ext && z.province === prov && z.name === name);
/** 대형 도시 개발 사업이 벌어지는 존 (자료의 도·이름) */
export function specialZone(k) {
  const [prov, name] = SPECIAL_DEV[k].where;
  return zoneProps.findIndex((z) => !z.ext && z.province === prov && z.name === name);
}
const devSpec = (kind) => ZONE_DEV[kind] || SPECIAL_DEV[kind];

const UNIT_PRICE_MARGIN = 0.15, HOUSEHOLD = 2.4, UNIT_PRICE = { capital: 6, metro: 3.5, other: 2.2, kp: 0.8 };

/** 대상: 존 하나(시군·북측 구역) 또는 분구한 시의 구 하나(subs) */
function targetStats(zone, subs) {
  const z = zoneProps[zone];
  const ss = subs || z.subs.map((_, k) => z.sub0 + k);
  const p = (i) => (result ? result.subs.pop[i] || 0 : 0), pop = result ? ss.reduce((t, i) => t + p(i), 0) : z.pop;
  // 시가지 밀도: 주민이 사는 읍면동의 밀도를 인구로 가중 평균 (넓은 시 존의 산·들 때문에 낮게 나오지 않게)
  const dens = pop > 0 ? ss.reduce((t, i) => t + p(i) * (p(i) / Math.max(0.05, subArea(i))), 0) / pop : 0;
  return { z, ss, pop, dens, kp: z.country === 'KP' };
}

/** 사업안 (안 되면 why) */
export function zoneDevPlan(kind, zone, subs = null, name = zoneName(zone)) {
  const D = devSpec(kind), t = targetStats(zone, subs);
  if (SPECIAL_DEV[kind]) {
    const prev = (state.zoneDev || []).filter((d) => d.kind === kind);
    let why = prev.some((d) => !d.done) ? '공사 중입니다' : prev.length ? '이미 완공했습니다' : null;
    if (!why && D.after && !(state.zoneDev || []).some((d) => d.kind === D.after && d.done)) why = `${SPECIAL_DEV[D.after].label}을 먼저 다 지어야 합니다`;
    if (!why && D.needHDI && result) {
      // 그 도(자료 이름) 존들의 인구 가중 HDI
      const zs = zoneProps.map((z, i) => i).filter((i) => !zoneProps[i].ext && zoneProps[i].province === D.needHDI[0]);
      const P = zs.reduce((s0, i) => s0 + result.zones.pop[i], 0), h = P ? zs.reduce((s0, i) => s0 + result.zones.hdi[i] * result.zones.pop[i], 0) / P : 0;
      if (h < D.needHDI[1]) why = `${D.needHDI[0]} HDI가 ${D.needHDI[1]} 이상이어야 합니다 (지금 ${h.toFixed(3)})`;
    }
    return { kind, key: `${kind}:${zone}`, zone, name: D.label, subs: null, persons: D.persons, cost: t.kp ? D.kpCost : D.cost, revenue: 0, years: D.years, why, dens: t.dens };
  }
  const key = `${kind}:${zone}:${name}`;
  const prev = (state.zoneDev || []).filter((d) => d.key === key);
  let why = null;
  if (D.minDensity && t.dens < D.minDensity) why = `시가지 밀도가 ${D.minDensity.toLocaleString()}명/km²를 넘어야 합니다 (지금 ${Math.round(t.dens).toLocaleString()}명/km²)`;
  if (prev.some((d) => !d.done)) why = '공사 중입니다';
  else if (kind !== 'redev' && prev.length) why = '이미 조성했습니다';
  else if (kind === 'redev' && prev.some((d) => state.year - d.year < D.again)) why = `${D.again}년 안에 다시 재개발할 수 없습니다`;
  let persons, cost, revenue = 0;
  if (kind === 'redev') {
    persons = Math.round(Math.min(D.max, Math.max(D.min, t.pop * D.share)) / 100) * 100;
    cost = Math.round(persons * (t.kp ? D.kpPerPerson : D.perPerson));
    revenue = Math.round((persons / HOUSEHOLD) * UNIT_PRICE[regionClass(t.z, t.z.cy, t.z.cx)] * UNIT_PRICE_MARGIN);
  } else { persons = D.persons; cost = t.kp ? D.kpCost : D.cost; }
  return { kind, key, zone, name, subs: subs || null, persons, cost, revenue, years: D.years, why, dens: t.dens };
}

export function zoneDevHTML(zone, subs = null, name = zoneName(zone)) {
  const z = zoneProps[zone];
  if (!z || z.ext) return '';
  const rows = Object.keys(ZONE_DEV).filter((k) => !subs || k === 'redev').map((k) => {
    const p = zoneDevPlan(k, zone, subs, name), D = ZONE_DEV[k];
    const fx = k === 'redev' ? `인구 +${p.persons.toLocaleString()}명 (같은 쪽 다른 곳에서 옮겨 옴), 분양 수익 ${formatWon(p.revenue)}, 주민 행복도 +${D.happy}`
      : `소득 목표 +${Math.round((D.income - 1) * 100)}%, 소득 수렴 ×${D.conv}, 일자리를 찾아 ${p.persons.toLocaleString()}명 유입`;
    return `<div class="item"><div class="t">${esc(D.label)}${k === 'redev' ? ` (${esc(name)})` : ''}</div><div class="m">${fx}, ${formatWon(p.cost)}, ${p.years}년${p.why ? `, <span class="neg">${esc(p.why)}</span>` : ''}</div>
      <div class="actions"><button class="small" data-zdev="${k}" data-zdev-zone="${zone}" data-zdev-name="${esc(name)}"${subs ? ` data-zdev-subs="${subs.join(',')}"` : ''} ${p.why ? 'disabled' : ''}>착공</button></div></div>`;
  });
  // 이 자리의 대형 도시 개발 사업
  if (!subs) for (const [k, D] of Object.entries(SPECIAL_DEV)) {
    if (specialZone(k) !== zone) continue;
    const p = zoneDevPlan(k, zone);
    rows.unshift(`<div class="item"><div class="t">${esc(D.label)}</div><div class="m">${esc(D.desc)}, 인구 +${D.persons.toLocaleString()}명, 소득 목표 +${Math.round((D.income - 1) * 100)}%, ${formatWon(p.cost)}, ${D.years}년${p.why ? `, <span class="neg">${esc(p.why)}</span>` : ''}</div>
      <div class="actions"><button class="small primary" data-zdev="${k}" data-zdev-zone="${zone}" data-zdev-name="${esc(D.label)}" ${p.why ? 'disabled' : ''}>착공</button></div></div>`);
  }
  const done = (state.zoneDev || []).filter((d) => d.zone === zone && (!subs || d.name === name));
  return `<h4>도시 개발</h4>${done.map((d) => `<p class="hint">${d.year}년 ${esc(devSpec(d.kind).label)}${d.kind === 'redev' ? ` (${esc(d.name)})` : ''} ${d.done ? '완공' : `공사 중 (${d.year + devSpec(d.kind).years}년 완공)`}</p>`).join('')}${rows.join('')}`;
}

export function bindZoneDev(el, after) {
  el.querySelectorAll('[data-zdev]').forEach((b) => {
    b.onclick = () => {
      const subs = b.dataset.zdevSubs ? b.dataset.zdevSubs.split(',').map(Number) : null;
      const p = zoneDevPlan(b.dataset.zdev, +b.dataset.zdevZone, subs, b.dataset.zdevName);
      if (p.why) { alert(p.why); return; }
      if (!canAfford(state, p.cost, p.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
      const what = SPECIAL_DEV[p.kind] ? p.name : `${p.name} ${ZONE_DEV[p.kind].label}`;
      if (!confirm(`${what}: ${formatWon(p.cost)}, ${p.years}년. 착공할까요?`)) return;
      const id = crypto.randomUUID();
      (state.zoneDev ||= []).push({ id, kind: p.kind, key: p.key, zone: p.zone, name: p.name, subs: p.subs, persons: p.persons, revenue: p.revenue, year: state.year, done: false, applied: false });
      startProject(state, { id, kind: 'zonedev', links: [], stations: [], cost: p.cost, years: p.years, label: what });
      after?.();
    };
  });
}

/** 완공된 개발 구역: 수익·행복도를 넣고, 시뮬레이션에 넘길 인구 이동 목록을 돌려준다 (한 번만) */
export function settleZoneDev(done) {
  const ids = new Set(done.filter((p) => p.kind === 'zonedev').map((p) => p.id)), out = [];
  for (const d of state.zoneDev || []) {
    if (ids.has(d.id) && !d.done) {
      d.done = true;
      state.budget += d.revenue || 0;
      const D = devSpec(d.kind);
      if (D.happy) state.happyBonus[d.zone] = (state.happyBonus[d.zone] || 0) + D.happy;
      if (D.hall && !(state.govHalls ||= []).some((h) => h.name === D.hall.name)) state.govHalls.push({ ...D.hall });   // 정부 청사 (지도의 청사 표시)
      state.log.unshift(`${state.year}년 ${SPECIAL_DEV[d.kind] ? D.label : `${d.name} ${D.label}`} 완공: 인구 ${d.persons.toLocaleString()}명 입주${d.revenue ? `, 분양 수익 ${formatWon(d.revenue)}` : ''}${D.hall ? `, ${D.hall.name} 개청` : ''}`);
    }
    if (d.done && !d.applied) {
      d.applied = true;
      const D = devSpec(d.kind);
      // 늘어난 인구를 덜어 오는 존 (평양 대개발: 평안남도·황해도), 입주는 사업 존들에 나눠
      const from = D.from ? zoneProps.map((z, i) => i).filter((i) => !zoneProps[i].ext && D.from.includes(zoneProps[i].province)) : null;
      const zs = D.zones ? D.zones.map(([p, n, o]) => [zoneAt(p, n), o?.persons ?? D.persons / D.zones.length]).filter(([z]) => z >= 0) : [[d.zone, d.persons]];
      for (const [zi, persons] of zs) {
        const z = zoneProps[zi], ss = (!D.zones && d.subs) || z.subs.map((_, k) => z.sub0 + k);
        const w = ss.map((i) => Math.max(1, result?.subs.pop[i] || 0)), W = w.reduce((t, v) => t + v, 0);
        out.push({ zone: zi, lon: z.cx, lat: z.cy, persons: Math.round(persons), net: D.net, from, parts: ss.map((i, k) => ({ sub: toModelSub(i), share: w[k] / W })) });
      }
    }
  }
  return out;
}

/** 해마다 계산에 넘길 산업·업무단지 효과: [존, 소득 목표 배수, 수렴 배수, 편의 가산] */
export function zoneDevEffects() {
  const out = [];
  for (const d of (state.zoneDev || []).filter((x) => x.done && x.kind !== 'redev')) {
    const D = devSpec(d.kind);
    if (D.zones) for (const [p, n, o] of D.zones) { const z = zoneAt(p, n); if (z >= 0) out.push([z, o?.income ?? D.income, o?.conv ?? D.conv, D.amenity]); }
    else out.push([d.zone, D.income, D.conv, D.amenity]);
  }
  return out.concat(powerEffects());
}

/**
 * 전력 현대화 (game/mega.js의 power·grid 사업): [존, 소득 목표 배수, 수렴 배수, 편의 가산]
 * - 발전 현대화율 25%마다 북측 모든 존: 소득 목표 +1%, 수렴 ×1.12
 * - 송전망: 긴급 복구는 평양·함흥·청진, 간선망은 시(구역) 지역, 배전망은 군 지역 (소득 목표 +3~5%, 수렴 ×1.15~1.3)
 */
export function powerEffects() {
  const M = state.mega || {}, out = [];
  const step = Math.floor(powerPct(state) / 25);
  const kp = zoneProps.map((z, i) => [z, i]).filter(([z]) => !z.ext && z.country === 'KP');
  if (step) for (const [, i] of kp) out.push([i, 1 + 0.01 * step, 1 + 0.12 * step, 0]);
  const city = (z) => z.province === '평양시' || ['함흥시', '청진시'].includes(z.name) || ['함흥시', '청진시'].includes(z.city);
  if (M['grid-emergency']) for (const [z, i] of kp) if (city(z)) out.push([i, 1.05, 1.3, 0]);
  if (M['grid-trunk']) for (const [z, i] of kp) if (/(시|구역)$/.test(z.name)) out.push([i, 1.03, 1.15, 0]);
  if (M['grid-dist']) for (const [z, i] of kp) if (/군$/.test(z.name)) out.push([i, 1.03, 1.15, 0]);
  return out;
}

/** 완공된 관광거점도시 개발이 더하는 관광객: 존별 하루 방문객 (계산의 tourKP에 더한다, 통합도만큼 찾아온다) */
export function zoneDevTourism(Z) {
  const out = new Array(Z).fill(0);
  for (const d of (state.zoneDev || []).filter((x) => x.done)) {
    const D = SPECIAL_DEV[d.kind];
    if (!D?.tour) continue;
    const zs = (D.tourZones || [D.where]).map(([p, n]) => zoneAt(p, n)).filter((z) => z >= 0);
    for (const z of zs) out[z] += (D.tour * 1e6) / 365 / zs.length;
  }
  return out;
}
