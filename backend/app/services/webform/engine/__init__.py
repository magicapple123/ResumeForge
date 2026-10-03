"""通用表单理解与填写引擎（站点无关）。

它回答两个问题：

1. **页面上有哪些可见控件，各是什么类型、当前值是什么**（文本 / 下拉 / 单选 / 复选 /
   富文本 / 文件 / 日期）。
2. **资料里的字段该填到哪个控件里**——靠 ``label`` / ``placeholder`` / ``aria-label`` /
   ``name`` / 邻近文本做启发式映射，而不是把某站点的选择器堆死。

这条"启发式映射 + 站点适配器兜底"的取舍是设计的关键决策：站点选择器会变，字段语义相对
稳定，所以**理解表单**用通用逻辑，**定位站点特有元素**才交给适配器。

## 2026-09-26 从 ``services/apply/`` 迁来并修了五个缺陷

迁到 ``services/webform/`` 是因为它现在真正服务于「网申填表」；投递链路（BOSS）只往聊天框
发招呼语，从不填表单，留着它在 ``apply/`` 只会让依赖方向变成 webform → apply。

修掉的五处（前四处原先都有测试"覆盖"，但那些测试用不执行 JS 的假客户端，只断言脚本字符串
里出现了某个标记，所以全都测不出来）：

1. ``select`` 原先落进 ``else`` 分支，用 ``HTMLInputElement.prototype`` 的 value setter
   作用在 ``<select>`` 上——Chrome 会抛 ``Illegal invocation``。现在单列一个分支。
2. 快照原先**不采集控件当前值**，``options`` 只采文本不采 ``value``。而网申下拉普遍是
   ``<option value="3">本科</option>``——只拿文本无法回填。现在两者都采。
3. ``Control.options`` 采了却从未被消费（没有"值 → 哪个选项"的逻辑）。现在判断在
   ``matching.resolve_select_option`` 里，是纯函数、可穷举测。
4. 单选/复选原先用合成 ``el.click()``（``isTrusted=false``），站点会静默忽略。现在走
   ``browser.interaction.click_selector`` 的可信鼠标事件，且**只在需要改变状态时才点**
   （对已勾选的复选框再点一下会把它取消勾选）。
5. ``file`` 控件原先直接调 ``set_file_input``，但导出管线不落临时文件，没有本地路径可给，
   真实站点上会抛 ``CdpError`` 并**中断整轮填充**。现在 ``match_fields`` 不产生 ``file``
   映射，预览里固定提示"简历附件请自己上传"。

本包由 scripts / writers / model / evidence / core 组成，此 ``__init__`` 作为原
``engine`` 模块路径的兼容门面：``__all__``、来自 ``matching`` 的再导出
（SelectOption / SelectResolution / DateResolution 等）与私有符号保持原命名空间全集，
外部导入路径零改动。
"""
from __future__ import annotations

import logging

from ..fields import (
    AUTOCOMPLETE_DENY,
    AUTOCOMPLETE_FIELDS,
    CLAIM_LABELS,
    CONSENT_HINTS,
    FIELD_BLOCK_HINTS,
    FIELD_DENYLIST,
    FIELD_EXCLUDE_HINTS,
    FIELD_PREFERRED_TYPES,
    FIELD_SYNONYMS,
)
from ..matching import (
    DateResolution,
    SelectOption,
    SelectResolution,
    date_component,
    format_date,
    is_date_hint,
    is_placeholder,
    meaningful_options,
    resolve_choice,
    resolve_select_option,
)
from ..repeated_fields import (
    compatible_block,
    family_for_field,
    field_key_for_block,
    parse_block_label,
    split_repeated_key,
)
from .core import FormEngine
from .evidence import _longest_synonym, _states_its_field, evidence_key
from .model import (
    CONTROL_TYPES,
    ApplyOutcome,
    Control,
    FieldMapping,
    MatchResult,
    SkipNote,
    _DEPENDENT_SELECT_POLL_SECONDS,
    _DEPENDENT_SELECT_WAIT_SECONDS,
)
from .scripts import CONTROLS_SCRIPT, FOCUS_LISTENER_SCRIPT, _CONTROL_HELPERS_JS
from .writers import (
    _PROTOTYPE_BY_TYPE,
    _read_back_script,
    _read_select_options_script,
    _select_option_script,
    _set_richtext_script,
    _set_value_script,
)

logger = logging.getLogger(__name__)

__all__ = [
    "CONTROL_TYPES",
    "CONTROLS_SCRIPT",
    "ApplyOutcome",
    "Control",
    "FieldMapping",
    "FormEngine",
    "MatchResult",
    "SkipNote",
]
