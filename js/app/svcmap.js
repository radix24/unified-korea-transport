// 운행 계통을 지도에 노선으로.
import { formatWon, resolve } from '../game/catalog.js';
import { metroOpBadge, opBadge, operatorOf } from '../game/operators.js';
import { canRun, defaultTrainType, isGTX, SERVICE_KINDS } from '../game/services.js';
import { canAfford, effectiveNetwork, fundFor, linkAt, linkPending, linksBlockedFor, linksUnderBuild, upgradeCost, UPGRADES } from '../game/state.js';
import { t } from '../i18n.js';
import { kmBetween } from '../sim/model.js';
import { railStd } from '../ui/railkind.js';
import { base, CLASS_LABEL, esc, map, result, selection, state, wholeRoute } from './core.js';
import { allLinks, linkTwins, nodeCoord, nodeNames, shownTraffic, stationKey } from './mapdata.js';
import { select } from './interact.js';
import { renderSelection } from './econ.js';
import { defaultStops, openServiceEditor, passingServicesHTML, railStationSet, servicePlan, serviceSection, setSvcEdit, stationRiders, svcEdit } from './svc.js';
import { fundSelect } from './operators.js';
import { pathCoords } from './straighten.js';
import { toast } from '../ui/panel.js';
import { drawServicePick, endMapTools, isCommuterLine, nearestStation, routeThrough, setSvcPick, svcPick } from './pick.js';
import { LINE_ORIGIN, originConnector, reopenHTML, sameRoute } from './reopen.js';

// ------------------------------------------------------------ 운행 계통을 지도에 노선으로

export const SVC_COLORS = ['#e4572e', '#2e86de', '#20a35a', '#9b59b6', '#f0a202', '#d6337f', '#0fa3b1', '#7a5c3e', '#596275', '#c0392b', '#6ab04c', '#30336b'];
export let showServices = true;
export function setShowServices(v) { return (showServices = v); }
try { showServices = localStorage.getItem('ukt-svc-lines') !== '0'; } catch { /* 기본은 켬 */ }
export let showHousing = true;   // 택지지구 면·경계·단지 도로 (범례에서 끌 수 있다)
export function setShowHousing(v) { return (showHousing = v); }
try { showHousing = localStorage.getItem('ukt-housing') !== '0'; } catch { /* 기본은 켬 */ }

/** 운행 계통 색: 등급마다 한 색 (노선마다 다른 색이면 여러 계통이 겹칠 때 무엇이 특급인지 읽히지 않았다) */
export const GRADE_COLORS = { hsr: '#1f5fd1', gtx: '#0b7a8f', limited: '#d62828', express: '#f08c00', local: '#2b8a3e', commuter: '#7048e8' };
export const GRADE_LABELS = { hsr: '고속', gtx: 'GTX', limited: '특급', express: '급행', local: '보통', commuter: '광역' };
export function svcGrade(s) {
  if ((s.lines || [s.line]).some((n) => /^GTX-/.test(n || ''))) return 'gtx';
  return s.cls === 'hsr' ? 'hsr' : GRADE_COLORS[s.kind] ? s.kind : 'local';
}
/** 선로 종류: 도시철도·GTX·일반철도·고속철도를 가른다 (GTX는 일반철도 자료로 들어와 있다) */
export function railKindLabel(l) {
  if (l.mode === 1 && isGTX(l)) return 'GTX (광역급행철도, GTX 열차만 다님)';
  return CLASS_LABEL[l.cls];
}
export function svcColor(s) { return GRADE_COLORS[svcGrade(s)]; }

/** 새 계통 색: 아직 안 쓴 색부터 */
export function nextSvcColor() {
  const used = new Set((state.services || []).map((s, k) => svcColor(s, k)));
  return SVC_COLORS.find((c) => !used.has(c)) || SVC_COLORS[(state.services || []).length % SVC_COLORS.length];
}

/** 계통 구간(a에서 via를 따라)들을 이은 좌표 */
export function serviceCoords(links, segs) {
  const out = [];
  for (const sg of segs) {
    const c = pathCoords(links, sg.via, sg.a);
    out.push(...(out.length ? c.slice(1) : c));
  }
  return out;
}

/**
 * 운행 계통을 계통 색의 노선으로 그린다 (차량 제작 중이면 옅게).
 * 같은 자리를 지나는 계통은 그 자리에서만 나란히 비켜 그린다: 300m 남짓 조각마다 그곳을 함께 지나는 계통 수만큼 칸을 나눠
 * 선로를 가운데에 두고 늘어놓는다 (경의·중앙선과 GTX-A처럼 선로가 달라도 겹쳐 지나면 같은 자리로 친다).
 * 예전에는 계통 번호로 정한 한 칸을 노선 전체에 써서, 번호가 다섯 차이 나는 계통끼리 겹치고 혼자 다니는 곳에서도 비켜 그렸다
 */
export const SVC_CELL = 0.003;   // 겹침을 보는 칸 (경위도, 약 300m)
export function drawServices() {
  const src = map?.getSource('services');
  if (!src || !state) return;
  const f = [];
  if (showServices && state.services?.length) {
    const links = effectiveNetwork(base, state).links;
    const all = allLinks();
    const list = state.services.map((s, k) => ({ s, k })).filter(({ s }) => svcEdit?.id !== s.id && s.segs?.length);
    // 링크가 덮는 칸 (300m 간격으로 짚은 점)
    const cellMemo = new Map();
    const cellsOf = (i) => {
      let c = cellMemo.get(i);
      if (c) return c;
      c = new Set();
      const g = all[i]?.geom || [];
      for (let k = 0; k + 3 < g.length; k += 2) {
        const [x0, y0, x1, y1] = [g[k], g[k + 1], g[k + 2], g[k + 3]];
        if (Number.isNaN(x0) || Number.isNaN(x1)) continue;
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / SVC_CELL));
        for (let t = 0; t <= n; t++) c.add(`${Math.round((x0 + ((x1 - x0) * t) / n) / SVC_CELL)},${Math.round((y0 + ((y1 - y0) * t) / n) / SVC_CELL)}`);
      }
      cellMemo.set(i, c);
      return c;
    };
    const svcCells = list.map(({ s }) => { const set = new Set(); for (const sg of s.segs) for (const i of sg.via) for (const c of cellsOf(i)) set.add(c); return set; });
    const byCell = new Map();
    svcCells.forEach((set, t) => { for (const c of set) { if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(t); } });
    // 링크의 기준 방향: 양 끝을 이은 방향이 동쪽(정북 포함)이면 a→b. 칸 번호는 이 방향의 오른쪽을 +로 센다
    // (나란한 다른 선로라도 같은 쪽을 같은 부호로: 반대로 지나는 계통끼리 같은 쪽에 겹치지 않게)
    const canonMemo = new Map();
    const canon = (i) => {
      if (canonMemo.has(i)) return canonMemo.get(i);
      const g = all[i]?.geom || [], n = g.length;
      const dx = n >= 4 ? g[n - 2] - g[0] : 0, dy = n >= 4 ? g[n - 1] - g[1] : 0;
      const v = dx > 0 || (dx === 0 && dy > 0);
      canonMemo.set(i, v);
      return v;
    };
    // 계통 칸 정하기: 긴 계통부터, 칸을 둘 넘게 함께 쓰는(나란히 가는) 계통이 아직 쓰지 않은 가장 작은 칸
    const slotOf = new Array(list.length).fill(0);
    {
      const order = list.map((_, t) => t).sort((x, y) => svcCells[y].size - svcCells[x].size);
      const done = [];
      for (const t of order) {
        const used = new Set();
        for (const u of done) {
          let shared = 0;
          for (const cc of svcCells[t]) if (svcCells[u].has(cc) && ++shared >= 2) break;
          if (shared >= 2) used.add(slotOf[u]);
        }
        let k = 0;
        while (used.has(k)) k++;
        slotOf[t] = k;
        done.push(t);
      }
    }
    // 구간을 함께 지나는 계통: 그 구간 칸의 절반 넘게에 있는 계통 (구간마다 한 번)
    const groupMemo = new Map();
    const linkGroup = (i) => {
      if (groupMemo.has(i)) return groupMemo.get(i);
      const cells = cellsOf(i), tally = new Map();
      for (const cc of cells) for (const t of byCell.get(cc) || []) tally.set(t, (tally.get(t) || 0) + 1);
      const g = [...tally].filter(([, n]) => n * 2 >= cells.size).map(([t]) => t);
      groupMemo.set(i, g);
      return g;
    };
    // 그 자리(칸과 둘레 8칸)를 지나는 계통
    const groupAt = (x, y) => {
      const cx = Math.round(x / SVC_CELL), cy = Math.round(y / SVC_CELL), g = new Set();
      for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) for (const t of byCell.get(`${cx + u},${cy + v}`) || []) g.add(t);
      return [...g].sort((a, b) => a - b);
    };
    list.forEach(({ s, k }, j) => {
      const props = { id: s.id, color: svcColor(s, k), built: s.built ? 1 : 0 };
      let cur = null;
      const flush = () => { if (cur && cur.c.length > 1) f.push({ type: 'Feature', properties: { ...props, off: cur.off }, geometry: { type: 'LineString', coordinates: cur.c } }); };
      const put = (p, q, off) => {
        if (cur && cur.off === off) cur.c.push(q);
        else { flush(); cur = { off, c: [p, q] }; }
      };
      for (const sg of s.segs) {
        let node = sg.a;
        for (const i of sg.via) {
          const c = pathCoords(links, [i], node);
          const l = links[i];
          const fwd = l.a === node;
          node = fwd ? l.b : l.a;
          const sign = fwd === canon(i) ? 1 : -1;
          // 계통마다 칸 하나를 처음부터 끝까지 (함께 지나는 계통끼리 다른 칸): 칸이 바뀌지 않아 계통 하나가 끊기지 않은 한 줄이 된다.
          // 칸은 진행 방향 오른쪽으로 센다 (예전에는 구간 방향(동서)마다 칸과 쪽이 바뀌어 남북으로 가는 경강선 등이 토막토막 끊겨 보였다)
          // 칸 번호는 이 구간을 함께 지나는 계통 사이의 순서로 줄인다: 계통 전체에 한 칸을 쓰면 붐비는 수도권에서 받은 큰 칸 번호를
          // 혼자 다니는 곳에서도 그대로 써, 선로에서 멀리 떨어져 그려졌다 (혼자 다니면 선로 위에)
          const g = linkGroup(i).filter((t) => t !== j);
          const off = g.filter((t) => slotOf[t] < slotOf[j] || (slotOf[t] === slotOf[j] && t < j)).length;
          for (let m = 0; m + 1 < c.length; m++) put(c[m], c[m + 1], off);
        }
      }
      flush();
    });
  }
  src.setData({ type: 'FeatureCollection', features: f });
}

/** 목록에서 계통 위에 마우스를 올리면 지도에서 그 계통만 진하게 (null이면 되돌린다) */
const SVC_OPACITY = ['case', ['==', ['get', 'built'], 1], 0.9, 0.5];
export function previewService(id) {
  if (!map?.getLayer('services-line')) return;
  map.setPaintProperty('services-line', 'line-opacity', id ? ['case', ['==', ['get', 'id'], id], 1, 0.1] : SVC_OPACITY);
}

/** 목록에서 고른 계통을 열고 지도를 그 노선에 맞춘다 */
export function goService(id) {
  const s = state.services.find((x) => x.id === id);
  if (!s) return;
  previewService(null);
  if (svcPick) endServicePick();
  endMapTools();
  // 저장된 구간(segs)이 비었거나 일부만 남은 계통(예: 대경선 복원)도 노선 전체가 들어오게 정차역 좌표를 함께 쓴다
  const c = [...serviceCoords(effectiveNetwork(base, state).links, s.segs || []), ...(s.stops || []).map((n) => nodeCoord(n)).filter(Boolean)];
  openServiceEditor(s.line, s.cls, s.id);
  if (c.length > 1) {
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 11, duration: 500 });
  }
}

/** 계통 편집 중: 지금 고른 정차역과 경로를 지도에 */
export function drawServiceEdit() {
  const e = svcEdit;
  if (!e) return;
  const { plan } = servicePlan();
  const f = [...e.stops].filter((n) => nodeCoord(n)).map((n) => ({ type: 'Feature', properties: { svc: 1 }, geometry: { type: 'Point', coordinates: nodeCoord(n) } }));
  if (plan) f.push({ type: 'Feature', properties: { svc: 1, color: svcColor(e) }, geometry: { type: 'LineString', coordinates: serviceCoords(effectiveNetwork(base, state).links, plan.segs) } });
  map.getSource('draft').setData({ type: 'FeatureCollection', features: f });
  const src = map.getSource('services');
  if (src && e.id) drawServices();
}

/** 계통 편집 중 지도에서 역을 누르면: 계통 위 역은 정차를 넣고 빼고, 계통 밖 역은 가장 덜 돌아가는 자리에 넣어 경로를 늘린다 */
export function serviceEditClick(ll) {
  const n = nearestStation(ll);
  if (n != null) serviceEditNode(n);
}

/** 계통 편집: 역 하나를 넣고 뺀다 (경로 위 역이면 정차를 켜고 끄고, 밖의 역이면 그 역까지 경로를 늘린다) */
export function serviceEditNode(n) {
  const e = svcEdit;
  if (e.nodes.includes(n)) {
    const on = !e.stops.has(n);
    if (on) e.stops.add(n); else e.stops.delete(n);
    toast(`${nodeNames().get(n)?.name || '역'} ${on ? '정차' : '통과'}`);   // 지도를 작게 보면 어느 역이 눌렸는지 알기 어렵다
    renderSelection();
    return;
  }
  const stops = e.nodes.filter((x) => e.stops.has(x));
  const d = (a, b) => { const p = nodeCoord(a), q = nodeCoord(b); return kmBetween(p[0], p[1], q[0], q[1]); };
  let at = 0, bc = Infinity;
  for (let k = 0; k <= stops.length; k++) {
    const cost = !stops.length ? 0 : k === 0 ? d(n, stops[0]) : k === stops.length ? d(stops[k - 1], n) : d(stops[k - 1], n) + d(n, stops[k]) - d(stops[k - 1], stops[k]);
    if (cost < bc) { bc = cost; at = k; }
  }
  const picks = [...stops.slice(0, at), n, ...stops.slice(at)];
  const r = picks.length >= 2 ? routeThrough(picks) : null;
  if (!r) { toast(`${nodeNames().get(n)?.name || '이 역'}까지 이어지는 철도 경로가 없습니다.`); return; }
  e.lines = r.lines; e.line = r.lines[0]; e.nodes = r.nodes;
  e.stops.add(n);
  renderSelection();
}

// ------------------------------------------------------------ 역 이름으로 찾기 (지도에서 작은 역을 누르기 어려워서)

/** 철도역 이름 목록 (datalist) 과 찾기 칸 */
export function stationSearchHTML(id, placeholder, label = '역 찾기', value = '', listId = null) {
  // listId: 같은 패널의 다른 찾기 칸 목록을 같이 쓴다 (역 1,400여 개를 칸마다 다시 넣지 않게)
  let list = '';
  if (!listId) {
    const nn = nodeNames(), names = new Set();
    for (const n of railStationSet()) { const nm = nn.get(n)?.name; if (nm) names.add(nm); }
    list = `<datalist id="${id}-list">${[...names].sort((a, b) => a.localeCompare(b)).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
  }
  return `<div class="name-row"><label class="kind" for="${id}">${esc(label)}</label><input type="text" id="${id}" list="${listId || `${id}-list`}" value="${esc(value || '')}" placeholder="${esc(placeholder)}" style="flex:1">${list}</div>`;
}

/** 이름에 맞는 철도역 노드. 같은 이름 역이 여럿이면 near(노드 목록)에 가장 가까운 역, near가 없으면 이용객이 많은 역 */
export function findStationNode(name, near = []) {
  const key = stationKey(name || '');
  if (!key) return null;
  const nn = nodeNames(), cands = [...railStationSet()].filter((n) => nn.get(n) && stationKey(nn.get(n).name) === key && nodeCoord(n));
  if (!cands.length) return null;
  const ref = near.map(nodeCoord).filter(Boolean);
  if (ref.length) {
    const dist = (n) => { const c = nodeCoord(n); return Math.min(...ref.map((q) => kmBetween(c[0], c[1], q[0], q[1]))); };
    return cands.sort((a, b) => dist(a) - dist(b))[0];
  }
  const r = stationRiders();
  return cands.sort((a, b) => (r.get(b) || 0) - (r.get(a) || 0))[0];
}

/** 찾기 칸: Enter나 목록에서 고르면 on(노드)을 부르고 그 역으로 지도를 옮긴다 */
export function bindStationSearch(el, id, near, on) {
  const inp = el.querySelector('#' + id);
  if (!inp) return;
  const go = () => {
    const v = inp.value.trim();
    if (!v) return;
    const n = findStationNode(v, near());
    if (n == null) { toast(`'${v}' 역을 찾지 못했습니다. 목록에 나오는 이름으로 골라 보세요.`); return; }
    map.easeTo({ center: nodeCoord(n), zoom: Math.max(map.getZoom(), 10) });
    inp.value = '';
    on(n);
    setTimeout(() => document.querySelector('#' + id)?.focus(), 0);
  };
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); go(); } });
  // 목록에서 고르면 input 이벤트로 값이 통째로 들어온다
  inp.addEventListener('input', (ev) => { if (ev.inputType === 'insertReplacementText' || ev.inputType == null) go(); });
  inp.addEventListener('focus', () => inp.select());   // 시점·종점 칸은 지금 역 이름이 들어 있어 바로 고쳐 쓰게
}

export function endServicePick() {
  setSvcPick(null);
  map.getCanvas().style.cursor = '';
  map.getSource('draft').setData({ type: 'FeatureCollection', features: [] });
}

export function servicePickClick(ll) {
  const best = nearestStation(ll);
  if (best != null) servicePickNode(best);
}

/** 새 계통의 방식: 등급·열차·편성과 정차 방식을 한 번에 (실제 계통 이름으로 고른다) */
export const SERVICE_MODES = {
  ktx: { label: 'KTX', sub: '고속, 큰 역만', kind: 'limited', types: ['hsr', 'semi', 'intercity', 'diesel'], sets: 6 },
  itx: { label: 'ITX', sub: '급행, 큰 역 절반', kind: 'express', types: ['intercity', 'diesel'], sets: 4 },
  local: { label: '무궁화', sub: '보통, 모든 역', kind: 'local', types: ['intercity', 'diesel'], sets: 4 },
  commuter: { label: '광역', sub: '전철, 모든 역, 싼 요금', kind: 'commuter', types: ['commuter', 'diesel'], sets: 10 },
};
/** 경로에 맞는 방식: 광역 전철 노선만 지나면 광역, 고속선이 절반 넘으면 KTX, 아니면 ITX */
export function suggestMode(r) {
  if (r.lines.every(isCommuterLine)) return 'commuter';
  return r.cls === 'hsr' ? 'ktx' : 'itx';
}

const kmOf = (a, b) => { const p = nodeCoord(a), q = nodeCoord(b); return p && q ? kmBetween(p[0], p[1], q[0], q[1]) : Infinity; };
/** 거쳐 갈 역: 시점과 종점 사이 가장 덜 돌아가는 자리에 끼운다 (예전에는 늘 끝에 붙어, 종점 뒤로 되돌아가는 계통이 생겼다) */
function insertVia(picks, n) {
  if (picks.length < 2) { picks.push(n); return; }
  let at = 1, best = Infinity;
  for (let k = 1; k < picks.length; k++) {
    const cost = kmOf(picks[k - 1], n) + kmOf(n, picks[k]) - kmOf(picks[k - 1], picks[k]);
    if (cost < best) { best = cost; at = k; }
  }
  picks.splice(at, 0, n);
}
/** 시점·종점 바꾸기 (role: 'from' | 'to') */
function setEnd(picks, role, n) {
  const k = picks.indexOf(n);
  if (k >= 0) picks.splice(k, 1);
  if (role === 'from') { if (picks.length) picks.unshift(n); else picks.push(n); }
  else if (picks.length < 2) picks.push(n);
  else picks[picks.length - 1] = n;
}

/** 지도에서 역을 누르면: 시점 → 종점 → 거쳐 갈 역 차례로. 이미 고른 역을 누르면 뺀다 */
export function servicePickNode(n) {
  const picks = svcPick.picks, k = picks.indexOf(n);
  if (k >= 0) picks.splice(k, 1); else insertVia(picks, n);
  drawServicePick();
  renderSelection();
}

/** 고른 역 사이 경로가 같은 선로를 두 번 지나는지 (되돌아가는 계통) */
function doublesBack(r) {
  const seen = new Set();
  for (const sg of r.segs) for (const i of sg.via) { if (seen.has(i)) return true; seen.add(i); }
  return false;
}

export function servicePickPanel() {
  const nn = nodeNames(), picks = svcPick.picks, name = (n) => esc(nn.get(n)?.name || '');
  const r = picks.length >= 2 ? routeThrough(picks) : null;
  const links = effectiveNetwork(base, state).links;
  const km = r ? r.segs.reduce((t, sg) => t + sg.via.reduce((u, i) => u + (links[i]?.len || 0), 0), 0) : 0;
  const rec = r ? suggestMode(r) : null, mode = svcPick.mode || rec;
  const from = picks[0], to = picks.length >= 2 ? picks[picks.length - 1] : null, via = picks.slice(1, -1);
  return `${header('운행 계통 신설')}
    <p class="hint">시점과 종점을 고르면 경로와 정차역을 저절로 잡습니다. 지도에서 역을 누르면 시점, 종점, 거쳐 갈 역 차례로 들어갑니다.</p>
    <div class="pick-form">${stationSearchHTML('sp-from', '예: 용산', '시점', from != null ? nn.get(from)?.name : '')}
    ${stationSearchHTML('sp-to', '예: 여수엑스포', '종점', to != null ? nn.get(to)?.name : '', 'sp-from-list')}
    ${stationSearchHTML('sp-via', '사이에 꼭 거칠 역 (넣지 않아도 됩니다)', '거쳐 갈 역', '', 'sp-from-list')}</div>
    ${via.length ? `<div class="pick-chips">${via.map((n) => `<span class="svc-stop on">${name(n)}<button type="button" class="chip-x" data-sp-del="${picks.indexOf(n)}" aria-label="${name(n)} 빼기">×</button></span>`).join('')}</div>` : ''}
    ${r ? `<div class="pick-route"><b>${name(from)} → ${name(to)}</b>, ${km.toFixed(0)}km, 지나는 역 ${r.nodes.length}개
      <span class="m">${r.lines.map(esc).join(' → ')}</span></div>
      ${doublesBack(r) ? '<p class="hint warn-text">경로가 같은 선로를 되짚어 돌아갑니다. 거쳐 갈 역이 시점·종점 바깥에 있지 않은지 보세요.</p>' : ''}
      <div class="name-row"><span class="kind">방식</span></div>
      <div class="mode-pick" role="radiogroup" aria-label="계통 방식">${Object.entries(SERVICE_MODES).map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === mode}" tabindex="${k === mode ? 0 : -1}" class="${k === mode ? 'on' : ''}" data-sp-mode="${k}">
        <b>${v.label}</b><span class="m">${v.sub}${k === rec ? ', 추천' : ''}</span></button>`).join('')}</div>`
    : picks.length >= 2 ? '<p class="hint warn-text">고른 역 사이를 잇는 철도 경로가 없습니다. 다른 역을 골라 보세요.</p>' : ''}
    <div class="actions">
      <button class="primary" id="sp-ok" ${r ? '' : 'disabled'}>다음: 정차역과 열차 확인</button>${picks.length >= 2 ? '<button id="sp-swap" title="시점과 종점을 맞바꿉니다">뒤집기</button>' : ''}</div>`;
}

export function bindServicePick(el) {
  const picks = svcPick.picks;
  // 시점·종점이 잡히면 지도를 역 하나가 아니라 경로 전체에 맞춘다
  const redo = () => {
    drawServicePick();
    renderSelection();
    const r = picks.length >= 2 ? routeThrough(picks) : null;
    const c = r ? serviceCoords(effectiveNetwork(base, state).links, r.segs) : [];
    if (c.length > 1) {
      const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 60, maxZoom: 11, duration: 500 });
    }
  };
  bindStationSearch(el, 'sp-from', () => picks.slice(-1), (n) => { setEnd(picks, 'from', n); redo(); });
  bindStationSearch(el, 'sp-to', () => picks.slice(0, 1), (n) => { setEnd(picks, 'to', n); redo(); });
  bindStationSearch(el, 'sp-via', () => picks, (n) => { if (!picks.includes(n)) insertVia(picks, n); redo(); });
  el.querySelectorAll('[data-sp-del]').forEach((b) => { b.onclick = () => { picks.splice(+b.dataset.spDel, 1); redo(); }; });
  el.querySelectorAll('[data-sp-mode]').forEach((b) => { b.onclick = () => { svcPick.mode = b.dataset.spMode; renderSelection(); }; });
  // 방식 고르기는 라디오처럼 화살표로 옮긴다
  el.querySelector('.mode-pick')?.addEventListener('keydown', (ev) => {
    const keys = Object.keys(SERVICE_MODES), d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const cur = keys.indexOf(ev.target.closest('[data-sp-mode]')?.dataset.spMode);
    svcPick.mode = keys[(cur + d + keys.length) % keys.length];
    renderSelection();
    document.querySelector(`[data-sp-mode="${svcPick.mode}"]`)?.focus();
  });
  el.querySelector('#sp-swap')?.addEventListener('click', () => { picks.reverse(); redo(); });
}

/** 고른 역들을 차례로 잇는 경로를 찾아, 고른 방식(등급·열차·정차)으로 계통 편집 창을 연다 */
export function commitServicePick() {
  const picks = svcPick.picks;
  const r = routeThrough(picks);
  if (!r) { toast('고른 역 사이를 잇는 철도 경로가 없습니다.'); return; }
  const { nodes, lines, cls, under } = r;
  const nn = nodeNames();
  const mk = svcPick.mode || suggestMode(r), m = SERVICE_MODES[mk];
  const type = m.types.find((t) => canRun(t, under)) || 'diesel';
  const stops = m.kind === 'local' || m.kind === 'commuter' ? new Set(nodes) : new Set([...defaultStops(nodes, m.kind), ...picks]);
  setSvcEdit({ line: lines[0], lines, cls, kind: m.kind, name: `${nn.get(picks[0])?.name}–${nn.get(picks[picks.length - 1])?.name} ${m.label}`,
    type, sets: m.sets, nodes, stops, id: null, nameEdited: false, color: nextSvcColor(), mode: mk, modeLabel: m.label, picks: [...picks] });
  endServicePick();
  select({ type: 'service' });
}

export function header(title) {
  return `<div class="sel-head"><h3>${esc(title)}</h3><button class="small close" title="닫기 (Esc)">닫기</button></div>`;
}

export function linkPanel(id) {
  const l = linkAt(base, state, id);
  // 분리 차로 쌍은 합친 값 (지도 색과 같게)
  const vc = shownTraffic ? shownTraffic.vc[linkTwins[id]] : 0, vol = shownTraffic ? shownTraffic.vol[linkTwins[id]] : 0;
  const speed = result ? result.links.speed[id] : 0;
  const busyProj = state.projects.find((p) => p.status === 'building' && p.links.includes(id) && p.kind !== 'upgrade');   // 새로 짓는 중 (개량 메뉴 없음)
  const upProjs = state.projects.filter((p) => p.status === 'building' && p.kind === 'upgrade' && p.links.includes(id));   // 개량 공사 중: 다른 개량은 함께 벌일 수 있다
  const isRoad = l.mode === 0;
  const planned = id < base.links.length && linkPending(base, state, id);
  const osmProj = planned && state.projects.find((p) => p.kind === 'osm' && p.status === 'building' && p.links.includes(id));
  const ups = l.ext || l.cls === 'ferry' || planned ? [] : UPGRADES.filter((u) => u.mode === l.mode && u.applies(l) && !(upProjs.length && linksBlockedFor(state, u.id).has(id)));
  const route = sameRoute(id, true);
  const routeKm = route.reduce((sum, x) => sum + linkAt(base, state, x).len, 0);
  const viaKm = originConnector(l, sameRoute(id)).reduce((sum, x) => sum + linkAt(base, state, x).len, 0);
  // 신호 고도화·장편성 (선로 수 말고 수송력을 키운 개량)
  const capRows = l.sig || l.long ? `<tr><td>수송력 개량</td><td>${[l.sig ? '신호 고도화 (운행 +30%)' : '', l.long ? '장편성 (정원 +50%)' : ''].filter(Boolean).join(', ')}</td></tr>` : '';
  const rows = l.mode === 2
    ? `<tr><td>표정 속도</td><td>${l.speed} km/h</td></tr>
       ${capRows}
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`
    : isRoad
    ? `<tr><td>차로</td><td>${l.lanes}차로${l.paved ? '' : ' (비포장)'}</td></tr>
       <tr><td>설계·실제 속도</td><td>${l.speed} / ${speed.toFixed(0)} km/h</td></tr>
       ${l.cls === 'motorway' && l.kp ? `<tr><td>규격</td><td>${l.speed < 95 ? '북측 규격 (아래 재건축으로 남측 규격)' : '남측 규격'}</td></tr>` : ''}
       <tr><td>교통량</td><td>${Math.round(vol).toLocaleString()} PCU/일</td></tr>`
    : `<tr><td>선로</td><td>${l.tracks === 1 ? '단선' : l.tracks === 2 ? '복선' : l.tracks + '선'}</td></tr>
       <tr><td>전력</td><td>${{ AC: '교류 25kV', DC: '직류 3kV', none: '비전철' }[l.power]}</td></tr>
       <tr><td>규격</td><td>${railStd(l) ? '개량 전 북측 철도 (아래 "남측 규격 일괄 개량"으로 이 구간을, "노선 일괄"로 노선 전체를 한 번에 바꿀 수 있습니다)' : '남측 규격'}</td></tr>
       <tr><td>최고 운행 속도</td><td>${l.speed} km/h</td></tr>
       ${capRows}
       <tr><td>이용객</td><td>${Math.round(vol).toLocaleString()} 명/일</td></tr>`;
  // 누른 곳이 속한 역–역(IC–IC) 구간
  const sec = selection?.type === 'link' && selection.id === id ? selection.section : null;
  const secIds = sec?.ids || [id];
  const secKm = secIds.reduce((s0, x) => s0 + linkAt(base, state, x).len, 0);
  const nnS = nodeNames();
  const secLabel = sec && secIds.length > 1 ? `${nnS.get(sec.A)?.name || '교차로'} – ${nnS.get(sec.B)?.name || '교차로'}` : '';
  return `${header(l.name || CLASS_LABEL[l.cls])}
    ${secLabel ? `<p class="hint">선택 구간: <b>${esc(secLabel)}</b>, ${secKm.toFixed(1)}km (${secIds.length}개 링크). 개량은 이 구간 전체에 적용됩니다.</p>` : ''}
    ${l.mode === 1 ? passingServicesHTML(secIds) : ''}
    <table class="kv">
      <tr><td>종류</td><td>${railKindLabel(l)}, ${l.kp ? '북' : '남'}</td></tr>
      ${operatorOf(state, l) ? `<tr><td>운영사</td><td>${opBadge(state, operatorOf(state, l))}</td></tr>` : metroOpBadge(l) ? `<tr><td>운영 기관</td><td>${metroOpBadge(l)}</td></tr>` : ''}
      <tr><td>연장</td><td>${l.len.toFixed(1)} km</td></tr>
      ${rows}
      <tr><td>혼잡도 (V/C)</td><td class="${vc > 1 ? 'neg' : ''}">${vc.toFixed(2)}</td></tr>
    </table>
    ${l.mode >= 1 && l.name && !l.ext && !planned ? serviceSection(l, secIds) : ''}
    ${!planned && !busyProj ? reopenHTML(id, l) : ''}
    ${l.name && !l.ext && l.cls !== 'ferry' ? `<h4>노선 이름</h4><div class="name-row"><input type="text" id="line-rename" value="${esc(l.name)}">
      <button class="small" id="line-rename-ok">바꾸기</button></div>` : ''}
    ${planned ? `<p class="hint">진행 중인 사업 구간입니다: ${esc(osmProj?.label || '')}, ${osmProj ? `${osmProj.doneYear}년 개통 예정` : ''}. 사업 탭에서 예산 투입 속도를 바꿀 수 있습니다.</p>`
    : l.ext ? '<p class="hint">국외 거점과 잇는 국경 연결 구간입니다. 개량 대상이 아닙니다.</p>'
    : l.cls === 'ferry' ? '<p class="hint">여객선 항로입니다. 개량 대상이 아닙니다.</p>'
    : busyProj ? `<p class="hint">공사 중: ${esc(busyProj.label)} (${busyProj.doneYear}년 완공)</p>` : `${upProjs.map((p) => `<p class="hint">공사 중: ${esc(p.label)} (${p.doneYear}년 완공), 겹치지 않는 다른 개량은 함께 벌일 수 있습니다</p>`).join('')}<h4>개량</h4>
    <div class="actions"><button class="small sec-start" title="두 역·IC를 차례로 눌러 그 사이만 고릅니다">구간 선택 (${l.mode === 0 ? 'IC' : '역'} 두 곳 누르기)</button>
      ${l.mode >= 1 ? '<button class="small" data-padd="station" title="노선 위 한 점을 눌러 역을 놓습니다">이 노선에 역 신설</button>' : l.cls === 'motorway' ? '<button class="small" data-padd="ic">IC·JCT 신설</button><button class="small" data-padd="rest">휴게소 신설</button>' : ''}
      ${l.mode === 1 ? '<button class="small" data-st-start title="두 역 사이를 단순한 곡선으로 새로 놓고 옛 구간은 폐선합니다. 사이 역은 눌러서 자동·제자리 유지·폐역을 고릅니다">구간 직선화</button>' : ''}</div>
    ${l.mode === 1 ? fundSelect([operatorOf(state, l)]) : ''}
    ${lineBatchHTML(l, id)}
    ${route.length > 1 ? `<label class="name-row"><input type="checkbox" id="whole-route" ${wholeRoute ? 'checked' : ''}>
      <span>같은 이름 노선 전체 (${route.length}개 구간, ${routeKm.toFixed(0)}km${viaKm > 0 ? `, ${LINE_ORIGIN[l.name]}까지 다른 노선과 함께 쓰는 ${viaKm.toFixed(0)}km 포함` : ''})</span></label>` : ''}
    <div class="list">${ups.map((u) => {
      const ids = (wholeRoute && route.length > 1 ? route : secIds).filter((x) => u.applies(linkAt(base, state, x)));
      const cost = ids.reduce((sum, x) => sum + upgradeCost(u, linkAt(base, state, x)), 0);
      const ok = canAfford(state, cost, u.years, fundFor(state, ids.map((x) => linkAt(base, state, x))));
      return `<div class="item opt"><div class="opt-row">
        <span>${resolve(u.label, l)}${ids.length > 1 ? `, ${ids.length}개 구간` : ''}${upEffect(u, l) ? `<span class="m" style="display:block">${upEffect(u, l)}${ids.length > 1 ? ' (누른 구간 기준)' : ''}</span>` : ''}</span>
        <span class="btns"><button class="small" data-prev-up="${u.id}" title="다 지었을 때 효과">미리보기</button>
        <button class="small ${ok && !u.retire ? 'primary' : ''}" data-up="${u.id}" ${ok ? '' : 'disabled'} title="${spendTitle(cost)}">${formatWon(cost)}, ${u.years}년</button></span></div></div>`;
    }).join('') || '<p class="hint">가능한 개량이 없습니다.</p>'}</div>`}`;
}

/** 돈을 쓰는 단추의 안내: 누르면 바로 착공하고 예산이 얼마 남는지 */
export function spendTitle(cost) {
  return `누르면 바로 착공합니다, 가용 예산 ${formatWon(state.budget)} → ${formatWon(state.budget - cost)}`;
}

/** 개량이 바꾸는 값 (누른 구간 기준): "설계 속도 80→95km/h · 연장 12.0→10.8km" */
export function upEffect(u, l) {
  if (u.retire) return '';
  const d = u.apply(l), out = [];
  const sp = l.mode === 2 ? '표정 속도' : l.mode === 0 ? '설계 속도' : '최고 속도';
  if (d.speed != null && d.speed !== l.speed) out.push(`${sp} ${l.speed}→${d.speed}km/h`);
  if (d.len != null && d.len !== l.len) out.push(`연장 ${l.len.toFixed(1)}→${d.len.toFixed(1)}km`);
  if (d.lanes != null && d.lanes !== l.lanes) out.push(`${l.lanes}→${d.lanes}차로`);
  if (l.mode === 1 && d.tracks != null && d.tracks !== l.tracks) out.push(`선로 ${l.tracks}→${d.tracks}개`);
  if (d.power && d.power !== l.power) out.push(d.power === 'AC' ? '교류 25kV 전철' : d.power);
  if (d.paved && !l.paved) out.push('포장 (수송력 회복)');
  if (u.id === 'straighten') out.push('지도 선형은 그대로 (새 자리에 곧게 놓으려면 위의 구간 직선화)');
  return out.join(', ');
}

/**
 * 노선 일괄 승압·전철화: 같은 이름 노선(실제 기점역까지 함께 쓰는 구간 포함)의 북측 직류 3kV 구간을 모두 교류 25kV로(승압),
 * 비전철 구간을 모두 전철화한다. 구간을 하나하나 고르지 않아도 되고, 한 사업으로 묶어 10% 덜 든다
 */
export const LINE_BATCH_DISCOUNT = 0.9;
export function lineBatch(id) {
  const u = UPGRADES.find((x) => x.id === 'electrify');
  const route = sameRoute(id, true).filter((i) => !(i < base.links.length && linkPending(base, state, i)) && !state.replaced?.[i]);
  const make = (pw, up = u) => {
    const work = linksBlockedFor(state, up.id);
    const ids = route.filter((i) => { const m = linkAt(base, state, i); return !work.has(i) && m.mode === 1 && !m.ext && (pw ? m.power === pw : up.applies(m)); });
    const ls = ids.map((i) => linkAt(base, state, i));
    const cost = Math.round(ls.reduce((s0, m) => s0 + upgradeCost(up, m), 0) * LINE_BATCH_DISCOUNT);
    return { ids, km: ls.reduce((s0, m) => s0 + m.len, 0), cost, years: up.years, ok: ids.length > 0 && canAfford(state, cost, up.years, fundFor(state, ls)) };
  };
  // 북측 철도 일괄 개량: 이 노선의 개량 전 북측 구간을 모두 남측 규격으로 (복선·교류 25kV·120km/h·표준궤)
  return { DC: make('DC'), none: make('none'), kpstd: make(null, UPGRADES.find((x) => x.id === 'kpstd')), years: u.years };
}
/** 북측 철도 전체 일괄 개량: 개량 전 북측 선로(직류 3kV·비전철·단선·저속)를 모두 남측 규격으로 한 사업에 (노선 일괄과 같은 10% 할인) */
export function kpStdAll() {
  const work = linksBlockedFor(state, 'kpstd'), u = UPGRADES.find((x) => x.id === 'kpstd');
  const ids = allLinks().map((_, i) => i).filter((i) => !work.has(i) && !(i < base.links.length && linkPending(base, state, i)) && !state.replaced?.[i]
    && (() => { const m = linkAt(base, state, i); return m.mode === 1 && !m.ext && u.applies(m); })());
  const ls = ids.map((i) => linkAt(base, state, i));
  const cost = Math.round(ls.reduce((s0, m) => s0 + upgradeCost(u, m), 0) * LINE_BATCH_DISCOUNT);
  return { ids, km: ls.reduce((s0, m) => s0 + m.len, 0), lines: new Set(ls.map((m) => m.name).filter(Boolean)).size, cost, years: u.years, ok: ids.length > 0 && canAfford(state, cost, u.years, fundFor(state, ls)) };
}
export function lineBatchHTML(l, id) {
  if (l.mode !== 1 || !l.name || l.ext) return '';
  const b = lineBatch(id);
  if (!b.DC.ids.length && !b.none.ids.length && !b.kpstd.ids.length) return '';
  const row = (k, label) => (b[k].ids.length ? `<div class="item opt"><div class="opt-row"><span>${label}, ${b[k].km.toFixed(0)}km (${b[k].ids.length}개 구간)</span>
    <span class="btns"><button class="small ${b[k].ok ? 'primary' : ''}" data-line-batch="${k}" ${b[k].ok ? '' : 'disabled'}>${formatWon(b[k].cost)}, ${b[k].years}년</button></span></div></div>` : '');
  return `<h4>노선 일괄, ${esc(l.name)}</h4>
    <p class="hint">이 노선의 해당 구간을 모두 한 사업으로 (구간을 고르지 않아도 되고 10% 덜 듭니다). 다 지으면 남측 전동차가 이 노선으로 직통할 수 있습니다.</p>
    <div class="list">${row('kpstd', '노선 전체 남측 규격 개량 (북측 구간: 복선·교류 25kV·120km/h·표준궤)')}${row('DC', '노선 전체 승압 (직류 3kV → 교류 25kV)')}${row('none', '노선 전체 전철화 (비전철 → 교류 25kV)')}</div>`;
}

/** 폐도·폐선은 되돌릴 수 없으니 한 번 더 묻는다 (지나는 운행 계통 수도 알려 준다) */
export function confirmRetire(upId, ids) {
  const u = UPGRADES.find((x) => x.id === upId);
  if (!u?.retire) return true;
  const set = new Set(ids);
  const km = ids.reduce((s0, i) => s0 + linkAt(base, state, i).len, 0);
  const svc = (state.services || []).filter((s) => s.segs?.some((sg) => sg.via.some((i) => set.has(i)))).map((s) => s.name);
  return confirm(`${km.toFixed(1)}km를 ${u.mode === 0 ? '폐도' : '폐선'}합니다. 내년에 걷어 내며 되돌릴 수 없습니다.${svc.length ? `
이 구간을 지나는 운행 계통 ${svc.length}개(${svc.slice(0, 4).join(', ')}${svc.length > 4 ? ' 등' : ''})는 다른 길로 다시 짜고, 길이 없으면 멈춥니다.` : ''}`);
}

/** 드래그로 고른 여러 구간: 가장 긴 수단 기준으로 개량을 한꺼번에 */
export function multiPanel(ids) {
  const work = linksUnderBuild(state);   // 개량끼리는 겹쳐도 된다: 개량마다 착공할 때 거른다
  const km = [0, 0, 0];
  for (const i of ids) km[linkAt(base, state, i).mode] += linkAt(base, state, i).len;
  const mode = km.indexOf(Math.max(...km));
  const pool = ids.filter((i) => {
    const l = linkAt(base, state, i);
    return l.mode === mode && !l.ext && l.cls !== 'ferry' && !(i < base.links.length && linkPending(base, state, i)) && !work.has(i);
  });
  const names = [...new Set(pool.map((i) => linkAt(base, state, i).name).filter(Boolean))].slice(0, 6);
  const ups = UPGRADES.filter((u) => u.mode === mode).map((u) => {
    const app = pool.filter((i) => u.applies(linkAt(base, state, i)));
    const cost = app.reduce((s, i) => s + upgradeCost(u, linkAt(base, state, i)), 0);
    const len = app.reduce((s, i) => s + linkAt(base, state, i).len, 0);
    return { u, app, cost, len };
  }).filter((x) => x.app.length);
  const label = ['도로', '철도', '도시철도'][mode];
  const sc = selection?.type === 'multi' ? selection.section : null;
  const nn = nodeNames();
  const title = sc ? `${nn.get(sc.A)?.name || '교차점'} – ${nn.get(sc.B)?.name || '교차점'} 구간` : `${label} ${pool.length}개 구간 선택`;
  return `${header(title)}
    ${sc ? `<div class="actions">${sc.mode === 1 ? '<button class="small" id="sec-straight">이 구간 직선화</button>' : ''}
      <button class="small" id="sec-prev">첫 개량 효과 미리보기</button><button class="small sec-start">다른 구간 고르기</button></div>` : ''}
    <p class="hint">${km[mode].toFixed(0)}km, ${names.map(esc).join(', ')}${names.length === 6 ? ' 등' : ''}${pool.length < ids.length ? ` (다른 수단·공사 중 구간 ${ids.length - pool.length}개 제외)` : ''}<br>Shift를 누른 채 구간을 누르면 더하거나 빼고, Shift를 누른 채 끌면 상자 안 구간을 한꺼번에 고릅니다.</p>
    <div class="list">${ups.map(({ u, app, cost, len }) => {
      const ok = canAfford(state, cost, u.years);
      return `<div class="item opt"><div class="opt-row">
        <span>${resolve(u.label, linkAt(base, state, app[0]))}, ${app.length}개 구간 ${len.toFixed(0)}km</span>
        <button class="small ${ok && !u.retire ? 'primary' : ''}" data-mup="${u.id}" data-ids="${JSON.stringify(app)}" ${ok ? '' : 'disabled'} title="${spendTitle(cost)}">${formatWon(cost)}, ${u.years}년</button></div></div>`;
    }).join('') || '<p class="hint">고른 구간에 가능한 개량이 없습니다.</p>'}</div>`;
}
