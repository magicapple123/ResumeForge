# SPDX-License-Identifier: Apache-2.0
"""守卫：RF-02 第三批（ASR / 外部简历 / 调研）的三个入口把同步段交出了事件循环。

主守卫 ``test_async_route_thread_boundary.py`` 只做 AST 静态判断（"有没有 ``run_sync``"），
它区分不出"包了个壳但同步段仍在事件循环线程上跑"——那正是三条屏障用例要钉的东西：

1. ``transcribe.test_asr_profile``：**纯配置读 + 外部调用**。准备段要跑一次旧数据迁移
   并读已存配置（读库），随后 ``probe_asr_connection`` 是真发一段静音的远端调用。
2. ``external_resumes.upload_external_resume``：**读文件/落库 + 解析**。解析已经在
   ``run_in_threadpool`` 里，落库段（登记原件 + 建行 + 拼详情回显）必须也在 worker。
3. ``research.research_company``：**检索 + 模型**。准备段读搜索配置与 Key，中间两条
   网络路是协程，收尾还要记搜索用量（写库）。

做法与 ``tests/test_resume_route_boundary.py::test_risk_scan_prepare_runs_off_loop`` 一致：
直接调路由函数（不过 TestClient），把同步段换成一个屏障探针——记线程号 → 置 ``entered``
→ 等 ``release`` → **再调真实现**。所以断言的是真实路径，不是假实现。

**为什么这是证据而不是"耗时阈值"**：``release.wait()`` 只在事件循环线程能推进到
``release.set()`` 时才会返回。旧实现把同步段留在事件循环上时，``wait`` 会把事件循环
本身占住，3 秒后自己抛 ``AssertionError``——失败信息直接指出"事件循环被同步阶段占住"，
而不是某个玄学的耗时比较。

覆盖边界：三条只代表上面三个入口的形态，不代表本批全部 13 个文件已逐个验证；
``knowledge.search_knowledge`` / ``materials.upload_material_attachment`` 等入口由各自的
领域测试覆盖行为，线程边界靠主守卫的 AST 判据（0 违规）+ 这三个代表样本。
"""

from __future__ import annotations

import asyncio
import io
import threading
from typing import Any

import pytest
from app.api import external_resumes as external_api
from app.api import research as research_api
from app.api import transcribe as transcribe_api
from app.schemas.asr import AsrProfileTestRequest, AsrSettingsTestResult
from app.schemas.external_resume import ExternalResumeDetail
from app.schemas.research import ResearchCompanyRequest
from fastapi import UploadFile
from starlette.datastructures import Headers

# 事件循环所在的线程 = 跑 ``asyncio.run`` 的线程（与 pytest 主线程同一个）。
_LOOP_THREAD = threading.get_ident()

RESUME_TXT = "\n".join(
    [
        "张三",
        "手机：13800138000 邮箱：zhangsan@example.com",
        "负责后端接口开发，接口耗时下降 30%",
    ]
)


def _tid() -> int:
    """当前线程标识；只比对它，不用耗时阈值。"""
    return threading.get_ident()


def _spy_close(db: Any, sink: list[int]) -> None:
    """把 ``db.close`` 换成"先记线程再真关"：证明连接是从 worker 归还的。"""
    real_close = db.close

    def _close() -> None:
        sink.append(_tid())
        real_close()

    db.close = _close


def _upload(filename: str, content: bytes, content_type: str = "text/plain") -> UploadFile:
    """真的 ``UploadFile``（内存缓冲）：路由只用到 ``read()`` / ``filename`` / ``content_type``。"""
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=Headers({"content-type": content_type}),
    )


# ===== 1. 纯配置读 + 外部调用 =====


def test_asr_profile_prepare_runs_off_loop(
    monkeypatch: pytest.MonkeyPatch, db_session: Any
) -> None:
    """``_prepare_profile_probe`` 在 worker 里跑，事件循环全程可推进。

    旧实现（同步段留在事件循环上）会卡死在 ``release.wait()`` 里 3 秒后抛错，失败信息
    就是那句"事件循环被同步阶段占住"。
    """
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    closed: list[int] = []
    real_prepare = transcribe_api._prepare_profile_probe

    def barrier_prepare(db: Any, profile_id: str, payload: AsrProfileTestRequest):  # noqa: ANN202
        threads["prepare"] = _tid()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("ASR 配置探测准备阶段等待放行超时：事件循环被同步阶段占住")
        # 放行后真跑一遍：真的跑旧数据迁移、真的解析（语义没有被假实现替换）。
        return real_prepare(db, profile_id, payload)

    async def fake_probe(**kwargs: Any) -> tuple[bool, str, int]:
        threads["probe"] = _tid()
        # 远端调用开始时请求连接必须已经归还，否则几十秒的探测会一直钉着它。
        assert closed, "探测开始前请求连接必须已经归还"
        return True, "", 42

    monkeypatch.setattr(transcribe_api, "_prepare_profile_probe", barrier_prepare)
    monkeypatch.setattr(transcribe_api, "probe_asr_connection", fake_probe)
    _spy_close(db_session, closed)

    payload = AsrProfileTestRequest(
        base_url="https://synthetic.invalid/v1", model="whisper-1", api_key="sk-synthetic"
    )

    async def scenario() -> AsrSettingsTestResult:
        task = asyncio.create_task(
            transcribe_api.test_asr_profile(  # type: ignore[arg-type]
                "new", payload, db_session
            )
        )
        assert await asyncio.to_thread(entered.wait, 3.0), "ASR 探测准备阶段没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    result = asyncio.run(scenario())

    assert threads["prepare"] != _LOOP_THREAD, "ASR 探测准备段仍在事件循环线程上执行"
    assert threads["probe"] == _LOOP_THREAD, "探测是协程，应在事件循环线程上等 IO"
    assert closed == [threads["prepare"]], "请求连接应由同一个 worker 归还，而不是事件循环"
    assert result.ok is True
    assert result.latency_ms == 42


# ===== 2. 读文件 / 落库 + 解析 =====


def test_external_resume_persist_runs_off_loop(
    monkeypatch: pytest.MonkeyPatch, db_session: Any
) -> None:
    """解析在 ``run_in_threadpool``，落库段在 ``run_sync``——两段都不在事件循环上。

    ``_persist_upload`` 必须在会话还活着时把详情 DTO 物化好：``row`` 一旦跨线程带回
    事件循环，任何一个没加载过的列都会在 ``_detail_of`` 里抛 ``DetachedInstanceError``。
    所以这里断言的是**真实落库结果**（正文提取到了、行真的建了），而不是"函数被调过"。
    """
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    real_persist = external_api._persist_upload

    def barrier_persist(db: Any, raw: bytes, **kwargs: Any):  # noqa: ANN202
        threads["persist"] = _tid()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("外部简历落库段等待放行超时：事件循环被同步阶段占住")
        return real_persist(db, raw, **kwargs)

    monkeypatch.setattr(external_api, "_persist_upload", barrier_persist)
    upload = _upload("zhangsan.txt", RESUME_TXT.encode("utf-8"))

    async def scenario() -> ExternalResumeDetail:
        task = asyncio.create_task(
            external_api.upload_external_resume(  # type: ignore[arg-type]
                upload, name="", job_id=None, db=db_session
            )
        )
        assert await asyncio.to_thread(entered.wait, 3.0), "外部简历落库段没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    result = asyncio.run(scenario())

    assert threads["persist"] != _LOOP_THREAD, "外部简历落库段仍在事件循环线程上执行"
    assert isinstance(result, ExternalResumeDetail)
    # 展示名就是原文件名（去目录、截宽），说明详情回显是在会话活着时物化的。
    assert result.name == "zhangsan.txt"
    assert "负责后端接口开发" in result.text, "解析结果应原样带回响应，语义不能被搬运改掉"

    db_session.rollback()
    rows = db_session.query(external_api.ExternalResume).all()
    assert len(rows) == 1, "落库段是真的写进了库，而不是被探针替换成了空实现"


# ===== 3. 检索 + 模型 =====


def test_research_company_three_phases(monkeypatch: pytest.MonkeyPatch, db_session: Any) -> None:
    """准备（读配置 + Key）与收尾（记用量）都在 worker，两条网络路在事件循环。

    同时证明顺序：连接在模型/网络调用开始前就已归还——一次调研几十秒，不能一直占着
    一条池连接与它的读快照。
    """
    entered = threading.Event()
    release = threading.Event()
    threads: dict[str, int] = {}
    closed: list[int] = []
    real_load = research_api.load_research_runtime
    real_record = research_api.record_research_usage

    def barrier_load(db: Any, *, api_key: str | None = None):  # noqa: ANN202
        threads["prepare"] = _tid()
        entered.set()
        if not release.wait(3.0):
            raise AssertionError("公司调研准备阶段等待放行超时：事件循环被同步阶段占住")
        return real_load(db, api_key=api_key)

    async def fake_research(
        runtime: Any,
        *,
        company: str,
        role: str = "",
        jd: str = "",
        deep: bool = False,
        parts: tuple[str, ...] = ("cards", "brief"),
    ) -> dict[str, Any]:  # noqa: ANN401
        threads["research"] = _tid()
        assert closed, "网络/模型调用开始前请求连接必须已经归还"
        return {
            "company": company,
            "brief": {"status": "ok", "billed_searches": 0},
            "cards": {"sections": []},
            "sources": [],
            "notes": [],
            "deep": deep,
        }

    def spy_record(db: Any, brief: dict[str, Any]) -> None:
        threads["usage"] = _tid()
        real_record(db, brief)

    monkeypatch.setattr(research_api, "load_research_runtime", barrier_load)
    monkeypatch.setattr(research_api, "run_company_research_with", fake_research)
    monkeypatch.setattr(research_api, "record_research_usage", spy_record)
    _spy_close(db_session, closed)

    async def scenario() -> dict[str, Any]:
        task = asyncio.create_task(
            research_api.research_company(  # type: ignore[arg-type]
                ResearchCompanyRequest(company="腾讯", role="后端开发"), db_session
            )
        )
        assert await asyncio.to_thread(entered.wait, 3.0), "公司调研准备阶段没有开始"
        release.set()
        return await asyncio.wait_for(task, 5.0)

    result = asyncio.run(scenario())

    assert threads["prepare"] != _LOOP_THREAD, "公司调研准备段仍在事件循环线程上执行"
    assert threads["research"] == _LOOP_THREAD, "网络/模型调用是协程，应在事件循环线程上等 IO"
    assert threads["usage"] != _LOOP_THREAD, "记搜索用量是一次写库，必须回到 worker"
    assert closed == [threads["prepare"]], "请求连接应由同一个 worker 归还，而不是事件循环"
    assert result["company"] == "腾讯", "响应体应原样透传，语义不能被三段式改掉"
