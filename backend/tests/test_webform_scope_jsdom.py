# SPDX-License-Identifier: Apache-2.0
"""范围开关与清单重建的**真 JS 执行**契约（node + jsdom，不开浏览器）。

## 为什么不能只断言脚本里出现了某一行

`test_webform_scope_panel.py` 里有一组"脚本里有没有这句"的结构契约——它挡得住整段被
删掉，挡不住**写对了但跑不通**：`elScope` 为空时 `setAttribute` 抛异常、定时器回滚画到
了不存在的节点、`scrollTop` 读写的时机错了……这些只有真跑一遍才暴露。

canary 家族（`test_webform_js_canary.py`）跑的是真浏览器，CI 与并行下恒 skip，不是门禁。
这里折中：用 `node + frontend/node_modules/jsdom`（先例 `test_webform_ud_dropdown.py`）
执行**同一份生成出来的脚本**，把四条行为钉成可执行断言：

1. 点开关**当场**变色 + `aria-busy` + 两键禁用（不 Python 回推也成立）；
2. 回推到了：以回推值为准，等待态清掉；
3. 没等到回推：2.5s 后**回滚**到上一份已确认范围，并解除等待态；
4. 回推时**必须停表**——否则旧定时器会在下一次切换时把新请求的乐观态抹掉；
5. 清单整块重建前后 `scrollTop` 被记住并回写，搜索词保持。

## 什么时候跑

`node` 与 `frontend/node_modules/jsdom` 都在才跑；缺一样就 skip（后端 CI 不装前端依赖）。
"""

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from app.services.webform.engine.scripts import FOCUS_LISTENER_SCRIPT
from app.services.webform.live_scripts import _ACK_SCOPE_SCRIPT, _scope_script

FRONTEND_NODE_MODULES = Path(__file__).resolve().parents[2] / "frontend" / "node_modules"
_JSDOM_MODULE = FRONTEND_NODE_MODULES / "jsdom"

_PAGE = '<!doctype html><html><body><div class="form"><input id="deep-name" type="text"></div></body></html>'

# 场景脚本在**窗口作用域**里跑（与注入方式一致）。假定时器把 `setTimeout` 的回调攒进
# 队列，测试里手动"到点"——2.5s 的回滚不用真等，也就能精确验证"回推之后那次不该再跑"。
_RUNNER = """
const { JSDOM } = require(__JSDOM__);
const dom = new JSDOM(__PAGE__, { runScripts: 'dangerously' });
const w = dom.window;
const queue = new Map();
let seq = 1;
w.setTimeout = (fn, ms) => { const id = seq++; queue.set(id, { fn, ms }); return id; };
w.clearTimeout = (id) => { queue.delete(id); };
// 当前队列里最大的定时器 id：用来区分"上一次点击留下的表"和"这一次点击新起的表"。
w.__rfLastTimerId = () => (queue.size ? Math.max(...queue.keys()) : 0);
w.__rfFire = (minMs, maxId) => {
  const upTo = typeof maxId === 'number' ? maxId : Infinity;
  let fired = 0;
  for (const [id, timer] of [...queue.entries()]) {
    if (timer.ms >= minMs && id <= upTo) { queue.delete(id); timer.fn(); fired += 1; }
  }
  return fired;
};
w.eval(__INSTALL__);
w.eval(__SCOPE_GROUP__);
const out = w.eval(__SCENARIO__);
console.log(JSON.stringify(out));
dom.window.close();
"""

# 四条读数在三个场景里共用：开关的高亮、等待态、禁用、请求全局。
_READ = """
  const root = document.getElementById('__rf_live_host__').shadowRoot;
  const box = root.querySelector('.scope');
  const group = root.querySelector('[data-scope="group"]');
  const all = root.querySelector('[data-scope="all"]');
  const read = () => ({
    groupOn: group.classList.contains('on'),
    allOn: all.classList.contains('on'),
    busy: box.getAttribute('aria-busy'),
    disabled: [group.disabled, all.disabled],
    request: window.__rfScopeRequest || null,
  });
"""


def _jsdom_available() -> bool:
    return shutil.which("node") is not None and _JSDOM_MODULE.is_dir()


def _run(scenario: str) -> dict:
    """在一个新页面上装一次监听、置 group 范围，然后执行场景脚本并取回返回值。"""
    if not _jsdom_available():  # pragma: no cover - 无 node 或缺前端依赖的环境跳过
        pytest.skip("node 或 frontend/node_modules/jsdom 不可用")
    runner = (
        _RUNNER.replace("__JSDOM__", json.dumps(str(_JSDOM_MODULE).replace("\\", "/")))
        .replace("__PAGE__", json.dumps(_PAGE))
        .replace("__INSTALL__", json.dumps(FOCUS_LISTENER_SCRIPT))
        .replace("__SCOPE_GROUP__", json.dumps(_scope_script("group", [])))
        .replace("__SCENARIO__", json.dumps(scenario))
    )
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
        fh.write(runner)
        path = fh.name
    try:
        proc = subprocess.run(
            ["node", path], capture_output=True, text=True, timeout=60, encoding="utf-8"
        )
    finally:
        Path(path).unlink(missing_ok=True)
    assert proc.returncode == 0, f"jsdom 执行失败：{proc.stderr[:800]}"
    return json.loads(proc.stdout.strip())


def test_clicking_the_switch_paints_at_once_and_ack_settles_it():
    """点下去**当场**落到新档，不等 Python；回推以回推值为准并清掉等待态。

    轮询最快 350ms 才换届，此前开关毫无变化——用户看到的就是"点了没反应"然后连点。
    """
    scenario = (
        "(() => {" + _READ + " const before = read();"
        " all.click();"
        " const pending = read();" + _ACK_SCOPE_SCRIPT + ";" + _scope_script("all", []) + ";"
        " const settled = read();"
        " return { before, pending, settled };"
        "})()"
    )
    out = _run(scenario)

    assert out["before"]["groupOn"] is True and out["before"]["allOn"] is False, out["before"]

    pending = out["pending"]
    assert pending["allOn"] is True and pending["groupOn"] is False, pending
    assert pending["busy"] == "true", pending
    assert pending["disabled"] == [True, True], pending
    # 请求全局照旧只置一个值，由 Python 侧消费后 ACK 清掉。
    assert pending["request"] == "all", pending

    settled = out["settled"]
    assert settled["allOn"] is True and settled["groupOn"] is False, settled
    assert settled["busy"] is None, settled
    assert settled["disabled"] == [False, False], settled
    assert settled["request"] is None, settled


def test_without_an_answer_the_switch_rolls_back_after_2_5s():
    """没等到回推：2.5s 后回滚到**上一份已确认**范围（`__rfScope`），等待态解除。

    不回滚的话开关会一直停在用户点的那一档、两个键一直禁用——看起来像卡死。
    """
    scenario = (
        "(() => {" + _READ + " all.click();"
        " const pending = read();"
        " const fired = window.__rfFire(2500);"
        " const rolled = read();"
        " return { pending, fired, rolled };"
        "})()"
    )
    out = _run(scenario)

    assert out["pending"]["allOn"] is True, out["pending"]
    assert out["fired"] == 1, f"2.5s 的回滚定时器没到点：{out['fired']}"

    rolled = out["rolled"]
    assert rolled["groupOn"] is True and rolled["allOn"] is False, rolled
    assert rolled["busy"] is None, rolled
    assert rolled["disabled"] == [False, False], rolled


def test_an_acknowledged_switch_stops_its_rollback_timer():
    """回推时必须**停表**：旧定时器留着，下一次切换的乐观态会在 2.5s 被它抹掉。

    做法：第一次点击 → 回推（应停表）→ 再点另一档（此时存在**新**的表）→ 只推**旧**表。
    正确实现下旧表已被清掉（`fired == 0`），新请求的乐观高亮与禁用保持不变。
    """
    scenario = (
        "(() => {" + _READ + " all.click();"
        " const firstTimer = window.__rfLastTimerId();"
        + _ACK_SCOPE_SCRIPT
        + ";"
        + _scope_script("all", [])
        + ";"
        " group.click();"
        " const pending = read();"
        " const fired = window.__rfFire(2500, firstTimer);"
        " const after = read();"
        " return { firstTimer, pending, fired, after };"
        "})()"
    )
    out = _run(scenario)

    assert out["firstTimer"] > 0, out
    assert out["pending"]["groupOn"] is True, out["pending"]
    assert out["pending"]["busy"] == "true", out["pending"]
    assert out["fired"] == 0, "回推之后 2.5s 的回滚定时器还在队列里（没有停表）"
    assert out["after"] == out["pending"], f"旧的定时器把新请求的乐观态抹掉了：{out}"


def test_rebuilding_the_list_keeps_scroll_and_keyword():
    """清单整块重建（几百行）不能把用户滚到的位置弄丢，搜索词也要照旧生效。

    `scrollTop` 在 jsdom 里没有布局、恒为 0，所以这里换成一个记账的访问器：读到的值
    就是"重建前的位置"，写回几次、写了什么都能直接断言。
    """
    scenario = (
        "(() => {"
        " const root = document.getElementById('__rf_live_host__').shadowRoot;"
        " const list = root.querySelector('.list');"
        " const search = root.querySelector('.search input');"
        " const hits = root.querySelector('.hits');"
        " const more = root.querySelector('.more');"
        " let top = 120;"
        " const writes = [];"
        " Object.defineProperty(list, 'scrollTop', {"
        "   configurable: true,"
        "   get: () => top,"
        "   set: (value) => { top = value; writes.push(value); },"
        " });"
        " window.__rfCatalog = ["
        "   { group: '身份信息', label: '姓名', value: '张三' },"
        "   { group: '教育经历 1', label: '学校', value: '天津工业大学' },"
        " ];"
        " more.click();"
        " const expanded = { writes: writes.slice(), rows: list.querySelectorAll('.row').length };"
        " top = 64; writes.length = 0;"
        " search.value = '姓';"
        " window.__rfRefreshList();"
        " return {"
        "   expanded,"
        "   writes: writes.slice(),"
        "   top,"
        "   keyword: search.value,"
        "   hits: hits.textContent,"
        "   rows: list.querySelectorAll('.row').length,"
        " };"
        "})()"
    )
    out = _run(scenario)

    # 展开那一次：两条资料都画出来，且重建前后各回写一次（空态/正常两个出口都写了）。
    assert out["expanded"]["rows"] == 2, out
    assert out["expanded"]["writes"] == [120], out["expanded"]

    # 带搜索词重建：位置回写 64、搜索词不变、命中数按新词算（只剩「姓名」那条）。
    assert out["writes"] == [64], f"重建后没有把滚动位置写回去：{out}"
    assert out["top"] == 64, out
    assert out["keyword"] == "姓", out
    assert out["rows"] == 1, out
    assert "1" in out["hits"], out
