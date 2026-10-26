# SPDX-License-Identifier: Apache-2.0
"""Dataset-scoped UI locale stored in the existing AppSetting table."""

import json
import logging

from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..models.setting import AppSetting
from ..schemas.ui_locale import UiLocale, UiLocaleIn

logger = logging.getLogger(__name__)

UI_LOCALE_KEY = "ui.locale"


def get_ui_locale(db: Session) -> UiLocale | None:
    row = db.get(AppSetting, UI_LOCALE_KEY)
    if row is None:
        return None
    try:
        return UiLocaleIn.model_validate(json.loads(row.value)).locale
    except (json.JSONDecodeError, ValidationError, TypeError):
        # Corrupt content is left recoverable and never included in a log.
        logger.warning("ui locale preference is invalid; treating it as unconfigured")
        return None


def save_ui_locale(db: Session, locale: UiLocale) -> UiLocale:
    # Keep service calls as strict as the HTTP boundary.
    setting = UiLocaleIn(locale=locale)
    serialized = json.dumps(setting.model_dump())
    try:
        row = db.get(AppSetting, UI_LOCALE_KEY)
        if row is None:
            db.add(AppSetting(key=UI_LOCALE_KEY, value=serialized))
        else:
            row.value = serialized
        # Even an unchanged provisional locale must reach persistence.
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise
    return setting.locale
