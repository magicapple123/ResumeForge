# SPDX-License-Identifier: Apache-2.0
"""``GET /api/assistant/tools``：对外公开助手可调用工具的清单。

**为什么单独一个模块**：路由本体只有几行，而 ``app/api/assistant.py`` 已经贴着 500 行
生产代码预算（``tests/test_file_size_budget.py`` 守卫），把这条只读路由塞进去会直接超线。

**为什么必须有这个接口**：#38 要求"助手能做什么"对用户/前端可见，而此前它只存在于
``services.assistant_tools.tool_definitions()`` 的返回值里——前端拿不到，只能在文档里
口口相传。这里**不新增第二份清单**：名称/说明/参数全部原样取自同一份 OpenAI schema，
所以"界面列的"与"模型实际拿到的"结构上一致；``writes`` 也从注册表读，不靠人工维护。

只读、无副作用、不读会话、不碰数据库：工具清单是静态元数据，与数据集内容无关。
两档"按上下文才可见"的工具按**默认参数**处理并如实标注：

* 联网搜索（``web_search``）是每条消息的开关，不是全局设置，所以默认形态下列出它不合适；
* 放宽模式（``relaxed``）会读到身份字段/网申填写值，只在用户显式开启的会话里下发。
"""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas.assistant import AssistantToolListOut, AssistantToolOut
from ..services.assistant_tools import tool_definitions, tool_writes
from ..services.assistant_tools._registry import tool_category

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/tools", response_model=AssistantToolListOut)
def list_assistant_tools() -> AssistantToolListOut:
    """助手默认具备的工具（含参数 schema），供界面展示能力边界。

    这里刻意不传上下文：清单描述的是"这个助手能做什么"，而不是"这条消息能调什么"。
    敏感/联网类工具按默认参数（不开启）处理，与模型在不声明开关时拿到的集合一致。
    """
    items = [
        AssistantToolOut(
            name=str(definition["function"]["name"]),
            category=tool_category(str(definition["function"]["name"])),
            description=str(definition["function"].get("description") or ""),
            writes=tool_writes(str(definition["function"]["name"])),
            parameters=definition["function"].get("parameters") or {},
        )
        for definition in tool_definitions()
    ]
    return AssistantToolListOut(items=items, count=len(items))
