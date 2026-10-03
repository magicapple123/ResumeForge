"""字段目录、「网申资料」与记忆目标路由（职责①）。

从 ``api/webform.py`` 拆出。服务层符号一律经 ``webform_service`` 属性访问，
保证包属性 patch（``app.api.webform.webform_service.*``）继续生效。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.webform import (
    WebFormExtraProfileIn,
    WebFormExtraProfileOut,
    WebFormFieldsOut,
    WebFormMemoryTargetsOut,
)
from ...services import webform as webform_service



router = APIRouter(prefix="/api/webform", tags=["webform"])


# ===== 字段目录 =====


@router.get("/fields", response_model=WebFormFieldsOut)
def list_fields():
    """网申字段目录。界面由它驱动渲染——加字段只改后端常量表，不用动前端。"""
    return webform_service.list_fields()


# ===== 「网申资料」=====
#
# 用户专门为网申表单录的补充资料（四六级分数、档案所在地、紧急联系人、身高视力…），
# **简历里没有**，所以单独存在 ``web_form_profile_entry`` 里。
#
# **只给网申填表用**：简历生成读的是 ``UserProfile``，完全不经过这两个接口，所以
# "生成简历不读这里"是结构保证的。助手也读不到（理由见 ``test_assistant_coverage.py``）。


@router.get("/extra-profile", response_model=WebFormExtraProfileOut)
def read_extra_profile(db: Session = Depends(get_db)):
    """字段清单 + 已填的值 + 每条的来源与档位（清单由后端下发，前端不写死字段名）。"""
    return {
        **webform_service.list_extra_fields(db),
        "values": webform_service.extra_profile.list_entries(db),
        "details": webform_service.extra_profile.list_details(db),
        "repeated_groups": webform_service.repeated_profile.list_groups(db),
    }


@router.put("/extra-profile", response_model=WebFormExtraProfileOut)
def write_extra_profile(payload: WebFormExtraProfileIn, db: Session = Depends(get_db)):
    """整份覆盖写入。没提到的 key 会被删除——这一屏就是「网申资料」的全部。

    ``details`` 只用于给**学到的**那几条指定来源与档位（``source`` / ``reuse``）。
    """
    try:
        webform_service.extra_profile.save_entries(
            db,
            payload.values,
            details={key: entry.model_dump() for key, entry in payload.details.items()},
            commit=False,
        )
        if payload.repeated is not None:
            webform_service.repeated_profile.save_groups(
                db,
                {
                    key: [record.model_dump() for record in records]
                    for key, records in payload.repeated.items()
                },
                commit=False,
            )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    return {
        **webform_service.list_extra_fields(db),
        "values": webform_service.extra_profile.list_entries(db),
        "details": webform_service.extra_profile.list_details(db),
        "repeated_groups": webform_service.repeated_profile.list_groups(db),
    }


@router.get("/memory-targets", response_model=WebFormMemoryTargetsOut)
def list_memory_targets(db: Session = Depends(get_db)):
    """返回「记住这条」可以写入的目标。**只有「网申资料」**（理由见 profile_targets）。"""
    return {"targets": webform_service.profile_targets.build_memory_targets(db)}

