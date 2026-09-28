"""「网申资料」的读写：用户专门为网申表单填的那批补充资料。

与 ``data.py`` 的分工：那份把 ``UserProfile``（简历资料）展开成扁平字段，本模块管**另一张表**
（``web_form_profile_entry``）——简历里没有、只有网申表单会问的那些栏目（四六级分数、档案
所在地、紧急联系人、身高视力…）。

**为什么独立一张表**（而不是往 ``UserProfile`` 加列）记在 ``models/web_form_profile.py``
的模块说明里，一句话：让"生成简历不读这些"成为**代码路径上到不了**，而不是一句约定。

## 写入语义

``save_entries`` 是**整份覆盖**：传进来的映射就是全部，没提到的 key 一律删除。理由是这一屏
就是"网申资料的全部"，用户清空某一格时**删除**才是他要的语义（否则那张空值会一直躺在库里，
下次读出来还要靠过滤兜住）。空值不落库——"没有这一项"与"这一项是空的"在这里是同一件事。

## 学到的（``source="learned"``）

``learnable()`` 从"这次将填入的行"里挑出**资料里没有、值得记下来**的那些，交给前端弹一条
提示；用户勾选后仍走 ``save_entries`` 落库（**不另开写入接口**）。两件事都在这个模块里，
因为它们是同一张表的读与写。

``reuse="once"`` 的值**只记不填**：``list_entries(reusable_only=True)`` 会把它们滤掉。

## 自定义字段（``CUSTOM_`` 前缀，2026-09-27）

用户要能记下**字段清单之外**、这家公司问了的框（「导师姓名」「实验室」）。这类 key 的形状是
``CUSTOM_导师姓名``：前缀让库里一眼看得出它不是目录字段，后缀是**用户当初看到的栏目名**。

**它们能存、能显示、能被手填和「换个资料…」搜到，但不参与模糊匹配。** 这不是省事——
匹配靠 ``engine.evidence_key()`` 在 ``FIELD_SYNONYMS[field]`` 里找证据，而自定义字段只有
标签本身一个信号，内置字段每个有 5–10 个同义词加 ``autocomplete`` 档位。让一个单信号字段
按相似度参与匹配，意味着它下一次可能**静默把值填进错误的框**——而填错了用户往往当场看不出来。

**唯一的例外是"精确同名"**（``data._with_unique_custom_label_values`` 与
``live._suggest_custom_field``）：标签去掉空白标点后与**唯一一条**候选完全相等时才认，
且只在实时逐框那条路上生效（批量预填不走）。两条同名就放弃——歧义不猜。这是"完全相等"，
不是"看起来像"，所以上面那个误填风险不成立。

所以：**要按相似度自动匹配，就得在 ``fields.py`` 里有一行**（那是改常量表，可靠性与内置字段等同）。
库里再攒一份"运行时同义词表"是不做的——两处都叫同义词，日后必然分叉（``recognize_field``
与 ``_rank_controls`` 各写一份的教训记在 ``engine.evidence_key`` 的注释里）。

### 写入与读取必须同时放行

``_accepts()`` 是**唯一**的收窄判据，三个入口（``save_entries`` / ``list_entries`` /
``list_details``）共用它。先前只有 ``save_entries`` 收窄、读取端另写一份过滤——那种形状下
"加了新 key 忘了同步改读取"会表现为**存进去了读不出来**（用户看到自己刚记的东西不见了），
而且没有任何报错。收在一处就不会漏。
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy.orm import Session

from ...models.web_form_profile import (
    CUSTOM_KEY_PREFIX,
    REUSE_GENERAL,
    REUSE_LEVELS,
    REUSE_ONCE,
    SOURCE_LEARNED,
    SOURCE_MANUAL,
    WebFormProfileEntry,
)
from .fields import FIELD_LABELS, FORM_FIELDS, SOURCE_EXTRA

# 目录里 ``source="extra"`` 的那些 key。**目录内的**合法 key 就是这一批。
EXTRA_FIELD_KEYS: frozenset[str] = frozenset(
    field.key for field in FORM_FIELDS if field.source == SOURCE_EXTRA
)

# 单个值最长多少字符。与资料里其它长文本字段同量级；超长多半是误粘贴。
MAX_VALUE_CHARS = 2000

# 自定义字段的标签最长多少字符（``field_key`` 那一列是 64，前缀也占位置）。
MAX_CUSTOM_LABEL_CHARS = 40

# 规范标签时要剥掉的装饰性符号（与 ``matching._DECORATION`` 同一批：表单里"（"与"("混用
# 是常态，必填星号也常见）。
_LABEL_DECORATION = " \t\r\n-—–:：·.、,，*＊[]【】()（）<>《》\"'“”‘’"


def _accepts(key: str) -> bool:
    """这个 key 允许读写吗。**三个入口共用这一处判据**（理由见模块说明）。

    目录内的 key 收，``CUSTOM_`` 前缀的也收——后者是用户在填表时攒出来的。
    **其余一律不收**：目录外的普通 key 混进来会冒充简历资料字段（"姓名""手机号"那种），
    下一次它们会被当成"库里已有的字段"参与判据，把不该学的东西挡掉或放进来。
    """
    return key in EXTRA_FIELD_KEYS or key.startswith(CUSTOM_KEY_PREFIX)


def custom_key(label: str) -> str:
    """把用户看到的栏目名规范成自定义字段的 key（``CUSTOM_导师姓名``）。

    剥掉装饰符号与内部空白后**原样保留中文**——不做拼音/哈希之类的转换，因为这一列是给人
    看的、也要靠它去重（同一个栏目名第二次记住时该覆盖，而不是攒出两条）。
    空标签返回空串，调用方据此拒绝（没有名字的字段在界面上没法显示）。
    """
    cleaned = re.sub(r"\s+", "", label.strip().strip(_LABEL_DECORATION))
    if not cleaned:
        return ""
    return f"{CUSTOM_KEY_PREFIX}{cleaned[:MAX_CUSTOM_LABEL_CHARS]}"


def display_label(field_key: str, label: str = "") -> str:
    """一条记录在界面上该显示什么名字。

    ``label`` 非空就用它；否则回落到目录的 ``FIELD_LABELS``。两条路径合成一处，所以读取端
    不必判断"这个 key 是自定义的还是目录的"。

    **自定义字段的兜底要把前缀剥掉**：库里有 ``label`` 为空的存量行（这一列是后加的），
    直接回落到 key 的话界面上会出现 ``CUSTOM_导师姓名``——那个前缀是给库里看的，不是给
    用户看的。
    """
    if label:
        return label
    if field_key.startswith(CUSTOM_KEY_PREFIX):
        return field_key[len(CUSTOM_KEY_PREFIX) :] or field_key
    return FIELD_LABELS.get(field_key, field_key)


# 自定义字段在「网申资料」里的分组名。放最后——它们没有目录里的归类信息。
CUSTOM_GROUP = "自定义"


def custom_fields_of(db: Session, groups: list[str]) -> list[dict[str, Any]]:
    """库里那些 ``CUSTOM_`` 前缀的自定义字段，转成与目录字段同形的条目。

    给「网申资料」界面用：用户记下了就得看得见、改得掉、删得掉。**只收有值的**——与
    ``list_entries`` 同一口径（没有这一项与"这一项是空的"是同一件事），所以界面不会为
    一个空的自定义字段铺一格输入框。

    ``groups`` 会被**就地追加** ``自定义``（如果确实有自定义字段）：分组顺序来自目录，
    而这个组是运行时才出现的，只能在这里补。

    ``matchable=False`` 是给界面看的信号：**它们不参与自动匹配**（理由见模块说明），
    界面据此不要对它们承诺"下次自动填"——那是句假话，比不显示更糟。
    """
    rows = (
        db.query(WebFormProfileEntry)
        .filter(WebFormProfileEntry.field_key.like(f"{CUSTOM_KEY_PREFIX}%"))
        .all()
    )
    rows = [row for row in rows if row.value and _accepts(row.field_key)]
    if not rows:
        return []

    if CUSTOM_GROUP not in groups:
        groups.append(CUSTOM_GROUP)

    return [
        {
            "key": row.field_key,
            "label": display_label(row.field_key, row.label),
            # 自定义字段在库里是什么类型无从得知（那是跟着页面控件走的，不是跟着字段走的），
            # 一律给 text——长文本也能存，只是输入框不自动撑高。
            "kind": "text",
            "group": CUSTOM_GROUP,
            "sensitive": False,
            "matchable": False,
        }
        for row in rows
    ]


def list_entries(db: Session, *, reusable_only: bool = False) -> dict[str, str]:
    """读出全部「网申资料」，返回 ``{key: value}``。

    **只返回目录里认得的 key**：目录删掉某个字段后，库里那条旧值不该再被读出来
    （否则会填进一个我们已经不认识的字段）。

    ``reusable_only=True`` 时再滤掉 ``reuse="once"`` 的那些——那是"只记不填"的档位
    （内推码、某家的申请编号），留着它们参与预填正是这个档位要避免的事。
    """
    rows = db.query(WebFormProfileEntry).all()
    return {
        row.field_key: row.value
        for row in rows
        if _accepts(row.field_key)
        and row.value
        and not (reusable_only and row.reuse == REUSE_ONCE)
    }


def list_details(db: Session) -> dict[str, dict[str, str]]:
    """读出每条的**完整形状**（值 + 来源 + 档位 + 显示名），供「我的资料」展示。

    与 ``list_entries`` 分开：那个是给**填表**用的（只关心 key→值），这个是给**界面**用的
    （还要显示来源与档位）。合成一个会让前者多返回三个它永远不看的字段。
    """
    rows = db.query(WebFormProfileEntry).all()
    return {
        row.field_key: {
            "value": row.value,
            "source": row.source or SOURCE_MANUAL,
            "reuse": row.reuse or REUSE_GENERAL,
            "label": display_label(row.field_key, row.label),
        }
        for row in rows
        if _accepts(row.field_key) and row.value
    }


def save_entries(
    db: Session,
    values: Mapping[str, str],
    *,
    details: Mapping[str, Mapping[str, str]] | None = None,
) -> dict[str, str]:
    """整份覆盖写入。返回落库后的结果，供调用方回显（不必再查一次）。

    ``details`` 可选，用来给某几条指定 ``source`` / ``reuse`` / ``label``（学到的那些走
    这里）；没提到的 key 按"用户自己录的、默认档位、从目录取名"落库——这正是「我的资料」
    那一屏的语义。
    """
    cleaned: dict[str, str] = {}
    for key, raw in values.items():
        if not _accepts(key):
            continue  # 目录外且非自定义的键直接丢弃，不报错——前端多传一个键不该让整次保存失败。
        value = (raw or "").strip()[:MAX_VALUE_CHARS]
        if value:
            cleaned[key] = value

    existing = {row.field_key: row for row in db.query(WebFormProfileEntry).all()}
    for key, value in cleaned.items():
        extra = (details or {}).get(key) or {}
        source = extra.get("source") or SOURCE_MANUAL
        reuse = extra.get("reuse") or REUSE_GENERAL
        if source not in (SOURCE_MANUAL, SOURCE_LEARNED):
            source = SOURCE_MANUAL
        if reuse not in REUSE_LEVELS:
            reuse = REUSE_GENERAL
        # 标签没给就留空串（读取端回落到目录名）。**不从 key 倒推**——自定义 key 里那个
        # 后缀虽然长得像标签，但它是规范化过的（剥过标点），倒推会让界面上的名字和用户
        # 当初填的那个逐渐对不上。
        label = str(extra.get("label") or "")[:64]
        row = existing.get(key)
        if row is None:
            db.add(
                WebFormProfileEntry(
                    field_key=key, value=value, label=label, source=source, reuse=reuse
                )
            )
        else:
            row.value = value
            row.label = label
            row.source = source
            row.reuse = reuse
    # 本次没提到的（含被清空的）一律删掉——见模块说明里的"整份覆盖"。
    for key, row in existing.items():
        if key not in cleaned:
            db.delete(row)
    db.commit()
    return cleaned


def remember(
    db: Session,
    *,
    key: str,
    value: str,
    label: str = "",
    source: str = SOURCE_LEARNED,
    reuse: str = REUSE_GENERAL,
) -> bool:
    """记下一条，**不动库里已有的其它条目**。返回是否真的写进去了。

    与 ``save_entries`` 的区别是语义：那个是"这一屏就是全部"（没提到的删掉），这个是
    "把这一条加进去"。逐框「记住这条」走这里——用户在页面上点的是**一个框**，
    不该因此把他之前记的东西全删掉。

    同 key 再记一次是覆盖（值/标签/档位都更新），所以反复点同一个框不会攒出重复条目。
    值或 key 不合法则不写，返回 ``False`` 让调用方如实告诉用户"这条没记上"。
    """
    if not _accepts(key):
        return False
    cleaned_value = (value or "").strip()[:MAX_VALUE_CHARS]
    if not cleaned_value:
        return False

    row = (
        db.query(WebFormProfileEntry)
        .filter(WebFormProfileEntry.field_key == key)
        .one_or_none()
    )
    if row is None:
        db.add(
            WebFormProfileEntry(
                field_key=key,
                value=cleaned_value,
                label=label[:64],
                source=source,
                reuse=reuse,
            )
        )
    else:
        row.value = cleaned_value
        if label:
            row.label = label[:64]
        row.source = source
        row.reuse = reuse
    db.commit()
    return True


# ===== 学到的东西 =====

# 值是哪来的，写进提案里给用户看。与 ``service.SOURCE_RULE`` / ``SOURCE_AI`` 同义，
# 但**不 import 那两个常量**——``service`` 会连带拉起 ``engine``（重依赖），而本模块
# 只做这张表的读写，不该为两个字符串把整条链拽进导入期。
FROM_RULE = "rule"
FROM_AI = "ai"


def learnable(db: Session, items: Iterable[Any], known: Mapping[str, str]) -> list[dict[str, str]]:
    """从"这次将填入的行"里挑出**简历通里没有、值得记下来**的那些。

    ``items`` 是 ``service.PreviewItem`` 的序列（用户勾选过、这次真会填进去的行）；
    ``known`` 是 ``data.build_form_data()`` 的结果——**由调用方传进来复用**，不要在这里
    再查一次库（``preview`` 路由已经算过一份）。

    ## 判据只有三条

    1. 这行的 ``field`` **不在** ``known`` 里。**这就是"简历通里没有"的定义**——包括简历
       资料与已经存在的网申资料。
    2. 值非空。
    3. ``field`` 是**认得的**（``_accepts()``：目录内的，或 ``CUSTOM_`` 前缀的自定义字段）。

    ## 第 3 条在挡什么

    规则偶尔会把**简历资料里的字段**（姓名、手机号…）映射到一个"资料里恰好为空"的框上，
    AI 也可能把某个 ``source="profile"`` 的字段判成新信息。那些行的 ``field`` 不在
    ``EXTRA_FIELD_KEYS`` 里，**学下来会让"学到的东西"冒充简历资料字段**，下次还会覆盖
    用户自己在「我的资料」里填的值。所以在**提案阶段**就滤掉。

    同理也是在挡 ``save_entries`` 的静默丢弃：那边按同一个 ``_accepts()`` 收窄，不认得的
    key 会**悄悄消失**。与其让用户勾了半天发现没存上，不如一开始就不提案。

    ## 为什么不需要问"值是不是用户敲的"

    ``field not in known`` 已经蕴含了答案：这个字段在库里没有值，所以这行出现在 ``items``
    里的值只能来自别处（规则给它的、或 AI 候选给的）。而**资料里"有这个字段但值为空"的行
    根本不在 ``items`` 里**——它们落在 ``report.missing_data``，是另一桶。所以那种行既不会
    被误学，也不需要额外判断。

    > 逐框「记住这条」那条链**确实**要处理 ``missing_data``（用户点着一个认得出但没值的框
    > 要记住它）。它走 ``remember()``，**不经过这里**——两条链各自成立，不要在这里混。

    ## 与已有资料不重复提案

    一个字段被记住之后，下一次它就出现在 ``known`` 里了 → 不再提案。所以这条提示**不会**
    变成每次填表都弹的骚扰。
    """
    proposals: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items:
        key = str(getattr(item, "field", "") or "").strip()
        if not key or key in seen or key in known:
            continue
        if not _accepts(key):
            continue
        value = str(getattr(item, "value", "") or "").strip()[:MAX_VALUE_CHARS]
        if not value:
            continue
        seen.add(key)
        source = str(getattr(item, "source", "") or "")
        proposals.append(
            {
                "key": key,
                "label": FIELD_LABELS.get(key, key),
                "value": value,
                "from": FROM_AI if source == FROM_AI else FROM_RULE,
            }
        )
    return proposals


__all__ = [
    "CUSTOM_GROUP",
    "CUSTOM_KEY_PREFIX",
    "EXTRA_FIELD_KEYS",
    "FROM_AI",
    "FROM_RULE",
    "MAX_CUSTOM_LABEL_CHARS",
    "MAX_VALUE_CHARS",
    "custom_fields_of",
    "custom_key",
    "display_label",
    "learnable",
    "list_details",
    "list_entries",
    "remember",
    "save_entries",
]
