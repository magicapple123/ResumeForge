"""把用户资料整理成"可以直接往表单里填"的扁平字段字典。

与 ``services/apply/_queue.py::build_apply_data`` 是**超集**关系：那个只取投递必需的
6 个展示字段（BOSS 那条链路只用得到它们），这里要覆盖网申表单的全部常见项。
两者**刻意各自独立**——投递链路的取数口径不该被网申的需求牵着走，反之亦然。

日期一律按资料里的字符串原样带出，格式化交给 ``matching.format_date``（它知道目标控件
是 ``date`` 还是 ``month``）。
"""

from .catalog import (
    build_catalog as build_catalog,
)
from .catalog import (
    catalog_from_profile as catalog_from_profile,
)
from .profile_map import (
    DEGREE_RANK as DEGREE_RANK,
)
from .profile_map import (
    education_rank as education_rank,
)
from .profile_map import (
    pick_latest_experience as pick_latest_experience,
)
from .profile_map import (
    pick_top_education as pick_top_education,
)
from .profile_map import (
    profile_to_form_data as profile_to_form_data,
)
from .source import (
    build_form_data as build_form_data,
)
from .source import (
    build_live_form_data as build_live_form_data,
)

__all__ = [
    "DEGREE_RANK",
    "build_catalog",
    "catalog_from_profile",
    "build_form_data",
    "build_live_form_data",
    "education_rank",
    "pick_latest_experience",
    "pick_top_education",
    "profile_to_form_data",
]
