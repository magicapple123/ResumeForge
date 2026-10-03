"""网申填表接口（prefix ``/api/webform``）。

薄路由：只做校验、调 service、返回 schema；错误统一 ``HTTPException(status, detail=中文)``。

**这个功能只填不交**：这里没有任何"提交表单"的接口，service 层也没有对应的实现
（``tests/test_webform_no_submit.py`` 把这条钉成了不变量）。填完由用户在浏览器窗口里
自己核对并点击提交。
"""
from fastapi import APIRouter

from ...services import webform
from ...services.webform import (
    ai as ai,
    extra_profile as extra_profile,
    history as history,
    live_targets as live_targets,
    profile_targets as profile_targets,
    repeated_profile as repeated_profile,
    url_history as url_history,
)
from ...services.webform import browser
from ...services.webform.engine import FormEngine as FormEngine
from . import (
    browser_routes as browser_routes,
    extra_profile_routes as extra_profile_routes,
    fill_routes as fill_routes,
    live_routes as live_routes,
)
from .live_routes import _start_live_session as _start_live_session

# 兼容旧名：原单文件里的模块别名，按 ``app.api.webform.webform_browser`` 取。
webform_service = webform  # patch 契约名：``app.api.webform.webform_service.*``
webform_browser = browser

# 聚合各路由域；include 顺序 = 拆分前的路由注册顺序。
router = APIRouter()
router.include_router(extra_profile_routes.router)
router.include_router(browser_routes.router)
router.include_router(live_routes.router)
router.include_router(fill_routes.router)
