# SPDX-License-Identifier: Apache-2.0
"""资料箱附件上传的请求体预算守卫。

背景：``POST /api/materials/attachments`` 端点自身按 10 MB 校验单个文件，但请求体
中间件的全局默认是 8 MB。如果附件路径没被登记进 ``larger_body_paths``，一个 9 MB 的
PDF 会在进入端点前就被中间件以「请求体过大，最大允许 8 MB」拦下 —— 用户看到的提示
和真实原因不符，且 ``accept`` 里写着支持 PDF/Word 也没意义。

这条守卫把「端点能收 10 MB」与「中间件放行到 10 MB 以上」钉在一起；同时反证全局
默认没有被顺手放宽（共享安全参数不能被单个功能带着一起改）。
"""

from __future__ import annotations

from app.api import materials
from app.application import create_app
from app.config import get_settings
from app.middleware.request_context import RequestContextMiddleware


def _request_context_layer():
    app = create_app()
    layers = [item for item in app.user_middleware if item.cls is RequestContextMiddleware]
    assert layers, "RequestContextMiddleware 没有装配，请求体预算检查失效"
    return layers[0]


def test_material_attachment_path_is_registered_for_a_larger_body():
    """附件路径必须在更宽请求体名单里，且额度足以覆盖端点自己的 10 MB 校验。"""
    layer = _request_context_layer()
    larger = layer.kwargs["larger_body_paths"]

    path = materials.ATTACHMENT_UPLOAD_PATH
    assert path == "/api/materials/attachments", "附件上传路径变了，同步 application.py 的登记"
    assert path in larger, (
        f"附件路径没有登记进 larger_body_paths，8–10MB 文件会被中间件先拦下：{path}"
    )

    endpoint_limit = materials.MAX_MATERIAL_ATTACHMENT_BYTES
    assert larger[path] > endpoint_limit, (
        "中间件额度必须大于端点校验值，否则端点那句 10 MB 的提示永远走不到："
        f"middleware={larger[path]} endpoint={endpoint_limit}"
    )


def test_global_body_limit_is_not_widened_by_the_attachment_exception():
    """反证：附件放宽不能顺带把全局默认抬上去（共享安全参数）。"""
    layer = _request_context_layer()
    settings = get_settings()

    assert layer.kwargs["max_body_bytes"] == settings.max_request_body_mb * 1024 * 1024
    assert settings.max_request_body_mb == 8, "全局默认变了，需要单独评审而不是跟着附件改动"
    assert settings.max_attachment_upload_mb >= 12


def test_sibling_material_paths_keep_the_global_limit():
    """同前缀的其它资料接口仍走全局默认，避免「放宽一个上传口」变成「整个域都放宽」。"""
    layer = _request_context_layer()
    larger = layer.kwargs["larger_body_paths"]

    for sibling in (
        "/api/materials",
        "/api/materials/batch-delete",
        "/api/materials/attachments-x",
    ):
        assert sibling not in larger, f"{sibling} 不应继承附件的放宽额度"
