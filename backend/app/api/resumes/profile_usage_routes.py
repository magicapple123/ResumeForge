# SPDX-License-Identifier: Apache-2.0
"""简历「本次使用」只读追溯端点（R-33）。

**为什么单独一个端点，而不是只塞进简历详情响应**：

1. 追溯信息要到 2026-10 才落地，旧客户端/旧缓存里的 ResumeOut 形状不变——独立端点
   不会让任何既有响应契约多出字段；
2. 详情响应同时被生成/保存/改名/收藏等写端点复用，若把快照塞进 ResumeOut 的组装函数，
   每个写端点都要多查一次快照（或者返回 null，形成"同一份简历时而有时而无"的假象）；
3. 除快照外还要回**过时判定**（freshness），它需要读当前组 scope——这属于"提示层"
   数据，只在这里算一次，详情主路径不承担该查询。

**只读、无副作用**：不重新生成、不改正文、不回写快照。组被删除后快照照常返回并标注
``group_deleted=true``（R-33：历史仍可读）。旧简历（无快照）返回 ``profile_usage=null``
且 ``freshness.changed=false``，不报错。
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.resume_profile_usage import ResumeProfileUsageOut
from ...services.resume.profile_usage import profile_usage_response
from ._shared import _get_live_resume

router = APIRouter()


@router.get("/{resume_id}/profile-usage", response_model=ResumeProfileUsageOut)
def get_resume_profile_usage(resume_id: int, db: Session = Depends(get_db)):
    """这份简历保存/生成时用的是哪个组、哪些大字段，以及资料/定义之后有没有变。

    ``freshness.changed`` 只是"重新生成会得到不同纸面"的提示：已保存简历不会自动变化。
    简历不存在或已在回收站 → 404（与详情端点同一口径）。
    """
    record = _get_live_resume(db, resume_id)
    return profile_usage_response(db, record.id)


__all__ = ["router"]
