# SPDX-License-Identifier: Apache-2.0
"""UI locale preference, independent of any Resume's output language."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

UiLocale = Literal["zh-CN", "en-US"]


class UiLocaleIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    locale: UiLocale


class UiLocaleOut(BaseModel):
    # None preserves a provisional first-paint localStorage choice.
    locale: UiLocale | None = None
