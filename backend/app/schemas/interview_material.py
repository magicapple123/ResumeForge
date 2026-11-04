# SPDX-License-Identifier: Apache-2.0
"""面试材料导入（#41）的请求/响应结构。

从 ``schemas/interview.py`` 拆出来的又一次机械搬迁：那一份已经贴到 500 行预算，而材料
这一组（上传 DTO + 写端点用的已提取材料）与面试会话本身没有共同状态，边界干净。

两侧接受**同一组格式**（图片 / PDF / TXT / Word / Markdown，问题 6）：``kind`` 只表示
"放哪一侧"（界面左右栏），解析路径由文件类型决定，见 ``services/document_text`` 与
``services/interview/interview_material``。
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# 导入材料的正文上限（#41，问题 6 把文本与图片统一到 20,000）：防"前端塞一大段进来"的闸。
# 必须等于 ``document_text.MAX_DOCUMENT_TEXT_CHARS``，测试 test_extracted_len_is_bounded 钉住。
MAX_MATERIAL_TEXT_CHARS = 20_000

# 材料来源（#41）：``kind`` 只表示"放哪一侧"，不决定接受什么格式；解析路径由文件类型决定。
MaterialKind = Literal["job", "resume"]


class InterviewMaterialIn(BaseModel):
    """一份**已提取**的导入材料：文件名 + 正文。

    为什么提交的是提取后的文本、而不是再传一次文件：提取发生在 ``/interview/materials``
    上传那一刻，用户当场就能看到"解析成功 / 识别出多少字 / 有哪些警告"；开面试时只把
    结果带进会话（快照），不需要为同一份文件解析两遍，也不会在开场那十几秒里再插入一次
    可能失败的 OCR。
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(default="", max_length=256)
    text: str = Field(min_length=1, max_length=MAX_MATERIAL_TEXT_CHARS)

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("导入的材料没有可用的文字内容")
        return cleaned


class InterviewMaterialExtract(BaseModel):
    """上传端点的返回：文件名、正文、警告，以及正文是怎么来的（``parser``）。"""

    name: str
    text: str
    warnings: list[str] = Field(default_factory=list)
    # text = 本机提取，vision = 视觉识别（图片 / 扫描件 PDF）；两侧格式统一后只能按实际路径说。
    parser: Literal["text", "vision"] = "text"
