"""采集配置与采集请求 schema。"""

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .base import (
    COLLECT_FILTER_CODE_MAX_CHARS,
    COLLECT_FILTER_KEY_MAX_CHARS,
    DEFAULT_COLLECT_INTERVAL_JITTER_SECONDS,
    DEFAULT_COLLECT_INTERVAL_SECONDS,
    DEFAULT_COLLECT_PER_TASK_LIMIT,
    MAX_BACKFILL_REQUEST_ITEMS,
    MAX_COLLECT_FILTERS,
    MAX_COLLECT_KEYWORDS,
)

# ===== 采集配置 =====


class CollectConfigIn(BaseModel):
    """采集配置。关键词 + 城市 + 翻页是首期确定生效的；薪资/经验/学历依赖站点映射，

    映射失败时由界面显示「未生效」，绝不静默忽略。
    """

    model_config = ConfigDict(extra="forbid")

    keywords: list[str] = Field(default_factory=list, max_length=MAX_COLLECT_KEYWORDS)
    city: str = Field(default="", max_length=64)
    salary_min: int | None = Field(default=None, ge=0, le=1000)
    experience: str = Field(default="", max_length=32)
    education: str = Field(default="", max_length=32)
    # 采集结果的岗位类型标注（校招/实习/社招）；空串 = 不限。**仅入库标注**：
    # 不入去重判据、不参与站点筛选（与薪资/经验/学历"采集后本地筛选"口径一致）。
    job_type: str = Field(default="", max_length=32)
    # **站点侧筛选项**：``{分组 key: 选项编码}``（如 ``{"degree": "203"}``）。选项清单由适配器
    # 从站点自己那里读（见 ``services/sites/boss_filters``），界面渲染成下拉框，用户选什么就存
    # 什么；编码在**采集开始前**由适配器对着当次读到的清单校验，不通过的如实上报、绝不发出去。
    #
    # 与上面三个字段的分工：``salary_min`` / ``experience`` / ``education`` 筛的是
    # **"你的条件 vs 岗位要求"**（"我是本科"），``filters`` 是**站点筛选栏本身**
    # （"岗位要求本科"）。两者语义不同，可以同时用。
    filters: dict[str, str] = Field(default_factory=dict)
    per_task_limit: int = Field(default=DEFAULT_COLLECT_PER_TASK_LIMIT, ge=1, le=200)
    interval_seconds: int = Field(default=DEFAULT_COLLECT_INTERVAL_SECONDS, ge=1, le=600)
    interval_jitter_seconds: int = Field(default=DEFAULT_COLLECT_INTERVAL_JITTER_SECONDS, ge=0, le=300)

    @field_validator("filters")
    @classmethod
    def filters_must_be_bounded(cls, value: dict[str, str]) -> dict[str, str]:
        if len(value) > MAX_COLLECT_FILTERS:
            raise ValueError(f"站点筛选项最多 {MAX_COLLECT_FILTERS} 个")
        cleaned: dict[str, str] = {}
        for key, code in value.items():
            clean_key = (key or "").strip()
            clean_code = (code or "").strip()
            if not clean_key or not clean_code:
                continue
            if len(clean_key) > COLLECT_FILTER_KEY_MAX_CHARS:
                raise ValueError("筛选项名称过长")
            if len(clean_code) > COLLECT_FILTER_CODE_MAX_CHARS:
                raise ValueError("筛选项编码过长")
            cleaned[clean_key] = clean_code
        return cleaned

    @field_validator("keywords")
    @classmethod
    def keywords_must_be_clean(cls, value: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in value:
            text = (item or "").strip()
            if not text:
                continue
            if len(text) > 50:
                raise ValueError("单个关键词不能超过 50 个字")
            if text not in cleaned:
                cleaned.append(text)
        return cleaned


class CollectConfigOut(CollectConfigIn):
    """当前生效的采集配置 + 出厂默认值回显。"""

    defaults: CollectConfigIn = Field(default_factory=CollectConfigIn)


class CollectFilterOptionOut(BaseModel):
    """一个可选项。``group`` 只用于界面分组（行业有 15 个一级分组），其余为空。"""

    code: str
    label: str
    group: str = ""


class CollectFilterGroupOut(BaseModel):
    """站点筛选栏里的一格，对应界面上的一个下拉框。"""

    key: str
    param: str
    label: str
    options: list[CollectFilterOptionOut] = Field(default_factory=list)
    # 这份清单是从哪儿读来的：session（你的登录会话）/ public（全网通用）/ snapshot（内置快照）
    # / unavailable（这次读不到）。**必须展示给用户**——不同来源可信度不同，用户有权知道
    # 自己选的那一项是"这个账号真实可见的"还是"退回的公共清单"。
    source: str = "unavailable"
    note: str = ""


class CollectFilterOptionsOut(BaseModel):
    """当前站点的站点侧筛选项清单。"""

    site_key: str = ""
    display_name: str = ""
    groups: list[CollectFilterGroupOut] = Field(default_factory=list)
    # 是否读到了登录态清单（false = 浏览器没启动或读失败，用的是公共清单）。
    session_read: bool = False


class CollectTaskCreateIn(BaseModel):
    """开始一次采集的请求体。

    只有一个可选开关：是否保存本次抓到的站点原文（用于排查解析问题）。**默认关闭**——往磁盘
    写站点数据必须由用户每次显式勾选，绝不默认记录。
    """

    model_config = ConfigDict(extra="forbid")

    save_site_samples: bool = False


class CollectBackfillIn(BaseModel):
    """「补齐详情」请求体：按岗位 id 只补抓详情。

    用于修**历史遗留**的空 JD——当年采集时详情没抓到（该成因已修好），但已经落库的那几条修不了，
    因为采集按 URL 去重、重新采集会直接跳过它们。这里改由用户点名补齐。
    """

    model_config = ConfigDict(extra="forbid")

    # 空列表不在 schema 层拦：交给业务层给出「请先选择要补齐详情的岗位」这类可操作的中文提示。
    job_ids: list[int] = Field(default_factory=list, max_length=MAX_BACKFILL_REQUEST_ITEMS)

