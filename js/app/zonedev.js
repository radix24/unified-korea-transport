// 도시 개발 구역: 재개발(시군·구마다), 산업단지, 업무단지. 역세권 개발·경제특구와 같은 사업 틀 (사업비 → 공기 → 완공 때 효과).
// 재개발은 낡은 주거지를 고밀로 다시 지어 인구가 늘고(같은 쪽 다른 곳에서 옮겨 온다) 분양 수익이 예산으로 돌아온다.
// 산업단지·업무단지는 일자리를 만들어 소득이 오르고(목표·수렴 속도) 사람이 모인다. 금액 단위 억원.
import { regionClass } from '../game/devel.js';
import { canAfford, startProject } from '../game/state.js';
import { formatWon } from '../game/catalog.js';
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
  const D = ZONE_DEV[kind], t = targetStats(zone, subs);
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
    const fx = k === 'redev' ? `인구 +${p.persons.toLocaleString()}명 (같은 쪽 다른 곳에서 옮겨 옴) · 분양 수익 ${formatWon(p.revenue)} · 주민 행복도 +${D.happy}`
      : `소득 목표 +${Math.round((D.income - 1) * 100)}% · 소득 수렴 ×${D.conv} · 일자리를 찾아 ${p.persons.toLocaleString()}명 유입`;
    return `<div class="item"><div class="t">${esc(D.label)}${k === 'redev' ? ` (${esc(name)})` : ''}</div><div class="m">${fx} · ${formatWon(p.cost)} · ${p.years}년${p.why ? ` · <span class="neg">${esc(p.why)}</span>` : ''}</div>
      <div class="actions"><button class="small" data-zdev="${k}" data-zdev-zone="${zone}" data-zdev-name="${esc(name)}"${subs ? ` data-zdev-subs="${subs.join(',')}"` : ''} ${p.why ? 'disabled' : ''}>${esc(D.label)}</button></div></div>`;
  });
  const done = (state.zoneDev || []).filter((d) => d.zone === zone && (!subs || d.name === name));
  return `<h4>도시 개발</h4>${done.map((d) => `<p class="hint">${d.year}년 ${esc(ZONE_DEV[d.kind].label)}${d.kind === 'redev' ? ` (${esc(d.name)})` : ''} ${d.done ? '완공' : `공사 중 (${d.year + ZONE_DEV[d.kind].years}년 완공)`}</p>`).join('')}${rows.join('')}`;
}

export function bindZoneDev(el, after) {
  el.querySelectorAll('[data-zdev]').forEach((b) => {
    b.onclick = () => {
      const subs = b.dataset.zdevSubs ? b.dataset.zdevSubs.split(',').map(Number) : null;
      const p = zoneDevPlan(b.dataset.zdev, +b.dataset.zdevZone, subs, b.dataset.zdevName);
      if (p.why) { alert(p.why); return; }
      if (!canAfford(state, p.cost, p.years)) { alert('예산과 차입 한도가 부족합니다.'); return; }
      if (!confirm(`${p.name} ${ZONE_DEV[p.kind].label}: ${formatWon(p.cost)}, ${p.years}년. 착공할까요?`)) return;
      const id = crypto.randomUUID();
      (state.zoneDev ||= []).push({ id, kind: p.kind, key: p.key, zone: p.zone, name: p.name, subs: p.subs, persons: p.persons, revenue: p.revenue, year: state.year, done: false, applied: false });
      startProject(state, { id, kind: 'zonedev', links: [], stations: [], cost: p.cost, years: p.years, label: `${p.name} ${ZONE_DEV[p.kind].label}` });
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
      if (d.kind === 'redev') state.happyBonus[d.zone] = (state.happyBonus[d.zone] || 0) + ZONE_DEV.redev.happy;
      state.log.unshift(`${state.year}년 ${d.name} ${ZONE_DEV[d.kind].label} 완공: 인구 ${d.persons.toLocaleString()}명 입주${d.revenue ? ` · 분양 수익 ${formatWon(d.revenue)}` : ''}`);
    }
    if (d.done && !d.applied) {
      d.applied = true;
      const z = zoneProps[d.zone], ss = d.subs || z.subs.map((_, k) => z.sub0 + k);
      const w = ss.map((i) => Math.max(1, result?.subs.pop[i] || 0)), W = w.reduce((t, v) => t + v, 0);
      out.push({ zone: d.zone, lon: z.cx, lat: z.cy, persons: d.persons, parts: ss.map((i, k) => ({ sub: toModelSub(i), share: w[k] / W })) });
    }
  }
  return out;
}

/** 해마다 계산에 넘길 산업·업무단지 효과: [존, 소득 목표 배수, 수렴 배수, 편의 가산] */
export function zoneDevEffects() {
  return (state.zoneDev || []).filter((d) => d.done && d.kind !== 'redev').map((d) => [d.zone, ZONE_DEV[d.kind].income, ZONE_DEV[d.kind].conv, ZONE_DEV[d.kind].amenity]);
}
