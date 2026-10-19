"""岗位列表排序（R14）：``sort`` 键 → ORDER BY，``order`` 显式覆盖方向。

单独成模块的两个理由：

1. ``GET /jobs``（分页列表）与 ``GET /jobs/ids``（跨页全选）必须用**同一份**映射，
   否则"全选全部"拿到的 id 顺序与用户看到的列表顺序不一致；
2. ``api/jobs.py`` 已经接近 500 行预算（``tests/test_file_size_budget.py`` 会拦），
   排序映射放进去会让它越过红线。

键名自带方向后缀（``created_desc`` / ``title_asc``）：不带 ``order`` 的链接也自解释。
这是与简历侧（``api/resumes/crud_routes.py`` 的 5 个复合枚举）同一种思路，但字段不同，
**不要**把两份常量合并——岗位没有 ``job_title`` 这种列。
"""

from __future__ import annotations

from typing import Any, Literal

from ...models.job import Job

# 后端接受的排序键（FastAPI 用 Literal 校验，非法值直接 422）。
JobSort = Literal["created_desc", "updated_desc", "title_asc", "company_asc"]
# 方向覆盖：只在需要"逆着某列的默认方向"时传。
JobSortOrder = Literal["asc", "desc"]

# sort 键 → (排序列, 该键自带的方向)。
_SORT_COLUMNS: dict[str, tuple[Any, str]] = {
    "created_desc": (Job.created_at, "desc"),
    "updated_desc": (Job.updated_at, "desc"),
    "title_asc": (Job.title, "asc"),
    "company_asc": (Job.company, "asc"),
}


def job_order_by(sort: JobSort, order: JobSortOrder | None = None) -> tuple[Any, Any]:
    """把 ``(sort, order)`` 翻成两条 ORDER BY 表达式：主列 + ``id`` 兜底。

    ``order`` 覆盖 ``sort`` 自带的方向（``sort=title_asc&order=desc`` = 标题降序），
    这样前端第二次点同一列列头不必新增一个后端键。

    第二条按 ``id`` 同向兜底是必要的，不是洁癖：``created_at`` 精度只到秒，同一批
    导入/采集的岗位会撞在同一秒，没有稳定次序时翻页会出现"第 2 页又看到第 1 页那几条"。
    """
    column, default_direction = _SORT_COLUMNS[sort]
    direction = order or default_direction
    if direction == "asc":
        return (column.asc(), Job.id.asc())
    return (column.desc(), Job.id.desc())


__all__ = ["JobSort", "JobSortOrder", "job_order_by"]
