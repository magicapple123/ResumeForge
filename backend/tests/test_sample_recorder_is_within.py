"""QA 独立验证：API 输入面（未知字段 422）与第二道防线 ``_is_within`` 的边界。

拆分自 test_sample_recorder_runner_qa.py——``_is_within`` 是"越界即拒写"的第二道
防线，需要独立的函数级契约用例：兄弟目录同前缀、root 本身、``..`` 归一化、路径不存在、
resolve 抛 OSError、软链接逃逸、Windows 大小写/反斜杠等价。
"""
from __future__ import annotations

import contextlib
import os
from pathlib import Path

import pytest
from app.services.apply.task_runner import _is_within

# ===== 六、API 形状核实（未知字段必须 422，不是把脏数据当 500 吞掉）=====


def test_collect_task_rejects_unknown_body_fields_with_422(client):
    """``POST /collect/tasks`` 的请求体是 ``extra="forbid"``：传未知字段要给 422，
    而不是带着未知字段继续跑（更不是 500）。这保证"每次采集显式勾选"是一个封闭的输入面，
    不会因为前端多传了个字段就静默改变行为。"""
    client.put("/api/collect/config", json={"keywords": ["后端"], "city": "北京"})

    response = client.post("/api/collect/tasks", json={"unknown_field": True})

    assert response.status_code == 422


# ===== 七、第二道防线 _is_within 的边界（B 的牙齿）=====
#
# 背景：修复把「只用已解析适配器的 key 拼目录」（A）与「拼完再检查是否在 captures 之内」
# （B）做成两道防线。C（恶意 site_key 回归）只钉住了 A——A 正确时，即使把 B 整段删掉，
# C 的断言（样本落在 captures/boss、captures 外无 json）**依然全绿**，因为目录本就落在
# captures 内。所以这里单独为 B 补一组用例：直测函数契约 + 一条会让 join 结果越界的
# runner 级用例，让"越界即拒写"这条性质单独也有牙。


def _make_escaping_link(link: Path, target: Path) -> bool:
    """在 ``link`` 处建一个指向外部 ``target`` 的链接，返回是否**真的**建成且会被 resolve() 跟随。

    两条经验决定了这个 helper 必须"回读核实"、而不是"没抛异常就当成功"：

    - 有些环境（含本机沙箱）``os.symlink`` 会**静默失败**：不抛异常、但链接根本没建出来；
    - Windows 上无符号链接权限时 ``os.symlink`` 也会失败，此时退回**目录联接**（junction，
      不需要特权）——对 ``_is_within`` 而言二者等价，因为它只看 ``resolve()`` 是否跳出 root。

    统一用"``resolve()`` 是否真的跳到 ``target``"作为成功判据；建不成就返回 False，由调用方
    跳过，绝不伪造绿灯。
    """
    link.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError, NotImplementedError):
        os.symlink(target, link, target_is_directory=True)
    if link.exists() and link.resolve() == target.resolve():
        return True
    if os.name == "nt":
        import subprocess

        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True)
    try:
        return link.exists() and link.resolve() == target.resolve()
    except OSError:
        return False


def test_is_within_rejects_sibling_directory_sharing_a_prefix(tmp_path):
    """兄弟目录同前缀（``captures-evil``）必须判为「不在之内」。

    这是手写"是不是在里面"检查最经典的错误：``str(path).startswith(str(root))`` 对
    ``<root>-evil`` 返回 True（字符串前缀相同），于是把样例写进一个只是"名字像 captures"
    的目录。这里断言为 False，并同时钉住"字符串法会误判"，说明为什么必须用 resolve()。
    """
    root = tmp_path / "captures"
    root.mkdir()
    sibling = tmp_path / "captures-evil"

    assert str(sibling).startswith(str(root))  # 朴素的 startswith 会误判为"在内"
    assert _is_within(sibling, root) is False  # 正确实现必须判为"不在内"

    # 反向确认：真正的子目录仍是 True（挡住"一律返回 False"这种假修复）。
    assert _is_within(root / "boss", root) is True


def test_is_within_accepts_the_root_itself_without_raising(tmp_path):
    """``path == root`` 时行为必须明确且**不抛异常**：这里钉住返回 True（root 在自身之内）。"""
    root = tmp_path / "captures"
    root.mkdir()

    assert _is_within(root, root) is True


def test_is_within_normalises_dotdot(tmp_path):
    """含 ``..`` 的路径按 resolve() 归一化后再判断：回到内部算内、跳到外部算外。"""
    root = tmp_path / "captures"
    (root / "boss").mkdir(parents=True)

    assert _is_within(root / "boss" / ".." / "boss", root) is True
    assert _is_within(root / ".." / "outside", root) is False


def test_is_within_works_even_when_paths_do_not_exist(tmp_path):
    """目标 / 根都还不存在时也要能用（``resolve`` 非严格模式），不能因为不存在就崩。"""
    root = tmp_path / "captures"  # 故意不创建

    assert _is_within(root / "boss", root) is True
    assert _is_within(tmp_path / "elsewhere", root) is False


def test_is_within_returns_false_when_resolve_raises_oserror(monkeypatch):
    """``resolve()`` 抛 ``OSError`` 时必须返回 False，绝不向上传播。

    落盘是旁路能力：一个解析失败的路径不该把整次采集弄坏。这里让 ``Path.resolve`` 直接
    抛错，断言函数吞掉异常并返回 False。
    """

    def boom(self, *args, **kwargs):
        raise OSError("模拟 resolve 失败")

    monkeypatch.setattr(Path, "resolve", boom, raising=True)

    assert _is_within(Path("a/b"), Path("a")) is False


def test_is_within_follows_a_symlink_that_escapes_captures(tmp_path):
    """软链接逃逸：captures 内一个指向外部的软链接，保存路径经过它 → 必须判为「不在之内」。

    这正是用 ``resolve()`` 而不是字符串比较的理由：字符串看 ``captures/evil`` 明明是
    ``captures`` 的子路径（下面显式断言了这点），但 ``resolve()`` 会跟随链接、发现它其实
    指向外部。符号链接建不出来时退回目录联接；两者都建不出才跳过——不伪造绿灯。
    """
    root = tmp_path / "captures"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / "evil"

    if not _make_escaping_link(link, outside):
        pytest.skip("本环境既建不出符号链接也建不出目录联接，跳过链接逃逸用例")

    assert str(link).startswith(str(root))  # 字符串法会误判为"在内"
    assert _is_within(link, root) is False  # resolve() 跟随链接 → 正确判为"不在内"


@pytest.mark.skipif(os.name != "nt", reason="大小写/反斜杠等价只在 Windows 文件系统上有意义")
def test_is_within_windows_case_and_separator_forms(tmp_path):
    """Windows 大小写不敏感、``\\`` 与 ``/`` 等价：这些形态不应误判。

    ``Captures`` 与 ``captures`` 在 Windows 上指向同一目录，必须算"在内"；
    ``captures\\boss\\..\\boss`` 归一化后仍在本目录之内，也不算越界。
    """
    root = tmp_path / "captures"
    (root / "boss").mkdir(parents=True)

    assert _is_within(tmp_path / "Captures" / "boss", root) is True
    assert _is_within(tmp_path / Path("captures\\boss\\..\\boss"), root) is True
    assert _is_within(tmp_path / Path("captures-evil"), root) is False
