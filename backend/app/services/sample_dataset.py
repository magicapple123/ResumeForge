# SPDX-License-Identifier: Apache-2.0
"""体验示例数据集：一键载入纯虚构的小份数据，让新用户立刻"有的可看"。

新装用户的首页是空的：没有岗位、没有简历，所有功能都停在空态。这份示例数据只做
一件事——让引导结束的那一瞬间，**每个页面都有内容可看**（岗位、简历、资料箱、
知识库、面经/题库与网申资料都有内容）。

边界：纯虚构（不含真实个人数据、播种不发网络或模型调用）；独立数据集（主数据一个
字节都不碰，可整份删除）；幂等复用（同 seed_version 直接切回，reused=True，不重复新建）。
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .. import database
from ..dataset_registry import MAIN_DATASET_ID, DatasetError, read_metadata, write_metadata
from .data_backup import restore_directory
from .datasets import activate_dataset, create_dataset, import_dataset, list_datasets
from .sample_dataset_seeds import (
    _seed_interview_experience,
    _seed_jobs,
    _seed_knowledge,
    _seed_materials,
    _seed_question_bank,
    _seed_resumes,
    _seed_tracks,
    _seed_web_form_profile,
)

logger = logging.getLogger(__name__)

SAMPLE_DATASET_NAME = "体验示例"

# 播种内容的版本号：丰富化示例数据后递增。载入时按它判断「已存在的示例数据集
# 是否还是当前版本」——同版本直接复用（reused=True），旧版本走新建流程（旧数据集
# 原样保留，不就地升级：用户可能已经在那份示例上改过内容）。
#
# 3 = 示例简历补齐全部资料字段（性别 / 出生年 / 个人主页 / GitHub / 照片）。
# 只服务"没有内置包"的开发/测试环境；发布环境用包内容 hash 做版本（sample_seed_version）。
SAMPLE_SEED_VERSION = "3"

# 内置示例包（问题清单 §6.7：随包发布，不再保留降级到"代码播种"的发布路径）。
# 它是 scripts/seed_test_dataset.py 的生成物，**禁止手改**；改
# scripts/dataset_seed/** 后必须重新生成（见包目录 README 与测试里的计数守卫）。
_SAMPLE_PACK_RELATIVE = Path("assets") / "sample" / "sample_dataset.zip"


def _sample_pack_path() -> Path | None:
    """内置示例包路径；没有这个文件（开发/测试环境）时返回 None。

    测试用 monkeypatch.setattr 替换它来驱动两条路径（代码播种 / 包导入）。
    """
    path = Path(__file__).resolve().parents[1] / _SAMPLE_PACK_RELATIVE
    return path if path.is_file() else None


def _sample_pack_digest() -> str | None:
    """内置包的 sha256 前 12 位；包不存在时返回 None。

    用**内容 hash** 而不是 exported_at 做版本：重新生成时时间戳会变，内容没变就不该
    算新版本（否则每重新生成一次就多一份「体验示例」，清单 §6.4）。
    """
    path = _sample_pack_path()
    if path is None:
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()[:12]


def sample_seed_version() -> str:
    """当前示例数据的版本号：有内置包用 pack:<sha256 前 12>，否则代码播种版本。"""
    digest = _sample_pack_digest()
    return f"pack:{digest}" if digest is not None else SAMPLE_SEED_VERSION


def _find_reusable_sample_dataset() -> str | None:
    """已存在的「当前播种版本」示例数据集 id；旧版本/主数据不算。"""
    version = sample_seed_version()
    for dataset in list_datasets():
        dataset_id = dataset.get("id", "")
        if dataset_id == MAIN_DATASET_ID or dataset.get("source") != "sample":
            continue
        metadata = read_metadata(dataset_id)
        if metadata.get("seed_version") == version:
            return dataset_id
    return None


def load_sample_dataset(bind: Engine) -> dict[str, Any]:
    """载入「体验示例」数据集并切换过去；已存在同版本示例时直接复用。

    返回切换后的数据集描述（带 sample: True 标记）；reused 表示这次是**回到已有**的
    示例数据集而不是新建（前端据此把提示从"已创建"改成分流措辞，旧后端没有这个字段，
    前端按可选处理）。调用方是本机 API。

    有内置包（backend/app/assets/sample/sample_dataset.zip，随包发布）时优先走导入
    管线（包是完整演示数据的唯一真源）；没有包（开发/测试环境）才回退代码播种。
    """
    reusable_id = _find_reusable_sample_dataset()
    if reusable_id is not None:
        activated = activate_dataset(reusable_id, bind)
        logger.info("复用已有体验示例数据集 id=%s", reusable_id)
        return {**activated, "sample": True, "reused": True}

    pack_path = _sample_pack_path()
    if pack_path is not None:
        return _load_sample_from_pack(pack_path, bind)
    return _load_sample_from_code(bind)


def _load_sample_from_pack(pack_path: Path, bind: Engine) -> dict[str, Any]:
    """从内置包导入一份新的「体验示例」并切换过去（清单 §6.3 的随包发布路径）。

    复用备份导入管线（先验后写、失败回滚、候选库迁移到 head、附件恢复），格式校验/
    epoch 闸门/附件 sha256 复核都不必重写。导入写死的 source="导入" 在这里覆写为
    "sample"；restore_directory 与上传导入接口用同一个暂存目录（同盘才能原子改名）。
    """
    version = sample_seed_version()
    try:
        info = import_dataset(
            pack_path, SAMPLE_DATASET_NAME, bind, restore_directory(bind)
        )
    except Exception as exc:  # noqa: BLE001 - 包存在却导不进来必须明确失败
        # §6.3：**不得静默回退代码播种**——否则用户以为载入成功，内容却不是完整示例。
        raise DatasetError(f"体验示例数据包导入失败：{exc}") from exc
    metadata = read_metadata(info["id"])
    metadata["source"] = "sample"
    metadata["seed_version"] = version
    write_metadata(info["id"], metadata)
    activated = activate_dataset(info["id"], bind)
    logger.info("已从内置包载入体验示例 dataset=%s version=%s", info["id"], version)
    return {**activated, "sample": True, "reused": False}


def _load_sample_from_code(bind: Engine) -> dict[str, Any]:
    """代码播种（没有内置包时）：4 岗位 / 2 简历的旧示例，保持原行为不变。"""
    info = create_dataset(SAMPLE_DATASET_NAME, bind)
    # 数据集注册表是 JSON 元数据（不是数据库迁移）：source 覆写为 "sample"、
    # seed_version 记录播种版本；页头与数据集列表据此显示「示例」标识并判断复用。
    metadata = read_metadata(info["id"])
    metadata["source"] = "sample"
    metadata["seed_version"] = SAMPLE_SEED_VERSION
    write_metadata(info["id"], metadata)
    activated = activate_dataset(info["id"], bind)

    with database.SessionLocal() as db:
        # SessionLocal 是原地改绑的（见 database.rebind）：这里拿到的已经是新库。
        jobs = _seed_jobs(db)
        resumes = _seed_resumes(db, jobs[0])
        _seed_tracks(db, jobs, resumes[0])
        _seed_materials(db)
        _seed_knowledge(db)
        _seed_interview_experience(db, jobs[1])
        _seed_question_bank(db, jobs[1], resumes[0])
        _seed_web_form_profile(db)
        db.commit()
        logger.info(
            "体验示例数据已写入 dataset=%s jobs=%d resumes=%d",
            info["id"],
            len(jobs),
            len(resumes),
        )
    return {**activated, "sample": True, "reused": False}


__all__ = [
    "SAMPLE_DATASET_NAME",
    "SAMPLE_SEED_VERSION",
    "load_sample_dataset",
    "sample_seed_version",
]
