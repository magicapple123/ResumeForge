"""A failed model reply may echo private context; never return it in an error."""

import pytest
from app.services.interview.interview_questions import generate_question_answer
from app.services.llm.base import LLMError


@pytest.mark.asyncio
async def test_failed_json_retry_does_not_expose_the_raw_reply(caplog):
    private_reply = "SYNTHETIC_PRIVATE_RESUME sk-synthetic_very_secret_value C:/private/database.db"

    class Provider:
        calls = 0

        async def chat(self, _messages, **_kwargs):
            self.calls += 1
            return private_reply

    provider = Provider()
    with pytest.raises(LLMError) as error:
        await generate_question_answer(
            provider, question="synthetic", job_payload="", resume_text=""
        )
    assert provider.calls == 2
    assert "参考答案" in str(error.value)
    assert private_reply not in str(error.value)
    assert "SYNTHETIC_PRIVATE_RESUME" not in caplog.text
