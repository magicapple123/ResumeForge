# SPDX-License-Identifier: Apache-2.0
r"""RAG 离线评测集生成器（T0.2）：60 组「同义改写型 JD」× 种子条目 ground truth。

**数据来源**：`scripts/seed_test_dataset.py --check` 生成的真实形状资料库（13 个内置
板块、106 个小字段基本填满）。脚本不手搓假条目，只从这份资料库里**确定性地挑目标
条目**，再让 DeepSeek 为每组写一份"表达同样能力、但不用目标条目原词"的招聘 JD。

规格与校验规则（目标选择、泄漏判据、基线漏召回）在 `rag_eval_spec.py`；本文件只负责
LLM 调用（磁盘缓存、失败重试、并发补生成）与产物落盘。

**调用纪律**：DeepSeek 密钥只在进程内从应用既有全局配置（按机加密）读取，不落盘、
不打印；同一输入命中 `runtime/rag_eval/llm_cache/` 缓存，重跑不多花钱；总调用 ≤ 300。

用法（仓库根目录）：

    backend\.venv\Scripts\python.exe scripts\rag_eval_dataset.py --corpus
    backend\.venv\Scripts\python.exe scripts\rag_eval_dataset.py --generate
    backend\.venv\Scripts\python.exe scripts\rag_eval_dataset.py --fill
    backend\.venv\Scripts\python.exe scripts\rag_eval_dataset.py --refill
    backend\.venv\Scripts\python.exe scripts\rag_eval_dataset.py --verify
    backend\.venv\Scripts\python.exe scripts\rag_eval_dataset.py --inspect 10
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import rag_eval_common as common
from rag_eval_spec import (  # noqa: F401 - 规格/常量显式再导出，便于单文件阅读
    ARCHETYPES,
    BATCH_SIZE,
    DATASET_NAME,
    FIXTURE_FILE,
    MAX_FIX_ROUNDS,
    MAX_OUTPUT_TOKENS,
    _alternate_targets,
    _require_entry,
    ensure_corpus,
    pick_targets,
    validate_group,
)


def _llm_config():
    from app.services.global_llm_profiles import read_global_llm

    global_llm = read_global_llm()
    if global_llm is None or not global_llm.config.api_key:
        raise SystemExit("未找到已配置的 LLM（应用全局设置里没有可用配置），无法生成评测集")
    config = global_llm.config
    return (
        config.api_key,
        _openai_base(config.base_url),
        config.model or "deepseek-flash",
        config.timeout_seconds,
    )


def _openai_base(base_url: str) -> str:
    """统一走 OpenAI 兼容 /chat/completions（任务书 §8 的口径）。"""
    text = (base_url or "").strip().rstrip("/")
    for suffix in ("/responses", "/chat/completions"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
    return text or "https://api.deepseek.com"


def _cache_path(payload: dict[str, Any]) -> Path:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return common.LLM_CACHE_DIR / (hashlib.sha256(raw).hexdigest()[:32] + ".json")


class LlmCallError(RuntimeError):
    """LLM 调用最终失败（已重试）；由生成流程降级处理，不终止整个评测集生成。"""


def _build_payload(messages: list[dict[str, str]], max_tokens: int) -> dict[str, Any]:
    key, _base_url, model, _timeout = _llm_config()
    return {
        "model": model,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        "_key": key,
    }


def _cacheable(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if not key.startswith("_")}


async def chat_json_async(
    messages: list[dict[str, str]], *, max_tokens: int = MAX_OUTPUT_TOKENS
) -> dict[str, Any]:
    """异步调 LLM 并解析 JSON；失败重试 ≤2 次；同一输入命中磁盘缓存。

    并发只用于「补生成」，缓存键不含并发度信息，因此重跑仍然逐字节复用结果。
    """
    import httpx

    payload = _build_payload(messages, max_tokens)
    key = str(payload.pop("_key"))
    cache = _cache_path(_cacheable(payload))
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    _k, base_url, _model, timeout_seconds = _llm_config()
    last_error = ""
    for attempt in range(3):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    base_url + "/chat/completions",
                    json=_cacheable(payload),
                    headers={"Authorization": "Bearer " + key},
                    timeout=max(30.0, float(timeout_seconds)),
                )
            if response.status_code in (429, 500, 502, 503) and attempt < 2:
                await asyncio.sleep(1.5 * (attempt + 1))
                continue
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            data = _parse_json_object(content)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
            return data
        except Exception as exc:  # noqa: BLE001 - 失败重试，最终如实抛出
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < 2:
                await asyncio.sleep(1.5 * (attempt + 1))
    raise LlmCallError("LLM 调用失败（已重试 2 次）：" + last_error)


def chat_json(
    messages: list[dict[str, str]], *, max_tokens: int = MAX_OUTPUT_TOKENS
) -> dict[str, Any]:
    """同步包装（脚本侧单条调用）；并发补生成走 `chat_json_async`。"""
    return asyncio.run(chat_json_async(messages, max_tokens=max_tokens))


def _parse_json_object(content: str) -> dict[str, Any]:
    text = str(content or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"```\s*$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型没有返回 JSON 对象")
    return json.loads(text[start : end + 1])


# ===== 提示词与批量生成 =====


_DATASET_SYSTEM = (
    "你是招聘 JD 撰写专家，熟悉中文互联网岗位的真实招聘描述。你只输出 JSON，不输出解释。"
)


def _target_brief(target: dict[str, Any], corpus: dict[str, Any]) -> str:
    entry = _require_entry(corpus, target["section_key"], target["primary_value"])
    text = json.dumps(entry["item"], ensure_ascii=False, sort_keys=True)
    return f"- 板块 {target['section_key']}，条目标识「{target['primary_value']}」：{text}"


def _batch_prompt(
    archetype: str, role: str, groups: list[dict[str, Any]], corpus: dict[str, Any]
) -> list[dict[str, str]]:
    blocks: list[str] = []
    for group in groups:
        blocks.append(
            f"### {group['id']}\n" + "\n".join(_target_brief(t, corpus) for t in group["targets"])
        )
    return [
        {"role": "system", "content": _DATASET_SYSTEM},
        {
            "role": "user",
            "content": (
                "请为下面每个「候选人的真实经历组合」写一份招聘 JD，表达该岗位会要求的能力。\n"
                f"岗位族：{role}\n\n" + "\n\n".join(blocks) + "\n\n严格要求：\n"
                "1. 每组 JD 是独立的一份招聘信息，字段：title / description / requirements / "
                "additional_info；description 200–400 字，requirements 120–260 字，"
                "additional_info 可为空串；像真实招聘信息，不要写「候选人」「经历」这类元话语。\n"
                "2. **禁止出现目标条目里的任何原词**：不要出现条目中的公司/学校/社团/项目/"
                "论文/证书名称；不要出现条目里的英文技术栈或工具名（如 SQL、Python、Tableau、"
                "RFM、LightGBM、SHAP、Metabase、Excel、Hive 等）；不要出现条目里连续 4 个以上"
                "汉字组成的短语；不要出现条目里的具体数字（人数、百分比、金额、AUC 等）。\n"
                "3. 用同义词、上位词、跨语言说法或职责描述来传达同样的能力要求。例如条目写"
                "「按活跃度与消费频次切成 5 层、设计三档召回」，JD 可以写「负责用户分层运营，"
                "针对不同生命周期人群设计差异化触达策略」。\n"
                "4. 每组 rationale 一句话说明 JD 与这些经历的对应关系（不要求出现原词）。\n\n"
                '只输出 JSON：{"groups":[{"id":"g001","job":{"title":"…","description":"…",'
                '"requirements":"…","additional_info":""},"rationale":"…"}]}'
            ),
        },
    ]


# ===== 校验（泄漏 / 基线漏召回） =====


def generate(db_path: Path) -> dict[str, Any]:
    common.configure_backend_env(db_path)
    corpus = ensure_corpus(db_path)
    groups = pick_targets(corpus)
    generated: dict[str, dict[str, Any]] = {}
    by_archetype: dict[str, list[dict[str, Any]]] = {}
    for group in groups:
        by_archetype.setdefault(group["archetype"], []).append(group)
    roles = {archetype["key"]: archetype["role"] for archetype in ARCHETYPES}
    for archetype_key, batch in by_archetype.items():
        for start in range(0, len(batch), BATCH_SIZE):
            chunk = batch[start : start + BATCH_SIZE]
            try:
                _generate_batch(corpus, archetype_key, roles[archetype_key], chunk, generated)
            except LlmCallError as exc:
                # 单批失败不终止整份评测集：下一轮补生成只处理缺失组（已成功的走缓存）。
                print(f"batch failed archetype={archetype_key} size={len(chunk)}: {exc}")
    # 第二轮：并发补生成缺失组（首轮失败/模型漏返回）。
    _parallel_fill(
        corpus, [group for group in groups if group["id"] not in generated], roles, generated
    )
    # 第三轮：不合格组带着失败原因再补（≤ MAX_FIX_ROUNDS 轮）。
    for round_index in range(MAX_FIX_ROUNDS):
        invalid = {group_id: validate_group(generated[group_id], corpus) for group_id in generated}
        retry_groups = [group for group in groups if invalid.get(group["id"])]
        if not retry_groups:
            break
        print(f"fix round {round_index + 1}: {len(retry_groups)} groups")
        _parallel_fill(
            corpus,
            retry_groups,
            roles,
            generated,
            fix_notes={key: reasons for key, reasons in invalid.items() if reasons},
        )
    invalid = {group_id: validate_group(generated[group_id], corpus) for group_id in generated}
    for group in groups:
        if group["id"] not in generated:
            invalid[group["id"]] = ["模型未返回该组"]
    result_groups = [
        generated[group["id"]]
        for group in groups
        if group["id"] in generated and not invalid[group["id"]]
    ]
    dropped = {key: reasons for key, reasons in invalid.items() if reasons}
    payload = {
        "version": 1,
        "dataset": DATASET_NAME,
        "seed_db": str(db_path.relative_to(common.REPO_ROOT)).replace("\\", "/"),
        "corpus_digest": common.corpus_digest(corpus),
        "group_count": len(result_groups),
        "groups": result_groups,
        "dropped": dropped,
        "generated_at": common.timestamp(),
    }
    common.write_json(FIXTURE_FILE, payload)
    print(f"fixtures: {FIXTURE_FILE}")
    print(f"groups: {len(result_groups)} / {len(groups)}，dropped: {len(dropped)}")
    for key, reasons in dropped.items():
        print("  drop", key, "；".join(reasons[:3]))
    return payload


def _apply_group_payload(
    raw: dict[str, Any], by_id: dict[str, dict[str, Any]], generated: dict[str, dict[str, Any]]
) -> None:
    group_id = str(raw.get("id") or "").strip()
    if group_id not in by_id:
        return
    merged = dict(by_id[group_id])
    merged["job"] = {
        key: str((raw.get("job") or {}).get(key) or "").strip()
        for key in ("title", "description", "requirements", "additional_info")
    }
    merged["rationale"] = str(raw.get("rationale") or "").strip()
    generated[group_id] = merged


def _generate_batch(
    corpus: dict[str, Any],
    archetype_key: str,
    role: str,
    chunk: list[dict[str, Any]],
    generated: dict[str, dict[str, Any]],
) -> None:
    """首轮批量生成：只解析，不在这里重试（重试/补生成由并发轮次统一消化）。"""
    payload = chat_json(_batch_prompt(archetype_key, role, chunk, corpus))
    by_id = {group["id"]: group for group in chunk}
    for raw in payload.get("groups") or []:
        _apply_group_payload(raw, by_id, generated)


async def _fill_async(
    corpus: dict[str, Any],
    groups: list[dict[str, Any]],
    roles: dict[str, str],
    fix_notes: dict[str, list[str]] | None,
    concurrency: int,
) -> list[tuple[str, dict[str, Any] | None, str]]:
    semaphore = asyncio.Semaphore(concurrency)

    async def one(group: dict[str, Any]) -> tuple[str, dict[str, Any] | None, str]:
        async with semaphore:
            messages = _batch_prompt(group["archetype"], roles[group["archetype"]], [group], corpus)
            fix = (fix_notes or {}).get(group["id"])
            if fix:
                messages[-1]["content"] += (
                    "\n\n上一轮的不合格原因（请逐条修正，尤其不要复制目标条目里的词句/数字）：\n"
                    "- " + group["id"] + " 不合格：" + "；".join(fix[:3])
                )
            try:
                payload = await chat_json_async(messages)
            except LlmCallError as exc:
                return group["id"], None, str(exc)
            raws = payload.get("groups") or []
            if not raws:
                return group["id"], None, "模型未返回该组"
            return group["id"], raws[0], ""

    return list(await asyncio.gather(*(one(group) for group in groups)))


def _parallel_fill(
    corpus: dict[str, Any],
    groups: list[dict[str, Any]],
    roles: dict[str, str],
    generated: dict[str, dict[str, Any]],
    *,
    fix_notes: dict[str, list[str]] | None = None,
    concurrency: int = 6,
) -> None:
    """并发补生成（失败组/不合格组）；单组失败只记录，不终止整份评测集。"""
    if not groups:
        return
    results = asyncio.run(_fill_async(corpus, groups, roles, fix_notes, concurrency))
    by_id = {group["id"]: group for group in groups}
    for group_id, raw, error in results:
        if raw is None:
            print(f"fill failed {group_id}: {error}")
            continue
        _apply_group_payload(raw, by_id, generated)


def fill_dropped(db_path: Path) -> dict[str, Any]:
    """只补生成上次被剔除的组（带失败原因重写；仍不合格则如实保留在 dropped）。

    为什么单独一个入口：整份重跑会重新消耗已成功的调用（缓存能救，但固定组顺序
    之外的提示词会变），而"补生成"只对失败组花调用额度，也不会改写已合格的 JD。
    """
    fixture = common.read_json(FIXTURE_FILE)
    common.configure_backend_env(db_path)
    corpus = ensure_corpus(db_path)
    if common.corpus_digest(corpus) != fixture.get("corpus_digest"):
        raise SystemExit("语料指纹不匹配，不能增量补生成；请先 --generate 重跑")
    groups = pick_targets(corpus)
    by_id = {group["id"]: group for group in groups}
    generated = {group["id"]: group for group in fixture["groups"]}
    dropped = dict(fixture.get("dropped") or {})
    if not dropped:
        print("没有需要补生成的组")
        return fixture
    roles = {archetype["key"]: archetype["role"] for archetype in ARCHETYPES}
    pending = [by_id[group_id] for group_id in dropped if group_id in by_id]
    print(f"补生成 {len(pending)} 组（第 1 轮，带失败原因）")
    _parallel_fill(corpus, pending, roles, generated, fix_notes=dropped)
    still = {
        group_id: validate_group(generated[group_id], corpus)
        for group_id in dropped
        if group_id in generated
    }
    still = {key: reasons for key, reasons in still.items() if reasons}
    if still:
        stronger = {
            group_id: reasons
            + [
                "当前 JD 与目标条目用词/片段重复过多，请彻底改用同义、上位或跨语言表达，"
                "确保关键词匹配无法直接命中目标条目；也不要把目标条目的具体数字带进 JD。"
            ]
            for group_id, reasons in still.items()
        }
        print(f"补生成 {len(still)} 组（第 2 轮，加强改写）")
        _parallel_fill(
            corpus, [by_id[group_id] for group_id in still], roles, generated, fix_notes=stronger
        )
    valid_groups: list[dict[str, Any]] = []
    remaining: dict[str, list[str]] = {}
    for group in groups:
        group_id = group["id"]
        candidate = generated.get(group_id)
        reasons = validate_group(candidate, corpus) if candidate is not None else ["模型未返回该组"]
        if reasons:
            remaining[group_id] = reasons
            continue
        valid_groups.append(candidate)
    payload = dict(fixture)
    payload.update(
        {
            "corpus_digest": common.corpus_digest(corpus),
            "group_count": len(valid_groups),
            "groups": valid_groups,
            "dropped": remaining,
            "generated_at": common.timestamp(),
        }
    )
    common.write_json(FIXTURE_FILE, payload)
    print(f"fixtures: {FIXTURE_FILE}")
    print(f"groups: {len(valid_groups)} / {len(groups)}，dropped: {len(remaining)}")
    for key, reasons in remaining.items():
        print("  drop", key, "；".join(reasons[:3]))
    return payload


def refill_dropped(db_path: Path) -> dict[str, Any]:
    """把始终写不合格的组**换一组目标条目**重新生成（不是硬凑，也不降校验标准）。

    只对 dropped 组换目标：每组从同岗位族里取一组尚未使用的条目组合，重新让模型
    写 JD。已合格组一字不动；新 JD 仍要过同一套泄漏/基线漏召回校验。
    """
    fixture = common.read_json(FIXTURE_FILE)
    common.configure_backend_env(db_path)
    corpus = ensure_corpus(db_path)
    if common.corpus_digest(corpus) != fixture.get("corpus_digest"):
        raise SystemExit("语料指纹不匹配，不能增量补生成")
    groups = pick_targets(corpus)
    by_id = {group["id"]: group for group in groups}
    generated = {group["id"]: group for group in fixture["groups"]}
    dropped = dict(fixture.get("dropped") or {})
    if not dropped:
        print("没有需要补生成的组")
        return fixture
    used: set[tuple[tuple[str, str], ...]] = set()
    for group in groups:
        if group["id"] in generated:
            used.add(
                tuple(sorted((t["section_key"], t["primary_value"]) for t in group["targets"]))
            )
    roles = {archetype["key"]: archetype["role"] for archetype in ARCHETYPES}
    pending: list[dict[str, Any]] = []
    for group_id in dropped:
        spec = dict(by_id[group_id])
        alternates = _alternate_targets(corpus, spec["archetype"], used)
        if alternates is None:
            print(f"no alternate targets for {group_id}")
            continue
        spec["targets"] = alternates
        by_id[group_id] = spec
        pending.append(spec)
    print(f"换目标补生成 {len(pending)} 组（第 1 轮）")
    _parallel_fill(corpus, pending, roles, generated)
    still = {
        group_id: validate_group(generated[group_id], corpus)
        for group_id, _spec in ((g["id"], g) for g in pending)
        if group_id in generated
    }
    still = {key: reasons for key, reasons in still.items() if reasons}
    if still:
        print(f"换目标补生成 {len(still)} 组（第 2 轮，带失败原因）")
        _parallel_fill(
            corpus, [by_id[group_id] for group_id in still], roles, generated, fix_notes=still
        )
    valid_groups: list[dict[str, Any]] = []
    remaining: dict[str, list[str]] = {}
    for group in groups:
        group_id = group["id"]
        candidate = generated.get(group_id)
        reasons = validate_group(candidate, corpus) if candidate is not None else ["模型未返回该组"]
        if reasons:
            remaining[group_id] = reasons
            continue
        valid_groups.append(candidate)
    payload = dict(fixture)
    payload.update(
        {
            "group_count": len(valid_groups),
            "groups": valid_groups,
            "dropped": remaining,
            "generated_at": common.timestamp(),
        }
    )
    common.write_json(FIXTURE_FILE, payload)
    print(f"fixtures: {FIXTURE_FILE}")
    print(f"groups: {len(valid_groups)} / {len(groups)}，dropped: {len(remaining)}")
    for key, reasons in remaining.items():
        print("  drop", key, "；".join(reasons[:3]))
    return payload


def verify(db_path: Path) -> dict[str, Any]:
    payload = common.read_json(FIXTURE_FILE)
    common.configure_backend_env(db_path)
    corpus = ensure_corpus(db_path)
    digest = common.corpus_digest(corpus)
    if digest != payload.get("corpus_digest"):
        raise SystemExit("语料指纹不匹配：种子资料变了或 fixture 不是由当前库生成的")
    failures: list[str] = []
    for group in payload["groups"]:
        reasons = validate_group(group, corpus)
        if reasons:
            failures.append(f"{group['id']}: {'；'.join(reasons[:3])}")
    print(f"校验 {len(payload['groups'])} 组：失败 {len(failures)}")
    for failure in failures:
        print(" ", failure)
    return {"groups": len(payload["groups"]), "failures": failures}


def inspect(db_path: Path, count: int) -> None:
    payload = common.read_json(FIXTURE_FILE)
    for group in payload["groups"][:count]:
        print("=" * 78)
        print(group["id"], "|", group["archetype"], "|", group["job"]["title"])
        print("目标：")
        for target in group["targets"]:
            print("  -", target["section_key"], "→", target["primary_value"])
        print("JD：")
        print(group["job"]["description"])
        print("要求：")
        print(group["job"]["requirements"])
        print("对应关系：", group.get("rationale") or "")


def main() -> int:
    parser = argparse.ArgumentParser(description="生成/校验 RAG 离线评测集")
    parser.add_argument("--corpus-db", default=str(common.DEFAULT_SEED_DB))
    parser.add_argument("--corpus", action="store_true", help="只导出语料并打印统计")
    parser.add_argument("--generate", action="store_true", help="调用 LLM 生成 60 组 fixture")
    parser.add_argument("--fill", action="store_true", help="只补生成上次被剔除的组")
    parser.add_argument("--refill", action="store_true", help="给仍不合格的组换目标条目重生成")
    parser.add_argument("--verify", action="store_true", help="程序化校验既有 fixture")
    parser.add_argument("--inspect", type=int, default=0, metavar="N", help="打印前 N 组供人工抽检")
    args = parser.parse_args()
    db_path = Path(args.corpus_db)
    if not db_path.exists():
        raise SystemExit(f"评测库不存在：{db_path}；先跑 scripts/seed_test_dataset.py --check")
    if args.corpus:
        common.configure_backend_env(db_path)
        corpus = common.load_corpus(db_path)
        print(
            "group:",
            corpus["group_id"],
            corpus["group_name"],
            "revision:",
            corpus["workspace_revision"],
        )
        for section in corpus["section_order"]:
            meta = corpus["sections"][section]
            print(section, meta["form"], len(meta["entries"]))
        return 0
    if args.generate:
        generate(db_path)
        return 0
    if args.fill:
        fill_dropped(db_path)
        return 0
    if args.refill:
        refill_dropped(db_path)
        return 0
    if args.verify:
        verify(db_path)
        return 0
    if args.inspect:
        inspect(db_path, args.inspect)
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
