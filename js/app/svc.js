// 운행 계통(특급·급행·보통) 편집.
import { formatWon, upgradeCost, UPGRADES } from '../game/catalog.js';
import { opBadge, operatorOf } from '../game/operators.js';
import {
  canRun, defaultTrainType, isCommuter, lineStations, OPERATING, planService, railAdjacency, railPath, removeService, SERVICE_KINDS, serviceBuyCost, startService, TRAIN_TYPES, tripsPerDay, updateService,
} from '../game/services.js';
import { effectiveNetwork, FREQ_STEPS, linkAt, linkPending, load, OP_FACTORS, save, startProject, startUpgrade } from '../game/state.js';
import { autoBrand } from '../game/trainnames.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { toast } from '../ui/panel.js';
import { base, esc, namer, result, state } from './core.js';
import { startStationAdd } from '../game/points.js';
import { MEGA } from '../game/mega.js';
import { allLinks, nodeCoord, nodeNames, refreshLinks, stationKey, stationKeysOf } from './mapdata.js';
import { select } from './interact.js';
import { fmtMin } from './route.js';
import { renderAll } from './panels.js';
import { renderSelection } from './econ.js';
import { autoLocalTrains, fundSelect, isConnectorLine, serviceBrand, serviceOperator } from './operators.js';
import { routeThrough, sectionOf, startServicePick, svcPick } from './pick.js';
import { bindStationSearch, drawServiceEdit, header, nextSvcColor, serviceEditNode, stationSearchHTML, svcColor } from './svcmap.js';
import { popWithin } from './gazette.js';

// ------------------------------------------------------------ 운행 계통 (특급·급행·보통)

// 계획 목록 (plans.js가 넣는다: 서로 가져오면 순환하므로)
// var(초기값 없음): plans.js가 이 모듈보다 먼저 실행되며 넣어도 지워지지 않게 (let이면 초기화 전 접근 오류)
var plansOf, planLineOf;   // eslint-disable-line no-var
export function setPlansOf(f, lineName) { plansOf = f; planLineOf = lineName; }
/** 계통 계획이 다니는 노선 이름: lines(기존 노선·국외 노선 이름) + lineOf(먼저 지은 계획들의 노선 이름) */
export function servicePlanLines(plan) {
  const own = (plan.lineOf || []).map((id) => plansOf?.().find((x) => x.id === id)).filter(Boolean).map((p) => planLineOf(p));
  return [...new Set([...(plan.lines || []), ...own])];
}

export let svcEdit = null;   // 편집 중인 계통 {line, cls, kind, name, trains, nodes: 노선 위 역 순서, stops: Set, id}
export function setSvcEdit(v) { return (svcEdit = v); }
export const SERVICE_DAY_MIN = 1440;   // 24시간 운행

export function railStationSet() {
  const s = new Set(base.stations.map(([, n]) => n));
  for (const n of state.newStations) s.add(n);
  for (const n of state.closedStations || []) s.delete(n);
  return s;
}

export function stationRiders() {
  const m = new Map();
  if (result) result.stations.node.forEach((nd, k) => m.set(nd, result.stations.riders[k]));
  return m;
}

/**
 * 등급별 기본 정차역: 보통은 모든 역, 급행·특급은 큰 역만 (양 끝은 늘 정차).
 * 지역 간 승하차 순위와 역세권 인구(반경 3km) 순위를 더한 점수로 큰 역부터 고르되,
 * 이미 고른 역과 너무 가까우면(특급 25km, 급행 8km) 건너뛴다. 정차역 수는 노선 길이로 정한다 (특급 약 45km, 급행 약 15km마다 한 역).
 * 그래서 대전·동대구처럼 큰 도시 역은 서고 수도권 역이 몰리지 않는다
 */
export function defaultStops(nodes, kind) {
  if (kind === 'local' || kind === 'commuter') return new Set(nodes);
  const r = stationRiders();
  const spacing = kind === 'express' ? 8 : 25, perKm = kind === 'express' ? 15 : 45;
  const coord = new Map(nodes.map((n) => [n, nodeCoord(n)]));
  const pop = new Map(nodes.map((n) => { const c = coord.get(n); return [n, c ? popWithin(c[0], c[1], 3) : 0]; }));
  const rank = (score) => {
    const sorted = [...nodes].sort((a, b) => score(b) - score(a));
    return new Map(sorted.map((n, i) => [n, 1 - i / nodes.length]));
  };
  const rr = rank((n) => r.get(n) || 0), rp = rank((n) => pop.get(n));
  const order = [...nodes].sort((a, b) => (rr.get(b) + rp.get(b)) - (rr.get(a) + rp.get(a)));
  let km = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = coord.get(nodes[i - 1]), b = coord.get(nodes[i]);
    if (a && b) km += kmBetween(a[0], a[1], b[0], b[1]);
  }
  const target = Math.min(nodes.length, Math.max(3, Math.round(km / perKm) + 1));
  const chosen = [nodes[0], nodes[nodes.length - 1]];
  const far = (n) => chosen.every((m) => { const a = coord.get(n), b = coord.get(m); return !a || !b || kmBetween(a[0], a[1], b[0], b[1]) >= spacing; });
  for (const n of order) {
    if (chosen.length >= target) break;
    if (!chosen.includes(n) && far(n)) chosen.push(n);
  }
  return new Set(chosen);
}

/** 여러 노선의 역을 이어 한 줄로 (경부선 → 평부선 → 평의선처럼 끝과 끝이 가까운 쪽으로 붙인다) */
export function chainStations(net, lines) {
  const set = railStationSet();
  let chain = lineStations(net, set, lines[0]);
  const xy = (n) => nodeCoord(n);
  const d = (a, b) => kmBetween(...xy(a), ...xy(b));
  for (const L of lines.slice(1)) {
    const st = lineStations(net, set, L);
    if (!st.length || !chain.length) { chain = chain.concat(st); continue; }
    const h = chain[0], t = chain[chain.length - 1], s0 = st[0], s1 = st[st.length - 1];
    const opts = [[d(t, s0), () => chain.concat(st)], [d(t, s1), () => chain.concat([...st].reverse())],
      [d(h, s1), () => st.concat(chain)], [d(h, s0), () => [...st].reverse().concat(chain)]];
    chain = opts.sort((x, y) => x[0] - y[0])[0][1]();
  }
  return chain.filter((n, k) => chain.indexOf(n) === k);
}

/** 계통 양 끝 역에서 이어지는 다른 노선: [{ name, end: 0|1, far: 그 노선 반대쪽 끝 역 }].
 * 끝 역에 닿는(1.5km 안) 노선만 든다 (예전에는 5km 안의 아무 노선이나 들어 용산에서 공항철도가 골라지기도 했다) */
export function connectableLines(net, e) {
  const endN = [e.nodes[0], e.nodes[e.nodes.length - 1]], ends = endN.map((n) => nodeCoord(n));
  const touch = new Map();
  for (const l of net.links) {
    if (l.mode !== 1 || !l.active || l.via || !l.name || e.lines.includes(l.name) || l.ext || touch.has(l.name)) continue;
    for (const n of [l.a, l.b]) {
      const c = nodeCoord(n);
      const k = c ? ends.findIndex((q) => q && kmBetween(q[0], q[1], c[0], c[1]) < 1.5) : -1;
      if (k >= 0) { touch.set(l.name, k); break; }
    }
  }
  const set = railStationSet(), out = [];
  for (const [name, end] of touch) {
    const st = lineStations(net, set, name);
    if (st.length < 2) continue;
    const q = ends[end], dist = (n) => { const c = nodeCoord(n); return c ? kmBetween(q[0], q[1], c[0], c[1]) : 0; };
    const far = [st[0], st[st.length - 1]].sort((x, y) => dist(y) - dist(x))[0];
    if (dist(far) < 3 || e.nodes.includes(far)) continue;
    out.push({ name, end, far });
  }
  return out.sort((x, y) => x.end - y.end || x.name.localeCompare(y.name));
}

/** 계통 양 끝의 방위 이름: 남북으로 길면 북단·남단, 동서로 길면 서단·동단 */
export function endLabels(e) {
  const a = nodeCoord(e.nodes[0]), b = nodeCoord(e.nodes[e.nodes.length - 1]);
  if (!a || !b) return ['한쪽 끝', '다른 끝'];
  if (Math.abs(a[1] - b[1]) >= Math.abs(a[0] - b[0]) * 0.8) return a[1] > b[1] ? ['북단', '남단'] : ['남단', '북단'];
  return a[0] < b[0] ? ['서단', '동단'] : ['동단', '서단'];
}

export function openServiceEditor(line, cls, id = null) {
  const net = effectiveNetwork(base, state);
  const s = id && state.services.find((x) => x.id === id);
  const lines = s?.lines || [line];
  // 이미 있는 계통은 정차역을 차례로 잇는 경로의 역들로 (여러 노선을 지나는 계통도 순서가 맞게)
  const nodes = (s && s.stops.length >= 2 && routeThrough(s.stops, isCommuter(s.kind, s.type))?.nodes) || chainStations(net, lines);
  if (nodes.length < 2) { alert('이 노선에는 역이 둘 이상 있어야 운행 계통을 짤 수 있습니다.'); return; }
  const under = net.links.filter((l) => lines.includes(l.name) && l.mode === 1 && !l.via);
  svcEdit = s
    ? { line: lines[0], lines, cls, kind: s.kind, name: s.name, type: s.type || defaultTrainType(cls, under), sets: s.sets, nodes, stops: new Set(s.stops), id, nameEdited: true,
      color: svcColor(s, state.services.indexOf(s)) }
    : { line, lines, cls, kind: 'limited', name: `${line} ${SERVICE_KINDS.limited.label}`, type: defaultTrainType(cls, under), sets: 4, nodes, stops: defaultStops(nodes, 'limited'), id: null,
      color: nextSvcColor() };
  select({ type: 'service' });
}

/** 먼저 지어야 하는 사업 이름: 계획 사업 id 또는 'mega:국가 대형 사업 id' */
export function requireName(id) {
  if (id.startsWith('mega:')) return MEGA.find((m) => m.id === id.slice(5))?.name || id;
  return plansOf?.().find((x) => x.id === id)?.name || id;
}

/**
 * 계획 사업의 운행 계통(type 'service'): 새 선로 없이 기존선(lines)의 from–to 사이 모든 역에 서는 광역 전철.
 * 계통 편집을 그 노선·구간·광역 통근 전동차로 채워 연다 (비전철 구간이 있으면 편집 창이 전철화를 권한다)
 */
export function openServicePlan(plan) {
  // 먼저 지어야 하는 선로 계획 (평양–베이징 직통: 경의고속철도 서울–평양·평양–신의주·대륙 직결)
  // 'mega:○○'는 국가 대형 사업 (한일해저터널·호남고속철 제주 연장)
  const done = new Set(state.projects.filter((p) => p.status === 'done' && p.plan).map((p) => p.plan));
  const need = (plan.requires || []).filter((id) => (id.startsWith('mega:') ? !state.mega?.[id.slice(5)] : !done.has(id)));
  if (need.length) { alert(`${plan.name}: 먼저 ${need.map((id) => requireName(id)).join(', ')}을(를) 완공해야 합니다.`); return; }
  const net = effectiveNetwork(base, state), nn = nodeNames(), set = railStationSet();
  plan = { ...plan, lines: servicePlanLines(plan) };
  // 역 찾기: 이름이 같은 역 가운데 계획 노선 위의 역을 먼저 (평양역처럼 다른 노선에만 있으면 그 역)
  const onLine = new Set();
  for (const l of net.links) if (l.mode === 1 && l.active && !l.via && plan.lines.includes(l.name)) { onLine.add(l.a); onLine.add(l.b); }
  // 이름은 보이는 이름·자료의 원래 이름 모두로, '-역'·'-청년'·두음법칙을 맞춰 견준다 (행정구역 정리로 라산이 나산으로 보여도 찾는다)
  const named = (nm) => { const k = stationKey(nm); return [...set].filter((n) => stationKeysOf(n, nn.get(n)?.name).has(k)); };
  // 이름으로 못 찾으면(이름을 바꾼 역·게임에서 새로 지은 역) 계획에 적힌 자리에서 3km 안의 노선 위 역으로
  const near = (nm) => {
    const pt = (plan.points || []).find((p) => stationKey(p[0]) === stationKey(nm));
    if (!pt) return null;
    let best = null, bd = 3;
    for (const n of set) {
      if (!onLine.has(n)) continue;
      const c = nodeCoord(n), d = c ? kmBetween(pt[1], pt[2], c[0], c[1]) : Infinity;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  };
  const find = (nm) => { const c = named(nm); return c.find((n) => onLine.has(n)) ?? c[0] ?? near(nm); };
  // 두 끝과 거쳐 가는 역(via: 직결하는 갈아타는 역, 평양·함흥 등) 사이를 차례로 잇는다
  const names = [plan.from, ...(plan.via || []), plan.to], ends = names.map(find);
  const miss = names.find((n, k) => ends[k] == null);
  if (miss) { alert(`${plan.name}: ${miss}역을 찾지 못했습니다.`); return; }
  // 그 사이 선로가 지나는 모든 역 (광역 전철은 모든 역에 선다)
  const nodes = [ends[0]];
  for (let k = 0; k + 1 < ends.length; k++) {
    // 광역 전철 계획은 고속선을 지나지 않는다
    const via = railPath(net.links, ends[k], ends[k + 1], new Set(plan.lines), 1, railAdjacency(net.links, new Set(plan.lines), 1, isCommuter(plan.kind || 'commuter', plan.train || 'commuter'), plan.train === 'hsr'));
    if (!via) { alert(`${plan.name}: ${names[k]}–${names[k + 1]} 사이 선로가 이어지지 않습니다.`); return; }
    let node = ends[k];
    for (const i of via) { const l = net.links[i]; node = l.a === node ? l.b : l.a; if (set.has(node) && nodes[nodes.length - 1] !== node) nodes.push(node); }
  }
  // 광역 전철은 모든 역에 서고, 정차역(stopsAt)이 적힌 계획(고속 직통)은 그 역에만 선다
  const stops = plan.stopsAt ? new Set(nodes.filter((n, k) => k === 0 || k === nodes.length - 1 || plan.stopsAt.some((nm) => stationKeysOf(n, nn.get(n)?.name).has(stationKey(nm))))) : new Set(nodes);
  // 단계 확장(extends: 앞 단계 계획): 앞 단계로 연 계통을 늘린다 (같은 계통 이름·색, 편성은 늘린 만큼만 산다)
  // extends는 계획 id 또는 지금 다니는 계통 이름(대경선 등 기본 계통)
  const prev = plan.extends && (state.services || []).find((s) => s.plan === plan.extends || s.planChain?.includes(plan.extends) || s.name === plan.extends);
  if (plan.extends && !prev) { alert(`${plan.name}: 먼저 ${requireName(plan.extends)}로 계통을 열어야 합니다.`); return; }
  svcEdit = { line: plan.lines[0], lines: plan.lines, cls: plan.cls || 'conv', kind: plan.kind || 'commuter', name: prev ? prev.name : plan.service || plan.name, type: plan.train || 'commuter',
    sets: Math.max(prev?.sets || 0, plan.sets || 6), nodes, stops, id: prev ? prev.id : null, nameEdited: true, color: prev?.color || plan.color || nextSvcColor(), plan: plan.id, upgrade: plan.upgrade !== false };
  select({ type: 'service' });
}

/** 계통에 다른 노선을 이어 붙인다 (직통 운전) */
/** 이어 가기: 끝 역에서 그 노선 반대쪽 끝 역까지 실제 경로로 늘린다 (새로 붙은 큰 역은 등급 기준으로 선다) */
export function extendServiceLine(x) {
  const e = svcEdit;
  const stops = e.nodes.filter((n) => e.stops.has(n));
  const picks = x.end === 0 ? [x.far, ...stops] : [...stops, x.far];
  const r = routeThrough(picks, isCommuter(e.kind, e.type));
  if (!r) { toast('이 노선으로 이어지는 철도 경로가 없습니다. 다른 노선을 골라 보세요.'); return; }
  const before = new Set(e.nodes);
  e.lines = r.lines; e.line = r.lines[0]; e.nodes = r.nodes;
  const add = defaultStops(e.nodes, e.kind);
  for (const n of e.nodes) if (!before.has(n) && add.has(n)) e.stops.add(n);
  e.stops.add(x.far);
  if (!e.nameEdited) e.name = `${e.lines.map((y) => y.replace(/선$/, '')).join('·')} 직통 ${SERVICE_KINDS[e.kind].label}`;
  renderSelection();
}

/** 시점·종점 바꾸기: 지금 경로에서 두 역 사이만 남긴다 (양 끝은 정차역) */
export function trimService(i, j) {
  const e = svcEdit;
  if (!(i < j)) return;
  const keep = e.nodes.slice(i, j + 1);
  const stops = keep.filter((n) => e.stops.has(n));
  if (stops[0] !== keep[0]) stops.unshift(keep[0]);
  if (stops[stops.length - 1] !== keep[keep.length - 1]) stops.push(keep[keep.length - 1]);
  const r = routeThrough(stops, isCommuter(e.kind, e.type));
  if (r) { e.lines = r.lines; e.line = r.lines[0]; e.nodes = r.nodes; } else e.nodes = keep;
  e.stops = new Set(stops);
  renderSelection();
}

export function servicePlan() {
  const stops = svcEdit.nodes.filter((n) => svcEdit.stops.has(n));
  const links = effectiveNetwork(base, state).links;
  const plan = stops.length >= 2 ? planService(links, railStationSet(), stops, svcEdit.kind, new Set(svcEdit.lines), svcEdit.type) : null;
  if (plan) plan.under = plan.segs.flatMap((sg) => sg.via.map((i) => links[i]));
  return { stops, plan };
}

/** 계획 광역 전철과 함께 놓는 복선 전철화: 계통 밑 선로 가운데 남측 규격 일괄 개량(복선·교류 25kV·120km/h)이 필요한 구간과 사업비 */
export function serviceUpgrade(plan) {
  const u = UPGRADES.find((x) => x.id === 'kpstd');
  const ids = [...new Set(plan.segs.flatMap((sg) => sg.via))].filter((i) => {
    const l = linkAt(base, state, i);
    return l && u.applies(l) && !(i < base.links.length && linkPending(base, state, i)) && !state.projects.some((pj) => pj.status === 'building' && pj.links.includes(i));
  });
  return { ids, cost: ids.reduce((t, i) => t + upgradeCost(u, linkAt(base, state, i)), 0), km: ids.reduce((t, i) => t + linkAt(base, state, i).len, 0) };
}

export function servicePanel() {
  const e = svcEdit, nn = nodeNames(), r = stationRiders();
  const { stops, plan } = servicePlan();
  const cur = e.id ? state.services.find((x) => x.id === e.id) : null;
  const trains = plan ? tripsPerDay(e.sets, plan.runMin) : 0;
  const cost = serviceBuyCost(cur && { ...cur, type: cur.type || e.type }, { type: e.type, sets: e.sets });
  // 계획 광역 전철: 밑 선로 복선 전철화를 함께 착공하면(기본) 전동차를 고를 수 있다 (전철화가 끝나기 전까지는 지금 선로로 다닌다)
  const upg = e.plan && plan ? serviceUpgrade(plan) : null;
  const runnable = (t) => !plan || canRun(t, plan.under) || (!!e.upgrade && !!upg?.ids.length);
  const typeOk = runnable(e.type);
  // 전동차를 막는 비전철 구간 (노선별 km): 바로 전철화를 벌일 수 있게
  const noPower = new Map(), noPowerIds = [];
  if (plan) {
    const links = effectiveNetwork(base, state).links, seen = new Set();
    for (const sg of plan.segs) for (const i of sg.via) {
      const l = links[i];
      if (seen.has(i) || !l || (l.power && l.power !== 'none') || l.len < 0.5) continue;
      seen.add(i);
      if (i < base.links.length && linkPending(base, state, i)) continue;
      if (state.projects.some((pj) => pj.status === 'building' && pj.links.includes(i))) continue;
      noPowerIds.push(i);
      noPower.set(l.name || '이름 없는 선로', (noPower.get(l.name || '이름 없는 선로') || 0) + l.len);
    }
  }
  const powerHint = noPower.size ? `<p class="hint warn-text">비전철 구간이 있어 전동차는 다닐 수 없습니다: ${[...noPower].map(([n, km]) => `${esc(n)} ${km.toFixed(0)}km`).join(', ')}.
    디젤 객차로 다니거나, 이 구간을 전철화하세요 (완공되면 전동차를 고를 수 있습니다).</p>
    <div class="actions"><button class="small" id="svc-electrify" data-ids="${JSON.stringify(noPowerIds)}">비전철 구간 전철화 (${noPowerIds.length}개 구간)</button></div>` : '';
  // 경로 위 모든 역을 노선도처럼 한 줄로: 누르면 서고 지나간다 (진한 역에 선다. 예전에는 서는 역만 보여 지나는 역은 지도에서 찾아 눌러야 했다)
  const via = new Set((e.picks || []).slice(1, -1));   // 계통을 짤 때 고른 거쳐 갈 역
  const rows = e.nodes.map((n) => { const on = e.stops.has(n); return `<li><button type="button" class="svc-stop${on ? ' on' : ''}" data-stop-toggle="${n}" aria-pressed="${on}" title="${on ? '누르면 통과' : '누르면 정차'}">
      <span class="dot" aria-hidden="true"></span>${esc(nn.get(n)?.name || `역 ${n}`)}${via.has(n) ? '<span class="via-tag">거쳐 감</span>' : ''}<span class="m">${result ? `${Math.round(r.get(n) || 0).toLocaleString()}명` : ''}</span></button></li>`; }).join('');
  // 접는 칸 (연 상태는 편집 중에 기억한다)
  const open = (e.openSec ||= { route: true, train: true, name: !e.id, stats: !!e.id });
  const sec = (k, title, body) => `<details class="svc-sec" data-sec="${k}" ${open[k] ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
  const lab = endLabels(e), last = e.nodes.length - 1;
  const ext = connectableLines(effectiveNetwork(base, state), e);
  e.ext = ext;
  const opts = (sel) => e.nodes.map((n, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(nn.get(n)?.name || `역 ${n}`)}</option>`).join('');
  const routeSec = sec('route', `경로·정차역 <span class="m">${stops.length} / ${e.nodes.length}개 역 정차</span>`, `
    ${!e.id && e.picks ? '<div class="actions"><button class="small" id="svc-back" title="시점·종점·거쳐 갈 역·방식을 다시 고릅니다">← 경로 다시 고르기</button></div>' : ''}
    <div class="name-row"><span class="kind">노선</span><span>${e.lines.map(esc).join(' → ')}</span></div>
    <div class="name-row"><label class="kind" for="svc-from">시점</label><select id="svc-from" title="${lab[0]} 끝 역: 이 역보다 바깥은 운행하지 않습니다">${opts(0)}</select></div>
    <div class="name-row"><label class="kind" for="svc-to">종점</label><select id="svc-to" title="${lab[1]} 끝 역">${opts(last)}</select></div>
    ${stationSearchHTML('svc-find', '역 이름 (정차 넣기·빼기, 경로 늘리기)')}
    ${e.underLink != null ? '<div class="actions"><button class="small" id="svc-under">이 자리 선로(구간) 보기</button></div>' : ''}
    <div class="actions"><button class="small" data-svc-preset="local">모든 역</button><button class="small" data-svc-preset="express">큰 역 절반</button><button class="small" data-svc-preset="limited">큰 역만</button></div>
    <p class="hint">진한 역에 섭니다. 눌러서 넣고 빼세요. 지도에서 계통 밖의 역을 누르면 그 역까지 경로를 늘립니다${result ? ' (숫자: 하루 이용객)' : ''}.</p>
    <ol id="svc-stops" class="stop-strip" style="--line-color:${esc(e.color)}">${rows}</ol>
    ${ext.length ? `<div class="name-row"><label class="kind" for="svc-ext">노선 더 잇기</label>
      <select id="svc-ext"><option value="">끝 역에서 이어 갈 노선…</option>${ext.map((x, i) => `<option value="${i}">${lab[x.end]} ${esc(nn.get(e.nodes[x.end ? last : 0])?.name || '')}에서 → ${esc(x.name)} (${esc(nn.get(x.far)?.name || '')}까지)</option>`).join('')}</select><button class="small" id="svc-ext-ok">잇기</button></div>` : ''}`);
  const trainSec = sec('train', `열차·편성 <span class="m">${esc(SERVICE_KINDS[e.kind].label)} · ${esc(TRAIN_TYPES[e.type].label.split(' ')[0])} ${e.sets}편성</span>`, `
    <div class="name-row"><label class="kind" for="svc-kind">등급</label><select id="svc-kind" title="특급·급행은 고른 역에만 서서 통과역마다 정차 시간을 줄이고, 정차역의 배차 간격이 짧아집니다. 열차는 같은 선로 용량을 나눠 씁니다">${Object.entries(SERVICE_KINDS)
      .map(([k, v]) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      <span class="m">정차 방식·요금</span></div>
    <div class="name-row"><label class="kind" for="svc-type">열차</label><select id="svc-type">${Object.entries(TRAIN_TYPES)
      .map(([k, v]) => `<option value="${k}" ${k === e.type ? 'selected' : ''} ${runnable(k) ? '' : 'disabled'}>${v.label}${runnable(k) ? '' : ' (비전철 구간 있음)'}</option>`).join('')}</select></div>
    <div class="name-row"><label class="kind" for="svc-sets">편성</label><input type="range" id="svc-sets" min="1" max="60" value="${e.sets}" style="flex:1" aria-label="편성 수">
      <input type="number" id="svc-sets-n" min="1" max="60" value="${e.sets}" class="num" aria-label="편성 수 직접 입력"></div>
    <p class="hint">${TRAIN_TYPES[e.type].label}: 정원 ${TRAIN_TYPES[e.type].cap.toLocaleString()}명, 편성당 ${formatWon(TRAIN_TYPES[e.type].setCost)}. 편성을 늘리면 운행 횟수가 저절로 늘어납니다.</p>
    ${upg && upg.ids.length ? `<div class="name-row"><label><input type="checkbox" id="svc-upgrade" ${e.upgrade ? 'checked' : ''}> 밑 선로 복선 전철화 함께 착공</label></div>
    <p class="hint">남측 규격 일괄 개량(복선·교류 25kV·120km/h·표준궤) ${upg.km.toFixed(0)}km · ${formatWon(upg.cost)} · 5년. 공사 동안은 지금 선로(단선·저속)로 다닙니다.</p>` : ''}
    ${e.upgrade && upg?.ids.length ? '' : powerHint}`);
  const statsSec = sec('stats', '운행 지표', `<table class="kv">
      ${plan ? `<tr><td>표정 속도</td><td>${(plan.km / (plan.runMin / 60)).toFixed(0)} km/h</td></tr>
      <tr><td>하루 운행 (24시간)</td><td>${trains}회 · 한 방향 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, trains / 2)))}분 간격</td></tr>
      <tr><td>하루 수송력</td><td>${(trains * TRAIN_TYPES[e.type].cap).toLocaleString()}명</td></tr>
      ${(() => {
        const st = e.id && svcStats().find((x) => x.s.id === e.id);
        if (!st) return `<tr><td>하루 이용객</td><td class="m">${e.id ? '다음 해 계산부터 나옵니다' : '운행을 시작하면 다음 해부터 나옵니다'}</td></tr>`;
        return `<tr><td>하루 이용객 (어림)</td><td>${Math.round(st.riders).toLocaleString()}명 <span class="m">평균 ${st.avgKm.toFixed(0)}km 탐</span></td></tr>
          <tr><td>가장 붐비는 구간 · 승차율</td><td>${Math.round(st.peak).toLocaleString()}명 · ${Math.round(st.load * 100)}%</td></tr>`;
      })()}` : '<tr><td colspan="2">정차역을 둘 이상 고르세요.</td></tr>'}
    </table>`);
  const nameSec = sec('name', `이름·색${e.id ? '' : '·재원'} <span class="m">${esc(e.name)}</span>`, `
    <div class="name-row"><label class="kind" for="svc-name">이름</label><input type="text" id="svc-name" value="${esc(e.name)}"><input type="color" id="svc-color" value="${esc(e.color)}" aria-label="노선 색" title="노선 색 (지도에 이 색으로 그립니다)"></div>
    ${e.id ? '' : fundSelect(plan ? [serviceOperator({ segs: plan.segs })] : [])}`);
  // 아래에 붙은 영수증: 무엇을 만드는지, 얼마가 들고 예산이 얼마 남는지 (예전에는 스크롤 끝의 단추만 있었다)
  const nm = (n) => esc(nn.get(n)?.name || '');
  const foot = `<div class="sel-foot">
    ${plan ? `<div class="receipt"><b>${nm(stops[0])} → ${nm(stops[stops.length - 1])}</b> · ${plan.km.toFixed(0)}km · ${fmtMin(plan.runMin)} · 하루 ${trains}회</div>
    <div class="receipt m">차량 ${cost ? formatWon(cost) : '추가 없음'}${cur ? ` (보유 ${cur.sets}편성)` : ''} · 가용 예산 ${formatWon(state.budget)}${cost ? ` → ${formatWon(state.budget - cost)}` : ''} · 다음 해부터 반영</div>` : '<div class="receipt warn-text">정차역을 둘 이상 고르세요.</div>'}
    ${plan && !typeOk ? `<p class="hint warn-text">${esc(TRAIN_TYPES[e.type].label)}은(는) 비전철 구간을 달릴 수 없습니다. 열차를 디젤 객차로 바꾸거나 전철화를 마친 뒤 저장하세요.</p>` : ''}
    <div class="actions">
      <button class="primary" id="svc-ok" ${plan && typeOk ? '' : 'disabled'}>${e.id ? '저장' : '운행 시작'}</button>
      ${e.id ? '<button id="svc-del" class="danger">운행 중단</button>' : ''}
    </div></div>`;
  return `${header(e.id ? `운행 계통 고치기: ${e.name}` : `운행 계통 신설${e.modeLabel ? ` · ${e.modeLabel}` : ''}`)}
    ${routeSec}${trainSec}${statsSec}${nameSec}${foot}`;
}

export function bindService(el) {
  const e = svcEdit;
  if (!e) return;
  el.querySelector('#svc-name').onchange = (ev) => { e.name = ev.target.value.trim() || e.name; e.nameEdited = true; };
  el.querySelector('#svc-electrify')?.addEventListener('click', (ev) => {
    const r = startUpgrade(base, state, JSON.parse(ev.target.dataset.ids), 'electrify');
    if (!r.ok) { alert(r.reason); return; }
    save(state); refreshLinks(); renderAll();
    toast('비전철 구간 전철화를 시작했습니다. 완공되면 이 계통에 전동차를 고를 수 있습니다.');
  });
  el.querySelector('#svc-under')?.addEventListener('click', () => { const id = e.underLink; select({ type: 'link', id, section: sectionOf(id) }); });
  el.querySelector('#svc-color').oninput = (ev) => { e.color = ev.target.value; drawServiceEdit(); };
  drawServiceEdit();
  el.querySelector('#svc-kind').onchange = (ev) => {
    e.kind = ev.target.value;
    e.modeLabel = null;   // 등급을 바꾸면 처음 고른 방식(KTX 등) 표시는 맞지 않는다
    // 이름을 손대지 않았으면 시점–종점과 새 등급으로 (예전에는 첫 노선 이름으로 바뀌어 '경부선 급행'이 되었다)
    if (!e.nameEdited) { const nn = nodeNames(), st = e.nodes.filter((n) => e.stops.has(n)); e.name = `${nn.get(st[0])?.name}–${nn.get(st[st.length - 1])?.name} ${SERVICE_KINDS[e.kind].label}`; }
    if (!e.id) e.stops = defaultStops(e.nodes, e.kind);
    renderSelection();
  };
  el.querySelector('#svc-type').onchange = (ev) => { e.type = ev.target.value; renderSelection(); };
  el.querySelector('#svc-upgrade')?.addEventListener('change', (ev) => { e.upgrade = ev.target.checked; if (!e.upgrade && !canRun(e.type, servicePlan().plan?.under || [])) e.type = 'diesel'; renderSelection(); });
  el.querySelector('#svc-ext-ok')?.addEventListener('click', () => {
    const v = el.querySelector('#svc-ext').value;
    if (v === '') { toast('이어 갈 노선을 먼저 고르세요.'); return; }
    const x = e.ext?.[+v];
    if (x) extendServiceLine(x);
  });
  // 경로 다시 고르기: 고른 역과 방식을 그대로 들고 계통 신설 첫 화면으로
  el.querySelector('#svc-back')?.addEventListener('click', () => { const picks = e.picks, mode = e.mode; startServicePick(picks); if (svcPick) svcPick.mode = mode; });
  const from = el.querySelector('#svc-from'), to = el.querySelector('#svc-to');
  const trim = () => { if (+from.value >= +to.value) { toast('시점은 종점보다 앞 역이어야 합니다.'); renderSelection(); return; } trimService(+from.value, +to.value); };
  if (from) { from.onchange = trim; to.onchange = trim; }
  bindStationSearch(el, 'svc-find', () => e.nodes, (n) => serviceEditNode(n));
  const setsR = el.querySelector('#svc-sets'), setsN = el.querySelector('#svc-sets-n');
  setsR.oninput = () => { e.sets = +setsR.value; setsN.value = e.sets; };
  setsR.onchange = () => renderSelection();
  setsN.onchange = () => { e.sets = Math.max(1, Math.min(60, Math.round(+setsN.value) || 1)); renderSelection(); };
  // 접는 칸을 열고 닫은 상태를 기억한다 (다시 그려도 그대로)
  el.querySelectorAll('details.svc-sec').forEach((d) => { d.ontoggle = () => { (e.openSec ||= {})[d.dataset.sec] = d.open; }; });
  el.querySelectorAll('[data-stop-toggle]').forEach((a) => {
    a.onclick = (ev) => { ev.preventDefault(); const n = +a.dataset.stopToggle; if (e.stops.has(n)) e.stops.delete(n); else e.stops.add(n); renderSelection(); };
  });
  // 역을 눌러도 목록이 맨 위로 돌아가지 않게
  const stopBox = el.querySelector('#svc-stops');
  if (stopBox) {
    stopBox.scrollTop = e.stopScroll || 0;
    stopBox.onscroll = () => { e.stopScroll = stopBox.scrollTop; };
  }
  el.querySelectorAll('[data-svc-preset]').forEach((b) => { b.onclick = () => { e.stops = defaultStops(e.nodes, b.dataset.svcPreset); renderSelection(); }; });
  el.querySelector('#svc-ok').onclick = () => {
    const { stops, plan } = servicePlan();
    if (!plan) return;
    // 계통 이름은 겹치지 않게: 같은 이름 계통이 있으면 두 끝 역을 붙인다 (평의선 특급 (평양–신의주))
    const nn = nodeNames(), endName = (n) => nn.get(n)?.name || '';
    const taken = (nm) => (state.services || []).some((x) => x.id !== e.id && x.name === nm);
    const nm0 = e.name, nm1 = `${nm0} (${endName(stops[0])}–${endName(stops[stops.length - 1])})`;
    const name = !taken(nm0) ? nm0 : !taken(nm1) ? nm1 : `${nm1} ${SERVICE_KINDS[e.kind].label}`;
    const rec = { name, kind: e.kind, line: e.lines[0], lines: e.lines, cls: e.cls, stops, type: e.type, sets: e.sets, runMin: plan.runMin, km: plan.km, segs: plan.segs, color: e.color,
      underLinks: plan.under, plan: e.plan };
    // 계획 광역 전철: 복선 전철화를 먼저 착공한다 (예산이 모자라면 계통도 열지 않는다)
    if (e.plan && e.upgrade) {
      const upg = serviceUpgrade(plan);
      if (upg.ids.length) {
        const u = startUpgrade(base, state, upg.ids, 'kpstd', { label: `${e.name} 복선 전철화` });
        if (!u.ok) { alert(u.reason); return; }
      }
    }
    // 단계 확장: 계통이 거쳐 온 계획(planChain)을 적어 두고, 이 계획을 착공한 것으로 남긴다 (차량을 더 사면 그 사업, 아니면 운행 연장 사업)
    const before = e.id && state.services.find((x) => x.id === e.id);
    if (before && e.plan && before.plan && before.plan !== e.plan) rec.planChain = [...new Set([...(before.planChain || []), before.plan])];
    const nProj = state.projects.length;
    const r = e.id ? updateService(state, e.id, rec) : startService(state, rec);
    if (!r.ok) { alert(r.reason); return; }
    if (e.id && e.plan) {
      const veh = state.projects.slice(nProj).find((p) => p.kind === 'vehicles');
      if (veh) veh.plan = e.plan;
      else startProject(state, { id: crypto.randomUUID(), kind: 'vehicles', service: e.id, plan: e.plan, links: [], cost: 0, years: 1, fund: before?.fund || 'gov', label: `${name} 운행 연장 (${plansOf?.().find((x) => x.id === e.plan)?.name || ''})` });
    }
    // 계획 광역 전철의 중간 신설역: 계통이 지나는 선로 위 가장 가까운 자리에 역을 놓는다 (완공되면 계통이 선다)
    const pl = e.plan && plansOf?.().find((x) => x.id === e.plan);
    for (const [nm, lon, lat] of pl?.newStops || []) {
      const sv = e.id ? state.services.find((x) => x.id === e.id) : state.services[state.services.length - 1];
      // 광역철도 전용역: 고속선이 아닌 일반선 위에만 놓는다
      const ids = [...new Set(sv.segs.flatMap((sg) => sg.via))].filter((i) => linkAt(base, state, i).cls !== 'hsr');
      let best = null, bd = 1.5;
      for (const i of ids) {
        const g = linkAt(base, state, i).geom || [];
        for (let k = 0; k + 3 < g.length; k += 2) {
          if (Number.isNaN(g[k]) || Number.isNaN(g[k + 2])) continue;
          const d = Math.min(kmBetween(lon, lat, g[k], g[k + 1]), kmBetween(lon, lat, g[k + 2], g[k + 3]));
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best == null) continue;
      const name = nm || namer.suggest(lon, lat, 'station');
      startStationAdd(base, state, { link: best, lon, lat, name });
    }
    svcEdit = null;
    save(state); select(null); renderAll();
  };
  el.querySelector('#svc-del')?.addEventListener('click', () => {
    if (!confirm(`${e.name} 운행을 멈추고 계통을 지웁니다. 되돌릴 수 없습니다.`)) return;
    removeService(state, e.id);
    svcEdit = null;
    save(state); select(null); renderAll();
  });
}

/** 이 구간을 실제로 지나는 계통 (지도에서 선로를 누르면 맨 위에 보여 한 번 더 눌러 고른다) */
export function servicesOn(ids) {
  const set = new Set(ids);
  return (state.services || []).filter((s) => s.segs?.some((sg) => sg.via.some((i) => set.has(i))));
}
export function passingServicesHTML(ids) {
  const list = servicesOn(ids);
  if (!list.length) return '';
  return `<h4>이 구간을 지나는 운행 계통 ${list.length}개</h4>
    <div class="actions">${list.map((s) => `<button class="small" data-svc-edit="${s.id}" title="이 계통 고치기"><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(svcColor(s, state.services.indexOf(s)))}"></span> ${esc(s.name)}</button>`).join('')}</div>`;
}

/** 링크 패널의 운행 계통·수익성 (도시철도는 수익성만) */
export function serviceSection(l, ids = []) {
  const ec = lineEconomics().find((x) => x.name === l.name);
  const econ = ec ? `<p class="hint">이 노선: 연 수입 ${formatWon(ec.rev / 1e8)} · 비용 ${formatWon(ec.cost / 1e8)} · 영업계수 <b class="${ec.ratio > 100 ? 'neg' : ''}">${fmtRatio(ec.ratio)}</b></p>` : '';
  const diagram = '<button class="small" id="line-diagram">노선도 보기 (열차 위치·정차역·혼잡도)</button>';
  if (l.mode === 2) return `<h4>노선도 · 수익성</h4><div class="actions">${diagram}</div>${econ}<p class="hint">도시철도 이용객에는 같은 구 안의 짧은 이용(역세권 인구로 어림)이 들어 있습니다.</p>`;
  const here = new Set(servicesOn(ids));   // 이 구간을 지나는 계통은 패널 맨 위에
  const list = (state.services || []).filter((s) => !here.has(s) && (s.line === l.name || s.lines?.includes(l.name)));
  // 보통(자동) 열차: 모든 노선에 저절로 다니는 모든 역 정차 열차. 운행 비율(감편)은 여기서도 바꾼다
  const t = autoLocalTrains(l.name, l.cls), f = state.lineFreq?.[l.name] || 1;
  // 연결선은 다른 노선 열차가 지나기만 한다: 보통 열차 줄 대신 그렇다고 알린다
  const autoRow = isConnectorLine(l.name) ? '<p class="hint">다른 노선 열차가 지나는 연결선입니다. 보통 열차는 따로 다니지 않습니다.</p>' : `<div class="item opt"><div class="opt-row">
      <span>${esc(autoBrand(l.cls === 'hsr' ? 'hsr' : 'conv', operatorOf(state, l)))} (자동) <span class="m">모든 역 정차 · 하루 ${t}회 · 약 ${Math.max(1, Math.round(SERVICE_DAY_MIN / Math.max(1, t / 2)))}분 간격 · 노선 최대 이용객에 맞춰 저절로 정함${l.cls === 'hsr' ? '' : ' (광역 전철이 같이 다니는 구간은 전철 운행까지 센 횟수)'}</span></span>
      <select data-freq="${esc(l.name)}" title="보통 열차 운행 비율 (감편)">${FREQ_STEPS.map((x) => `<option value="${x}" ${x === f ? 'selected' : ''}>운행 ${Math.round(x * 100)}%</option>`).join('')}</select></div></div>`;
  return `<h4>노선도 · 운행 계통 · 수익성</h4><div class="actions">${diagram}
    <button class="small" id="st-start" title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선">구간 직선화 (두 역 고르기)</button></div>${econ}
    <div class="list">${autoRow}${list.map((s) => `<div class="item opt"><div class="opt-row">
      <span>${esc(s.name)} <span class="m">${s.name.includes(serviceBrand(s)) ? '' : `${esc(serviceBrand(s))} · `}${s.name.includes(SERVICE_KINDS[s.kind].label) ? "" : `${SERVICE_KINDS[s.kind].label} · `}${s.stops.length}개 역 · ${TRAIN_TYPES[s.type]?.label.split(' ')[0] || ''} ${s.sets}편성 · 하루 ${s.trains}회${s.built ? '' : ' · 차량 제작 중'}</span></span>
      ${opBadge(state, serviceOperator(s))} <button class="small" data-svc-edit="${s.id}">고치기</button></div></div>`).join('')}</div>
    <div class="actions"><button class="small primary svc-pick" title="시점과 종점을 골라 새 계통을 짭니다 (여러 노선을 지나도 됩니다)">운행 계통 신설</button></div>`;
}

export function fmtRatio(r) { return isFinite(r) ? Math.round(r).toLocaleString() : '–'; }

/** 운행 계통별 이용·수지 (시뮬레이션 결과의 가상 링크 순서 = 운행 중 계통의 구간 순서) */
export function svcStats() {
  const sv = result?.links.svcVol;
  const built = (state.services || []).filter((s) => s.built);
  if (!sv || sv.length !== built.reduce((n, s) => n + s.segs.length, 0)) return [];
  let k = 0;
  return built.map((s) => {
    let pkm = 0, peak = 0;
    const vs = [];
    for (const seg of s.segs) {
      const v = sv[k++] || 0;
      vs.push(v);
      pkm += v * seg.via.reduce((a, i) => a + linkAt(base, state, i).len, 0);
      peak = Math.max(peak, v);
    }
    // 하루 이용객(어림): 구간 이용객(양방향)이 늘어난 만큼 그 역에서 탔다고 본다.
    // 한 방향마다 첫 구간 + 늘어난 몫을 더하면 (v₁ + vₙ + Σ|vₖ − vₖ₋₁|) / 2 (같은 역에서 내리고 타는 사람은 빠져 조금 적게 나온다)
    let riders = vs.length ? (vs[0] + vs[vs.length - 1]) / 2 : 0;
    for (let j = 1; j < vs.length; j++) riders += Math.abs(vs[j] - vs[j - 1]) / 2;
    const avgKm = riders > 0 ? pkm / riders : 0;
    const cls = s.cls === 'hsr' ? 'hsr' : 'conv', fare = OPERATING.fareKm[cls] * SERVICE_KINDS[s.kind].fareFactor;
    const rev = pkm * fare * 365;
    // 비용: 열차-km 운행비 + 차량 감가상각(25년)
    const tt = TRAIN_TYPES[s.type] || TRAIN_TYPES.intercity;
    const cost = s.trains * s.km * tt.kmCost * 365 + (s.sets * tt.setCost * 1e8) / 25;
    return { s, peak, riders, avgKm, load: pkm / Math.max(1, s.trains * tt.cap * s.km), rev, cost,
      ratio: rev > 0 ? (cost / rev) * 100 : Infinity, premium: pkm * OPERATING.fareKm[cls] * (SERVICE_KINDS[s.kind].fareFactor - 1) * 365 };
  });
}

/**
 * 노선별 수지 (원/년): 수입 = 구간 이용객 × 거리 × km당 운임, 비용 = 열차-km 운행비 + 선로 유지비.
 * 열차 수는 이용객을 승차율 65%로 실을 만큼 (최소 운행 횟수 이상)으로 잡는다.
 */
export let econCache = null;
export function setEconCache(v) { return (econCache = v); }
export function lineEconomics() {
  if (!result) return [];
  if (econCache?.res === result) return econCache.rows;
  const OP = OPERATING, vol = result.links.vol, lines = new Map();
  allLinks().forEach((_, i) => {
    const l = linkAt(base, state, i);
    if (l.mode === 0 || !l.name || l.ext || l.cls === 'ferry' || linkPending(base, state, i) || state.replaced?.[i] || i >= vol.length) return;
    if (state.closedLines?.[l.name]) return;
    if (i >= base.links.length && !l.built) return;
    const cls = l.mode === 2 ? 'metro' : l.cls === 'hsr' ? 'hsr' : 'conv';
    let e = lines.get(l.name);
    if (!e) lines.set(l.name, (e = { name: l.name, cls, km: 0, rev: 0, cost: 0, track: 0, peak: 0 }));
    const v = vol[i];
    // 감편한 노선은 최소 운행도 그만큼 줄인다. 북측 구간은 운영사 수지와 같은 운임·비용 보정을 쓴다
    const f = state.lineFreq?.[l.name] || 1;
    const kpRail = l.kp && l.mode === 1 && !state.rail?.merged;
    const trains = Math.max(OP.minTrains[cls] * f * (kpRail ? OP_FACTORS.kpMinTrains : 1), v / (OP.paxPerTrain[cls] * OP.loadFactor));
    e.km += l.len;
    e.peak = Math.max(e.peak, v);
    e.rev += v * l.len * OP.fareKm[cls] * 365 * (l.kp && l.mode === 1 ? OP_FACTORS.kpFare(state.integration) : 1);
    const track = l.len * Math.max(1, Math.min(l.tracks || 2, 4)) * OP.trackKmCost[cls] * (l.kp && l.mode === 1 ? OP_FACTORS.kpTrackCost : 1);
    e.track += track;
    e.cost += trains * l.len * OP.trainKmCost[cls] * 365 * (l.kp && l.mode === 1 ? OP_FACTORS.kpCost : 1) + track;
  });
  // 특급·급행 승객은 등급 요금을 더 낸다
  for (const x of svcStats()) { const e = lines.get(x.s.line); if (e) e.rev += x.premium; }
  // 도시철도의 같은 구 안 이용은 모형이 구간 이용객에 이미 얹는다 (model.metroLocalLoads)
  // 여객 이용이 없는 노선(화물선, 역이 없는 선로)은 여객 열차가 다니지 않으므로 선로 유지비만 든다
  for (const e of lines.values()) if (e.peak < 1) { e.idle = true; e.cost = e.track; }
  const rows = [...lines.values()].filter((e) => e.km >= 5).map((e) => ({ ...e, ratio: e.rev > 0 ? (e.cost / e.rev) * 100 : Infinity }));
  econCache = { res: result, rows };
  return rows;
}

/** 항공 노선 영업계수: 편당 비용(기본비 + 거리비) ÷ 운임 수입 */
export function airRatio(aps, a, b, pax, freq) {
  const A = aps.find((x) => x.id === a), B = aps.find((x) => x.id === b);
  if (!A || !B) return Infinity;
  const km = kmBetween(A.lon, A.lat, B.lon, B.lat);
  const fare = (45000 + 90 * km) * (A.country !== B.country ? 1.6 : 1);
  const cost = 2 * freq * (9e6 + 14000 * km);
  return pax > 0 ? (cost / (pax * fare)) * 100 : Infinity;
}
