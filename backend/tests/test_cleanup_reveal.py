# SPDX-License-Identifier: Apache-2.0
"""清理清单的「在文件夹中显示」（条目 04）：相对路径还原 + 路径守卫 + 交给系统。

四条必须守住的性质：

1. **只接受相对路径**——绝对路径、``..``、盘符路径一律 400；这个端点不能变成
   「任意路径存在性探针」；
2. **符号链接逃逸挡住**——``(数据目录 / path).resolve()`` 必须仍在数据目录内，
   否则一条指向外面的软链就能让文件管理器跳到用户任意目录；
3. **首段白名单**——只有 ``backups`` / ``auto-backups`` / ``logs``（清理能扫到的
   三类）；数据库、附件、``datasets/`` 不允许被这样打开；
4. **发起即成功**——``explorer /select`` 成功也常返回非零退出码，所以子进程
   ``Popen`` 被调到就算成功，不看退出码。

子进程一律 mock：这组用例绝不允许在跑测试的机器上真的弹出资源管理器窗口
（与 ``test_storage_cleanup`` 的 ``tmp_path`` 纪律同一个理由）。
"""

from __future__ import annotations

import os
import subprocess
import types
from pathlib import Path

import pytest
from app.services import cleanup, system_reveal


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """每个用例一个干净的数据目录，与 ``services/cleanup.py`` 共用同一个根。

    端点里的根取自 ``cleanup._data_root()``（不是 ``api.stats`` 自己的常量），
    所以补丁打在 ``cleanup`` 上就够了——这条断言顺带钉住「两边同一个根」。
    """
    monkeypatch.setattr(cleanup, "DATA_DIR", str(tmp_path))
    assert cleanup._data_root() == tmp_path
    return tmp_path


@pytest.fixture
def popen_calls(monkeypatch):
    """把 ``system_reveal.subprocess`` 换成只记录参数的假实现，返回记录列表。"""
    calls: list[list[str]] = []

    def _popen(args, *extra, **kwargs):  # noqa: ANN001, ANN002, ANN003, ARG001
        calls.append(list(args))
        # 退出码 1：真机上 explorer /select 成功也常这样，不能被当成失败。
        return types.SimpleNamespace(poll=lambda: 1, returncode=1)

    monkeypatch.setattr(system_reveal, "subprocess", types.SimpleNamespace(Popen=_popen))
    return calls


def _write(root: Path, relative: str, size: int = 8) -> Path:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)
    return path


def _link_dir(target: Path, link: Path) -> None:
    """建一个目录链接：POSIX 用 ``symlink``，Windows 退回 ``mklink /J``。

    Windows 建符号链接要「创建符号链接」特权（开发者模式/管理员），但目录
    **junction** 不需要——所以逃逸用例在这台机器上也能真的跑，而不是永远 skip。
    """
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.symlink(target, link, target_is_directory=True)
        return
    except (OSError, NotImplementedError):
        pass
    if os.name == "nt":
        created = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(link), str(target)],
            capture_output=True,
            check=False,
        )
        if created.returncode == 0:
            return
    pytest.skip("当前环境不能创建目录链接（符号链接与 junction 都不可用）")


def _reveal(client, path):
    return client.post("/api/stats/storage/cleanup-reveal", json={"path": path})


# ---------------------------------------------------------------------------
# 正常路径：三条平台分支都发起进程，且路径被还原到数据目录之内
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("platform", "expected_tail"),
    [
        ("win32", "select"),
        ("darwin", "reverse"),
        ("linux", "parent"),
    ],
)
def test_a_real_file_is_revealed_by_the_platform_command(
    client, data_dir, popen_calls, monkeypatch, platform, expected_tail
):
    _write(data_dir, "backups/old.zip")
    monkeypatch.setattr(system_reveal.sys, "platform", platform)

    response = _reveal(client, "backups/old.zip")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert len(popen_calls) == 1
    command = popen_calls[0]
    target = (data_dir / "backups/old.zip").resolve()

    if expected_tail == "select":
        # explorer 的 /select, 后面必须紧跟目标路径（逗号属于语法）。
        assert command[0] == "explorer"
        assert command[1] == f"/select,{target}"
    elif expected_tail == "reverse":
        assert command == ["open", "-R", str(target)]
    else:
        # Linux 只能打开所在目录：没有统一的「选中文件」语义。
        assert command == ["xdg-open", str(target.parent)]


def test_a_nonzero_exit_code_is_not_a_failure(client, data_dir, popen_calls, monkeypatch):
    """Popen 发起即成功：假实现返回退出码 1，端点仍然 200。"""
    _write(data_dir, "logs/backend.log")
    monkeypatch.setattr(system_reveal.sys, "platform", "win32")

    response = _reveal(client, "logs/backend.log")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert popen_calls, "explorer 必须被发起"


def test_nested_auto_backup_file_is_revealed(client, data_dir, popen_calls, monkeypatch):
    """``auto-backups/<库名>/<快照>`` 这种两层路径同样能定位。"""
    _write(data_dir, "auto-backups/main/snap-1.db")
    monkeypatch.setattr(system_reveal.sys, "platform", "win32")

    response = _reveal(client, "auto-backups/main/snap-1.db")

    assert response.status_code == 200
    assert popen_calls[0][1].endswith("snap-1.db")


# ---------------------------------------------------------------------------
# 路径守卫：绝对路径 / 穿越 / 白名单 / 符号链接逃逸 —— 全部 400，且不发起进程
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_path",
    [
        "/etc/passwd",
        "C:/Windows/System32/drivers/etc/hosts",
        "c:/temp/x.db",
        "~/x.db",
        "\\\\server\\share\\x.db",
        "",
        "   ",
        None,
        123,
    ],
)
def test_absolute_and_non_string_paths_are_rejected(client, popen_calls, bad_path):
    response = _reveal(client, bad_path)

    assert response.status_code == 400
    assert popen_calls == []


@pytest.mark.parametrize(
    "traversal",
    [
        "../outside.db",
        "backups/../../outside.db",
        "backups/../logs/old.log",
        "backups\\..\\..\\outside.db",
        "backups/../.cleanup-trash/20260101-000000/old.zip",
    ],
)
def test_parent_traversal_is_rejected(client, data_dir, popen_calls, traversal):
    _write(data_dir, "logs/old.log")

    response = _reveal(client, traversal)

    assert response.status_code == 400
    assert "上级目录" in response.json()["detail"]
    assert popen_calls == []


@pytest.mark.parametrize(
    "foreign_path",
    [
        "datasets/abcdef0123456789.db",
        "user_files/copy.bin",
        "resume_forge.db",
        "browser-profile/Cookies",
        ".cleanup-trash/20260101-000000/old.zip",
    ],
)
def test_paths_outside_the_cleanup_categories_are_rejected(
    client, data_dir, popen_calls, foreign_path
):
    """白名单之外的首段一律 400：清理清单里不会出现它们。"""
    _write(data_dir, foreign_path)

    response = _reveal(client, foreign_path)

    assert response.status_code == 400
    detail = response.json()["detail"]
    for key in ("backups", "auto-backups", "logs"):
        assert key in detail
    assert popen_calls == []


def test_a_link_pointing_outside_the_data_dir_is_rejected(client, data_dir, popen_calls):
    """符号链接/junction 逃逸：字符串上没有 ``..``，但 resolve 之后落在数据目录之外。"""
    outside_dir = data_dir.parent / "outside-of-data-dir"
    _write(outside_dir, "secret.db")
    _link_dir(outside_dir, data_dir / "backups" / "escape-dir")

    response = _reveal(client, "backups/escape-dir/secret.db")

    assert response.status_code == 400
    assert "数据目录" in response.json()["detail"]
    assert popen_calls == []


def test_a_link_into_another_cleanup_category_is_rejected(client, data_dir, popen_calls):
    """链接指向另一类目录同样拒绝：解析后的首段必须仍在白名单里。"""
    _write(data_dir, "user_files/copy.bin")
    _link_dir(data_dir / "user_files", data_dir / "backups" / "sneaky")

    response = _reveal(client, "backups/sneaky/copy.bin")

    assert response.status_code == 400
    detail = response.json()["detail"]
    for key in ("backups", "auto-backups", "logs"):
        assert key in detail
    assert popen_calls == []


# ---------------------------------------------------------------------------
# 文件已经不在：404，且 detail 只写原因（引导由前端 errorGuidance 负责）
# ---------------------------------------------------------------------------


def test_a_cleaned_up_file_returns_404_with_a_reason_only(client, popen_calls):
    response = _reveal(client, "backups/gone.zip")

    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail == "文件已被移走或删除"
    # 后端不写「请…」：引导（建议做什么 + 请求编号）由前端 errorGuidance 统一给。
    assert "请" not in detail
    assert popen_calls == []


def test_a_directory_is_not_a_revealable_file(client, data_dir, popen_calls):
    (data_dir / "logs").mkdir(parents=True, exist_ok=True)

    response = _reveal(client, "logs")

    assert response.status_code == 404
    assert popen_calls == []


# ---------------------------------------------------------------------------
# 隐私：响应里不回绝对路径
# ---------------------------------------------------------------------------


def test_the_response_never_leaks_the_absolute_path(client, data_dir, popen_calls, monkeypatch):
    _write(data_dir, "backups/old.zip")
    monkeypatch.setattr(system_reveal.sys, "platform", "win32")

    response = _reveal(client, "backups/old.zip")

    assert response.status_code == 200
    assert str(data_dir) not in response.text
    assert "backups/old.zip" not in response.text


# ---------------------------------------------------------------------------
# 启动失败（文件管理器不可用）：400 而不是 500，且不回传原始异常文本
# ---------------------------------------------------------------------------


def test_a_broken_file_manager_returns_400_without_leaking_details(client, data_dir, monkeypatch):
    _write(data_dir, "backups/old.zip")

    def _boom(_args, *extra, **kwargs):  # noqa: ANN001, ANN002, ANN003, ARG001
        raise OSError("SYNTHETIC_PRIVATE_SYSTEM_PATH")

    monkeypatch.setattr(system_reveal, "subprocess", types.SimpleNamespace(Popen=_boom))

    response = _reveal(client, "backups/old.zip")

    assert response.status_code == 400
    assert "SYNTHETIC_PRIVATE_SYSTEM_PATH" not in response.text
    assert "请" not in response.json()["detail"]


# ---------------------------------------------------------------------------
# 纯函数层：命令拼装与「谁被调用了」分开断言
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("platform", "expected"),
    [
        ("win32", ["explorer", "/select,{path}"]),
        ("darwin", ["open", "-R", "{path}"]),
        ("linux", ["xdg-open", "{parent}"]),
    ],
)
def test_reveal_command_for_each_platform(monkeypatch, tmp_path, platform, expected):
    target = tmp_path / "logs" / "backend.log"
    monkeypatch.setattr(system_reveal.sys, "platform", platform)

    command = system_reveal.reveal_command(target)

    rendered = [part.format(path=target, parent=target.parent) for part in expected]
    assert command == rendered
