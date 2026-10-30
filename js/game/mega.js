// 국가 대형 사업(건설 탭): 한일해저터널, 호남고속철 제주 연장, 시베리아 횡단철도 진입.
// 여느 사업처럼 해마다 예산을 들여 짓고, 완공되면 네트워크에 선로가 붙거나(applyMega) 해마다 효과가 난다.
// 비용은 억원. 사업비·선형은 공개된 구상안을 게임용으로 단순화한 값이다.

export const MEGA = [
  {
    id: 'kj-tunnel', name: '한일해저터널', label: '한일해저터널 (부산–쓰시마–이키–후쿠오카)', cost: 600000, years: 10,
    desc: '부산에서 쓰시마·이키를 거쳐 후쿠오카까지 약 230km(해저 약 130km)의 고속철도 터널. 총사업비의 절반을 한국이 낸다. 완공되면 부산역에서 후쿠오카까지 고속열차가 다닌다.',
    ready: () => true,
  },
  {
    id: 'jeju-hsr', name: '호남고속철 제주 연장', label: '호남고속철 제주 연장 (목포–해남–보길도–추자도–제주)', cost: 170000, years: 8,
    desc: '목포에서 해남·보길도·추자도를 거쳐 제주까지 약 167km(해저 약 73km). 완공되면 제주역이 생기고 호남고속선 열차가 제주까지 간다.',
    ready: () => true,
  },
  {
    id: 'tsr', name: '시베리아 횡단철도 진입', label: '시베리아 횡단철도 진입 (두만강–하산 현대화·환적 시설)', cost: 50000, years: 4,
    desc: '두만강–하산 국경 철도를 현대화하고 궤간이 다른 러시아 철도와의 환적 시설을 지어 시베리아 횡단철도와 잇는다. 완공되면 국경 철도가 빨라지고, 철도 운영사가 해마다 대륙 통과 화물 수입을 얻는다.',
    ready: (state) => state.integration >= 0.5, need: '남북 통합도 50% 이상',
  },
  {
    id: 'kp-ac', name: '북측 철도 교류화', label: '북측 철도 교류화 (직류 3kV → 교류 25kV 전국 승압)', cost: 0, years: 6,   // 사업비는 직류 구간 연장으로 (kpACCost)
    desc: '북측의 직류 3kV 전철 구간을 모두 남측과 같은 교류 25kV로 바꾸는 국가 사업. 변전소·가선을 한꺼번에 바꿔 구간마다 할 때보다 20% 덜 든다. 공사 기간 동안 긴 노선부터 해마다 차례로 교류로 개통하고, 남북 열차가 기관차를 바꾸지 않고 다닌다.',
    ready: (state) => state.integration >= 0.7, need: '남북 통합도 70% 이상',
  },
  {
    id: 'wonsan-port', name: '원산항 개발', label: '원산항 개발 (국제 여객 부두·블라디보스토크·사카이미나토 항로)', cost: 12000, years: 4, port: true,
    desc: '원산항에 국제 여객 부두와 출입국 시설을 짓고 블라디보스토크(러시아)·사카이미나토(일본 돗토리현) 국제 여객선 항로를 엽니다. 사카이미나토에서는 도로로 히로시마·오사카와 이어집니다.',
    ready: (state) => state.integration >= 0.3, need: '남북 통합도 30% 이상',
  },
  {
    id: 'nampo-port', name: '남포항 개발', label: '남포항 개발 (국제 여객 부두·다롄·톈진 항로)', cost: 10000, years: 4, port: true,
    desc: '남포항에 국제 여객 부두와 출입국 시설을 짓고 다롄·톈진(중국) 국제 여객선 항로를 엽니다. 톈진항에서는 철도로 베이징과 이어집니다.',
    ready: (state) => state.integration >= 0.3, need: '남북 통합도 30% 이상',
  },
];

/**
 * 항만 개발로 여는 국제 여객선 항로. from: 한쪽 항구(가까운 도로 노드), to: 국외 거점 이름 또는 새 항구 {name, at, links: 그 항구에서 국외 거점으로 가는 길}.
 * hours는 운항 시간(시간), via는 바다로 도는 경유점
 */
export const PORT_ROUTES = {
  'wonsan-port': [
    { name: '원산–블라디보스토크', from: [127.455, 39.165], to: '블라디보스토크', hours: 20, via: [[128.3, 39.5], [129.8, 40.6], [131.2, 42.3], [131.75, 42.95]] },
    { name: '원산–사카이미나토', from: [127.455, 39.165], to: { name: '사카이미나토', at: [133.235, 35.545], links: [['히로시마', 190, 70], ['오사카', 260, 80]] }, hours: 20, via: [[128.4, 38.9], [130.5, 37.4], [132.4, 36.0], [133.2, 35.62]] },
  ],
  'nampo-port': [
    { name: '남포–다롄', from: [125.385, 38.725], to: '다롄', hours: 13, via: [[125.1, 38.62], [124.6, 38.5], [123.4, 38.7], [122.2, 38.85]] },
    { name: '남포–톈진', from: [125.385, 38.725], to: { name: '톈진', at: [117.75, 38.98], links: [['베이징', 140, 200, 1]] }, hours: 26, via: [[125.1, 38.62], [124.6, 38.5], [122.6, 38.45], [121.2, 38.35], [119.6, 38.7], [118.2, 38.95]] },
  ],
};

function nearestRoad(base, lon, lat) {
  let best = -1, bd = Infinity;
  for (const l of base.links) {
    if (l.mode !== 0 || l.ext) continue;
    for (const n of [l.a, l.b]) {
      const [x, y] = base.nodes[n], d = (x - lon) ** 2 + (y - lat) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
  }
  return best;
}
const foreignNode = (base, name) => (base.foreignNodes || []).find((f) => f.name === name)?.node;
function polyKm(pts) {
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], k = Math.cos(((y0 + y1) / 2) * Math.PI / 180);
    km += Math.hypot((x1 - x0) * k, y1 - y0) * 111.2;
  }
  return km;
}

/** 북측 직류 구간을 노선 이름별로 [{name, ids, km}] (긴 노선부터) */
export function kpDCLines(base, state) {
  const by = new Map();
  base.links.forEach((l, i) => {
    if (l.mode !== 1 || !l.kp || l.ext || state.replaced?.[i]) return;
    if ((state.overrides?.[i]?.power ?? l.power) !== 'DC') return;
    const k = l.name || '이름 없는 선';
    if (!by.has(k)) by.set(k, { name: k, ids: [], km: 0 });
    const g = by.get(k); g.ids.push(i); g.km += l.len;
  });
  return [...by.values()].sort((a, b) => b.km - a.km);
}

/** 교류화 사업비 (억원): 직류 구간 km당 15억(구간 승압과 같다)에서 20% 덜 */
export function kpACCost(base, state) {
  const km = kpDCLines(base, state).reduce((s, g) => s + g.km, 0);
  return Math.max(1000, Math.round((km * 15 * 0.8) / 100) * 100);
}

/** 교류화 공사 중: 해마다 공사 진척만큼 긴 노선부터 교류로 바꾼다. 바꾼 노선 이름 목록 */
export function kpACYear(base, state, p) {
  const lines = kpDCLines(base, state);
  p.acTotal ||= lines.reduce((s, g) => s + g.km, 0) || 1;
  const left = lines.reduce((s, g) => s + g.km, 0);
  const goal = p.acTotal * Math.min(1, (state.year - p.startYear) / p.years);
  const out = [];
  let done = p.acTotal - left;
  for (const g of lines) {
    if (done >= goal) break;
    for (const i of g.ids) state.overrides[i] = { ...(state.overrides[i] || {}), power: 'AC' };
    done += g.km;
    out.push(g.name);
  }
  return out;
}

export const TSR_FREIGHT = 5000;   // 대륙 통과 화물 수입 (억원/년, 북측 철도 운영사)

/** 철도역 이름으로 그 역의 철도 노드를 찾는다 (lineRe에 맞는 노선이 지나는 노드를 먼저) */
function railStation(base, name, lineRe) {
  const touch = (n) => base.links.filter((l) => l.mode === 1 && (l.a === n || l.b === n));
  const cands = base.stations.filter((s) => s[0] === name).map((s) => s[1]);
  return cands.find((n) => touch(n).some((l) => lineRe.test(l.name))) ?? cands.find((n) => touch(n).length) ?? null;
}

function addLink(base, state, attrs, coords) {
  const id = base.links.length + state.newLinks.length;
  state.newLinks.push({ id, built: true, kp: 0, tracks: 2, power: 'AC', ...attrs, geom: coords.flat() });
  return id;
}

const JEJU = [126.4936, 33.4996];

/** 대형 사업의 선형 (지도 미리보기와 완공 때 쓴다). 없으면 null */
export function megaGeometry(base, id) {
  if (id === 'kj-tunnel') {
    const a = railStation(base, '부산', /경부/);
    const b = (base.foreignNodes || []).find((f) => f.name === '후쿠오카')?.node;
    if (a == null || b == null) return null;
    return { a, b, coords: [base.nodes[a], [129.32, 34.66], [129.68, 33.77], base.nodes[b]], stops: ['부산', '쓰시마', '이키', '후쿠오카'] };
  }
  if (id === 'jeju-hsr') {
    const a = railStation(base, '목포', /호남/);
    if (a == null) return null;
    return { a, coords: [base.nodes[a], [126.60, 34.57], [126.55, 34.16], [126.32, 33.96], JEJU], stops: ['목포', '해남', '보길도', '추자도', '제주'] };
  }
  if (PORT_ROUTES[id]) {
    // 항로마다 [항구, 경유점, 건너편] (지도에는 여러 갈래로)
    const multi = PORT_ROUTES[id].map((r) => [r.from, ...r.via, typeof r.to === 'string' ? base.nodes[foreignNode(base, r.to)] : r.to.at]).filter((c) => c.every(Boolean));
    if (!multi.length) return null;
    return { coords: multi[0], multi, stops: PORT_ROUTES[id].map((r) => r.name) };
  }
  if (id === 'tsr') {
    const i = base.links.findIndex((l) => l.mode === 1 && /두만강–하산/.test(l.name || ''));
    if (i < 0) return null;
    const g = base.links[i].geom, coords = [];
    for (let k = 0; k < g.length; k += 2) if (!Number.isNaN(g[k])) coords.push([g[k], g[k + 1]]);
    return { link: i, coords, stops: ['두만강', '하산'] };
  }
  return null;
}

/** 완공된 대형 사업을 네트워크에 붙인다. 붙이거나 바꾼 링크 id 목록을 돌려준다 */
export function applyMega(base, state, id) {
  (state.mega ||= {})[id] = state.year;
  if (id === 'kp-ac') {
    const ids = kpDCLines(base, state).flatMap((g) => g.ids);
    for (const i of ids) state.overrides[i] = { ...(state.overrides[i] || {}), power: 'AC' };
    return ids;
  }
  const geo = megaGeometry(base, id);
  if (!geo) return [];
  if (id === 'kj-tunnel') {
    return [addLink(base, state, { a: geo.a, b: geo.b, mode: 1, cls: 'hsr', len: 230, speed: 250, name: '한일해저터널', ext: 1 }, geo.coords)];
  } else if (id === 'jeju-hsr') {
    const node = base.nodes.length + state.newNodes.length;
    state.newNodes.push(JEJU);
    state.newStations.push(node);
    state.names[node] = { name: '제주', kind: 'station', auto: false };
    return [addLink(base, state, { a: geo.a, b: node, mode: 1, cls: 'hsr', len: 167, speed: 250, name: '호남고속선' }, geo.coords)];
  } else if (PORT_ROUTES[id]) {
    const ids = [];
    for (const r of PORT_ROUTES[id]) {
      const a = nearestRoad(base, ...r.from);
      let b;
      if (typeof r.to === 'string') b = foreignNode(base, r.to);
      else {
        // 국외 새 항구: 노드를 두고 국외 거점까지 도로(철도) 연결
        b = base.nodes.length + state.newNodes.length;
        state.newNodes.push(r.to.at);
        for (const [city, km, speed, rail] of r.to.links) {
          const c = foreignNode(base, city);
          if (c == null) continue;
          ids.push(addLink(base, state, rail ? { a: b, b: c, mode: 1, cls: 'hsr', len: km, speed, ext: 1, name: `${r.to.name}–${city} 철도` }
            : { a: b, b: c, mode: 0, cls: 'motorway', lanes: 4, len: km, speed, paved: 1, ext: 1, name: `${r.to.name}–${city} 도로` }, [r.to.at, base.nodes[c]]));
        }
      }
      if (a < 0 || b == null) continue;
      const pts = [base.nodes[a], ...r.via, typeof r.to === 'string' ? base.nodes[b] : r.to.at];
      const km = Math.round(polyKm(pts) * 1.03 * 100) / 100;
      // 승선 대기·수속 1시간을 속도에 녹인다 (data/air_sea.json 여객선과 같게)
      ids.push(addLink(base, state, { a, b, mode: 0, cls: 'ferry', lanes: 2, len: km, speed: Math.max(5, Math.round(km / (r.hours + 1))), paved: 1, ext: 1, name: `${r.name} 여객선` }, pts));
    }
    return ids;
  } else if (id === 'tsr') {
    // 국경 철도를 표준궤·광궤 겸용 복선으로: 빨라지고 수송력이 는다
    state.overrides[geo.link] = { ...(state.overrides[geo.link] || {}), speed: 160, tracks: 2 };
    return [geo.link];
  }
  return [];
}
