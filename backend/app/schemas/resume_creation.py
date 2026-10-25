# SPDX-License-Identifier: Apache-2.0
"""新建简历的创建态快照 schema（F4 契约 §6 / Lead 2026-10-25 口径）。

POST /api/resumes/manual 的可选 profile_context：前端把打开新建面板时读到的
PaperProjectionOut.snapshot_token 与来源布局回传，服务端据此判断"用户看到的来源是否
仍然有效"，并把创建态 layout 冻结进 profile_usage_snapshot（resume_id 关联，R-33）。

单独成文件的原因很实际：schemas/resume.py 已贴近 500 行硬预算，而这两个模型只服务
创建接口；模块名里的 creation 就是它的边界。校验口径：
- snapshot_token 必填（空串没有意义，直接 422）；
- participating_keys / layout 是展示与追溯的**辅助信息**，权威值由服务端按 token 对应的
  当前投影重新冻结，因此这里只做长度上限，不信任客户端计数。
"""

from pydantic import BaseModel, Field


class ProfileContextLayoutItem(BaseModel):
    """来源面板显示的一个分区（只做展示/追溯输入，服务端不照抄）。"""

    section_key: str = Field(default="", max_length=48)
    section_name: str = Field(default="", max_length=40)
    entry_count: int = Field(default=0, ge=0, le=200)


class ProfileContextIn(BaseModel):
    """创建态资料快照入参：token 必须等于当前投影的 snapshot_token。"""

    snapshot_token: str = Field(min_length=1, max_length=128)
    participating_keys: list[str] = Field(default_factory=list, max_length=64)
    layout: list[ProfileContextLayoutItem] = Field(default_factory=list, max_length=64)


__all__ = ["ProfileContextIn", "ProfileContextLayoutItem"]
