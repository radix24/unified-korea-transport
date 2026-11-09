"""시군구 종사자 수(pipeline/jobs_2024.json)를 data/zones.json의 남측 존에 jobs로 넣는다.

출처: 고용노동부 사업체노동실태현황 2024 (KOSIS DT_118N_SAUPM75 8개시, DT_118N_SAUPM78 9개도),
전체 산업·전규모 총종사자수. 공공행정·국방과 공무원 재직기관은 원자료에서 빠져 있다.

- 전남광주통합특별시 존은 옛 광주광역시·전라남도 이름으로 찾는다.
- 인천 2026 개편 구: 옛 중구+동구 → 제물포구·영종구, 옛 서구 → 서해구·검단구 (인구 비례로 나눈다).
- 한 시군이 존 여럿으로 나뉜 곳(철원·연천·파주의 접경 조각)은 인구 비례로 나눈다.
북측·국외 존은 자료가 없어 넣지 않는다 (모형은 인구 비례로 본다).

zones.json을 다시 만든 뒤(build_grid.py) 이 스크립트를 다시 돌린다.
실행: python pipeline/add_jobs.py
"""

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main():
    src = json.loads((ROOT / "pipeline/jobs_2024.json").read_text(encoding="utf-8"))
    jobs = {(p, n): v for p, n, v in src["rows"]}
    zones = json.loads((ROOT / "data/zones.json").read_text(encoding="utf-8"))
    kr = [q for q in zones if q.get("country") == "KR"]

    inc = {q["name"]: q for q in kr if q["province"] == "인천광역시"}
    special = {}
    for names, olds in ((["제물포구", "영종구"], ["중구", "동구"]), (["서해구", "검단구"], ["서구"])):
        if not all(n in inc for n in names):
            continue
        tot = sum(jobs[("인천광역시", o)] for o in olds)
        ps = sum(inc[n]["pop"] for n in names)
        for n in names:
            special[n] = round(tot * inc[n]["pop"] / ps)

    groups = defaultdict(list)
    for q in kr:
        groups[(q["province"], q["name"])].append(q)
    miss = []
    for (p, n), qs in groups.items():
        v = jobs.get((p, n))
        if v is None and p == "전남광주통합특별시":
            v = jobs.get(("광주광역시", n), jobs.get(("전라남도", n)))
        if v is None and p == "인천광역시":
            v = special.get(n)
        if v is None:
            miss.append((p, n))
            continue
        ps = sum(q["pop"] for q in qs)
        for q in qs:
            q["jobs"] = round(v * q["pop"] / ps) if len(qs) > 1 else v
    (ROOT / "data/zones.json").write_text(json.dumps(zones, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"종사자 수 {sum(q.get('jobs', 0) for q in kr):,}명, 못 찾은 존 {miss}")


if __name__ == "__main__":
    main()
