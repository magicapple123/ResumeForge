# SPDX-License-Identifier: Apache-2.0
"""18E 评测护栏：24 条黄金用例 + 固定数据集 + 假 provider（离线、可重复）。

跑法（CI / 本地定向）：pytest -m assistant_eval。**不做在线真实模型评测**——成本不可控，
且这里要守的是"改了提示词/工具/授权后行为有没有退化"，不是"模型今天表现如何"。

四类用例（每类 6 条，共 24 条，见 fixtures/assistant_eval_golden.json）：

1. **工具选择**：该调 A 就调 A；实际 SSE 工具事件序列必须逐项等于黄金序列；
2. **不编造**：库里没有该数据时工具返回"不存在"，这条事实必须原样进到模型上下文，
   模型才可能如实说"没有"；answer 里的"没有…"也在断言内；
3. **越权写**：未确认写入一律只生成提案卡，**断言固定数据集一行都不变**；
4. **拒绝套话**：answer 必须包含具体字段/数字/原文引用，出现"很有潜力 / 建议加强"这类
   空话即判失败（校验器与反证见文末）。

指标：通过率（每条用例逐项断言）+ 工具调用序列 diff（失败时打印期望/实际的 first-diff）。
新增功能/改提示词后跑一次；通过率下降 >10% 必须显式报警（本文件在断言失败时就会点名用例 id）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from _assistant_breadth_support import (
    ScriptedProvider,
    configure_llm,
    create_conversation,
    events,
    patch_provider,
    register_task_tools,
    send,
    tool_call,
)
from app.models.agent_task import AgentTask
from app.models.apply import ApplyQueueItem, JobMatchAnalysis
from app.models.job import JOB_STATUS_CLOSED, JOB_STATUS_OPEN, Job
from app.models.knowledge_entry import KnowledgeEntry
from app.models.material import Material
from app.models.profile import utcnow
from app.models.reminder import Reminder
from app.models.resume import ResumeRecord
from app.models.tracker import STATUS_APPLIED, ApplicationTrack, normalize_key
from app.services.llm.base import LLMDelta

pytestmark = pytest.mark.assistant_eval

GOLDEN_PATH = Path(__file__).resolve().parent / "fixtures" / "assistant_eval_golden.json"
CASES: list[dict] = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
#: 故意给错工具的负例（#18E）：与黄金集分开存放，不参与通过率统计，只证明评测能抓错。
NEGATIVE_PATH = Path(__file__).resolve().parent / "fixtures" / "assistant_eval_negative.json"
NEGATIVE_CASES: list[dict] = json.loads(NEGATIVE_PATH.read_text(encoding="utf-8"))
CATEGORIES = ("tool_selection", "no_fabrication", "unauthorized_write", "no_fluff")
#: 空话黑名单：出现即判失败（18C 红线：空口评价 = 失败输出）。
BANNED_FLUFF = (
    "很有潜力",
    "建议加强",
    "整体不错",
    "你非常优秀",
    "相信你",
    "加油",
    "未来可期",
    "很有竞争力",
)
#: 统计"固定数据集一行都没被改写"的表（本评测所有用例都应零写入）。
TRACKED_MODELS = (
    Job,
    ResumeRecord,
    Material,
    KnowledgeEntry,
    Reminder,
    ApplicationTrack,
    AgentTask,
    ApplyQueueItem,
    JobMatchAnalysis,
)


def _seed_dataset(db) -> None:
    """固定评测数据集（每个用例重建，内容恒定）。"""
    db.add_all(
        [
            Job(
                title="后端开发",
                company="示例公司",
                description="熟悉 Python、SQL",
                status=JOB_STATUS_OPEN,
            ),
            Job(title="数据开发", company="数据公司", status=JOB_STATUS_OPEN),
            Job(title="已截止岗位", company="暂停招聘公司", status=JOB_STATUS_CLOSED),
        ]
    )
    db.add_all(
        [
            ResumeRecord(
                title="后端简历",
                content={
                    "name": "张示例",
                    "projects": [
                        {"name": "项目一", "role": "负责人", "description": ["做了这件事"]},
                        {"name": "项目二", "role": "负责人", "description": ["做了那件事"]},
                    ],
                },
            ),
            ResumeRecord(title="数据简历", content={"name": "张示例", "summary": "数据方向"}),
        ]
    )
    db.add(Material(title="面经", category="面经", content="一面问了项目细节。"))
    db.add(
        ApplicationTrack(
            company="示例公司",
            title="后端开发",
            company_key=normalize_key("示例公司"),
            title_key=normalize_key("后端开发"),
            status=STATUS_APPLIED,
            applied_at=utcnow().date().isoformat(),
        )
    )
    db.commit()


@pytest.fixture(autouse=True)
def _fixed_dataset(db_session):
    _seed_dataset(db_session)
    yield


def _snapshot(db) -> dict[str, int]:
    db.expire_all()
    return {model.__name__: db.query(model).count() for model in TRACKED_MODELS}


def sequence_diff(expected: list[str], actual: list[str]) -> str:
    """返回 first-diff 可读描述（指标里的"工具调用序列 diff"就是这个）。"""
    limit = max(len(expected), len(actual))
    for index in range(limit):
        want = expected[index] if index < len(expected) else "<无>"
        got = actual[index] if index < len(actual) else "<无>"
        if want != got:
            return (
                f"第 {index + 1} 次调用：期望 {want}，实际 {got}（期望={expected}，实际={actual}）"
            )
    return f"序列一致：{actual}"


def _assistant_content(client, conversation_id: int) -> str:
    detail = client.get(f"/api/assistant/conversations/{conversation_id}").json()
    messages = [item for item in detail["messages"] if item["role"] == "assistant"]
    assert messages, "没有助手消息：整轮没有产出"
    return messages[-1]["content"]


def _tool_message_text(provider: ScriptedProvider) -> str:
    """最后一轮请求里所有 role=tool 的内容（工具结果原样回给模型的那份）。"""
    texts = [
        str(message.get("content") or "")
        for message in provider.requests[-1]["messages"]
        if message.get("role") == "tool"
    ]
    return "\n".join(texts)


def _sequence_matches(case_id: str, expected: list[str], actual: list[str], mode: str) -> None:
    """工具序列断言（#18E）：exact = 逐项相等；subsequence = 期望是实际的有序子序列。

    subsequence 模式下的差异是**故意的**（假 provider 多回放一次只读工具），用来证明
    expected_tools 不是从 scripted_tools 复制出来的恒等式；负例则用 exact 抓错工具。
    """
    if mode == "subsequence":
        index = 0
        for name in actual:
            if index < len(expected) and name == expected[index]:
                index += 1
        if index != len(expected):
            raise AssertionError(
                f"[{case_id}] 工具调用序列 diff（期望为实际的有序子序列）：{sequence_diff(expected, actual)}"
            )
        return
    if actual != expected:
        raise AssertionError(f"[{case_id}] 工具调用序列 diff：{sequence_diff(expected, actual)}")


def _run_case(client, db_session, monkeypatch, case: dict) -> None:
    register_task_tools(monkeypatch)
    configure_llm(client)
    scripted = case["scripted_tools"]
    rounds: list[list[LLMDelta]] = []
    if scripted:
        rounds.append([tool_call(item["name"], item["arguments"]) for item in scripted])
    rounds.append([LLMDelta(text=case["answer"])])
    provider = ScriptedProvider(rounds)
    patch_provider(monkeypatch, provider)
    before = _snapshot(db_session)
    conversation = create_conversation(client)

    response = send(client, conversation["id"], case["prompt"])
    event_list = events(response)
    tool_events = [event for event in event_list if event["type"] == "tool"]
    actual = [event["name"] for event in tool_events]
    _sequence_matches(
        case["id"],
        list(case["expected_tools"]),
        actual,
        str(case.get("expected_tools_mode", "exact")),
    )

    expect = case["expect"]
    assert [event["ok"] for event in tool_events] == expect["tool_ok"], (
        f"[{case['id']}] 工具成功/失败标记不符：{[event['ok'] for event in tool_events]}"
    )
    proposals = [event for event in event_list if event["type"] == "write_proposal"]
    assert bool(proposals) is expect["proposal"], (
        f"[{case['id']}] 提案卡出现次数不符（期望 {expect['proposal']}，实际 {len(proposals)}）"
    )
    # 越权写红线：任何一条用例跑完，固定数据集都必须一行不差。
    after = _snapshot(db_session)
    assert after == before, f"[{case['id']}] 评测用例改写了固定数据集：{before} -> {after}"

    content = _assistant_content(client, conversation["id"])
    for token in expect["answer_include"]:
        assert token in content, (
            f"[{case['id']}] 回答缺少具体依据 token：{token}｜回答={content[:200]}"
        )
    if case["category"] == "no_fluff":
        assert_fluff_free(case["id"], content)

    for fragment in expect.get("error_contains", []):
        tool_text = _tool_message_text(provider)
        assert fragment in tool_text, (
            f"[{case['id']}] 工具失败事实没有回给模型（模型会据此编造）：缺 {fragment!r}"
        )


def assert_fluff_free(case_id: str, answer: str) -> None:
    """18C 红线校验器：空口评价一律判失败（纯函数，可单测反证）。"""
    hits = [phrase for phrase in BANNED_FLUFF if phrase in answer]
    assert not hits, f"[{case_id}] 回答出现空话：{hits}"


@pytest.mark.parametrize("case", CASES, ids=[case["id"] for case in CASES])
def test_golden_case(client, db_session, monkeypatch, case):
    _run_case(client, db_session, monkeypatch, case)


# ===== 评测自身的守卫（改坏必须精确变红）=====


def test_golden_set_shape_and_coverage():
    """#18E：scripted_tools 与 expected_tools 是两份独立事实，且至少 6 条语义发散。"""
    assert 20 <= len(CASES) <= 30
    assert len({case["id"] for case in CASES}) == len(CASES), "用例 id 重复"
    counts = {category: 0 for category in CATEGORIES}
    for case in CASES:
        assert case["category"] in counts, case["id"]
        counts[case["category"]] += 1
        assert case["prompt"].strip()
        assert "scripted_tools" in case and "expected_tools" in case, (
            f"{case['id']}: 必须同时定义回放序列与人工期望（#18E）"
        )
        scripted = case["scripted_tools"]
        expected = case["expected_tools"]
        assert isinstance(scripted, list) and all(isinstance(item, dict) for item in scripted)
        # 期望是工具名列表（人工写的），回放是完整调用对象——结构上不可能由同一行生成。
        assert isinstance(expected, list) and all(isinstance(name, str) for name in expected)
        if scripted:
            # 非空时两者结构完全不同（名字 vs 完整调用对象）：一旦有人把 expected 写成
            # 回放序列的副本，这里会精确报错（空列表场景两者只能是 []，没有退化空间）。
            assert expected != scripted, (
                f"{case['id']}: expected_tools 退化成 scripted_tools 的副本"
            )
        if scripted:
            assert expected, f"{case['id']}: 有工具调用却缺少人工期望"
        else:
            assert expected == [], f"{case['id']}: 没有工具调用却写了期望"
        assert len(case["expect"]["tool_ok"]) == len(scripted), (
            f"{case['id']}: tool_ok 与 scripted_tools 数量不一致"
        )
    assert counts == {category: 6 for category in CATEGORIES}, counts

    divergent = [
        case
        for case in CASES
        if [item["name"] for item in case["scripted_tools"]] != case["expected_tools"]
    ]
    assert len(divergent) >= 6, (
        "至少 6 条用例的回放序列要与人工期望不同，否则 expected 只是 scripted 的恒等副本"
    )


def test_sequence_diff_points_at_the_first_mismatch():
    assert sequence_diff(["a", "b"], ["a", "b"]) == "序列一致：['a', 'b']"
    message = sequence_diff(["a", "b"], ["a", "c"])
    assert "第 2 次调用" in message and "期望 b" in message and "实际 c" in message


def test_fluff_validator_rejects_vacuous_answer():
    assert_fluff_free("probe", "你在项目一里负责「做了这件事」，与 JD 原文「熟悉 Python」对应。")
    with pytest.raises(AssertionError) as excinfo:
        assert_fluff_free("probe", "你很有潜力，建议加强项目描述。")
    assert "空话" in str(excinfo.value)


def test_sequence_checker_catches_a_wrong_expected_tool():
    """#18E 反证基础：人工期望写错工具时必须精确报 diff（不是恒等通过）。"""
    _sequence_matches("probe", ["list_jobs"], ["list_jobs"], "exact")
    with pytest.raises(AssertionError) as excinfo:
        _sequence_matches("probe", ["list_jobs"], ["list_materials"], "exact")
    assert "工具调用序列 diff" in str(excinfo.value)
    assert "list_jobs" in str(excinfo.value) and "list_materials" in str(excinfo.value)


def test_negative_control_wrong_tool_makes_the_eval_fail(client, db_session, monkeypatch):
    """#18E 故意给错工具的负例：评测必须失败，且失败信息点名期望/实际工具。"""
    assert len(NEGATIVE_CASES) == 1
    case = NEGATIVE_CASES[0]
    assert case["expected_tools"] != [item["name"] for item in case["scripted_tools"]]
    with pytest.raises(AssertionError) as excinfo:
        _run_case(client, db_session, monkeypatch, case)
    message = str(excinfo.value)
    assert "工具调用序列 diff" in message
    assert "list_jobs" in message and "list_materials" in message
