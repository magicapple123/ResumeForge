"""数据模型：Control / FieldMapping / SkipNote / MatchResult / ApplyOutcome 与控件类型常量。"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..matching import DateResolution, SelectOption, SelectResolution, is_placeholder

# 中英文括号内的整段内容（安全词判定前先去掉：括号里是提示/举例，不是控件名）。
_PARENTHETICAL = re.compile(r"[（(][^）)]*[）)]")

_DEPENDENT_SELECT_WAIT_SECONDS = 2.0
_DEPENDENT_SELECT_POLL_SECONDS = 0.1
# 回读不一致时复读一次的等待（秒）：受控组件把内部状态落定有延迟，"填了立刻读"
# 可能读到还没更新的旧值。只在**不一致**时才等，happy path 仍是一次回读。
_RECHECK_DELAY_SECONDS = 0.2

CONTROL_TYPES = (
    "text",
    "textarea",
    "select",
    "radio",
    "checkbox",
    "richtext",
    "file",
    "date",
    "month",
    "email",
    "tel",
    "number",
    "unknown",
)



@dataclass(frozen=True)
class Control:
    """页面上的一个可见控件。"""

    index: int
    type: str = "unknown"
    name: str = ""
    label: str = ""
    placeholder: str = ""
    aria_label: str = ""
    aria_labelledby: str = ""
    aria_describedby: str = ""
    legend: str = ""
    title: str = ""
    element_id: str = ""
    # HTML 标准的字段类型提示（`autocomplete` 属性）。**唯一不需要猜的信号**——
    # 规范写得好的表单会带，Chrome 的自动填充也把它当第一优先级。
    autocomplete: str = ""
    required: bool = False
    # 框自身的长度上限（HTML ``maxlength``；0 表示没有限制）。**脚本 set 值会绕过它**，
    # 但页面校验/后续处理仍按这个上限截断——超长的值写进去只会剩前半截。
    max_length: int = 0
    # 只读输入框：值不由用户敲进来，**脚本写得进去、组件的状态却不会变**。级联选择器
    # （省/市/区那类）的输入框几乎都是这个形状，所以不能当普通文本框填。
    readonly: bool = False
    # 点开会弹层的输入框（`aria-haspopup` / `role=combobox`）：自定义下拉、级联选择器。
    # 同样不该直接写值——值该由点选产生。
    has_popup: bool = False
    # 原生 `<select>` 的联动标记；只有它允许在填充阶段重新读取 options。
    linked_select: bool = False
    selector: str = ""
    options: tuple[SelectOption, ...] = ()
    nearby_text: str = ""
    # 重复区块信息。已知时参与严格匹配；为空时兼容旧快照和结构不规范的页面。
    block_label: str = ""
    block_family: str = ""
    block_index: int | None = None
    date_group: str = ""
    date_part_name: str = ""
    date_part_label: str = ""
    # 同一区块内两个日期框经常拥有完全相同的文案，采集 DOM 顺序作为额外证据。
    date_order: int | None = None
    # 单选/复选的同组标识（``n:<name>`` 或 ``g:<容器序号>``）。空 = 不属于任何组。
    group: str = ""
    # ===== 当前状态（2026-09-26 新增：判断"用户已经填过"必须靠它）=====
    value: str = ""
    display: str = ""
    checked: bool = False
    # 派生文本（own_text / signature / date_part）的**实例级缓存**。frozen 字段本身
    # 不可变，这些纯派生值算一次就够；dict 本体可变，原地写入不算改字段。
    # init=False 不进构造签名（dataclasses.replace 出来的新实例拿全新缓存），
    # compare=False 不影响相等性与哈希，repr=False 不改显示。
    # 为什么要有它：匹配热路径上同一控件的 signature() 会被**每个字段**各问一次
    # （excluded_by_hints / block_hint_satisfied / has_ambiguous_field_evidence），
    # 不缓存就是「全表字段 × 全部控件」次重复 join + casefold；2026-10-05 性能审查
    # 估算长表单一次预览会放大到几十万次。
    _cache: dict[str, object] = field(
        default_factory=dict, init=False, repr=False, compare=False
    )

    def own_text(self) -> str:
        """控件**自己说的**：标签 / 占位符 / aria-label / name。

        与 ``nearby_text``（周围文字）分开，是因为两者的可信度不同——见 ``_best_control``。
        """
        cached = self._cache.get("own_text")
        if cached is None:
            cached = " ".join(
                part
                for part in (
                    self.label,
                    self.placeholder,
                    self.aria_label,
                    self.aria_labelledby,
                    self.legend,
                    self.title,
                    self.name,
                    self.element_id,
                )
                if part
            ).casefold()
            self._cache["own_text"] = cached
        return cached

    def signature(self) -> str:
        """用于启发式匹配的文本指纹（小写，便于包含判断）。"""
        cached = self._cache.get("signature")
        if cached is None:
            cached = " ".join(
                part
                for part in (
                    self.own_text(),
                    self.block_label,
                    self.nearby_text,
                    self.aria_describedby,
                )
                if part
            )
            self._cache["signature"] = cached
        return cached

    def date_part(self) -> str | None:
        """识别「年 / 月 / 日」这种把一个日期拆成多个下拉的控件。"""
        # 结果可能是 None（不是日期组件），缓存命中判断用「键存在」而不是判空。
        if "date_part" in self._cache:
            return self._cache["date_part"]  # type: ignore[return-value]

        def _compute() -> str | None:
            if self.date_part_name in {"year", "month", "day"}:
                return self.date_part_name
            for raw in (self.label, self.placeholder, self.aria_label, self.name, self.element_id):
                text = re.sub(r"[\s*＊:：()（）\[\]【】<>〈〉]", "", str(raw or "").casefold())
                if not text:
                    continue
                if text in {"年", "年份", "year", "yyyy"} or text.endswith(("年份", "year")):
                    return "year"
                if text in {"月", "月份", "month", "mm"} or text.endswith(("月份", "month")):
                    return "month"
                if text in {"日", "日份", "day", "dd"} or text.endswith(("日", "day")) and not text.endswith("日期"):
                    return "day"
            return None

        result = _compute()
        self._cache["date_part"] = result
        return result

    def security_text(self) -> str:
        """用于不可逆安全拦截的控件自述文本，不包含共享旁文或描述文字。

        ``nearby_text`` / ``aria_describedby`` 适合帮助识别字段，但它们可能复用整页或整块
        说明。网申页面常在作品链接说明里写“如有密码”，不能因此把姓名、邮箱等控件一起拦下。

        **括号里的内容也去掉**：那是在提示/举例（"如作品无法上传，请提供作品网盘链接
        （如有密码，用分号分隔）"——2026-10-05 鹰角页实测，整个作品链接框因此被"密码"
        误拦成永不填写），不是在给控件命名。真密码框的名字写在括号外（"密码"/"请输入密码"）。
        """
        text = " ".join(part for part in (self.own_text(), self.block_label) if part).casefold()
        return _PARENTHETICAL.sub(" ", text)

    def is_filled(self) -> bool:
        """这个控件页面上已经有值了吗（用于"不覆盖用户已填的值"）。"""
        if self.type in ("radio", "checkbox"):
            return self.checked
        if self.type == "select":
            if not self.options:
                return bool(self.value)
            for option in self.options:
                if option.value == self.value or option.display() == self.display:
                    return not is_placeholder(option.display())
            return bool(self.value)
        return bool(self.value.strip())

    def current_display(self) -> str:
        """给用户看的"页面上现在是什么"。"""
        if self.type in ("radio", "checkbox"):
            return "已勾选" if self.checked else ""
        return self.display or self.value


@dataclass(frozen=True)
class FieldMapping:
    """一条"字段 → 控件"的映射，连同它是怎么被决定的。"""

    control: Control
    field: str
    value: str
    # 文本类无需决策；下拉/单选带上选中的那个选项；日期带上粒度信息。
    select: SelectResolution | None = None
    date: DateResolution | None = None
    # 冠军得分比亚军高出不足这个差值时标为需确认（见 ``_best_control``）。
    low_confidence: bool = False

    def write_value(self) -> str:
        """真正写进页面的那个值（下拉要用 option 的 value，不是展示文本）。"""
        if self.select is not None and self.select.option is not None:
            return self.select.option.value
        if self.date is not None:
            return self.date.value
        return self.value


@dataclass(frozen=True)
class SkipNote:
    """被刻意跳过的控件，附原因（预览里要如实展示）。"""

    control: Control
    reason: str


@dataclass(frozen=True)
class MatchResult:
    """一次匹配的全部产物。"""

    mappings: list[FieldMapping] = field(default_factory=list)
    unmatched: list[Control] = field(default_factory=list)
    skipped: list[SkipNote] = field(default_factory=list)


@dataclass(frozen=True)
class ApplyOutcome:
    """单个控件的填充结果。"""

    index: int
    field: str
    status: str  # filled | skipped | failed | conflict | unverified
    detail: str = ""
    # 失败 / 未验证的**机器可读**原因码（见 recovery.py）：上报计数与重试决策都用它，
    # 中文 ``detail`` 只给人看。
    reason: str = ""
    # 这个控件实际尝试了几次（含首次）；上限见 recovery.MAX_RETRIES。
    attempts: int = 1
