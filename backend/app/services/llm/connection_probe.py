"""Cheap connection probes, independent of saved thinking preferences."""

from ...schemas.setting import LLMConfig

_THINKING_KEYS = frozenset({"thinking", "enable_thinking", "reasoning_effort", "reasoning"})


def connection_probe_config(config: LLMConfig) -> LLMConfig:
    """Disable known default thinking without sending vendor fields to unknown APIs.

    Reset the explicit style and legacy budget before consulting the vendor table.
    Extra-body thinking fields must also be stripped, or they can re-enable thinking.
    This creates a copy and never changes the saved configuration.
    """
    return config.without_thinking().model_copy(
        update={
            "max_tokens": 64,
            "thinking_style": "auto",
            "extra_body": {
                key: value
                for key, value in (config.extra_body or {}).items()
                if key not in _THINKING_KEYS
            },
        }
    )
