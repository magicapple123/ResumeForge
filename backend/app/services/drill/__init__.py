"""按事实台账深挖的面试服务层：契约生成、逐轮判定、复盘与复练队列。

与「模拟面试」（``services/interview/interview.py``）的区别：那边按轮数推进、结束时给一份四维度
评分报告；这边**一条主张一个契约**，全程用证据状态说话，产出的是一份"该去补什么"的清单。

**评分契约是本模块的核心**：它必须在提问**之前**生成并存库，判定时再读出来照着判。
这不是为了多存一份数据，而是为了防住"看到回答之后才定标准"——那是这类功能里最难发现、
也最伤信任的一种偏差（用户以为自己进步了，其实只是标准变松了）。
"""
from .common import (
    load_prompt as load_prompt,
)
from .contract import (
    build_contract_messages as build_contract_messages,
)
from .contract import (
    generate_plan as generate_plan,
)
from .contract import (
    open_contract as open_contract,
)
from .contract import (
    parse_plan as parse_plan,
)
from .contract import (
    select_claims as select_claims,
)
from .evaluate import (
    Verdict as Verdict,
)
from .evaluate import (
    apply_verdict as apply_verdict,
)
from .evaluate import (
    build_evaluate_messages as build_evaluate_messages,
)
from .evaluate import (
    current_question as current_question,
)
from .evaluate import (
    evaluate_answer as evaluate_answer,
)
from .evaluate import (
    parse_verdict as parse_verdict,
)
from .review import (
    build_review_messages as build_review_messages,
)
from .review import (
    generate_review as generate_review,
)
from .review import (
    local_review as local_review,
)
from .review import (
    parse_review as parse_review,
)
from .session import (
    finish_session as finish_session,
)
from .session import (
    pending_contract as pending_contract,
)
from .session import (
    session_summary as session_summary,
)

__all__ = [
    "Verdict",
    "apply_verdict",
    "current_question",
    "build_contract_messages",
    "build_evaluate_messages",
    "build_review_messages",
    "evaluate_answer",
    "finish_session",
    "generate_plan",
    "load_prompt",
    "generate_review",
    "local_review",
    "open_contract",
    "parse_plan",
    "parse_review",
    "parse_verdict",
    "pending_contract",
    "select_claims",
    "session_summary",
]
