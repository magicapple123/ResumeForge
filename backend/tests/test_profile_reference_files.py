# SPDX-License-Identifier: Apache-2.0
"""个人资料条目"分区参考文件"的退役回归（F2-E 产品决定）。

**产品决定（F2-E）**：旧资料界面里每个教育/经历/项目条目附带的"参考文件"（文件名 +
原文）随旧资料 UI 一起退役——新模型 106 个默认字段里没有这种语义，F3 生成链路改为消费
DTO 后也不再有任何来源。为兼容旧调用方：

- `/api/profile` 的请求/响应**形状不变**，长度校验照旧（422 仍是 422）；
- 参考文件字段写入被**忽略**（响应回显空串），并在日志里告警，不静默丢；
- 其余字段照常映射到新模型条目。

替代入口（交付说明里同步）：需要给条目留素材的，用该分区的自定义多行字段或「我的文件」，
不要再依赖旧的"分区参考文件"。
"""

import logging

import pytest
from app.schemas.profile import (
    MAX_REFERENCE_CONTENT_CHARS,
    MAX_REFERENCE_FILE_NAME_CHARS,
)

_REFERENCE_CONTENT = """# 应用软件项目实习总结

## 项目背景
面向实际业务完成需求分析、系统设计和交付。
"""


def _payload_with_references() -> dict:
    return {
        "educations": [
            {
                "school": "示例大学",
                "reference_file_name": "本科培养总结.md",
                "reference_content": _REFERENCE_CONTENT,
            }
        ],
        "experiences": [
            {
                "company": "示例科技",
                "reference_file_name": "实习复盘.txt",
                "reference_content": _REFERENCE_CONTENT,
            }
        ],
        "projects": [
            {
                "name": "简历通",
                "reference_file_name": "项目总结.md",
                "reference_content": _REFERENCE_CONTENT,
            }
        ],
    }


def test_reference_files_are_ignored_with_a_warning_but_shape_is_kept(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.services.profile.profile_service"):
        saved_response = client.put("/api/profile", json=_payload_with_references())

    assert saved_response.status_code == 200, saved_response.text
    saved = saved_response.json()
    # 形状保留：旧界面仍然拿到它认识的字段，但值已被忽略（不伪装成"保存成功"）。
    assert saved["educations"][0]["school"] == "示例大学"
    assert saved["educations"][0]["reference_file_name"] == ""
    assert saved["educations"][0]["reference_content"] == ""
    assert saved["experiences"][0]["reference_content"] == ""
    assert saved["projects"][0]["reference_file_name"] == ""

    loaded = client.get("/api/profile").json()
    assert loaded["educations"][0]["reference_content"] == ""
    assert loaded["projects"][0]["reference_file_name"] == ""
    # 其余内容确实落到了新模型，不因这次退役把整个条目丢掉。
    assert [item["school"] for item in loaded["educations"]] == ["示例大学"]
    assert [item["name"] for item in loaded["projects"]] == ["简历通"]

    warnings = "\n".join(record.getMessage() for record in caplog.records)
    assert "旧协议写入丢弃了新模型不支持的内容字段" in warnings
    for field in (
        "educations.reference_file_name",
        "educations.reference_content",
        "experiences.reference_content",
        "projects.reference_file_name",
    ):
        assert field in warnings


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        (
            "reference_file_name",
            "文" * (MAX_REFERENCE_FILE_NAME_CHARS + 1),
            f"参考文件名不能超过 {MAX_REFERENCE_FILE_NAME_CHARS} 个字符",
        ),
        (
            "reference_content",
            "内" * (MAX_REFERENCE_CONTENT_CHARS + 1),
            f"参考文件内容不能超过 {MAX_REFERENCE_CONTENT_CHARS} 个字符",
        ),
    ],
    ids=["file-name", "content"],
)
def test_profile_rejects_oversized_reference_file_fields(client, field, value, message):
    """旧协议的长度校验保留：退役的是存储语义，不是校验契约。"""
    response = client.put(
        "/api/profile",
        json={"projects": [{"name": "超长输入测试", field: value}]},
    )

    assert response.status_code == 422
    assert message in response.text
