"""简历接口：流式生成（SSE）、历史记录、预览渲染与导出。

Wave5 拆分后的**聚合门面**：六个路由域各自住在子模块里，本文件只做三件事——
① 组装 ``router`` 并按原文件端点顺序 include；
② 再导出 PDF 响应头常量（``application.py`` 构建 CORS expose_headers 时模块属性读取）；
③ 定义两个 **patch 锚点**（``create_provider`` / ``get_llm_config``）。

**patch 锚点契约**：四个测试文件以 ``monkeypatch.setattr("app.api.resumes.create_provider" /
"…get_llm_config", …)`` 替换这两个名字。锚点必须定义在包命名空间（本文件的显式别名导入），
子模块（generate_routes / ai_edits_routes）以 ``_api.<name>`` 调用期属性访问读取——
**禁止**在任何子模块里对这两个名字做 from-import 具名绑定（会把 patch 静默断开）。

**路由 include 顺序不变量**：``GET /templates``（字面量段）必须先于 ``GET /{resume_id}``
（参数段），否则 ``templates`` 会被当成记录 id 匹配、以 422 结束。当前顺序
templates → generate → crud → ai_edits → layout_render → export 即原文件端点顺序，
满足不变量，不要重排。
"""
from fastapi import APIRouter

from ...services.llm import create_provider as create_provider
from ...services.settings_service import get_llm_config as get_llm_config
from ._shared import (
    PDF_PAGE_LIMIT_HEADER as PDF_PAGE_LIMIT_HEADER,
    PDF_PAGES_HEADER as PDF_PAGES_HEADER,
)
from . import (
    ai_edits_routes,
    crud_routes,
    export_routes,
    generate_routes,
    layout_render_routes,
    templates_routes,
)

router = APIRouter(tags=["resumes"])

# include 顺序 = 原文件端点顺序；GET /templates 必须先于 crud 域的 GET /{resume_id}（见模块 docstring）。
#
# prefix 放在 include 调用而非 router 声明：本环境 FastAPI 的 include_router 在前缀参数为空时
# 会校验"被包含 router 不得存在空路径"，而 crud 域的 GET ""（list_resumes）正是空路径；
# 该校验不参考父 router 自身的 prefix，因此原 ``APIRouter(prefix="/api/resumes")`` 写法无法通过。
# 最终路径拼接公式为 父链 prefix + route.path，两种写法产出的 URL 与 OpenAPI 路径逐字符一致。
router.include_router(templates_routes.router, prefix="/api/resumes")
router.include_router(generate_routes.router, prefix="/api/resumes")
router.include_router(crud_routes.router, prefix="/api/resumes")
router.include_router(ai_edits_routes.router, prefix="/api/resumes")
router.include_router(layout_render_routes.router, prefix="/api/resumes")
router.include_router(export_routes.router, prefix="/api/resumes")
