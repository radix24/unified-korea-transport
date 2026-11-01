"""행정구역 규칙 시험: 화면 없는 크롬으로 게임을 열어 신설·승격·편입·분도·되돌리기를 차례로 하고,
단계마다 한국 행정 체계 규칙(tools/qa_admin.js의 RULES)과 단계별 기대를 검사한다.

실행: python tools/qa_admin.py            (위반이 있으면 종료 코드 1)
     python tools/qa_admin.py --only gijang_gu,small_city_gu   (몇 단계만, setup은 늘 돈다)

게임 서버를 따로 켤 필요 없다 (저장소를 --http 포트로 띄운다). 한 번에 5~10분 걸린다.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from qa_play import CHROME, Page  # noqa: E402

CAPTURE = ("window.__ce=[];const _ce=console.error;console.error=function(...a){window.__ce.push(a.map(x=>x&&x.stack?x.stack:String(x)).join(' ').slice(0,600));"
           "return _ce.apply(this,a)};addEventListener('error',e=>window.__ce.push('onerror '+(e.error&&e.error.stack||e.message)));"
           "addEventListener('unhandledrejection',e=>window.__ce.push('rej '+(e.reason&&e.reason.stack||e.reason)))")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--http", type=int, default=8790)
    ap.add_argument("--port", type=int, default=9390, help="크롬 원격 디버깅 포트")
    ap.add_argument("--only", default="", help="쉼표로 단계 이름 (setup은 늘 돈다)")
    args = ap.parse_args()
    steps = (ROOT / "tools" / "qa_admin.js").read_text(encoding="utf-8").split("// @@ ")[1:]
    only = set(filter(None, args.only.split(",")))
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(args.http)], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    prof = tempfile.mkdtemp(prefix="ukt-qa-admin-")
    chrome = subprocess.Popen([CHROME, "--headless=new", f"--remote-debugging-port={args.port}", f"--user-data-dir={prof}", "--window-size=1400,900",
                               "--no-first-run", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-background-timer-throttling",
                               "--disable-renderer-backgrounding", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    failed = []
    try:
        tabs = None
        for _ in range(300):
            try:
                tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json").read())
                break
            except Exception:
                time.sleep(0.2)
        p = Page(next(t for t in tabs if t["type"] == "page")["webSocketDebuggerUrl"])
        p.ws.settimeout(300)
        p.send("Runtime.enable"); p.send("Page.enable")
        p.send("Page.addScriptToEvaluateOnNewDocument", source=CAPTURE)
        p.send("Page.navigate", url=f"http://localhost:{args.http}/")
        t0 = time.time()
        for _ in range(60):
            time.sleep(5)
            try:
                if p.js("typeof ukt !== 'undefined' && !!ukt.result", timeout_ms=20000):
                    break
            except Exception:
                pass
        else:
            print("게임이 열리지 않았습니다", p.errors[:3])
            return 1
        print(f"열림 {round(time.time() - t0)}초", flush=True)
        p.js("window.confirm=()=>true; window.alert=(m)=>{(window.__al||=[]).push(String(m))}; document.querySelector('[data-setup-act=ok]')?.click(); true")
        time.sleep(3)
        for part in steps:
            name, _, body = part.partition("\n")
            name = name.strip()
            if only and name != "setup" and name not in only:
                continue
            t1 = time.time()
            try:
                r = p.js(f"(async () => {{ {body} }})().then((v) => JSON.stringify(v ?? null)).catch((e) => JSON.stringify({{ fail: ['오류 ' + (e.stack || e)] }}))", timeout_ms=280000)
                v = json.loads(r) if isinstance(r, str) else r
            except Exception as e:
                v = {"fail": [f"시험 도구 오류 {str(e)[:200]}"]}
            v = v if isinstance(v, dict) else {}
            bad = list(v.get("rules") or []) + list(v.get("fail") or []) + [f"콘솔 오류 {c[:200]}" for c in (v.get("ce") or [])]
            print(f"{'통과' if not bad else '실패'} {name} ({round(time.time() - t1)}초)" + ("" if not bad else "\n  - " + "\n  - ".join(bad[:12])), flush=True)
            if bad:
                failed.append(name)
        errs = [e for e in p.errors if "DataCloneError" not in e]
        if errs:
            print("페이지 오류", errs[:3])
            failed.append("page-errors")
    finally:
        chrome.kill(); server.kill()
        shutil.rmtree(prof, ignore_errors=True)
    print("모두 통과" if not failed else f"실패 {len(failed)}단계: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
