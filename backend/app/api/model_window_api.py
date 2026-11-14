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
)


def register_model_window_routes(router: APIRouter) -> None:
    """把只读接口挂到已存在的 /api/settings router 上（幂等：只挂一次）。"""

    @router.get("/model-windows", response_model=ModelWindowReferenceOut)
    def read_model_windows(db: Session = Depends(get_db)) -> ModelWindowReferenceOut:
        config = get_llm_config(db)
        resolved = configured_model_window(config)
        rule = matched_window(config.model)
        return ModelWindowReferenceOut(
            default_tokens=DEFAULT_CONTEXT_WINDOW,
            entries=[
                ModelWindowEntry(label=item.label, tokens=item.tokens, reference=item.reference)
                for item in MODEL_WINDOWS
            ],
            current=CurrentModelWindow(
                model=config.model,
                label=rule.label if rule is not None else None,
                tokens=resolved.tokens,
                source=resolved.source,
            ),
        )
