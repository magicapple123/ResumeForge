"""体验示例数据集：一键载入纯虚构的小份数据，让新用户立刻"有的可看"。

新装用户的首页是空的：没有岗位、没有简历，所有功能都停在空态。首启动引导会讲
"去哪里做什么"，但讲完用户面对的仍是空页面。这份示例数据只做一件事——让引导
结束的那一瞬间，首页有内容可看、简历可以打开导出。

边界：

- **纯虚构**：简历内容来自模板预览的示例（``resume_sample``），姓名/公司都带
  "示例"字样，不含任何真实个人数据；
- **独立数据集**：写在名为「体验示例」的独立数据集里并切换过去，主数据一个字节
  都不碰；用户在设置页随时可以整份删除，删除复用既有数据集删除流程。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import Engine

from .. import database
from ..models import Job, ResumeRecord
from ..models.job import JOB_STATUS_OPEN
from .datasets import activate_dataset, create_dataset
from .resume.resume_sample import sample_resume_content

logger = logging.getLogger(__name__)

SAMPLE_DATASET_NAME = "体验示例"

# 与示例简历同方向的一小段 JD：岗位详情有结构可读即可，不追求覆盖全部字段。
_SAMPLE_JD = """岗位职责：
1. 策划并执行季度主题营销活动，负责选题、预算与落地；
2. 维护渠道台账，按周追踪进量与转化；
3. 把活动经验沉淀成可复用的复盘流程。

任职要求：
1. 本科及以上学历，市场营销相关专业优先；
2. 一年以上市场/运营经验，能独立带小项目；
3. 熟悉 Excel 与基础数据复盘，沟通协作顺畅。"""

_SAMPLE_KEYWORDS = [
    {"name": "活动策划", "category": "职业技能"},
    {"name": "数据复盘", "category": "职业技能"},
    {"name": "Excel", "category": "办公技能"},
    {"name": "沟通协作", "category": "通用能力"},
]


def load_sample_dataset(bind: Engine) -> dict[str, Any]:
    """新建「体验示例」数据集、写入纯虚构数据并切换过去。

    返回切换后的数据集描述（带 ``sample: True`` 标记）；调用方是本机 API。
    """
    info = create_dataset(SAMPLE_DATASET_NAME, bind)
    activated = activate_dataset(info["id"], bind)

    content = sample_resume_content().model_dump()
    with database.SessionLocal() as db:
        # SessionLocal 是原地改绑的（见 database.rebind）：这里拿到的已经是新库。
        job = Job(
            title="市场运营专员",
            company="示例科技有限公司",
            location="上海",
            salary="8k-12k",
            job_type="校招",
            description=_SAMPLE_JD,
            keywords=_SAMPLE_KEYWORDS,
            recognition_source="手动填写",
            status=JOB_STATUS_OPEN,
        )
        db.add(job)
        db.flush()
        resume = ResumeRecord(
            title="示例简历 · 市场运营",
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            content=content,
            # 示例内容用户可以直接改：按"手动"归档，不冒充 AI 生成。
            source="manual",
        )
        db.add(resume)
        db.commit()
        logger.info(
            "体验示例数据已写入 dataset=%s job_id=%s resume_id=%s",
            info["id"],
            job.id,
            resume.id,
        )
    return {**activated, "sample": True}


__all__ = ["SAMPLE_DATASET_NAME", "load_sample_dataset"]
