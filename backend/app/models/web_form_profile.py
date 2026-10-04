"""「网申资料」：用户为网申表单专门填的那些资料，与简历资料**分开存**。

## 为什么要独立一张表，而不是往 ``UserProfile`` 加列

用户的原话是"这一项要跟简历资料分开，用于补充简历资料里没有的内容，专门供网申填表模块
读取，**生成简历模块默认不读这里的信息**"。独立成表让这条边界**由结构保证**：

- 简历生成走 ``get_profile_detail()`` → ``UserProfile``（``resume_generate_runner.py``），
  它不碰本表，所以"不读"不是一句约定，是**代码路径上到不了**；
- 网申填表走 ``webform/data/source.py::build_form_data()``（经 ``_combine_profile_and_extra_data``
  合并 ``webform/extra_profile.py::list_entries``），只在这里读。

若改为往 ``UserProfile`` 加列，两件事都会发生：简历生成会**自动**带上这些内容（因为它读整份
资料），而"别读"就得靠在生成侧逐列排除——那是"漏一列就静默破防"的形状。

## 为什么是键值对，不是固定列

字段清单要"越多越好"（校招网申问的东西远比简历多：四六级分数、档案所在地、紧急联系人、
身高视力…）。固定列意味着**每加一个字段发一次迁移**；键值对下加字段只改
``services/webform/fields.py`` 一处。代价是数据库里看不出每列含义——但界面、匹配、
导出全部按那份目录渲染，实际使用不受影响。

## 为什么没有 ``deleted_at``

它是**配置性资料**，不是"用户会心疼的内容"：某一项不要了就把值清空（存空串会被删除），
不存在"删掉一条经历"那种心疼感。所以它**不进回收站**——加了 ``deleted_at`` 就得登记
``trash.TRASH_SPECS``，而"回收站里躺着一个空字段"没有任何意义。

## ``source`` 与 ``reuse``：记下来的东西要看得见、改得掉

2026-09-27 加的两列，只为回答两个问题：

- ``source``：这条是**你自己录的**，还是**填表时填着填着学到的**？两者在库里的地位相同
  （都参与预填），但界面上必须分得开——学来的一条是程序推断的，用户有权知道它从哪来，
  否则"这个值我什么时候填过"会变成一个没人能回答的问题。
- ``reuse``：**下次还要不要自动填**？学到的值里混着一次性的东西（某家的内推码、某个申请
  编号），把它们和生日一样自动预填是错的。所以给三档，默认 ``general``。

``once`` 的值**留在库里但不过滤进预填**（见 ``webform/extra_profile.py::list_entries``）——"只记不填"
是这个档位的全部含义，光靠"删掉"表达不了它。

## 隐私

这里的值可能含证件号、家庭成员、健康状况等敏感信息。**只存本机**：不进分享包、不进简历导出、
不进助手上下文（助手**读不到**本表，理由记在 ``tests/test_assistant_coverage.py`` 的
``COVERAGE`` 里）。

``source="learned"`` 会让本表**自动增长**（不再是"用户自己录了多少就有多少"），所以上面那三条
不能只靠"没人去读"——``tests/test_webform_extra_profile.py`` 里有针对"学到的值也出不去"的断言。
"""
from datetime import datetime

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .profile import utcnow

# 值是怎么进库的。
SOURCE_MANUAL = "manual"  # 用户在「我的资料 → 网申资料」里自己录的
SOURCE_LEARNED = "learned"  # 填表时从"这次填进去的值"里学到的

# 下次要不要自动填。
REUSE_GENERAL = "general"  # 换哪家公司都成立（生日、身份证号、四六级分数）→ 自动预填
REUSE_SCENARIO = "scenario"  # 换公司通常还成立、但和投递渠道有关 → 自动预填并标出来源
REUSE_ONCE = "once"  # 一次性的（内推码、某家的申请编号）→ 只记不填
REUSE_LEVELS: tuple[str, ...] = (REUSE_GENERAL, REUSE_SCENARIO, REUSE_ONCE)

# 字段清单**之外**的自定义字段，其 key 用这个前缀。
#
# 2026-09-27 加：用户要能记下"目录里没有、但这家公司问了"的框（「导师姓名」「实验室」）。
# 用**肉眼可辨的前缀**而不是随机 id，是因为这个仓库的标准是"库里能看出含义"——看到
# ``CUSTOM_导师姓名`` 就知道它是用户自己在填表时攒出来的，不是目录里的字段。
#
# **带这个前缀的 key 不参与自动匹配**（它不在 ``FIELD_SYNONYMS`` 里）。见 extra_profile
# 模块说明：只有标签一个信号的字段，匹错了会静默把值填进错误的框。
CUSTOM_KEY_PREFIX = "CUSTOM_"


class WebFormProfileEntry(Base):
    """一条「网申资料」：``field_key`` 对应 ``services/webform/fields.py`` 里的 key。"""

    __tablename__ = "web_form_profile_entry"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 对应字段目录里的 key（如 "cet6_score"），或 ``CUSTOM_`` 前缀的自定义 key。
    # 唯一——一个 key 只该有一条，写入按 key upsert。
    field_key: Mapped[str] = mapped_column(String(64), index=True)
    value: Mapped[str] = mapped_column(Text, default="")
    # 界面上的字段名（「导师姓名」）。目录内的 key 这里存 ``FIELD_LABELS[key]``（冗余，
    # 但统一了读法）；自定义 key 靠它显示——否则界面上是一串 ``CUSTOM_导师姓名``。
    # 空串表示"从目录取名"，这是存量行的形状，**所以加这一列不需要数据迁移**。
    label: Mapped[str] = mapped_column(String(64), default="")

    # 见模块说明。两列都有 server_default，所以存量行（都是手录的）自动落成 manual + general。
    source: Mapped[str] = mapped_column(String(16), default=SOURCE_MANUAL)
    reuse: Mapped[str] = mapped_column(String(16), default=REUSE_GENERAL)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


__all__ = [
    "CUSTOM_KEY_PREFIX",
    "REUSE_GENERAL",
    "REUSE_LEVELS",
    "REUSE_ONCE",
    "REUSE_SCENARIO",
    "SOURCE_LEARNED",
    "SOURCE_MANUAL",
    "WebFormProfileEntry",
]
