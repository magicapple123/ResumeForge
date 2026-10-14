"""Dataset-domain failures with explicit safe public messages."""

_PUBLIC_MESSAGES = {
    message: message
    for message in (
        "数据集已切换，请保留草稿并刷新页面后重新打开；本次操作未执行",
        "数据集已切换，本任务不能再写入，请重新发起",
        "数据集正在切换中，请稍后再启动该任务",
        "页面尚未确认数据集，请刷新后重试；本次操作未执行",
    )
}


class DatasetScopeError(Exception):
    """Keep internal diagnostics separate from the response-safe message."""

    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.public_message = _PUBLIC_MESSAGES.get(
            message, "数据集当前不可用，请保留草稿并刷新后重试"
        )
