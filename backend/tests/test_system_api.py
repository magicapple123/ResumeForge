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
from fastapi.testclient import TestClient

from app.api import system as system_api
from app.database import SessionLocal, get_db
from app.main import app


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
        def fake_run(*_args, **_kwargs):
            raise failure

        monkeypatch.setattr(system_api.subprocess, "run", fake_run)
        system_api._stop_frontend_process()  # 不抛即通过


def test_a_failed_stop_is_reported_not_swallowed(monkeypatch, caplog):
    """脚本非 0 退出要留下退出码与输出：上次故障最要命的一点就是"什么都没记"。"""
    monkeypatch.setattr(
        system_api.subprocess,
        "run",
        lambda *_args, **_kwargs: _CompletedRun(returncode=1, stderr="拒绝：记录对不上".encode("utf-8")),
    )

    with caplog.at_level("WARNING"):
        system_api._stop_frontend_process()

    messages = [record.getMessage() for record in caplog.records]
    assert any("退出码 1" in message for message in messages), messages
    # 脚本自己的说法也要留下来（它是"记录对不上"还是"taskkill 失败"，只有它知道）。
    assert any("记录对不上" in message for message in messages), messages


def test_stop_output_from_a_non_utf8_console_still_gets_logged(monkeypatch, caplog):
    """子进程输出按控制台代码页编码（中文 Windows 上是 cp936）。

    两个要求：**不许抛**（抛了后端就不退了），而且**要能读懂**——第一版用 locale 解，
    在 `PYTHONUTF8=1` 下 locale 也是 utf-8，结果日志里是一串问号，等于白记。
    """
    gbk_output = "已停止 frontend。".encode("gbk")
    monkeypatch.setattr(
        system_api.subprocess,
        "run",
        lambda *_args, **_kwargs: _CompletedRun(stdout=gbk_output),
    )

    with caplog.at_level("INFO"):
        system_api._stop_frontend_process()  # 不抛即通过

    messages = [record.getMessage() for record in caplog.records if record.levelname == "INFO"]
    assert messages, "成功停止也要留下一条日志"
    if system_api.os.name == "nt":
        assert any("已停止 frontend" in message for message in messages), messages
