"""手动备份接口（RF-25）：``backups/`` 目录的列表与可恢复删除。

没有自动清理，没有"全部删除"：每份快照的删除都是用户在界面上逐份确认后
**移动到** ``backups/.trash/``，要找回去那里拿。
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db, session_engine
from ..services.data_backup.manual_backups import list_manual_backups, trash_manual_backup

router = APIRouter(prefix="/api/backups", tags=["backups"])


@router.get("/manual")
def read_manual_backups(db: Session = Depends(get_db)) -> dict:
    bind = session_engine(db)
    return list_manual_backups(bind)


@router.delete("/manual/{name}")
def remove_manual_backup(name: str, db: Session = Depends(get_db)) -> dict:
    bind = session_engine(db)
    try:
        return trash_manual_backup(bind, name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="备份不存在或已被移除") from exc
