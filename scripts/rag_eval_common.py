# SPDX-License-Identifier: Apache-2.0
"""RAG 离线评测的公共设施：语料加载、确定性排序与指标计算（T0.2/T0.3）。

**为什么单独成模块**：评测集生成（`rag_eval_dataset.py`）与评测执行（`rag_eval_run.py`）
必须用**同一份**语料与同一套身份口径，否则 ground truth 的条目在两边对不上，评测数字
无法复现。所有函数都是纯函数（除了 `load_corpus` 要按 DATABASE_URL 读一次库）。

**指标定义**（与 `rag_eval_run.py` docstring 一致，这里是唯一实现）：

- `Recall@k = 命中种子条目数 / 种子条目总数`，逐组计算后按组取平均；
- `nDCG@10`：二值相关性，`DCG = Σ rel_i / log2(i+1)`（i 从 1 起），
  `IDCG = Σ_{i=1..min(|targets|,10)} 1/log2(i+1)`，nDCG = DCG / IDCG；
- `MRR`：第一个命中目标的名次的倒数（无命中记 0）；
- `section_coverage@10`：目标涉及的板块中，前 10 名覆盖到的板块占比（逐组平均）；
- `miss_rate@10 = 1 - Recall@10`：漏召回率，是 Phase 0 决策门的另一条判据。

**排序口径（确定性）**：候选 = 当前组参与分区里的全部列表型条目（含 skills；不含
basic_info / summary 两个单例）。每条按现有 `_score_item(item, section, focus)` 打分，
按 `(-score, 全局序)` 稳定排序；全局序 = 参与分区顺序 + 条目在库内顺序。这与生成链
"先打分再按分区截断"不同——离线评测只看**召回**，所以用全库联合排序做代理，这一点
必须在报告里如实写明。
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "backend"
FIXTURE_DIR = BACKEND_DIR / "tests" / "fixtures" / "rag_eval"
DEFAULT_SEED_DB = REPO_ROOT / "runtime" / "rag_eval" / "seed" / "resume_forge.db"
RUNTIME_DIR = REPO_ROOT / "runtime" / "rag_eval"
LLM_CACHE_DIR = RUNTIME_DIR / "llm_cache"

#: 排序语料只收列表型分区（单例分区没有"条目"可召回）。
SINGLETON_KEYS = frozenset({"basic_info", "summary"})
#: ground truth 只从"按岗位相关性筛条目"的分区里选：奖项不参与筛选
#: （`_select_entries` 对 awards 无条件返回）、skills 走 `_select_skills` 独立路径，
#: 两者都不在召回评测的适用范围内。
TARGET_SECTIONS = (
    "experiences",
    "projects",
    "campus_experiences",
    "publications",
    "research_projects",
    "patents",
    "credentials",
)


def configure_backend_env(db_path: Path) -> None:
    """在导入 `app` 之前把 DATABASE_URL 指向评测库（app.config 是导入期快照）。"""
    os.environ["DATABASE_URL"] = "sqlite:///" + Path(db_path).as_posix()
    os.environ.setdefault("LOG_FILE_ENABLED", "false")
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))


def load_corpus(db_path: Path = DEFAULT_SEED_DB) -> dict[str, Any]:
    """按当前组读取消费快照并展开成评测语料（需要 `configure_backend_env` 先执行）。"""
    from app import database
    from app.services.profile.ai_profile import load_ai_consumed_profile
    from app.services.profile.profile_context import build_consumed_data
    from app.services.profile.profile_relevance_constants import SECTION_PRIMARY_FIELDS

    with database.SessionLocal() as db:
        consumed = load_ai_consumed_profile(db)
        data = build_consumed_data(consumed)

    sections: dict[str, Any] = {}
    for key, section in consumed.sections.items():
        items = data.get(key)
        entries: list[dict[str, Any]] = []
        if isinstance(items, list):
            for index, (entry, item) in enumerate(zip(section.entries, items, strict=True)):
                entries.append(
                    {
                        "entry_id": entry.entry_id,
                        "index": index,
                        "item": item,
                        "primary_field": SECTION_PRIMARY_FIELDS.get(key, ""),
                        "primary_value": str(
                            item.get(SECTION_PRIMARY_FIELDS.get(key, ""), "")
                        ).strip(),
                    }
                )
        sections[key] = {
            "name": section.name,
            "form": section.form,
            "filter_by_job": bool(section.filter_by_job),
            "entries": entries,
        }
    return {
        "group_id": consumed.group_id,
        "group_name": consumed.group_name,
        "workspace_revision": consumed.workspace_revision,
        "participating_keys": list(consumed.participating_keys),
        "section_order": list(consumed.section_order),
        "sections": sections,
        "db_path": str(Path(db_path)),
    }


def canonical_entry_text(entry: dict[str, Any]) -> str:
    return json.dumps(entry["item"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def entry_digest(entry: dict[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_entry_text(entry).encode("utf-8")).hexdigest()


def corpus_digest(corpus: dict[str, Any]) -> str:
    """整份评测语料的稳定指纹：条目集合/文本变了，既有 ground truth 就不再可信。"""
    parts: list[str] = []
    for section in corpus["section_order"]:
        for entry in corpus["sections"].get(section, {}).get("entries") or []:
            parts.append(section + "\x1f" + canonical_entry_text(entry))
    return "sha256:" + hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def iter_ranking_entries(corpus: dict[str, Any]) -> list[dict[str, Any]]:
    """联合排序语料：参与分区顺序 + 条目顺序（稳定），只收列表型条目。"""
    result: list[dict[str, Any]] = []
    for section in corpus["section_order"]:
        meta = corpus["sections"].get(section) or {}
        if meta.get("form") in ("singleton", "basic_info"):
            continue
        if section in SINGLETON_KEYS:
            continue
        for entry in meta.get("entries") or []:
            result.append({"section_key": section, "entry": entry})
    return result


def skill_names(corpus: dict[str, Any]) -> list[str]:
    return [
        str(entry["item"].get("name", "")).strip()
        for entry in (corpus["sections"].get("skills") or {}).get("entries") or []
        if str(entry["item"].get("name", "")).strip()
    ]


def make_job_out(job: dict[str, Any]):
    """把 fixture 里的岗位字典转成 `JobOut`（生成链消费的真实类型）。"""
    from app.schemas.job import JobOut

    now = datetime.now(UTC)
    return JobOut(
        id=1,
        title=str(job.get("title") or ""),
        company=str(job.get("company") or ""),
        description=str(job.get("description") or ""),
        requirements=str(job.get("requirements") or ""),
        additional_info=str(job.get("additional_info") or ""),
        keywords=[],
        created_at=now,
        updated_at=now,
    )


def build_focus(job_out, corpus: dict[str, Any]):
    """生成链路同款 JobFocus：技能名只取当前组技能条目（F3/R-28）。"""
    from app.services.profile.profile_matching import build_job_focus

    return build_job_focus(job_out, skill_names=skill_names(corpus))


def focus_with_terms(focus, expansions: list[str] | tuple[str, ...]):
    """查询扩展的**唯一**落点：只合并进 terms，绝不进 skills（skills 是 12 分硬优先级）。"""
    from app.services.profile.profile_relevance_constants import JobFocus

    existing = {term.casefold() for term in focus.terms}
    merged = list(focus.terms)
    for term in expansions:
        text = str(term or "").strip()
        if not text or text.casefold() in existing:
            continue
        existing.add(text.casefold())
        merged.append(text)
    return JobFocus(skills=focus.skills, domains=focus.domains, terms=tuple(merged))


def rank_entries(focus, corpus: dict[str, Any]) -> list[dict[str, Any]]:
    """对联合语料做确定性排序（见模块 docstring 的排序口径）。"""
    from app.services.profile.profile_matching import _score_item

    scored: list[tuple[int, int, dict[str, Any]]] = []
    for order, row in enumerate(iter_ranking_entries(corpus)):
        entry = row["entry"]
        item = entry["item"]
        score = int(_score_item(item, row["section_key"], focus))
        scored.append((score, order, row))
    scored.sort(key=lambda value: (-value[0], value[1]))
    return [row for _score, _order, row in scored]


def match_targets(ranked: list[dict[str, Any]], targets: list[dict[str, Any]]) -> list[int | None]:
    """返回每个目标在排序里的 1-based 名次（没命中记 None）。

    目标身份 = (section_key, primary_field, 规范化后的 primary_value)：seed 资料集
    是确定性生成的，同一文本就是同一条；同时用 entry_digest 在加载时校验漂移。
    """
    positions: dict[tuple[str, str, str], int] = {}
    for rank, row in enumerate(ranked, start=1):
        entry = row["entry"]
        key = (
            row["section_key"],
            str(entry.get("primary_field") or ""),
            _normalize(str(entry.get("primary_value") or "")),
        )
        positions.setdefault(key, rank)
    result: list[int | None] = []
    for target in targets:
        key = (
            str(target["section_key"]),
            str(target.get("primary_field") or ""),
            _normalize(str(target.get("primary_value") or "")),
        )
        result.append(positions.get(key))
    return result


def _normalize(value: str) -> str:
    return "".join(value.split()).casefold()


def recall_at(positions: list[int | None], k: int) -> float:
    if not positions:
        return 0.0
    return sum(1 for pos in positions if pos is not None and pos <= k) / len(positions)


def ndcg_at(positions: list[int | None], k: int = 10) -> float:
    if not positions:
        return 0.0
    dcg = sum(1.0 / _log2(pos + 1) for pos in positions if pos is not None and pos <= k)
    idcg = sum(1.0 / _log2(i + 1) for i in range(1, min(len(positions), k) + 1))
    return dcg / idcg if idcg else 0.0


def mrr(positions: list[int | None]) -> float:
    hit = [pos for pos in positions if pos is not None]
    return 1.0 / min(hit) if hit else 0.0


def section_coverage(
    ranked: list[dict[str, Any]], targets: list[dict[str, Any]], k: int = 10
) -> float:
    """前 k 名对目标板块的覆盖：**板块内任意条目**进前 k 即算该板块被覆盖。

    **这是全仓唯一的 coverage 实现**：`rag_eval_run.py`、`rag_eval_embedding_spike.py`
    与报告 §5 必须调用它，禁止各自再写一份（否则 baseline 松口径 0.622 与 Phase 3
    紧口径 0.628 会被并排放进同一张表，不可比）。它刻意不等于"目标条目精确命中率"
    （那是 recall），只回答"这些板块有没有被召回覆盖到"。
    """
    target_sections = {str(target["section_key"]) for target in targets}
    if not target_sections:
        return 0.0
    reached = {row["section_key"] for row in ranked[:k]}
    return len(target_sections & reached) / len(target_sections)


def _log2(value: float) -> float:
    import math

    return math.log2(value)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def timestamp() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")
