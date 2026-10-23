# SPDX-License-Identifier: Apache-2.0
"""个人资料业务逻辑：读取、整体更新（PUT）与局部合并（PATCH）。

两种写入共用"子表先删后插"的构造方式，差别只在**取哪些字段来写**——
PUT 取全部（整体替换），PATCH 只取请求里出现过的键（合并）。
"""

from typing import Any

from sqlalchemy.orm import Session, selectinload

from ...models.profile import (
    Award,
    CampusExperience,
    Education,
    Experience,
    Project,
    Skill,
    UserProfile,
)
from ...schemas.profile import ProfileOut, ProfileUpdate

# 子表名称 -> 模型类，用于统一处理列表替换
_SECTION_MODELS = {
    "educations": Education,
    "experiences": Experience,
    "campus_experiences": CampusExperience,
    "projects": Project,
    "skills": Skill,
    "awards": Award,
}

# 名字为空就整行丢掉（而不是写进库）的子表。
#
# 只有技能：`name` 是它**唯一**的内容，空名字落库就是一条永远显示不出来的空标签
# （真实库里出现过 `skill.id=37/39` 这种 `name` 为空串的行，前端只会渲染出两个空
# 标签）。学历/经历不在此列——它们的空行至少有可编辑的字段，丢掉会让人以为自己
# 填的东西没保存。
_BLANK_ROWS_DROPPED = ("skills",)


def _writable_section_items(section: str, items: list[Any]) -> list[Any]:
    """写入前把"名字去空白后为空"的技能行剔除。

    **跳过而不是拒绝**：空技能行几乎总是界面上多出来的那一行没填，用户此刻是在保存
    别的字段；为一个空行回 422 会把整份资料打回去，代价远大于收益。
    """
    if section not in _BLANK_ROWS_DROPPED:
        return list(items)
    return [item for item in items if str(getattr(item, "name", "")).strip()]


def get_or_create_profile(db: Session) -> UserProfile:
    """单用户应用：保证主表始终有一条记录。"""
    profile = db.query(UserProfile).first()
    if profile is None:
        profile = UserProfile()
        db.add(profile)
        db.flush()
    return profile


def get_profile_detail(db: Session) -> UserProfile:
    """读取带全部子表的资料。

    必须 selectinload：生成接口在异步上下文中使用该对象，
    懒加载会在事件循环线程里触发 MissingGreenlet 错误。
    """
    profile = get_or_create_profile(db)
    options = [selectinload(getattr(UserProfile, name)) for name in _SECTION_MODELS]
    # 同一会话的 identity map 里一定有这一行（上面刚 get_or_create 过），`or profile`
    # 只是把这条保证写给类型检查，不改变任何行为。
    return db.get(UserProfile, profile.id, options=options) or profile


def update_profile(db: Session, payload: ProfileUpdate) -> UserProfile:
    """整体替换资料：基础字段逐个赋值，子表列表先删后插。"""
    profile = get_or_create_profile(db)
    section_payloads = {name: getattr(payload, name) for name in _SECTION_MODELS}
    basic_fields = payload.model_dump(exclude=set(_SECTION_MODELS))
    for field, value in basic_fields.items():
        setattr(profile, field, value)
    db.flush()  # 保证新记录先拿到 id，子表才能挂外键

    for name, model in _SECTION_MODELS.items():
        setattr(
            profile,
            name,
            [
                model(profile_id=profile.id, **item.model_dump())
                for item in _writable_section_items(name, section_payloads[name])
            ],
        )
    db.commit()
    return get_profile_detail(db)


def patch_profile(db: Session, payload: ProfileUpdate) -> UserProfile:
    """局部更新资料：**只改传了的字段**，未传的原样保留。

    与 :func:`update_profile` 的唯一区别是"取哪些字段来写"：

    - PUT 取**全部**字段（没传的按默认值 ""/[] 写进去），所以它是一份整体替换；
    - PATCH 只取 ``model_dump(exclude_unset=True)`` 里的，也就是这次请求真的出现过的键。

    两条容易写错的地方，这里都刻意写死：

    1. **子表要看 ``model_fields_set`` 而不是"值非空"**。用户显式传
       ``"educations": []`` 的意思是"清空教育经历"，与"没传这个键"是两件事；按值判断
       会把"清空"变成"不动"，用户看到的还是原来的三条。
    2. **子表项用完整 dump**，不用 ``exclude_unset``。子项里没传的字段必须落成模型默认
       值（与 PUT 同一份构造方式），否则 PATCH 建出来的学历行会是一堆 ``NULL``，
       下一次读取时 ``str`` 校验直接失败。
    """
    profile = get_or_create_profile(db)
    # 标量字段：只覆盖这次传了的；`section_order` 也在这条路上（它不是子表）。
    basic_fields = payload.model_dump(exclude_unset=True, exclude=set(_SECTION_MODELS))
    for field, value in basic_fields.items():
        setattr(profile, field, value)
    db.flush()  # 保证新记录先拿到 id，子表才能挂外键

    for name, model in _SECTION_MODELS.items():
        if name not in payload.model_fields_set:
            continue
        items = _writable_section_items(name, list(getattr(payload, name) or []))
        setattr(
            profile,
            name,
            [model(profile_id=profile.id, **item.model_dump()) for item in items],
        )
    db.commit()
    return get_profile_detail(db)


def to_profile_out(profile: UserProfile) -> ProfileOut:
    return ProfileOut.model_validate(profile)
