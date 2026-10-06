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
    AUTOCOMPLETE_DENY as AUTOCOMPLETE_DENY,
)
from ..fields import (
    AUTOCOMPLETE_FIELDS as AUTOCOMPLETE_FIELDS,
)
from ..fields import (
    CLAIM_LABELS as CLAIM_LABELS,
)
from ..fields import (
    CONSENT_HINTS as CONSENT_HINTS,
)
from ..fields import (
    FIELD_BLOCK_HINTS as FIELD_BLOCK_HINTS,
)
from ..fields import (
    FIELD_DENYLIST as FIELD_DENYLIST,
)
from ..fields import (
    FIELD_EXCLUDE_HINTS as FIELD_EXCLUDE_HINTS,
)
from ..fields import (
    FIELD_PREFERRED_TYPES as FIELD_PREFERRED_TYPES,
)
from ..fields import (
    FIELD_SYNONYMS as FIELD_SYNONYMS,
)
from ..matching import (
    DateResolution as DateResolution,
)
from ..matching import (
    SelectOption as SelectOption,
)
from ..matching import (
    SelectResolution as SelectResolution,
)
from ..matching import (
    date_component as date_component,
)
from ..matching import (
    format_date as format_date,
)
from ..matching import (
    is_date_hint as is_date_hint,
)
from ..matching import (
    is_placeholder as is_placeholder,
)
from ..matching import (
    meaningful_options as meaningful_options,
)
from ..matching import (
    resolve_choice as resolve_choice,
)
from ..matching import (
    resolve_select_option as resolve_select_option,
)
from ..repeated_fields import (
    compatible_block as compatible_block,
)
from ..repeated_fields import (
    family_for_field as family_for_field,
)
from ..repeated_fields import (
    field_key_for_block as field_key_for_block,
)
from ..repeated_fields import (
    parse_block_label as parse_block_label,
)
from ..repeated_fields import (
    split_repeated_key as split_repeated_key,
)
from .core import FormEngine
from .evidence import (
    _longest_synonym as _longest_synonym,
)
from .evidence import (
    _states_its_field as _states_its_field,
)
from .evidence import (
    block_hint_satisfied as block_hint_satisfied,
)
from .evidence import (
    competing_fields as competing_fields,
)
from .evidence import (
    evidence_key as evidence_key,
)
from .evidence import (
    excluded_by_hints as excluded_by_hints,
)
from .evidence import (
    has_ambiguous_field_evidence as has_ambiguous_field_evidence,
)
from .families import foreign_marker as foreign_marker
from .model import (
    _DEPENDENT_SELECT_POLL_SECONDS as _DEPENDENT_SELECT_POLL_SECONDS,
)
from .model import (
    _DEPENDENT_SELECT_WAIT_SECONDS as _DEPENDENT_SELECT_WAIT_SECONDS,
)
from .model import (
    CONTROL_TYPES,
    ApplyOutcome,
    Control,
    FieldMapping,
    MatchResult,
    SkipNote,
)
from .scripts import _CONTROL_HELPERS_JS as _CONTROL_HELPERS_JS
from .scripts import CONTROLS_SCRIPT
from .scripts import FOCUS_LISTENER_SCRIPT as FOCUS_LISTENER_SCRIPT
from .writers import (
    _PROTOTYPE_BY_TYPE as _PROTOTYPE_BY_TYPE,
)
from .writers import (
    _read_back_script as _read_back_script,
)
from .writers import (
    _read_select_options_script as _read_select_options_script,
)
from .writers import (
    _select_option_script as _select_option_script,
)
from .writers import (
    _set_richtext_script as _set_richtext_script,
)
from .writers import (
    _set_value_script as _set_value_script,
)

# ``relaxed_kind`` 定义在 ``FormEngine`` 上（与 ``skip_reason`` 对称），这里给一个
# 模块级别的名字，供服务层 ``from ..engine import relaxed_kind`` 使用。
relaxed_kind = FormEngine.relaxed_kind

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
