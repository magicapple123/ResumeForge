# SPDX-License-Identifier: Apache-2.0
"""诊断包导出的守卫：zip 内容、脱敏兜底、文件名。"""

import io
import json
import os
import re
import subprocess
import zipfile
from pathlib import Path

import pytest
from app.api import system as system_api
from app.main import app
from app.services.diagnostics import record_event
from fastapi.testclient import TestClient

client = TestClient(app)

# 后端日志尾部（backend-recent.log）与桌面壳两份日志同为"日志类"成员：预览报的
# bytes 必须等于包里这份成员的真实大小，用户才会相信"预览说的=包里有的"。
_LOG_MEMBERS = {"backend-recent.log", "desktop-main.log", "desktop-backend.log"}


def test_export_diagnostics_returns_zip_with_expected_members():
    response = client.get("/api/system/diagnostics/export")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert response.headers["content-disposition"].startswith(
        'attachment; filename="resumeforge-diagnostics-'
    )
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    assert {"diagnostics.json", "system.json"} <= names
    payload = json.loads(archive.read("diagnostics.json").decode("utf-8"))
    assert "events" in payload
    system = json.loads(archive.read("system.json").decode("utf-8"))
    assert system["app_version"]


def test_recent_log_tail_redacts_token_like_strings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """日志尾部进诊断包前必须抹掉疑似令牌；这是给支持者看的最后一道闸。"""
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    (log_dir / "backend.log").write_text(
        "2026-10-07 INFO [app.api] [request_id=abc] 请求处理完成\n"
        "2026-10-07 INFO [app.llm] [request_id=abc] using key sk-abcdef1234567890abcdef\n"
        "2026-10-07 INFO [app.x] [request_id=abc] blob "
        "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path)
    tail = system_api._recent_log_tail()
    assert "请求处理完成" in tail
    assert "sk-abcdef1234567890abcdef" not in tail
    assert "<redacted>" in tail
    assert "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2" not in tail


def test_recent_log_tail_missing_file_is_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path)
    assert system_api._recent_log_tail() == ""


def test_preview_reports_metadata_without_event_bodies():
    """导出前预览：只有元信息（条数/时间范围/类别/文件体积），不返回事件正文。"""
    record_event("test.preview", note="合成内容")

    response = client.get("/api/system/diagnostics/preview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["event_count"] >= 1
    assert payload["time_range"] is not None
    assert "test.preview" in payload["categories"]
    assert {item["name"] for item in payload["files"]} >= {"diagnostics.json", "system.json"}
    assert all(item["bytes"] > 0 for item in payload["files"])
    assert payload["contains_resume_content"] is False
    assert "不包含简历全文" in payload["note"]
    # 预览不应把事件正文（note 的值）带回给页面。
    assert "合成内容" not in response.text


def test_exported_zip_contains_no_contact_info_or_secrets():
    """负例钉住口径（RF-20 验收）：注入合成联系方式/密钥后，导出 zip 里找不到原值。"""
    contact_like = "mail zhangsan@example.com phone 13800138000 key sk-abcdef1234567890"
    record_event("test.negative", path=f"/resumes?q={contact_like}")

    response = client.get("/api/system/diagnostics/export")

    archive = zipfile.ZipFile(io.BytesIO(response.content))
    members = archive.namelist()
    # zip 成员白名单：只有脱敏事件、系统信息、（可选）后端日志尾部与（可选，
    # 仅桌面形态）桌面壳的两份日志，别无其它。
    assert set(members) <= {
        "diagnostics.json",
        "system.json",
        "backend-recent.log",
        "desktop-main.log",
        "desktop-backend.log",
    }
    # zip 是压缩存储的：逐成员解压后再做"无原值"断言。
    blob = "\n".join(archive.read(name).decode("utf-8", errors="replace") for name in members)
    for secret in ("zhangsan@example.com", "13800138000", "sk-abcdef1234567890"):
        assert secret not in blob
    # 脱敏后的占位符确实在包里，证明事件走了清洗路径而不是被整个丢弃。
    assert "<redacted>" in blob


def test_desktop_shell_logs_are_added_by_their_original_names(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """桌面壳的两份日志按**原名**进诊断包（RF_DESKTOP_LOG_DIR）。

    "后端起不来"时这个端点本身不可达，所以它们的价值恰恰在于：能在**起得来**的那
    一次导出里，把上一次起不来的证据带出去（desktop-main.log 里是壳的判断，
    desktop-backend.log 里是后端自己的 traceback）。
    """
    desktop_logs = tmp_path / "runtime" / "logs"
    desktop_logs.mkdir(parents=True)
    (desktop_logs / "desktop-main.log").write_text(
        "2026-10-22T10:00:00.000Z whenReady reached\n"
        "2026-10-22T10:00:01.000Z backend start failed: Error: spawn ENOENT "
        "key sk-abcdef1234567890abcdef\n",
        encoding="utf-8",
    )
    (desktop_logs / "desktop-backend.log").write_text(
        "Traceback (most recent call last):\nModuleNotFoundError: No module named 'uvicorn'\n",
        encoding="utf-8",
    )
    # 同目录的轮转文件与其它运行产物不能进包：只点读那两个名字，不递归整个目录。
    (desktop_logs / "desktop-backend.log.1").write_text("rotated\n", encoding="utf-8")
    (desktop_logs / "unrelated.log").write_text("noise\n", encoding="utf-8")
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(desktop_logs))
    # 后端自己的日志指到空目录，断言只落在桌面日志上。
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path / "data")

    response = client.get("/api/system/diagnostics/export")

    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    assert {"desktop-main.log", "desktop-backend.log"} <= names
    assert "desktop-backend.log.1" not in names, "轮转文件不该进包"
    assert "unrelated.log" not in names, "只允许点读这两个名字"
    main_log = archive.read("desktop-main.log").decode("utf-8")
    assert "spawn ENOENT" in main_log
    assert "sk-abcdef1234567890abcdef" not in main_log, "桌面日志同样要过脱敏闸"
    assert "<redacted>" in main_log
    assert "No module named 'uvicorn'" in archive.read("desktop-backend.log").decode("utf-8")

    # 预览与导出必须说同一件事：预览里列出的文件就是包里真正有的文件。
    preview = client.get("/api/system/diagnostics/preview").json()
    assert {"desktop-main.log", "desktop-backend.log"} <= {
        item["name"] for item in preview["files"]
    }


def test_desktop_logs_are_absent_without_the_env_var(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """未注入 RF_DESKTOP_LOG_DIR（控制台 / 纯后端 / 开发态）时行为完全不变。"""
    monkeypatch.delenv("RF_DESKTOP_LOG_DIR", raising=False)

    assert system_api._desktop_log_entries() == []
    # 目录不存在（打包态卸载后残留的配置）也不能抛。
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(tmp_path / "does-not-exist"))
    assert system_api._desktop_log_entries() == []


# --- 边界：零差异、损坏输入、体积窗口、路径边界、预览与包一致 -------------------
#
# 上面几条钉的是"功能能用"，这一段钉的是"功能不越界"：注入变量之前的包必须一个
# 成员都不多（顺序也不能变）、坏目录/坏文件/超大文件都不能让导出 500、脱敏之后
# 预览报的体积必须等于包里真实的大小。


def _zip_members() -> list[str]:
    """导出一次，返回 zip 成员名**按顺序**的列表。"""
    response = system_api.export_diagnostics()
    assert response.status_code == 200
    return zipfile.ZipFile(io.BytesIO(response.body)).namelist()


def _preview_names() -> list[str]:
    return [item["name"] for item in system_api.preview_diagnostics()["files"]]


def _write_backend_log(tmp_path: Path) -> Path:
    """造一份后端日志并把它指成当前 DATA_DIR，让 backend-recent.log 也参与顺序断言。"""
    data_dir = tmp_path / "data"
    (data_dir / "logs").mkdir(parents=True)
    (data_dir / "logs" / "backend.log").write_text("2026-10-22 INFO boot\n", encoding="utf-8")
    return data_dir


def test_desktop_logs_change_nothing_when_the_env_is_unset(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """未注入 RF_DESKTOP_LOG_DIR 时，预览与导出的条目集合/顺序与改动前逐字一致。

    "零差异"必须是可执行的断言而不是口头承诺：本功能只在**追加**两个成员，落回
    未注入的场景时列表应当还是原来那 3 条（后端日志存在时）或 2 条（不存在时）。
    """
    monkeypatch.setattr(system_api, "DATA_DIR", _write_backend_log(tmp_path))
    monkeypatch.delenv("RF_DESKTOP_LOG_DIR", raising=False)

    expected = ["diagnostics.json", "system.json", "backend-recent.log"]
    assert _preview_names() == expected
    assert _zip_members() == expected

    # 后端日志也没有的时候，只剩两个固定成员（与旧实现的 2 条基线一致）。
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path / "no-logs")
    assert _preview_names() == ["diagnostics.json", "system.json"]
    assert _zip_members() == ["diagnostics.json", "system.json"]


def test_desktop_logs_are_appended_after_the_existing_members(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """注入目录后只是**追加**在两个固定成员（与可选的后端日志）之后，顺序不变。"""
    monkeypatch.setattr(system_api, "DATA_DIR", _write_backend_log(tmp_path))
    logs = tmp_path / "desktop-logs"
    logs.mkdir()
    (logs / "desktop-main.log").write_text("main line\n", encoding="utf-8")
    (logs / "desktop-backend.log").write_text("backend line\n", encoding="utf-8")
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(logs))

    expected = [
        "diagnostics.json",
        "system.json",
        "backend-recent.log",
        "desktop-main.log",
        "desktop-backend.log",
    ]
    assert _preview_names() == expected
    assert _zip_members() == expected


def test_desktop_logs_survive_missing_or_broken_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """目录里什么都没有 / 空文件 / 文件位置被目录占住 / 非 UTF-8 字节都不许炸。"""
    monkeypatch.setattr(system_api, "DATA_DIR", tmp_path / "no-logs")
    logs = tmp_path / "desktop-logs"
    logs.mkdir()
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(logs))

    # 1) 目录存在但两个名字都不存在。
    assert system_api._desktop_log_entries() == []

    # 2) 空文件：不能变成 bytes=0 的空条目。
    (logs / "desktop-main.log").write_text("", encoding="utf-8")
    assert system_api._desktop_log_entries() == []
    assert "desktop-main.log" not in _preview_names()

    # 3) 只有换行：不抛异常，最多留一个无信息量的极短条目（不丢"这次启动过"的痕迹）。
    (logs / "desktop-main.log").write_text("\n\n\n", encoding="utf-8")
    blank = dict(system_api._desktop_log_entries()).get("desktop-main.log", "")
    assert blank.strip() == ""

    # 4) 名字被一个目录占住：open() 抛 IsADirectoryError，必须被当成"读不到"。
    (logs / "desktop-main.log").unlink()
    (logs / "desktop-main.log").mkdir()
    assert system_api._desktop_log_entries() == []

    # 5) 非 UTF-8 字节：replace 解码，坏字节不阻断导出。
    (logs / "desktop-main.log").rmdir()
    (logs / "desktop-main.log").write_bytes(b"before \xff\xfe broken\n")
    entries = dict(system_api._desktop_log_entries())
    assert "broken" in entries["desktop-main.log"]
    assert _zip_members()[:3] == ["diagnostics.json", "system.json", "desktop-main.log"]

    # 6) env 指向一个普通文件（不是目录）：按"没有目录"处理。
    not_a_dir = tmp_path / "file-not-dir"
    not_a_dir.write_text("x", encoding="utf-8")
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(not_a_dir))
    assert system_api._desktop_log_entries() == []


def test_blank_env_value_is_treated_as_unset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """空白值必须 strip 成"未设置"——否则 ``Path("   ")`` 会变成当前目录。"""
    for value in ("", "   ", "\t\n"):
        monkeypatch.setenv("RF_DESKTOP_LOG_DIR", value)
        assert system_api._desktop_log_entries() == [], f"空白值 {value!r} 不该被当成目录"


def test_oversized_desktop_log_is_tailed_on_a_line_boundary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """>256KB 的日志只取尾部，且首行必须是**完整**行（截断处的残行要丢掉）。"""
    logs = tmp_path / "desktop-logs"
    logs.mkdir()
    line_count = 4000
    # 每行 127 字节（含换行）→ 约 496KB，超过 256KB 的字节窗口。行内带空格：
    # 连续 48+ 个字母数字会被 ``_LOG_SECRET_PATTERNS`` 当成随机串抹掉，那就测不到
    # "首行是否完整"了（这也顺带证明脱敏是按行生效的）。
    lines = [f"{index:05d} " + "abcd efgh " * 12 for index in range(1, line_count + 1)]
    source = logs / "desktop-main.log"
    source.write_text("\n".join(lines) + "\n", encoding="utf-8")
    assert source.stat().st_size > system_api._DESKTOP_LOG_MAX_BYTES
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(logs))

    content = dict(system_api._desktop_log_entries())["desktop-main.log"]
    tail = content.splitlines()

    assert len(tail) == system_api._DESKTOP_LOG_TAIL_LINES
    # 首行是完整的一行：编号从 3601 开始（4000 行取最后 400 行），且格式未残缺。
    assert re.fullmatch(r"\d{5} abcd efgh( abcd efgh){11} ", tail[0]), f"首行像是半行：{tail[0]!r}"
    assert tail[0] == lines[line_count - system_api._DESKTOP_LOG_TAIL_LINES]
    assert tail[-1] == lines[-1]
    # 体积上限：字节窗口 256KB，行数窗口 400 行，两个都不能被越过。
    assert len(content.encode("utf-8")) <= system_api._DESKTOP_LOG_MAX_BYTES
    # 最老的内容确实没被打包。
    assert "00001 " not in content


def test_short_line_desktop_log_is_capped_by_line_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """行很短时字节窗口用不满，行数窗口必须单独生效（否则包里会带进上千行）。"""
    logs = tmp_path / "desktop-logs"
    logs.mkdir()
    lines = [f"line {index}" for index in range(1000)]
    (logs / "desktop-main.log").write_text("\n".join(lines) + "\n", encoding="utf-8")
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(logs))

    tail = dict(system_api._desktop_log_entries())["desktop-main.log"].splitlines()
    assert len(tail) == system_api._DESKTOP_LOG_TAIL_LINES
    assert tail[0] == "line 600"
    assert tail[-1] == "line 999"


def test_desktop_log_redaction_and_preview_bytes_match_the_archive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """脱敏后的体积必须和包里真实大小一致：预览说多少，包里就是多少。

    脱敏会**改变**体积（``sk-…`` → ``<redacted>``），所以这条同时挡住一个很容易犯的
    错：预览按原始文件 stat 报大小、包里装的却是脱敏后的内容。
    """
    # 后端自己那份日志也放上，三个日志成员的"预览体积 == 包里体积"一起断言。
    monkeypatch.setattr(system_api, "DATA_DIR", _write_backend_log(tmp_path))
    (tmp_path / "data" / "logs" / "backend.log").write_text(
        "2026-10-22 INFO boot key sk-zzzzzzzzzzzzzzzzzzzz\n", encoding="utf-8"
    )
    logs = tmp_path / "desktop-logs"
    logs.mkdir()
    token = "sk-" + "A1b2C3d4E5f6G7h8I9j0"
    blob = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2xtbm9wcXJzdHV2"
    (logs / "desktop-main.log").write_text(
        f"2026-10-22T10:00:00.000Z boot ok\n"
        f"2026-10-22T10:00:01.000Z using key {token} token {blob}\n"
        f"2026-10-22T10:00:02.000Z done\n",
        encoding="utf-8",
    )
    (logs / "desktop-backend.log").write_text(
        "Traceback (most recent call last):\nModuleNotFoundError: No module named 'uvicorn'\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(logs))

    preview = system_api.preview_diagnostics()
    archive = zipfile.ZipFile(io.BytesIO(system_api.export_diagnostics().body))

    # 预览里的每个日志成员都能在包里找到，且 bytes == 解的压前真实大小。
    listed = {
        item["name"]: item["bytes"] for item in preview["files"] if item["name"] in _LOG_MEMBERS
    }
    assert set(listed) == {"backend-recent.log", "desktop-main.log", "desktop-backend.log"}
    for name, reported in listed.items():
        assert archive.getinfo(name).file_size == reported, f"{name} 的预览体积与包里不一致"
        assert len(archive.read(name)) == reported

    main_log = archive.read("desktop-main.log").decode("utf-8")
    assert token not in main_log, "形似 sk- 的令牌必须被抹掉"
    assert blob not in main_log, "长随机串必须被抹掉"
    assert "<redacted>" in main_log
    # 抹掉的是令牌本身，普通行必须还在（不能整段丢弃）。
    assert "boot ok" in main_log and "done" in main_log


def test_desktop_log_dir_with_dotdot_only_reads_the_two_fixed_names(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """含 ``..`` 的目录值不会越界：只点读那两个固定名字，不递归、不看上一层。"""
    root = tmp_path / "root"
    logs = root / "real" / "logs"
    logs.mkdir(parents=True)
    (logs / "desktop-main.log").write_text("main line\n", encoding="utf-8")
    (logs / "desktop-backend.log").write_text("backend line\n", encoding="utf-8")
    # 上一层与子目录里的同名文件都不得被读到。
    (logs.parent / "desktop-main.log").write_text("ESCAPED parent\n", encoding="utf-8")
    (logs / "nested").mkdir()
    (logs / "nested" / "desktop-main.log").write_text("ESCAPED nested\n", encoding="utf-8")

    raw = str(logs / ".." / "logs")
    assert ".." in raw, "用例本身要真的带上 '..' 才有意义"
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", raw)

    entries = dict(system_api._desktop_log_entries())
    assert set(entries) == {"desktop-main.log", "desktop-backend.log"}
    assert entries["desktop-main.log"] == "main line"
    assert "ESCAPED" not in json.dumps(entries, ensure_ascii=False)


def _make_dir_link(link: Path, target: Path) -> bool:
    """建一个指向目录的链接；Windows 上没权限时退回 junction。建不成就返回 False。

    两种形态对被测代码是同一件事（目录位置是个 reparse point）。退回 junction 是因为
    Windows 普通账户默认没有 SeCreateSymbolicLinkPrivilege——不退回的话这条边界用例
    在开发机上永远只是 skip。
    """
    try:
        link.symlink_to(target, target_is_directory=True)
        return True
    except (OSError, NotImplementedError):
        pass
    if os.name != "nt":
        return False
    # mklink 的输出走控制台码页（中文 Windows 是 cp936），所以按字节收、不解码，
    # 否则 reader 线程会抛 UnicodeDecodeError（提示里看起来像测试框架的问题）。
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link), str(target)],
        capture_output=True,
        check=False,
    )
    return result.returncode == 0 and link.is_dir()


def test_desktop_log_dir_symlink_is_followed_but_not_recursed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """目录本身是符号链接时跟随（这个值只由本机用户设置），但依然不递归。"""
    real = tmp_path / "real-logs"
    real.mkdir()
    (real / "desktop-main.log").write_text("via symlink\n", encoding="utf-8")
    (real / "nested").mkdir()
    (real / "nested" / "desktop-backend.log").write_text("ESCAPED nested\n", encoding="utf-8")
    link = tmp_path / "link-logs"
    if not _make_dir_link(link, real):
        pytest.skip("当前环境既不能建符号链接也不能建 junction")
    monkeypatch.setenv("RF_DESKTOP_LOG_DIR", str(link))

    entries = dict(system_api._desktop_log_entries())
    assert entries["desktop-main.log"] == "via symlink"
    assert "desktop-backend.log" not in entries, "子目录里的同名文件不能进包"
