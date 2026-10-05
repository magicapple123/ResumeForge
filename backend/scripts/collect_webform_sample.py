"""从真机网申页采集一条匹配语料（脱敏草稿）到 fixtures/webform/pages/。

用法（backend 目录，PYTHONUTF8=1；网申专用浏览器已在 9334 运行并打开目标页面）：

    .venv\\Scripts\\python.exe scripts\\collect_webform_sample.py --list
    .venv\\Scripts\\python.exe scripts\\collect_webform_sample.py \\
        --site 鹰角 --out tests/fixtures/webform/pages/hypergryph-2026-10-05-apply-education.json

采集只保留**结构**：剥离每个控件的 ``value`` / ``display`` / ``checked``，并丢弃
页面 URL 与标题（URL 可能带查询参数）。同时统计 shadowRoot / iframe 数量——
这是"要不要做 DOM 穿透"的数据判据（穿透不在本期范围内，先攒数字）。

生成的 ``profile`` / ``expect`` 是空骨架并带 ``draft: true``：**期望映射必须人工填写**
（多数对照页面截图或实际填写结果），草稿 case 会被语料测试挡下——正确性是语料的
灵魂，不能由当前引擎的运行结果自证。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(BACKEND_DIR / "tests"))

from app.services.browser.cdp_client import CdpError, WebsocketCdpClient  # noqa: E402
from app.services.webform.engine import CONTROLS_SCRIPT  # noqa: E402
from webform_corpus_support import desensitization_violations  # noqa: E402

# 结构探针：shadow DOM / iframe / 可见控件计数。与 CONTROLS_SCRIPT 同一条页面通道。
PROBE_SCRIPT = (
    "(() => { /* rf:sample-probe */\n"
    "  let shadowRoots = 0;\n"
    "  for (const el of document.querySelectorAll('*')) { if (el.shadowRoot) { shadowRoots += 1; } }\n"
    "  return JSON.stringify({\n"
    "    shadow_roots: shadowRoots,\n"
    "    iframes: document.querySelectorAll('iframe').length,\n"
    "    visible_controls: document.querySelectorAll(\n"
    "      'input, textarea, select, [contenteditable=\"true\"]'\n"
    "    ).length,\n"
    "  });\n"
    "})()"
)

_STRIPPED_KEYS = ("value", "display", "checked")


def _strip_values(controls: list[dict]) -> list[dict]:
    return [
        {key: value for key, value in control.items() if key not in _STRIPPED_KEYS}
        for control in controls
    ]


def _pick_target(client: WebsocketCdpClient, target_id: str | None) -> None:
    targets = [
        item for item in client.list_targets() if item.get("type") == "page"
    ]
    if target_id:
        if not any(str(item.get("id")) == target_id for item in targets):
            raise CdpError(f"没有 id 为 {target_id} 的页面标签，用 --list 查看")
        return
    pages = [item for item in targets if str(item.get("url", "")).startswith("http")]
    if len(pages) == 1:
        return
    listing = "\n".join(
        f"  {item.get('id')}  {item.get('url', '')}" for item in targets
    )
    raise CdpError(f"当前有 {len(pages)} 个 http 页面，用 --target 指定一个：\n{listing}")


def main() -> int:
    parser = argparse.ArgumentParser(description="采集一条网申匹配语料（脱敏草稿）")
    parser.add_argument("--site", help="站点名（写进语料的 site 字段）")
    parser.add_argument("--out", help="输出的 fixture 路径（.json）")
    parser.add_argument("--port", type=int, default=9334, help="网申专用浏览器调试端口")
    parser.add_argument("--list", action="store_true", help="列出标签页后退出")
    parser.add_argument("--target", help="目标标签页 target id（多标签时用）")
    parser.add_argument("--note", default="", help="人工备注（页面/incident 描述）")
    parser.add_argument("--force", action="store_true", help="覆盖已存在的 --out 文件")
    args = parser.parse_args()

    client = WebsocketCdpClient(port=args.port)
    try:
        if args.list:
            for item in client.list_targets():
                if item.get("type") == "page":
                    print(f"{item.get('id')}  {item.get('url', '')}")
            return 0

        if not args.site or not args.out:
            parser.error("需要 --site 与 --out（或先 --list 看看有哪些标签页）")
        out_path = Path(args.out)
        if out_path.exists() and not args.force:
            print(f"目标已存在：{out_path}（确认要覆盖加 --force）")
            return 1

        _pick_target(client, args.target)
        # 单页应用的表单常在导航后异步渲染；轮询等一会儿再下结论，
        # 否则慢页面上会误报"没有控件"。
        deadline = time.monotonic() + 6.0
        payload: object = None
        while True:
            raw = client.evaluate(CONTROLS_SCRIPT)
            payload = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(payload, dict) and payload.get("controls"):
                break
            if time.monotonic() >= deadline:
                break
            time.sleep(0.4)
        if not isinstance(payload, dict) or not payload.get("controls"):
            print("等了 6 秒仍没有采集到控件——确认页面已打开、表单已渲染，且控件可见。")
            return 1
        probe = client.evaluate(PROBE_SCRIPT)
        probe_data = json.loads(probe) if isinstance(probe, str) else probe
    finally:
        client.close()

    controls = _strip_values(payload["controls"])
    fixture = {
        "version": 1,
        "id": out_path.stem,
        "site": args.site,
        "captured_at": date.today().isoformat(),
        "source_test": "",
        "note": args.note or "（人工补充：这条 case 的页面结构与它对错的期待）",
        "draft": True,
        "controls": controls,
        "profile": {},
        "expect": {"mappings": [], "forbidden": [], "low_confidence": []},
    }
    text = json.dumps(fixture, ensure_ascii=False, indent=2) + "\n"
    out_path.write_text(text, encoding="utf-8")

    print(f"已写出 {out_path}（{len(controls)} 个控件）")
    print(f"结构探针：{probe_data}")
    print("下一步（缺一不可）：")
    print("  1. 填写 profile 与 expect.mappings（含期望写值；把握不准的框写进 forbidden）")
    print("  2. 删掉 draft 字段，补上 source_test/note")
    print("  3. 跑 scripts/webform_match_report.py 确认数字，再 --update-baseline")
    violations = desensitization_violations(text)
    if violations:
        print(f"⚠ 页面文字里出现疑似个人数据，提交前必须人工核实/替换：{violations}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
