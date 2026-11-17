# SPDX-License-Identifier: Apache-2.0
"""「模型窗口参考」只读接口：把内置窗口表原样给界面，并标出当前模型命中的是哪一条。

为什么单独一个模块：``app/api/settings.py`` 已贴 500 行硬预算，这个接口又只读、无写入，
挂到同一个 ``/api/settings`` router 上即可（与上下文压缩设置同一做法）。

边界：只下发"型号名 / 窗口 / 官方链接"，不下发正则、配置、密钥——正则属于实现细节，
用户要的是"这家多少"，不是"怎么匹配的"。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.model_window import (
    CurrentModelWindow,
    ModelWindowEntry,
    ModelWindowReferenceOut,
)
from ..services.llm_settings import get_llm_config
from ..services.model_context_windows import (
    DEFAULT_CONTEXT_WINDOW,
    MODEL_WINDOWS,
    configured_model_window,
    matched_window,
    resolve_model_window,
)


def register_model_window_routes(router: APIRouter) -> None:
    """把只读接口挂到已存在的 /api/settings router 上（幂等：只挂一次）。"""

    @router.get("/model-windows", response_model=ModelWindowReferenceOut)
    def read_model_windows(
        model: str | None = None, db: Session = Depends(get_db)
    ) -> ModelWindowReferenceOut:
        """`?model=` 是可选的：带上它只查「参考表说这个型号是多少」。

        为什么要这个参数：设置弹窗里的型号可能**还没保存**（用户刚换的），而「填入参考值」
        要的是那张表对这个型号的判断。带参时**不看**当前配置里的手填值——用户问的是
        "表里多少"，掺进手填值就成了另一种问题（那正是 `current` 不带参时的语义）。
        不带参（或空串）时行为与加这个参数之前逐字一致：按当前生效配置解析。
        """
        explicit_model = (model or "").strip()
        config = get_llm_config(db)
        if explicit_model:
            resolved = resolve_model_window(explicit_model)
            rule = matched_window(explicit_model)
            target = explicit_model
        else:
            resolved = configured_model_window(config)
            rule = matched_window(config.model)
            target = config.model
        return ModelWindowReferenceOut(
            default_tokens=DEFAULT_CONTEXT_WINDOW,
            entries=[
                ModelWindowEntry(label=item.label, tokens=item.tokens, reference=item.reference)
                for item in MODEL_WINDOWS
            ],
            current=CurrentModelWindow(
                model=target,
                label=rule.label if rule is not None else None,
                tokens=resolved.tokens,
                source=resolved.source,
            ),
        )
