# SPDX-License-Identifier: Apache-2.0
"""生成步骤不变式助手 _require：缺失即大声失败（T9 复核的防御分支）。"""

import pytest
from app.services.resume.resume_generator_steps import _require


def test_require_returns_the_value_when_present() -> None:
    assert _require(0, "budget") == 0


def test_require_raises_with_the_step_name_when_missing() -> None:
    with pytest.raises(RuntimeError, match="生成步骤状态缺失：fact_sections"):
        _require(None, "fact_sections")
