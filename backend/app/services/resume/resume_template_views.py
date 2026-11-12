# SPDX-License-Identifier: Apache-2.0
"""简历模板的响应视图与面向前端的固定文案。

``STYLE_OFFLINE_DETAIL`` 与 ``template_detail`` 原先长在 ``api/resume_templates.py``。
``services/actions`` 的 format-template 动作要拿同一句文案与同一份详情视图，只能反向
import 路由模块。文案与视图都是"这个东西对外长什么样"的唯一实现，跟着服务走，
路由侧与工具侧才不会各说一套。
"""

from __future__ import annotations

from ...models.resume_template import ResumeTemplate
from ...schemas.resume_template import ResumeTemplateDetail

# 自制样式模板（kind='style'）已下线（2026-11）。错误文案只写**原因**，动作由前端拼
# （见 docs/ui-copy-guide.md §2.4 与 tests/test_detail_copy.py）。
STYLE_OFFLINE_DETAIL = "自制模板已下线，只能创建版式"


def template_detail(template: ResumeTemplate) -> ResumeTemplateDetail:
    return ResumeTemplateDetail.model_validate(template)


__all__ = ["STYLE_OFFLINE_DETAIL", "template_detail"]
