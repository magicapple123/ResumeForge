"""证据强度计算（匹配共用核心）。"""
from __future__ import annotations

import re
from functools import lru_cache

from ..fields import (
    AUTOCOMPLETE_FIELDS,
    FIELD_BLOCK_HINTS,
    FIELD_EXCLUDE_HINTS,
    FIELD_SYNONYMS,
)
from ..repeated_fields import family_for_field
from .families import foreign_marker
from .model import Control

_HIGH_RISK_AMBIGUOUS_FIELDS = frozenset(
    {
        "name",
        "phone",
        "phone_country_code",
        "email",
        "wechat",
        "qq",
        "id_number",
        "id_type",
    }
)


# 结果只依赖控件本身（默认目录下），按 (控件, fields) 记忆化。_rank_controls 对
# 每个字段排名都会把全部控件重问一遍这道守卫，不缓存就是「排名次数 × 控件数」次
# 全字段循环（2026-10-05 性能审查：这是缓存 evidence_key 之后的下一个瓶颈）。
@lru_cache(maxsize=8192)
def has_ambiguous_field_evidence(
    control: Control,
    fields: dict[str, tuple[str, ...]] | None = None,
) -> bool:
    """Return whether the control has multiple equally strong field signals.

    A form-level label list can put 姓名 and 手机号 in every control's nearby
    text. Choosing the longer synonym in that situation is not recognition;
    it is a guess. Repeated fields in the same family are exempt because their
    block and date-order rules resolve that ambiguity.
    """
    # 「年 / 月 / 日」组件不参与这个守卫：它们的语义由 date_part 拆分机制锚定
    # （每个组件只接受日期值里属于自己的部分），而控件旁的"表单级标签列表"
    # （姓名+手机号+邮箱挤在同一段旁文里）对组件是噪声、不是信号。拦下它们只会
    # 让毕业时间/就读时间的年月框集体进"没认出来"，再由 AI 兜底喂整串日期。
    if control.date_part():
        return False
    fields = fields or FIELD_SYNONYMS
    signature = control.signature()
    candidates: list[tuple[int, int, str]] = []
    for field_name, synonyms in fields.items():
        if any(hint in signature for hint in FIELD_EXCLUDE_HINTS.get(field_name, ())):
            continue
        key = evidence_key(control, field_name, synonyms)
        if key is not None:
            candidates.append((key[0], key[1], field_name))
    if len(candidates) < 2:
        return False
    strongest_tier = max(tier for tier, _score, _field_name in candidates)
    strongest = [
        (field_name, score)
        for tier, score, field_name in candidates
        if tier == strongest_tier
    ]
    unscoped = [
        (field_name, score)
        for field_name, score in strongest
        if family_for_field(field_name) is None
    ]
    if len(unscoped) < 2:
        return False
    return bool(
        _HIGH_RISK_AMBIGUOUS_FIELDS.intersection(field_name for field_name, _score in unscoped)
    )


# 同 evidence_key：纯函数 + 参数可哈希，rank / competing 两个循环都会对
# （控件, 字段）反复调用，记忆化后剩一次子串扫描。
@lru_cache(maxsize=32768)
def excluded_by_hints(control: Control, field_name: str) -> bool:
    """命中该字段的负向词（"紧急联系人姓名"之于"姓名"这类）就不能认领这个控件。

    规则引擎、实时识别与 **AI 采纳前的守门** 共用这一个实现。2026-10-05 前的
    缺口：只有规则引擎带这道闸，AI 答案可以绕过去——模型把「紧急联系人姓名」框
    认成 ``name`` 时，规则层拦得住，``preview`` / ``live`` 的采纳层拦不住。
    """
    # 「年 / 月 / 日」组件豁免：组件语义由 date_part 拆分机制锚定，槽位只收日期
    # 形状的值；而组件旁的"表单级标签列表"（mokahr apply 页实测：年框的邻近文本
    # 带着整表的"手机号码"等标签）会把日期字段的电话负向词误触发，毕业时间/就读
    # 时间的年月框全体消失。真电话框（区号）自己的文本就带电话词，不受影响。
    if control.date_part():
        return False
    signature = control.signature()
    return any(word in signature for word in FIELD_EXCLUDE_HINTS.get(field_name, ()))


def block_hint_satisfied(
    control: Control,
    field_name: str,
    key: tuple[int, int],
    synonyms: tuple[str, ...],
) -> bool:
    """区块限定字段的准入：弱证据（旁文档）必须能在签名里看到该区块的提示词。

    多段经历里的短词（"描述""职位""起止时间"）在两三个区块上同时命中是常态，
    没有区块名就不该认领——见 ``FIELD_BLOCK_HINTS``。两种例外：控件本身带
    ``block_family``（已经锚定在某条经历里），以及"是否…"这类选择字段
    （由控件类型/选项自证）。

    **引擎与 ``recognize_field`` 共用这一条**：先前 recognize_field 少了它，
    同一个「游戏经历」框引擎认不出、面板却报"实习描述（第一条）"——两处判据
    分叉的又一次实例（见 ``evidence_key`` 的 docstring）。
    """
    hint = FIELD_BLOCK_HINTS.get(field_name)
    if not hint:
        return True
    if hint in control.signature() or control.block_family:
        return True
    if key[0] >= 1:
        return True
    choice_field = any("是否" in synonym for synonym in synonyms)
    return choice_field and control.type in ("select", "radio", "checkbox")


# evidence_key 是纯函数（控件快照 frozen 不可变、同义词目录固定），按
# (控件, 字段, 同义词元组) 记忆化。为什么值得：_rank_controls 对每个字段把全部控件
# 重问一遍，_is_low_confidence 又把整个 rank 重跑一遍，has_ambiguous_field_evidence
# 还会把全部 ~136 个字段各问一遍——不缓存，长表单一次预览就是几十万次同义词子串
# 扫描（2026-10-05 性能审查）。maxsize 兜底内存：条目持有着控件引用，上限防止快照
# 生命周期之外长期滞留。
@lru_cache(maxsize=32768)
def evidence_key(
    control: Control, field_name: str, synonyms: tuple[str, ...]
) -> tuple[int, int] | None:
    """控件相对某个字段的**证据强度**，返回 ``(档位, 得分)``；毫无关联时返回 ``None``。

    档位（**先比档位，再比得分**）：

    - **3** = ``autocomplete``：站点按 HTML 规范**主动声明**的字段类型，不是从文本猜的；
    - **2** = **占位符**：输入框自己写着"请输入导师"——它一对一属于这个框，不会被邻居污染；
    - **1** = ``label`` / ``aria-label`` / ``name``；
    - **0** = 只在**旁文**（``nearby_text``）里命中。

    得分取同义词长度（"工作经验" 比 "经验" 更具体）。

    ## 为什么占位符要单独压过 label 和旁文

    2026-09-27 在腾讯校招简历页（``join.qq.com/resumeedit.html``）取了一份真机快照，
    「导师 / 实验室 / 研究方向 / 论文」四个框紧挨着，每个框的 ``nearby_text`` 都是这四个
    标签**搅在一起**的字符串：

        idx=32 请输入导师       nearby='导师 * 导师 * 实验室 研究方向 论文 0/1000'
        idx=33 请输入实验室     nearby='实验室 导师 * 实验室 研究方向 论文 0/1000'
        idx=34 请输入研究方向   nearby='研究方向 导师 * 实验室 研究方向 论文 0/1000'
        idx=35 请输入已发表论文 nearby='0/1000 0/1000 论文 0/1000 导师 * 实验室 研究方向 论文 0/1000'

    "研究方向" 出现在**每一个**框的签名里，于是按"最长同义词"比，「实验室」「论文」双双
    被它抢走。分档救不了——它们全在旁文档，平分。

    而 ``placeholder`` 一对一、且实测在这张页面上**每一个文本控件都写对了**。所以它单独
    成一档，压过 label 与旁文。``label`` 为什么更低：这张页面上它要么是空的，要么装的是
    **单选项文字**（"男"/"女"/"无实习经历"），比占位符粗得多。

    ## 共用

    引擎的 ``_rank_controls`` 与 ``service.recognize_field`` 共用这一个实现：先前两边各写
    一份，引擎那份修了、``recognize_field`` 那份没修，同一个框在批量预览与实时面板里
    认成了两个不同的字段。
    """
    if AUTOCOMPLETE_FIELDS.get(control.autocomplete) == field_name:
        return (3, 100)
    placeholder = control.placeholder.casefold().strip()
    # 占位符自己**指明了它要什么**（"请输入导师"/"请选择学历"）时，它就是权威：
    # 命中就按它算，**没命中也不许退回旁文**。
    #
    # 否则会出这样的事：腾讯校招页「请输入实验室」的旁文里混着"研究方向"，
    # 占位符查无此字段 → 退回旁文 → 被"研究方向"抢走，于是实验室栏被报成研究方向。
    # 正确行为是**如实说"认不出"**（实验室/论文不在字段目录里，本来就没得填），
    # 而不是从邻居的标签里借一个——借来的那个，用户一眼就看得出是错的。
    #
    # 旁文兜底（档位 0）留给**没有这类占位符**的表单（美团/字节把标签放在 input 旁边，
    # 占位符是空的或通用的"选择日期"），那种页面上旁文是唯一可用的信号。
    stated = _states_its_field(placeholder)
    # 某些真实表单用「如有内推串码可在此填写」描述这个输入框，虽然不以「请输入」
    # 开头，却仍然是一对一的字段声明。只接纳短、明确包含「如有…填写」的文案；
    # 不把长段说明或邻近文字当作这个框的权威标签。
    referral_style = (
        placeholder.startswith("如有") and "填写" in placeholder and len(placeholder) <= 40
    )
    tier1 = " ".join(
        (
            control.label,
            control.aria_label,
            control.aria_labelledby,
            control.legend,
            control.title,
            control.name,
        )
    ).casefold()
    if stated or referral_style:
        # 权威性建立在"一对一"上：占位符被多个互不配对的字段并列最高分时，它已经
        # 说不清自己要什么——对**所有**字段如实报"认不出"（见 _placeholder_leaders_conflict）。
        if _placeholder_leaders_conflict(placeholder):
            return None
        best = _longest_synonym(placeholder, synonyms)
        if best > 0:
            return (2, best)
        # 占位符点名的字段（"请输入姓名" → name）在这个控件上**全部**被负向词拦下时
        # （框其实长在紧急联系人/亲属区块里，见 FIELD_EXCLUDE_HINTS 的 RELATIVE_HINTS），
        # 占位符的权威落空——否则这类框会两头落空：本人字段被负向词拦下、
        # 紧急联系人字段又被权威规则挡在 label 之外，永远进"没认出来"
        # （2026-10-06 实测：紧急联系人三框全无人认领）。回退**只到 label 档**、
        # 不退旁文：label 一对一指向控件，旁文可能混进整表标签——退旁文会把
        # 被污染的本人姓名框送给紧急联系人字段（那是比漏填更糟的错填）。
        if not _placeholder_owners_excluded(control, placeholder):
            return None
        best = _longest_synonym(tier1, synonyms)
        return (1, best) if best > 0 else None
    # 光杆「请输入 / 请选择」：占位符没在陈述字段（见 ``_states_its_field``），但也**不许**
    # 掉进整段旁文——只认旁文**开头那一段**，它通常就是这个控件的真标签。
    if _bare_prefix_placeholder(placeholder):
        head = _leading_label_segment(control.nearby_text).casefold()
        best = _longest_synonym(head, synonyms)
        return (0, best) if best > 0 else None
    # 裸占位符：站点把标签直接写进占位符（"姓名"/"邮箱"/"国籍"），不带"请输入"前缀。
    # 2026-10-05 鹰角 apply 页实测：这类占位符一对一指向控件、写得清清楚楚，不该被
    # 排除在证据之外——否则框掉进旁文档，又被整表标签列表污染成"多字段并列"而全体
    # 放弃（姓名/邮箱/国籍全进"没认出来"）。命中按占位符档计；没命中**不截断**旁文
    # ——"年"/"月"这类短提示不在字段目录里，旁文（"毕业时间"）仍是年月组件唯一
    # 可用的信号。并列消歧的占位符同样只跳过这一档、不截断旁文。
    if placeholder and not _placeholder_leaders_conflict(placeholder):
        best = _longest_synonym(placeholder, synonyms)
        if best > 0:
            return (2, best)
    for tier, hay in ((1, tier1), (0, control.nearby_text.casefold())):
        best = _longest_synonym(hay, synonyms)
        if best > 0:
            return (tier, best)
    return None


def competing_fields(
    control: Control,
    field_name: str,
    fields: dict[str, tuple[str, ...]] | None = None,
) -> tuple[str, ...]:
    """同一控件上、与 ``field_name`` **同档同分并列**的其它字段。

    与 ``has_ambiguous_field_evidence`` 的分工：那个是"高风险字段并列 → 干脆不猜"；
    这个只回答"还有谁在争这个控件"，由调用方标成需确认。

    2026-10-05 实测的缺口：一个旁文为「学校名称 专业名称」的框，school 与 major
    同档同分并列，现有低置信判据（比的是**同一字段自己的**冠亚军控件）看不见这种
    "跨字段争抢"，于是按字段表顺序静默硬分——填错格且用户毫无提示。

    ``_pair_resolved_elsewhere`` 已经裁决掉的不算并列：start/end 靠 date_order、
    多段经历靠区块、同义冗余与主字段↔逐条变体各有着落，那些"并列"是常态不是事故。
    命中负向词或跨族否决的字段也不是真竞争者——它本来就无权认领这个控件。
    """
    if fields is None or fields is FIELD_SYNONYMS:
        return _competing_fields_default(control, field_name)
    return _competing_fields_for(control, field_name, fields)


@lru_cache(maxsize=8192)
def _competing_fields_default(control: Control, field_name: str) -> tuple[str, ...]:
    """默认字段目录下的记忆化入口。

    结果只依赖控件与字段目录（目录固定），按 (控件, 字段) 记忆化——与同文件
    ``evidence_key`` / ``excluded_by_hints`` 同款。低置信判定对每条最终映射都要问
    一次"还有谁在争"，不缓存就是「映射数 × 全字段」次目录循环（2026-10-05 性能审查）。
    """
    return _competing_fields_for(control, field_name, FIELD_SYNONYMS)


def _competing_fields_for(
    control: Control,
    field_name: str,
    fields: dict[str, tuple[str, ...]],
) -> tuple[str, ...]:
    synonyms = fields.get(field_name)
    if synonyms is None or control.date_part():
        return ()
    my_key = evidence_key(control, field_name, synonyms)
    if my_key is None:
        return ()
    competitors: list[str] = []
    for other_name, other_synonyms in fields.items():
        if other_name == field_name or _pair_resolved_elsewhere(field_name, other_name):
            continue
        if excluded_by_hints(control, other_name) or foreign_marker(control, other_name):
            continue
        other_key = evidence_key(control, other_name, other_synonyms)
        if other_key is None or other_key[0] != my_key[0]:
            continue
        if abs(other_key[1] - my_key[1]) < 2:
            competitors.append(other_name)
    return tuple(competitors)


def _longest_synonym(hay: str, synonyms: tuple[str, ...]) -> int:
    """``hay`` 里命中的最长同义词长度；一个都没命中返回 0。"""
    best = 0
    for synonym in synonyms:
        needle = synonym.casefold()
        if needle and needle in hay:
            best = max(best, len(needle))
    return best


def _start_end_base(field_name: str) -> str | None:
    """``education_start`` → ``"education"``；非 start/end 配对字段返回 ``None``。"""
    if field_name.endswith(("_start", "_end")):
        return field_name.rsplit("_", 1)[0]
    return None


# 逐条资料字段的家族前缀，与 ``repeated_fields.py`` 里 ``family_for_field`` 的
# 家族列表保持一致（那边是权威，改家族时两边同步）。
_REPEATED_FAMILY_PREFIXES = (
    "experience_",
    "project_",
    "award_",
    "campus_",
    "education_",
    "academic_",
    "language_",
    "certificate_",
    "skill_",
    "contact_",
    "portfolio_",
    "social_",
)


def _repeated_variant_base(field_name: str) -> str | None:
    """逐条资料字段的主体名：``education_laboratory`` → ``"laboratory"``。

    逐条资料目录（``repeated_profile_additions.py``）是主字段目录的补充——同一份
    语义、不同的记录位置，字段名即「家族前缀 + 主字段名」。非逐条字段返回 ``None``。
    """
    for prefix in _REPEATED_FAMILY_PREFIXES:
        if field_name.startswith(prefix):
            return field_name[len(prefix) :]
    return None


def _pair_resolved_elsewhere(field_name: str, other_name: str) -> bool:
    """并列的两个字段是否已经由**占位符之外**的机制区分。

    有四种情形不必消歧——它们各有自己的裁决者，占位符并列是常态而非事故：

    - **start/end 家族**（``education_start`` ↔ ``education_end``，以及跨家族的
      ``education_start`` ↔ ``experience_start``）：这类字段的哲学本就是"文本说不清、
      靠结构裁决"——开始/结束靠 ``date_order``，跨区块靠区块机制，DOM 顺序兜底
      （"起止时间"写在好几个家族的同义词里，占位符写全它就必然并列）；
    - **同义冗余字段**（``courses`` ↔ ``education_courses``）：同义词逐字相同，
      资料值也是同一份，填谁都是对的；
    - **互不相同的区块限定**（``experience_description`` ↔ ``project_description``）：
      各自锁死在「实习经历」「项目经历」区块里，由区块机制区分；
    - **主字段 ↔ 逐条变体**（``laboratory`` ↔ ``education_laboratory``）：逐条资料
      目录是主目录的补充，同义词天然重叠（"请输入实验室"对两者同分）；填谁都是
      实验室，field_order/区块机制裁决即可。
    """
    my_base = _start_end_base(field_name)
    if my_base and _start_end_base(other_name):
        return True
    my_variant = _repeated_variant_base(field_name)
    if my_variant == other_name or _repeated_variant_base(other_name) == field_name:
        return True
    # 同义冗余按**集合**比（顺序无关）：逐条资料的 contact_* 组与主目录的
    # emergency_contact_* 是同一份紧急联系人数据的两个槽位，同义词几乎相同但
    # 各差一条——按元组逐字比认不出这对"同义冗余"，占位符「请输入与本人关系」
    # 会被两个并列最高分判成说不清，整框进"没认出来"（2026-10-06 实测）。
    if set(FIELD_SYNONYMS.get(field_name) or ()) == set(FIELD_SYNONYMS.get(other_name) or ()):
        return True
    my_block = FIELD_BLOCK_HINTS.get(field_name)
    other_block = FIELD_BLOCK_HINTS.get(other_name)
    return bool(my_block and other_block and my_block != other_block)


@lru_cache(maxsize=1024)
def _placeholder_leaders(placeholder: str) -> tuple[str, ...]:
    """占位符在全字段目录下的并列最高分字段。

    `_placeholder_leaders_conflict` 与 `_placeholder_owners_excluded` 共用这一次
    全表计分（~136 个字段 × 各自同义词，按占位符原文缓存——同一页面上占位符
    高度重复，只算一次）。
    """
    scores = {
        name: _longest_synonym(placeholder, synonyms)
        for name, synonyms in FIELD_SYNONYMS.items()
    }
    top = max(scores.values(), default=0)
    if top <= 0:
        return ()
    return tuple(name for name, score in scores.items() if score == top)


@lru_cache(maxsize=1024)
def _placeholder_leaders_conflict(placeholder: str) -> bool:
    """占位符在**全字段目录**下的最高分，是否被多个互不配对的字段并列。

    占位符是仅次于 autocomplete 的权威信号——但权威性恰恰建立在"一对一"上。
    2026-10-05 拼多多页实测：占位符「请输入毕业学校专业」同时命中 school（"学校"
    2 字）与 major（"专业"2 字），同档同分，按 field_order 让 school 抢走，
    大学名被填进了专业框。两个不同字段对同一占位符并列最高分时，继续"择优"
    是猜，不是识别。

    返回 ``True`` 表示该占位符已说不清自己要什么：``evidence_key`` 对**所有**
    字段如实报"认不出"——宁可漏填，不可错填。
    """
    leaders = _placeholder_leaders(placeholder)
    if not leaders:
        return False
    for i, first in enumerate(leaders):
        for second in leaders[i + 1 :]:
            if not _pair_resolved_elsewhere(first, second):
                return True
    return False


def _placeholder_owners_excluded(control: Control, placeholder: str) -> bool:
    """占位符点名的**全部**并列字段，都在这个控件上被负向词拦下。

    拦截来源与 ``excluded_by_hints``（规则引擎 / 实时识别 / AI 守门共用）一致：
    紧急联系人、亲属栏里的「请输入姓名 / 请输入电话」框，本人字段（name / phone）
    被 RELATIVE_HINTS 拦下——这时占位符"这个框是姓名"的权威声明已经没有合法
    主人了。只要有任何一个并列字段仍有权认领，权威就照旧（保守：只对"两头落空"
    的框放行回退）。
    """
    leaders = _placeholder_leaders(placeholder)
    return bool(leaders) and all(excluded_by_hints(control, name) for name in leaders)


# 「请输入 / 请选择 / 请填写」之后什么都不剩，就说明占位符没在陈述任何字段。
_EMPTY_PLACEHOLDER_TAIL = " 　*＊:：,，.。…·-—_()（）[]【】"
# 长说明文里的指导语：出现它说明这段文字在教用户怎么填，而不是在点名一个字段。
_INSTRUCTION_MARKERS = ("您可以", "建议", "例如", "格式填写", "如：", "比如")


def _placeholder_prefix_tail(placeholder: str) -> str | None:
    """「请输入 / 请选择 / 请填写」之后的剩余文字；不以这三种开头时返回 ``None``。"""
    stripped = placeholder.strip()
    for prefix in ("请输入", "请选择", "请填写"):
        if stripped.startswith(prefix):
            return stripped[len(prefix) :]
    return None


def _bare_prefix_placeholder(placeholder: str) -> bool:
    """光杆「请输入 / 请选择 / 请填写」：有前缀，但后面不含任何字段信息。"""
    tail = _placeholder_prefix_tail(placeholder)
    return tail is not None and not tail.strip(_EMPTY_PLACEHOLDER_TAIL)


def _states_its_field(placeholder: str) -> bool:
    """占位符是不是在**陈述这个框要什么**（"请输入导师" / "请选择学历" / "请填写证件号码"）。

    这类占位符一对一属于输入框本身、实测在该页面上每个文本控件都写对了，
    因此可以当权威用；``nearby_text`` 则可能混进邻居的标签（见 ``evidence_key``）。

    主要认这三种前缀；「如有…填写」是少数仍然一对一指向当前输入框的网申提示，
    由 evidence_key 单独按短文案和字段同义词处理，其他说明文字仍不当作字段名。

    **两种"有前缀但不算陈述"的情形**（2026-10-05 真机实测后补）：

    - **光杆「请输入 / 请选择」**：不含任何字段信息，是装饰不是陈述。京东校招页的
      姓名 / 手机号码 / 电子邮箱三个框占位符都是"请输入"，真标签在旁文（"*姓名:"）里——
      当成权威会把三个最基础的框全拦成"认不出"。
    - **长说明文**（多行，或带"您可以…建议…"这类指导语）：它在教怎么填，不是点名字段。
      腾讯校招的"补充信息"框实测：占位符把 自我评价 / 爱好特长 / 补充信息 三个概念揉进
      一段建议里，按权威解析会因"并列"整个放弃；退回旁文后由它的真标签（"补充信息*"）
      一对一命中。
    """
    stripped = placeholder.strip()
    tail = _placeholder_prefix_tail(stripped)
    if tail is None or not tail.strip(_EMPTY_PLACEHOLDER_TAIL):
        return False
    return not (
        len(stripped) > 40 and ("\n" in stripped or any(marker in stripped for marker in _INSTRUCTION_MARKERS))
    )


def _leading_label_segment(text: str) -> str:
    """旁文开头的一段（第一个空白之前）——光杆占位符控件的真标签通常就在这儿。

    只在光杆占位符的回退里用：**不能拿整段旁文**——那可能是区块/整表级文本，
    会把属于别的控件的词带进来（鹰角页实测：学历框的旁文里带着整块教育背景的
    "就读时间"，用整段会把学历填成入学时间）。
    """
    head = re.split(r"[\s　]+", text.strip(), maxsplit=1)[0]
    return head.strip(" 　-—*＊:：")
