# SPDX-License-Identifier: Apache-2.0
"""跨引擎对拍（草稿浏览器 vs 服务端 PDF）共用的 Chromium harness。

**为什么需要一个独立模块而不是在两个测试文件里各写一份**：`test_cross_engine_height.py`
与 `test_export_page_parity_browser.py`（2026-10-22 从 `test_export_page_parity.py` 拆出，
原文件越过 500 行预算；纯服务端的页边距/响应头断言留在原文件）回答的是同一个问题
（"浏览器排出来的和服务端排出来的
是不是同一份东西"），只是量的对象不同（内容高度 / 页数与溢出标志）。两边如果各起一个
浏览器、各自写一遍"加载 HTML、等字体、等两帧"，就会出现"一个文件修了等待逻辑、另一个
没修"的漂移——而这类漂移表现得像"跨引擎结果不稳定"，排查方向会被完全带偏。

环境缺失时的行为（刻意写成"跳过并说出真实原因"，不要静默变绿）：

* playwright 包本身没装 → ``pytest.importorskip`` 跳过；
* 包在、但 Chromium 二进制缺失 / 版本对不上（``launch()`` 抛 ``Error``）→ ``pytest.skip``
  并把异常原文带出来。

2026-10-21 起本机可用的组合：后端 playwright 1.63.0 ↔ ``%LOCALAPPDATA%/ms-playwright``
下的 chromium-1248。此前后端 pin 的是 1.55.0（期望 chromium-1187），launch 直接报
"Executable doesn't exist"，于是整个浏览器对拍被 skip 掉了——**版本不匹配不是环境不可用**，
升级后端 playwright 就够了。
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from app.schemas.resume import ResumeContent

# 与前端预览同口径的页面几何（见 frontend/src/components/resume-preview/config.ts）：
# A4 = 210mm × 297mm，96dpi 下 210mm = 793.7px、297mm = 1122.5px。视口取整到 794×1123
# 是浏览器的常见做法；模板里 body 的尺寸单位是 mm，实际布局仍按 793.7 / 1122.5 走。
VIEWPORT = {"width": 794, "height": 1123}
DEVICE_SCALE_FACTOR = 1
LOCALE = "zh-CN"

# 1px = 0.264583mm（96dpi：25.4 / 96 = 0.2645833…）。与 PDF 侧的 mm 对拍时用它换算。
MM_PER_PX = 0.264583

_ASSETS_DIR = Path(__file__).parent / "assets"
MEASURE_LAYOUT_JS = (_ASSETS_DIR / "measure_layout.js").read_text(encoding="utf-8")

# 等字体就位后再等两帧：第一帧提交新的行高，第二帧让 `getBoundingClientRect()` 读到
# 稳定的几何。只等 `document.fonts.ready` 不够——中文字体是**本地**字体，有时在
# fonts.ready 兑现之后仍有一帧的排版回调没跑完。
_SETTLE_JS = """async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}"""


@pytest.fixture(scope="function")
def chromium_page() -> Iterator[Any]:
    """每个用例起一只 Chromium + 一个固定环境的页面，用完立刻关掉。

    缺失时 skip 并把真实原因写进报告（``pytest.importorskip`` / ``pytest.skip``）。
    固定视口 / 缩放 / 地区：跨引擎对拍只允许版式差异，不允许环境差异。

    **必须是 function 作用域，不能回到 session**（2026-10-22 实测）：playwright 的
    sync API 在同一个线程里跑自己的 asyncio 循环，会话级夹具会让那个循环活到整个
    测试进程结束，于是**此后每一个 ``async def`` 用例**都拿不到自己的循环，报
    ``RuntimeError: Cannot run the event loop while another loop is running``。
    症状极具误导性——失败全落在 ``test_writing_selection`` / ``test_webform_*`` 这些
    和浏览器毫无关系的地方，单个文件跑又全绿，一次全量能带出 300+ 个假失败。
    代价只是每个对拍用例多一次浏览器启动（约 0.6s），换来的是任意顺序都干净。
    """
    sync_api = pytest.importorskip(
        "playwright.sync_api",
        reason="未安装 playwright（pip install -r backend/requirements-dev.txt 后重试）",
    )
    with sync_api.sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch()
        except sync_api.Error as exc:  # 浏览器二进制缺失 / 版本不匹配
            pytest.skip(f"Chromium 起不来，浏览器对拍未验证；真实原因：{type(exc).__name__}: {exc}")
            raise AssertionError("unreachable") from exc
        context = browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=DEVICE_SCALE_FACTOR,
            locale=LOCALE,
        )
        page = context.new_page()
        try:
            yield page
        finally:
            context.close()
            browser.close()


def load_document(page: Any, html: str) -> None:
    """把导出的 HTML 装进页面并等到版式稳定（导航 → load → 字体 → 两帧）。

    **必须先 ``goto("about:blank")``**（2026-10-21 实测）：``set_content`` 走的是
    ``document.open/write/close``，当页面**已经**是 ``complete`` 状态时，它会在新内容
    的 ``load`` 事件之前就返回；于是"监听 load 再测量"的模板探针
    （``_resume_fit_script.j2``）在第二次及以后的文档上**根本没有跑**，``body.dataset``
    全是空值。表现像是"跨引擎对拍时有时无"，其实是同一个页面被复用时才出现。
    先做一次真实导航把 readyState 重置，``load`` 才会重新触发。
    """
    page.goto("about:blank")
    page.set_content(html, wait_until="load")
    page.evaluate(_SETTLE_JS)


def measure_layout(page: Any, page_limit: int) -> dict[str, float]:
    """用镜像自 ``resumeLayoutMeasure.ts`` 的脚本量一页版面（单位：px）。"""
    result = page.evaluate(f"({MEASURE_LAYOUT_JS})({int(page_limit)})")
    if not isinstance(result, dict):
        raise AssertionError(
            f"measure_layout.js 返回了 null：body 不可用或内容区高度非正（page_limit={page_limit}）"
        )
    return {
        "used_height": float(result["usedHeight"]),
        "page_content_height": float(result["pageContentHeight"]),
    }


def measure_layout_stable(
    page: Any,
    page_limit: int,
    *,
    tolerance_mm: float = 0.2,
) -> dict[str, float]:
    """连续量两次，差 < ``tolerance_mm`` 才认；否则再量一次，仍抖就 fail。

    抖动意味着"这次量到的不是最终版式"（字体回退、异步样式未落），在这种读数上
    比较跨引擎差异，得到的差值里混着噪声，指不出真正的排版漂移。所以宁可失败，
    也要把两次的读数打印出来——**不重试到"看起来稳"为止**。
    """
    readings = [measure_layout(page, page_limit)]
    for _ in range(2):
        readings.append(measure_layout(page, page_limit))
        if (
            abs(readings[-1]["used_height"] - readings[-2]["used_height"]) * MM_PER_PX
            < tolerance_mm
        ):
            return readings[-1]
    detail = " / ".join(f"{reading['used_height']:.2f}px" for reading in readings)
    pytest.fail(
        "浏览器测量不稳定：连续三次读到的正文高度差超过 "
        f"{tolerance_mm}mm（{detail}）——版面还没稳定，本次对拍结论无效。"
    )
    raise AssertionError("unreachable")


def read_preview_probe(page: Any) -> dict[str, str | None]:
    """读模板内 ``_resume_fit_script.j2`` 写在 ``body.dataset`` 上的探针结果。

    该脚本在 ``body.dataset.previewColumns === "1"``（预览切成多列）时会**故意不写**，
    因为分列后 ``body.scrollHeight`` 只剩一页高、量出来没有意义。所以这里必须确认
    当前是单列状态；读到 ``None`` 就是"探针没跑"，要如实报错而不是当成空值。
    """
    return page.evaluate(
        """() => ({
          pages: document.body.dataset.pages ?? null,
          overflow: document.body.dataset.overflow ?? null,
          measured: document.body.dataset.measured ?? null,
          previewColumns: document.body.dataset.previewColumns ?? null,
        })"""
    )


def parity_resume() -> ResumeContent:
    """跨引擎对拍用的确定性中文简历：无照片、无随机、长度接近一页。

    **刻意不复用** ``test_export_golden`` 的样本：那份样本被金样指纹钉住，任何为了调
    阈值而改一个字的动作都会同时动到金样基线——两个守卫互相绑架，最后只能一起放宽。

    版式上的分寸：classic / 14mm 下正文约 238mm（一页可用 269mm），modern 下约 258mm
    （约 96%）。再长一点就会在 modern 下溢出，再短一点则量不出折行差异。
    """
    return ResumeContent(
        name="陈书航",
        phone="13900001234",
        email="chen.shuhang@example.com",
        city="南京",
        job_intent="高级后端开发工程师",
        summary=(
            "六年后端开发经验，长期负责交易与结算系统的架构设计和稳定性治理，"
            "熟悉分布式事务与高并发场景下的容量规划。"
        ),
        education=[
            {
                "school": "南京理工大学",
                "major": "计算机科学与技术",
                "degree": "本科",
                "start_date": "2014-09",
                "end_date": "2018-06",
            }
        ],
        experience=[
            {
                "company": "云栖数据科技有限公司",
                "role": "高级后端工程师",
                "start_date": "2020-03",
                "end_date": "2024-08",
                "description": [
                    "负责结算核心链路的架构设计与落地，覆盖订单幂等、对账补偿与差错处理，"
                    "单日处理流水峰值达到一千二百万笔。",
                    "主导分库分表与冷热分离改造，把主库写入压力降低约六成，"
                    "迁移期间保持零故障、零资损。",
                    "推动接口契约评审与灰度发布流程落地，核心链路全年可用性达到四个九。",
                ],
            },
            {
                "company": "启明网络技术有限公司",
                "role": "后端工程师",
                "start_date": "2018-07",
                "end_date": "2020-02",
                "description": [
                    "参与统一网关与配额管理服务开发，负责鉴权、限流与灰度放量模块，"
                    "把网关平均响应时间从九十毫秒压到三十五毫秒。",
                    "建设接口级监控与告警看板，覆盖四十余个核心接口，"
                    "故障平均定位时间从半小时缩短到五分钟。",
                ],
            },
            {
                "company": "远山软件工作室",
                "role": "开发实习生",
                "start_date": "2017-07",
                "end_date": "2018-06",
                "description": [
                    "参与内部工单系统开发，负责表单引擎与导出模块，"
                    "独立完成六个业务表单的配置化改造。",
                ],
            },
        ],
        projects=[
            {
                "name": "异步任务调度平台",
                "role": "负责人",
                "tech_stack": ["Python", "Go", "Redis"],
                "description": [
                    "面向内部三十余个业务方提供延时任务与失败重试能力，支撑每日百万级任务调度。",
                ],
                "highlights": [
                    "设计两级时间轮与幂等补偿，任务平均触发延迟控制在五十毫秒以内。",
                ],
            }
        ],
        skills=[
            {"name": "Python", "level": "精通"},
            {"name": "Go", "level": "熟练"},
            {"name": "Redis", "level": "熟练"},
            {"name": "MySQL", "level": "熟练"},
            {"name": "Kafka", "level": "熟悉"},
        ],
    )
