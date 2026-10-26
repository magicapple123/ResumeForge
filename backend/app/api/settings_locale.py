# SPDX-License-Identifier: Apache-2.0
"""UI locale preferences; dataset identity is enforced by shared middleware."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.ui_locale import UiLocaleIn, UiLocaleOut
from ..services.ui_locale import get_ui_locale, save_ui_locale

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/locale", response_model=UiLocaleOut)
def read_locale(db: Session = Depends(get_db)) -> UiLocaleOut:
    return UiLocaleOut(locale=get_ui_locale(db))


@router.put("/locale", response_model=UiLocaleOut)
def write_locale(payload: UiLocaleIn, db: Session = Depends(get_db)) -> UiLocaleOut:
    return UiLocaleOut(locale=save_ui_locale(db, payload.locale))
