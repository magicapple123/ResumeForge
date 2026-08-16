"""个人资料接口：读取与整体更新。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas.profile import ProfileOut, ProfileUpdate
from ..services.profile_service import get_profile_detail, to_profile_out, update_profile

router = APIRouter(prefix="/api/profile", tags=["profile"])


@router.get("", response_model=ProfileOut)
def get_profile(db: Session = Depends(get_db)):
    return to_profile_out(get_profile_detail(db))


@router.put("", response_model=ProfileOut)
def save_profile(payload: ProfileUpdate, db: Session = Depends(get_db)):
    return to_profile_out(update_profile(db, payload))
