# SPDX-License-Identifier: Apache-2.0
"""R40 用量任务类型守卫：每个任务类型都有中文/英文标签，协议码不漏到界面上。

「模型用量 → 按任务」按 ``task`` 字符串分组；前端通过
``frontend/src/features/resume/provenance/usageTaskLabels.ts`` 的
``TASK_TYPE_MESSAGE_KEY`` 把码翻译成文案。这条测试是硬判据（与
``test_assistant_knowledge_audit.py`` 读前端源文件静态断言同一手法）：

1. 账本侧每个 ``TASK_*`` 常量在前端映射表里都有条目（新增任务类型忘加标签会变红）；
2. 每个条目的词条在 zh-CN / en-US 两套 message 里都存在且非空——中文界面不漏协议码，
   英文界面也不漏（避免"英文界面显示中文或原码"）；
3. 统一 AI 任务（``models/ai_task.py`` 的 kind）每个都映射到已知账本任务名，
   ``/api/ai-tasks`` 后台调模型不再落成 unknown。
"""

from __future__ import annotations

import re
from pathlib import Path

from app.models.ai_task import AI_TASK_KINDS
from app.services.llm import usage_tasks

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
LABELS_TS = FRONTEND_DIR / "src" / "features" / "resume" / "provenance" / "usageTaskLabels.ts"
ZH_MESSAGES = FRONTEND_DIR / "src" / "i18n" / "messages" / "zh-CN.provenance.ts"
EN_MESSAGES = FRONTEND_DIR / "src" / "i18n" / "messages" / "en-US.provenance.ts"

_CJK = re.compile(r"[\u4e00-\u9fff]")


def _ledger_task_values() -> set[str]:
    """usage_tasks 模块里全部 TASK_* 常量的值（= 账本会出现的任务类型全集）。"""
    return {
        value
        for name, value in vars(usage_tasks).items()
        if name.startswith("TASK_") and isinstance(value, str)
    }


def _read_label_map() -> dict[str, str]:
    """从 usageTaskLabels.ts 提取「任务码 → i18n key」映射（文本正则，与前端同源）。"""
    text = LABELS_TS.read_text(encoding="utf-8")
    # unknown 沿用共用的 provenance.usage.unknown 词条，其余都是 task.* 专属词条。
    pairs = re.findall(r"([a-z_]+):\s*\"(provenance\.usage\.(?:task\.[A-Za-z]+|unknown))\"", text)
    return dict(pairs)


def _read_message_values(path: Path) -> dict[str, str]:
    """从 message 文件提取 key → 文案（扁平点分 key、单引号/双引号值都收）。"""
    text = path.read_text(encoding="utf-8")
    values: dict[str, str] = {}
    for match in re.finditer(
        r"\"(provenance\.usage\.(?:task\.[A-Za-z]+|unknown))\":\s*\"([^\"]+)\"", text
    ):
        values[match.group(1)] = match.group(2)
    return values


def test_settings_probe_is_a_registered_task_type():
    assert usage_tasks.TASK_SETTINGS_PROBE == "settings_probe"
    # 设置页路径仍不产生业务任务名：自检的落账靠端点显式 set_ambient_task。
    assert usage_tasks.task_for_path("/api/settings/llm/test") is None


def test_every_ledger_task_type_has_a_frontend_label():
    label_map = _read_label_map()
    missing = _ledger_task_values() - set(label_map)
    assert missing == set(), f"缺少前端标签的任务类型：{sorted(missing)}"


def test_every_task_label_exists_in_zh_and_en_and_differs():
    label_map = _read_label_map()
    zh = _read_message_values(ZH_MESSAGES)
    en = _read_message_values(EN_MESSAGES)
    for task, key in sorted(label_map.items()):
        assert zh.get(key, ""), f"zh-CN 缺少 {key}（任务 {task}）"
        assert en.get(key, ""), f"en-US 缺少 {key}（任务 {task}）"
        assert _CJK.search(zh[key]), f"{key} 的中文词条没有中文"
        assert not _CJK.search(en[key]), f"{key} 的英文词条混入了中文"
        assert zh[key] != en[key], f"{key} 的中英文案相同（像是从一边复制的）"


def test_every_ai_task_kind_maps_to_a_known_usage_task():
    mapped = {usage_tasks.task_for_ai_kind(kind) for kind in AI_TASK_KINDS}
    assert mapped <= _ledger_task_values(), f"映射出了未知任务名：{sorted(mapped)}"
    # 两种监管型之外的真实调用入口都必须有明确的任务名，不允许落 unknown。
    for kind in ("job_analysis", "resume_risk", "resume_rewrite", "webform_fill"):
        assert usage_tasks.task_for_ai_kind(kind) != usage_tasks.TASK_UNKNOWN
