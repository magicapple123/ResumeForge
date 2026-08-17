"""运行时配置存取：用户在「设置」页填写的配置保存在本地 SQLite。

安全说明：API Key 以明文存放在本地数据库文件中。本项目定位为
单用户本地部署的工具，不做多用户暴露；如需对外部署请自行加锁。
"""
import json
import logging

from pydantic import ValidationError
from sqlalchemy.orm import Session

from ..models.setting import AppSetting, LLMConfigRecord
from ..schemas.setting import LLMConfig, LLMConfigRecordCreate, LLMConfigRecordOut

logger = logging.getLogger(__name__)

_LLM_CONFIG_KEY = "llm_config"


def get_llm_config(db: Session) -> LLMConfig:
    row = db.get(AppSetting, _LLM_CONFIG_KEY)
    if row is None:
        return LLMConfig()
    try:
        return LLMConfig.model_validate(json.loads(row.value))
    except (json.JSONDecodeError, ValidationError):
        # 脏数据降级为默认配置，不阻塞用户重新填写
        logger.warning("LLM 配置数据损坏，已重置为默认值")
        return LLMConfig()


def save_llm_config(db: Session, config: LLMConfig) -> None:
    row = db.get(AppSetting, _LLM_CONFIG_KEY)
    serialized = json.dumps(config.model_dump(), ensure_ascii=False)
    if row is None:
        db.add(AppSetting(key=_LLM_CONFIG_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()


def list_llm_config_records(db: Session) -> list[LLMConfigRecordOut]:
    rows = db.query(LLMConfigRecord).order_by(LLMConfigRecord.updated_at.desc()).all()
    return [LLMConfigRecordOut.model_validate(row) for row in rows]


def save_llm_config_record(db: Session, payload: LLMConfigRecordCreate) -> LLMConfigRecordOut:
    row = db.query(LLMConfigRecord).filter(LLMConfigRecord.name == payload.name).one_or_none()
    values = payload.model_dump(exclude={"name"})
    if row is None:
        row = LLMConfigRecord(name=payload.name, **values)
        db.add(row)
    else:
        for field, value in values.items():
            setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return LLMConfigRecordOut.model_validate(row)


def delete_llm_config_record(db: Session, record_id: int) -> None:
    row = db.get(LLMConfigRecord, record_id)
    if row is not None:
        db.delete(row)
        db.commit()
