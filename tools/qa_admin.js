// 행정구역 규칙 시험 (tools/qa_admin.py가 돌린다). 단계마다 {rules: [...], fail: [...]}를 돌려주면 둘 다 비어 있어야 통과.
// RULES: 한국 행정 체계 규칙 (광역 자리·직함, 시군 자리, 일반구에 구청장 없음, 도 안에 자치구 없음, 자치 전·후 관선·민선)
// @@ setup
window.alert = (m) => (window.__al ||= []).push(String(m)); window.confirm = () => true;
window.M = { B: await import('/js/app/bungu.js'), E: await import('/js/app/election.js'), R: await import('/js/app/region.js'), LC: await import('/js/game/local.js'), P: await import('/js/app/selpanel.js'), MD: await import('/js/app/mapdata.js'), C: await import('/js/app/core.js'), ST: await import('/js/game/state.js'), SS: await import('/js/game/savestore.js') };
const Z = ukt.zoneProps;
window.zi = (n, c) => Z.findIndex((z) => z.name === n && !z.ext && (!c || z.country === c));
window.wait = (ms) => new Promise((r) => setTimeout(r, ms));
window.closeW = () => document.querySelectorAll('.setup-wrap').forEach((w) => w.remove());
window.click = (x, y) => { const m = ukt.map; m.fire('click', { lngLat: { lng: x, lat: y }, point: m.project([x, y]), originalEvent: {} }); };
window.mkSplit = async (zoneName, re, name, country) => {
  const z = Z[zi(zoneName, country)], A = ukt.admin();
  const ss = z.subs.map((q, k) => ({ i: z.sub0 + k, x: q[0], y: q[1], name: M.R.subName(z.sub0 + k) })).filter((q) => re.test(q.name));
  ukt.startUnitPick(); const md = document.querySelector('[data-up-mode]'); md.value = 'emd'; md.dispatchEvent(new Event('change'));
  for (const q of ss) { ukt.map.jumpTo({ center: [q.x, q.y], zoom: 11 }); await wait(300); click(q.x, q.y); }
  document.querySelector('[data-up-name]').value = name; document.querySelector('[data-up-ok]').click();
  for (let k = 0; k < 30; k++) { await wait(1000); if (Object.values(ukt.state.local.splitUnit || {}).some((v) => v.name === name) && !ukt.busy) break; }
  document.querySelector('[data-up-cancel]')?.click(); closeW();
  return { k: Object.entries(ukt.state.local.splitUnit || {}).find(([, v]) => v.name === name)?.[0], picked: ss.map((q) => q.name) };
};
window.panelText = async (sel) => { ukt.select(sel); await wait(900); const el = document.querySelector('#selection'); el.querySelectorAll('details').forEach((d) => (d.open = true)); return el.innerText.replace(/\s+/g, ' '); };
// 한국 행정 체계 규칙 검사
window.RULES = () => {
  const L = ukt.state.local, a = ukt.admin(), LC = M.LC, E = M.E, R = M.R;
  const bad = [];
  const regs = a.regionPops();
  const regNames = new Set([...regs.keys()]);
  // 광역 자리
  for (const [k, o] of Object.entries(L.offices)) {
    if (!k.startsWith('g:')) continue;
    const r = k.slice(2);
    if (!regNames.has(r) || !(regs.get(r).pop > 0)) bad.push(`광역자리 유령 ${k} ${o.title}`);
    if (o.title !== LC.governorTitle(r)) bad.push(`광역직함 ${k}: ${o.title} != ${LC.governorTitle(r)}`);
  }
  for (const r of regNames) if (!L.offices['g:' + r]) bad.push(`광역자리 없음 ${r}`);
  // 기초 자리 ↔ 소속표
  const unitKeys = new Set();
  for (const u of a.units.values()) {
    const key = R.unitOfficeKey(u.id), metro = LC.isMetroCity(u.region);
    const rep = R.unitRepZone(u.id);
    const auto = rep >= 0 && LC.hasAutonomy(ukt.state, ukt.zoneProps[rep]);
    const o = L.offices[key];
    unitKeys.add(key);
    const b = L.bungu?.[u.id.startsWith('z:') ? LC.unitId(ukt.state, ukt.zoneProps[u.rep]) : u.id];
    if (u.split && u.metro) continue;  // 광역시 몸통: 아래 따로
    const isGuName = /구역?$/.test(u.name);
    if (metro && !isGuName && !/군$/.test(u.name) && !b) { if (o && !/구청장$/.test(o.title)) bad.push(`광역시 안 시 단체장 ${u.region} ${u.name}: ${o.title}`); }
    if (!metro && isGuName && o) bad.push(`도 안 자치구 ${u.region} ${u.name}: ${o.title}`);
    if (!o && auto && !(metro && u.name === u.region)) bad.push(`기초자리 없음 ${u.region} ${u.name} (${key})`);
    if (o && auto && o.appointed) bad.push(`자치 시행인데 관선 ${u.region} ${u.name}`);
    if (o && !auto && !o.appointed) bad.push(`자치 전인데 민선 ${u.region} ${u.name}`);
    if (o && metro && o.title === LC.governorTitle(u.region)) bad.push(`광역·기초 같은 직함 ${u.region}: ${o.title}`);
    if (o) { const want = u.split ? E.splitTitle(u) : E.mayorTitleOf(u.rep); if (want && o.title !== want) bad.push(`기초직함 ${u.name}: ${o.title} != ${want}`); }
  }
  for (const [k, o] of Object.entries(L.offices)) {
    if (!k.startsWith('m:')) continue;
    const base = k.split('#')[0];
    if (!unitKeys.has(base)) bad.push(`기초자리 유령 ${k} ${o.title}`);
    if (k.includes('#')) {
      const id = base.slice(2), uid = id.startsWith('split:') ? id : LC.unitId(ukt.state, ukt.zoneProps[+id]);
      const u = a.unit(id.startsWith('split:') ? id : 'z:' + id);
      const b = L.bungu?.[uid] || L.bungu?.[id];
      if (b?.general) bad.push(`일반구에 구청장 자리 ${k} ${o.title}`);
      if (u && !LC.isMetroCity(u.region)) bad.push(`도 안 구청장 자리 ${k} ${o.title} (${u.region})`);
    }
  }
  return bad;
};
window.offSum = () => { const o = Object.values(ukt.state.local.offices); return { n: o.length, appointed: o.filter((x) => x.appointed).length, g: o.filter((x) => x.region).length }; };
window.closeDlg = async () => { for (let q = 0; q < 3; q++) { const d = document.querySelector('.setup-wrap'); if (!d) break; d.querySelector('[data-ok]')?.click(); await wait(400); document.querySelector('.setup-wrap')?.remove(); } };
window.offs = (pred) => Object.entries(ukt.state.local.offices).filter(([k, v]) => pred(k, v)).map(([k, v]) => `${k}=${v.title} ${v.name}`);
window.zoneOffs = (n) => { const r = M.E.countyRep(zi(n)); return offs((k) => k === `m:${r}` || k.startsWith(`m:${r}#`)); };
window.subNames = (n) => { const z = ukt.zoneProps[zi(n)]; return z.subs.map((_, k) => M.R.subName(z.sub0 + k)); };
for (let k = 0; k < 120 && !ukt.admin(); k++) await wait(1000);   // 읍면동 경계(소속표)가 실릴 때까지
M.B.adjacency(); for (let k = 0; k < 40 && !M.B.annexTargets(); k++) await wait(500);
return { ok: 1, rules: RULES().slice(0, 30), off: offSum() };

// @@ dongtan_metro
// 신설 시(동탄) → 광역시 승격(자치구 둘)
const r = await mkSplit('화성시', /동탄\d+동/, '동탄시'); window.SK = r.k;
if (!SK) return { fail: ['동탄시 신설 실패'] };
for (const i of ukt.admin().unit(SK).subs) ukt.result.subs.pop[i] *= 2;   // 50만을 넘기게 (시험용)
ukt.select({ type: 'unit', id: SK }); await wait(900);
const sel = document.querySelector('#split-metro-n'); if (sel) sel.value = '2';
document.querySelector('#selection [data-split-metro]')?.click(); await wait(1500); await closeDlg();
const u = ukt.admin().unit(SK);
return { rules: RULES(), fail: u?.metro ? [] : ['광역시로 승격하지 않음'], offs: offs((k) => k.includes(SK) || k === 'g:동탄광역시') };
// @@ annex_osan
ukt.select({ type: 'unit', id: SK }); await wait(1500);
const b = [...document.querySelectorAll('#selection [data-annex]')].find((x) => /오산시/.test(x.textContent));
if (!b) return { fail: ['편입 목록에 오산시 없음'] };
b.click(); await wait(1500); await closeDlg();
const reg = M.LC.regionOf(ukt.state, ukt.zoneProps[zi('오산시')]);
const sn = subNames('오산시').filter((n) => /[읍면]$/.test(n));
return { rules: RULES(), fail: [...(reg === '동탄광역시' ? [] : [`오산 소속 ${reg}`]), ...(sn.length ? [`자치구 밑 읍면 ${sn.join(',')}`] : [])] };
// @@ gyeonggi_split
M.P.regionReorg('gyeonggi', '경기도'); await wait(500);
return { rules: RULES(), fail: ukt.admin().unit(SK)?.region === '동탄광역시' ? [] : ['분도 뒤 동탄광역시 소속이 바뀜'] };
// @@ dongtan_merge
const before = Object.keys(ukt.state.local.offices).length;
M.R.mergeSplitUnit(SK); await wait(800);
const left = Object.keys(ukt.state.local.offices).filter((k) => k.includes(SK) || k === 'g:동탄광역시');
const osan = M.LC.regionOf(ukt.state, ukt.zoneProps[zi('오산시')]);
return { rules: RULES(), fail: [...left.map((k) => `남은 자리 ${k}`), ...(/광역시/.test(osan) ? [`오산이 ${osan}에 남음`] : [])] };
// @@ bodyless_metro_annex
// 구 없이 승격한 신설 광역시에 시를 편입하면 몸통도 자치구로 나뉘어야 (자치구와 구 없는 동이 섞이지 않게)
const r = await mkSplit('화성시', /동탄\d+동/, '동탄시'); const k = r.k;
if (!k) return { fail: ['동탄시 신설 실패'] };
for (const i of ukt.admin().unit(k).subs) ukt.result.subs.pop[i] *= 2;
ukt.select({ type: 'unit', id: k }); await wait(900);
const sel = document.querySelector('#split-metro-n'); if (sel) sel.value = sel.options[0]?.value ?? '1';
document.querySelector('#selection [data-split-metro]')?.click(); await wait(1500); await closeDlg();
const gu0 = !!ukt.state.local.bungu?.[k];
ukt.select({ type: 'unit', id: k }); await wait(1500);
const b = [...document.querySelectorAll('#selection [data-annex]')].find((x) => /오산시/.test(x.textContent));
if (!b) return { fail: ['편입 목록에 오산시 없음'] };
b.click(); await wait(1500); await closeDlg();
const gus = [...new Set(Object.values(ukt.state.local.bungu?.[k]?.gu || {}))];
const rules = RULES();
M.R.mergeSplitUnit(k); await wait(800);
return { rules: [...rules, ...RULES()], fail: gu0 ? ['구 없이 승격하지 않음 (시험 조건)'] : gus.length < 2 ? [`몸통이 자치구로 나뉘지 않음 (${gus.join(',')})`] : [], gus };
// @@ gu_to_metro
// 분구한 시(벽성시)의 구 하나를 광역시(해주광역시)로 통째로 옮기면: 그 구는 광역시의 자치구, 구 없던 광역시 몸통도 자치구로
const L = ukt.state.local;
L.autonomyKP = true;
if (!L.independent.includes('해주시')) { L.independent.push('해주시'); M.R.adminInvalidate(); M.B.syncGovernors(); M.E.syncMayors(); }
const metro = M.LC.metroName('해주시');
const bz = zi('벽성군'), bk = M.LC.unitId(ukt.state, ukt.zoneProps[bz]);
(L.cityUp ||= []).push(bk); M.R.adminInvalidate();
if (!M.B.makeBungu(bk, 2, { general: true })) return { fail: ['벽성시 분구 실패'] };
M.E.syncMayors();
const gus = [...new Set(Object.values(L.bungu[bk].gu))], g = gus[gus.length - 1];
M.B.moveGuTo(M.B.guSubs(M.E.countyRep(bz), g), g, metro); await wait(800);
const key = Object.entries(L.splitUnit || {}).find(([, v]) => v.name === g)?.[0], u = key && ukt.admin().unit(key);
const hg = [...new Set(Object.values(L.bungu['해주시']?.gu || {}))];
return { rules: RULES(), fail: [...(u?.region === metro ? [] : [`옮긴 ${g}의 소속이 ${u?.region}`]), ...(hg.length >= 2 ? [] : ['해주광역시 몸통이 자치구로 나뉘지 않음'])] };
// @@ gimpo_tongjin
// 김포 → 인천 편입, 김포 땅으로 통진구 신설, 편입 되돌리기 → 통진구도 함께 합쳐져야
const gz = zi('김포시');
ukt.select({ type: 'zone', id: gz }); await wait(1500);
const b = [...document.querySelectorAll('#selection [data-annex]')].find((x) => x.dataset.annexTo === '인천광역시');
if (!b) return { fail: ['김포 인천 편입 단추 없음'] };
b.click(); await wait(1500); await closeDlg();
const r = await mkSplit('김포시', /^(월곶|하성|통진|대곶)(면|읍|동)$/, '통진구');
if (!r.k) return { fail: ['통진구 신설 실패'] };
const rulesMid = RULES();
ukt.select({ type: 'zone', id: gz }); await wait(1500);
document.querySelector('#selection [data-annex-undo]')?.click(); await wait(1500);
const still = Object.values(ukt.state.local.splitUnit || {}).some((s) => s.name === '통진구');
return { rules: [...rulesMid, ...RULES()], fail: still ? ['편입을 되돌려도 통진구가 남음'] : [] };
// @@ gijang_gu
const gz = zi('기장군');
ukt.select({ type: 'zone', id: gz }); await wait(1500);
const b = document.querySelector('#selection [data-gun-gu]');
if (!b) return { fail: ['기장군 구로 전환 단추 없음'] };
b.click(); await wait(1500); await closeDlg();
const em = subNames('기장군').filter((n) => /[읍면]$/.test(n));
return { rules: RULES(), fail: em.length ? [`자치구 밑 읍면 ${em.join(',')}`] : [] };
// @@ small_city_gu
const bad = M.B.bunguUnits().filter(([k]) => /태백|동해|삼척|문경/.test(k)).map((x) => x[1]);
return { fail: bad.map((x) => `50만 아래 일반구 후보 ${x}`) };
// @@ suwon_metro
// 수원(일반구 넷) 광역시 승격: 구청장은 모두 새로 뽑는다 (시장이 구청장 자리를 이어받지 않음)
const sz = zi('수원시'), rep = M.E.countyRep(sz);
const mayor = ukt.state.local.offices[`m:${rep}`]?.name;
ukt.select({ type: 'zone', id: sz }); await wait(1500);
const sel = document.querySelector('#bungu-n'); if (sel) sel.value = '1';
const b = document.querySelector('#selection [data-ev-city]'); if (!b) return { fail: ['수원 광역시 승격 단추 없음'] };
b.click(); await wait(1500); await closeDlg();
const core = ukt.state.local.offices[`m:${rep}`];
return { rules: RULES(), fail: core && core.name === mayor && /구청장$/.test(core.title) ? [`시장 ${mayor}이 ${core.title} 자리를 이어받음`] : [], offs: zoneOffs('수원시') };
// @@ year
const y0 = ukt.state.year;
document.querySelector('#btn-next')?.click();
for (let i = 0; i < 150 && ukt.state.year === y0; i++) await wait(1000);
for (let i = 0; i < 90 && ukt.busy; i++) await wait(1000);
return { rules: RULES(), fail: ukt.state.year === y0 ? ['해 넘기기 안 됨'] : [], ce: (window.__ce || []).slice(0, 3) };
