# SPDX-License-Identifier: Apache-2.0
"""退出接口的边界测试。

成功路径**不能真的调用**（那会把 pytest 自己关掉），所以这里用两层保护：
- 非回环请求必须被 403 拦住；
- 回环请求只会启动一个"停止线程"，测试把它替换成记录用的空函数，验证线程确实被创建。

另外守一件曾经真出过事的行为：**退出路径绝不允许抛异常**。停前端的子进程一旦抛
（找不到解释器、超时、输出解码失败），退出线程就会死在发信号之前——用户看到的是
"点了退出，进程还在"，而日志里什么都没有。
"""
import subprocess
import time

import pytest
from app.api import system as system_api
from app.database import SessionLocal, get_db
from app.main import app
from app.services.diagnostics import record_event
from fastapi.testclient import TestClient


def test_shutdown_rejects_non_loopback_clients():
    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app, client=("192.168.1.20", 50000)) as remote:
            response = remote.post("/api/system/shutdown")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 403
    assert "本机" in response.json()["detail"]


def test_shutdown_from_loopback_starts_the_stopper(monkeypatch, client):
    calls: list[str] = []
    monkeypatch.setattr("app.api.system._stop_process", lambda: calls.append("stopped"))

    response = client.post("/api/system/shutdown")

    assert response.status_code == 202
    assert response.json()["status"] == "stopping"
    # 线程真的被创建并跑起来了（否则"点了退出却没反应"又会回来）。
    deadline = time.time() + 2
    while not calls and time.time() < deadline:
        time.sleep(0.05)
    assert calls == ["stopped"]


class _CompletedRun:
    """``subprocess.run`` 的替身：只回我们要看的字段。"""

    def __init__(self, returncode: int = 0, stdout: bytes = b"", stderr: bytes = b""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_stopping_the_frontend_uses_a_hidden_console(monkeypatch):
    """Windows 上必须用 `CREATE_NO_WINDOW`——**不是** `DETACHED_PROCESS`。

    实测过的那次故障：分离进程没有控制台，而 Windows PowerShell 是控制台宿主程序，
    脚本压根没跑起来；输出又被丢掉，于是"点了退出，vite 还在跑"且无迹可寻。
    """
    if system_api.os.name != "nt":
        pytest.skip("只有 Windows 用 PowerShell 停止器")
    captured: dict = {}

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return _CompletedRun()

    monkeypatch.setattr(system_api.subprocess, "run", fake_run)

    system_api._stop_frontend_process()

    flags = captured["kwargs"]["creationflags"]
    assert flags & subprocess.CREATE_NO_WINDOW
    assert not flags & subprocess.DETACHED_PROCESS
    # 只停前端：停后端会把它自己（当前进程）一起带走，优雅退出就没机会跑了。
    assert captured["command"][-1] == "-SkipBackend"
    # 同步等：拿到退出码与输出才能判断成功与否。
    assert captured["kwargs"]["timeout"] > 0
    assert captured["kwargs"]["capture_output"] is True


def test_stopping_the_frontend_never_raises(monkeypatch):
    """子进程怎么失败都不能把异常抛出去——抛了后端就不退了。"""
    failures = [
        subprocess.TimeoutExpired(cmd="stop", timeout=1),
        OSError("找不到解释器"),
        RuntimeError("谁知道呢"),
    ]
    for failure in failures:
        def fake_run(*_args, __failure=failure, **_kwargs):
            raise __failure

        monkeypatch.setattr(system_api.subprocess, "run", fake_run)
        system_api._stop_frontend_process()  # 不抛即通过


def test_a_failed_stop_is_reported_not_swallowed(monkeypatch, caplog):
    """脚本非 0 退出要留下退出码与输出：上次故障最要命的一点就是"什么都没记"。"""
    monkeypatch.setattr(
        system_api.subprocess,
        "run",
        lambda *_args, **_kwargs: _CompletedRun(returncode=1, stderr="拒绝：记录对不上".encode()),
    )

    with caplog.at_level("WARNING"):
        system_api._stop_frontend_process()

    messages = [record.getMessage() for record in caplog.records]
    assert any("退出码 1" in message for message in messages), messages
    # 脚本自己的说法也要留下来（它是"记录对不上"还是"taskkill 失败"，只有它知道）。
    assert any("记录对不上" in message for message in messages), messages


# ===== 停止命令按平台选脚本（macOS / Linux 各一份）=====


def test_stop_command_uses_the_linux_script_on_linux(monkeypatch):
    """Linux 必须走仓库里那份 **Linux** 停止脚本，不能借 macOS 的。

    macOS 脚本把状态目录写死成 ``$HOME/Library/Application Support/ResumeForge``，
    Linux 上按那个路径去找启动记录永远找不到，于是「点退出」会静默地什么都不停
    ——前端还活着，页面却已经没有后端了。

    这里只能用 ``sys.platform`` 模拟：``os.name`` 是只读的（Windows 上恒为 ``nt``）。
    ``_stop_script()`` 因此把 linux 判定排在 windows 之前，否则这条断言在 CI 的
    Windows 机上永远绿不了（也就永远测不到）。
    """
    monkeypatch.setattr(system_api.sys, "platform", "linux")

    assert system_api._stop_command() == [
        "/bin/bash",
        str(system_api._LINUX_STOP_SCRIPT),
        "--skip-backend",
    ]


def test_the_linux_script_lives_under_the_repo_root():
    """路径按 ``_MACOS_STOP_SCRIPT`` 那一套从仓库根推出，而不是一个相对路径。"""
    assert system_api._LINUX_STOP_SCRIPT == (
        system_api._PROJECT_ROOT / "scripts" / "linux" / "stop.sh"
    )


def test_stop_command_keeps_the_macos_script_as_the_fallback(monkeypatch):
    """非 win32、非 linux（darwin）仍然走 macOS 脚本：兜底一个字都没变。"""
    if system_api.os.name == "nt":
        pytest.skip("Windows 上 os.name 恒为 nt，模拟不出 macOS 分支")
    monkeypatch.setattr(system_api.sys, "platform", "darwin")

    assert system_api._stop_command() == [
        "/bin/bash",
        str(system_api._MACOS_STOP_SCRIPT),
        "--skip-backend",
    ]


def test_a_missing_linux_script_only_warns(monkeypatch, tmp_path, caplog):
    """``scripts/linux/stop.sh`` 还没落盘时：只记一条警告，**不**去执行 bash。

    存在性守卫与停止命令必须看同一个文件。守卫看 macOS 脚本、实际执行的却是 Linux
    脚本时，Linux 上会一路走到 bash 报 "No such file"，日志里留下一条与真实原因无关
    的失败；而退出本身还得继续（前端没停掉也要让后端正常退出）。
    """
    monkeypatch.setattr(system_api.sys, "platform", "linux")
    monkeypatch.setattr(system_api, "_LINUX_STOP_SCRIPT", tmp_path / "stop.sh")
    commands: list[list[str]] = []
    monkeypatch.setattr(
        system_api.subprocess, "run", lambda *args, **_kwargs: commands.append(args[0])
    )

    with caplog.at_level("WARNING"):
        system_api._stop_frontend_process()

    assert commands == []
    messages = [record.getMessage() for record in caplog.records]
    assert any("找不到停止脚本" in message for message in messages), messages


def test_stop_output_from_a_console_codepage_can_be_read_back():
    """按控制台代码页编码的输出要能读出来——**候选表由用例给出，不靠这台机器**。

    第一版用 locale 解，在 `PYTHONUTF8=1` 下 locale 也是 utf-8，得到的是一串问号，
    日志等于白记；所以真实候选表里显式排了 `mbcs`。但那条链只能在**中文** Windows 上
    把 GBK 读回来：英文 Windows 的 ANSI 代码页是 cp1252，它会把同一串字节解成乱码而
    **不报错**，于是"能不能读出来"变成了"跑测试的是哪国机器"（CI 的 windows-latest
    正是英文的，2026-10-01 因此红过一次）。断言回退链就显式给候选表。
    """
    gbk_output = "已停止 frontend。".encode("gbk")

    assert "已停止 frontend" in system_api._decode_stop_output(gbk_output, ("utf-8", "gbk"))


def test_stop_output_never_breaks_the_shutdown_path(monkeypatch, caplog):
    """无论控制台是什么代码页：不抛，而且这条动作要留下日志。

    只断言**我们自己写的那半句**（脚本输出在英文 Windows 上可能是乱码，那是诊断信息
    的瑕疵，不是故障：判定一律看退出码，不解析文本）。
    """
    monkeypatch.setattr(
        system_api.subprocess,
        "run",
        lambda *_args, **_kwargs: _CompletedRun(stdout="已停止 frontend。".encode("gbk")),
    )

    with caplog.at_level("INFO"):
        system_api._stop_frontend_process()  # 不抛即通过

    messages = [record.getMessage() for record in caplog.records if record.levelname == "INFO"]
    assert any("已请求停止前端进程" in message for message in messages), messages


def test_diagnostics_endpoint_returns_redacted_runtime_events(client):
    record_event("test.system", control_count=3, value="private")

    response = client.get("/api/system/diagnostics")

    assert response.status_code == 200
    event = response.json()["events"][-1]
    assert event["event"] == "test.system"
    assert event["details"]["control_count"] == 3
    assert event["details"]["value"] == "<redacted>"


def test_form_reports_the_desktop_shell_when_the_shell_is_running(client, monkeypatch):
    """桌面壳注入 RF_DESKTOP_SHELL=1 → 前端必须看到 desktop=True。

    这是"桌面版不该出现下载 zip 并安装"的开关：桌面 payload 是源码形态整包，
    页面内覆盖安装补不齐 python-runtime.zip 之类的依赖，界面得改成引导用 Setup.exe。
    """
    monkeypatch.setenv("RF_DESKTOP_SHELL", "1")

    response = client.get("/api/system/form")

    assert response.status_code == 200
    body = response.json()
    assert body["desktop"] is True
    # 平台与版本号是给"从哪下载、装的是哪一版"用的，顺手一起钉住。
    assert body["platform"]
    assert body["app_version"]


def test_form_reports_a_non_desktop_run_without_the_env_flag(client, monkeypatch):
    """没有注入标记（控制台 start.cmd / 开发态 / 老桌面壳）→ 按非桌面处理。

    默认必须是"非桌面"：那是既有的、被验证过的应用内更新路径，宁可给控制台用户
    看到旧按钮，也不能把桌面用户默认推到一条补不齐依赖的路上。
    """
    monkeypatch.delenv("RF_DESKTOP_SHELL", raising=False)

    response = client.get("/api/system/form")

    assert response.status_code == 200
    assert response.json()["desktop"] is False


@pytest.mark.parametrize("flag", ["0", "false", "no", "", "  "])
def test_form_treats_non_truthy_flags_as_a_console_run(client, monkeypatch, flag):
    """只有明确说"是"才算桌面：空串、0、false 都不是。"""
    monkeypatch.setenv("RF_DESKTOP_SHELL", flag)

    assert client.get("/api/system/form").json()["desktop"] is False
