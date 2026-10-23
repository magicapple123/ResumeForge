# SPDX-License-Identifier: Apache-2.0
"""``PATCH /api/profile``：只改传了的字段，未传的原样保留。

它与 ``PUT /api/profile``（整体替换）**同时存在**，所以这份用例要钉住三件事：

1. 只传一个子资源数组时，其它数组与标量字段不被清空（PATCH 的核心语义）；
2. 显式传空数组 = **清空**该数组，不能退化成"不动"（这两件事在 HTTP 里是两件事）；
3. ``PUT`` 的行为逐字不变（没传的字段落回默认值）——向后兼容是保留 PUT 的全部理由。

为什么值得单独一条用例：真出 bug 的形态是"我改了手机号，教育经历全没了"，而那在界面上
完全看不出来（页面本来就滚动很长），只有比对前后两次 GET 才看得见。
"""

from __future__ import annotations

_BASE_PROFILE = {
    "name": "张三",
    "phone": "13800000000",
    "email": "zhangsan@example.com",
    "summary": "三年后端经验",
    "educations": [
        {"school": "天津工业大学", "major": "软件工程", "degree": "学士", "start_date": "2018-09"}
    ],
    "experiences": [{"company": "A公司", "role": "后端开发", "start_date": "2022-07"}],
    "projects": [{"name": "简历工具", "role": "独立开发"}],
    "skills": [{"name": "Python", "level": "熟练"}],
}


def _seed(client) -> dict:
    """先把一份**有内容**的资料存进去（PUT 整体替换语义，正好用来铺底）。"""
    response = client.put("/api/profile", json=_BASE_PROFILE)
    assert response.status_code == 200, response.text
    return response.json()


def test_patch_changes_only_the_fields_it_is_given(client):
    _seed(client)

    response = client.patch("/api/profile", json={"phone": "13900000000"})

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["phone"] == "13900000000"
    # 其它标量与**全部子资源数组**都原样保留。
    assert saved["name"] == "张三"
    assert saved["email"] == "zhangsan@example.com"
    assert saved["summary"] == "三年后端经验"
    assert [item["school"] for item in saved["educations"]] == ["天津工业大学"]
    assert [item["company"] for item in saved["experiences"]] == ["A公司"]
    assert [item["name"] for item in saved["projects"]] == ["简历工具"]
    assert [item["name"] for item in saved["skills"]] == ["Python"]
    # 落库了（不只是响应里改了）。
    assert client.get("/api/profile").json()["phone"] == "13900000000"


def test_patch_replacing_one_array_keeps_the_others(client):
    _seed(client)

    response = client.patch(
        "/api/profile",
        json={"educations": [{"school": "另一所大学", "major": "计算机"}]},
    )

    assert response.status_code == 200, response.text
    saved = response.json()
    assert [item["school"] for item in saved["educations"]] == ["另一所大学"]
    assert saved["educations"][0]["major"] == "计算机"
    # 数组按"整个替换"，其它数组不受影响。
    assert [item["company"] for item in saved["experiences"]] == ["A公司"]
    assert [item["name"] for item in saved["projects"]] == ["简历工具"]
    assert saved["name"] == "张三"


def test_patch_with_explicit_empty_array_clears_it(client):
    """显式传 ``[]`` 是**清空**，与"没传这个键"必须区分开。"""
    _seed(client)

    response = client.patch("/api/profile", json={"educations": []})

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["educations"] == []
    # 只清了传的那一个数组。
    assert len(saved["experiences"]) == 1
    assert len(saved["projects"]) == 1
    assert len(saved["skills"]) == 1


def test_patch_of_an_array_item_gets_defaults_for_missing_fields(client):
    """子项里没传的字段落成默认空串，不能是 NULL——否则下次读取会校验失败。"""
    _seed(client)

    response = client.patch("/api/profile", json={"awards": [{"name": "奖学金"}]})

    assert response.status_code == 200, response.text
    award = response.json()["awards"][0]
    assert award["name"] == "奖学金"
    assert award["date"] == "" and award["description"] == ""
    # 再读一次也不该炸（NULL 会在这里暴露成 500）。
    assert client.get("/api/profile").status_code == 200


def test_patch_with_empty_body_is_a_no_op(client):
    """什么都不传 = 什么都不改（不是"清空全部"）。"""
    _seed(client)

    response = client.patch("/api/profile", json={})

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["name"] == "张三"
    assert len(saved["educations"]) == 1


def test_patch_still_validates_like_put(client):
    """校验规则复用同一份 schema：PATCH 不能成为绕过长度/日期校验的后门。"""
    _seed(client)

    too_long = client.patch("/api/profile", json={"name": "名" * 65})
    bad_date = client.patch("/api/profile", json={"birth_date": "1" * 33})

    assert too_long.status_code == 422
    assert bad_date.status_code == 422


def test_put_is_still_a_full_replacement(client):
    """PUT 行为逐字不变：没传的字段落回默认值（空串 / 空数组）。"""
    _seed(client)

    response = client.put("/api/profile", json={"name": "李四"})

    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["name"] == "李四"
    assert saved["phone"] == "" and saved["email"] == "" and saved["summary"] == ""
    assert saved["educations"] == []
    assert saved["experiences"] == []


# ===== QA 补充：PUT 语义的"字段完整"版对照 + 校验边界 =====


def test_put_resets_every_single_field_to_its_default(client):
    """C12 的可长期维护版本：**逐字段**证明 PUT 仍是整体替换。

    只断言 ``phone``/``educations`` 这两个字段是不够的——以后新增一个字段时，如果它
    进了 ``ProfileUpdate`` 却没进 ``update_profile`` 的写入路径，那种"整体替换变成
    部分替换"的回归在原来的断言下完全看不出来（新字段只是保持旧值）。这里直接拿
    ``ProfileUpdate()`` 的默认值当基准，逐字段比对响应，字段一增一改就自动覆盖。
    """
    from app.schemas.profile import ProfileOut, ProfileUpdate

    # 前置：两者的字段集合必须对齐（否则本用例会静默漏掉某个字段）。
    assert set(ProfileUpdate.model_fields) <= set(ProfileOut.model_fields)
    defaults = ProfileUpdate().model_dump()

    _seed(client)
    response = client.put("/api/profile", json={"name": "李四"})

    assert response.status_code == 200, response.text
    saved = response.json()
    drifted = {
        field: (saved[field], default)
        for field, default in defaults.items()
        if field != "name" and saved[field] != default
    }
    assert drifted == {}, f"PUT 没有把未传字段落回默认值：{drifted}"


def test_patch_wrong_types_are_rejected_with_422(client):
    """类型错误仍然是 422：PATCH 不能成为绕过校验的后门。"""
    _seed(client)

    wrong_array = client.patch("/api/profile", json={"educations": "不是数组"})
    wrong_item = client.patch("/api/profile", json={"skills": [{"name": 123}]})
    wrong_scalar = client.patch("/api/profile", json={"name": 123})

    assert wrong_array.status_code == 422
    assert wrong_item.status_code == 422
    assert wrong_scalar.status_code == 422
    # 被拒的请求不许留下半截写入。
    saved = client.get("/api/profile").json()
    assert saved["name"] == "张三"
    assert [item["name"] for item in saved["skills"]] == ["Python"]


def test_unknown_field_is_ignored_by_both_put_and_patch(client):
    """这一条钉的是"两个端点口径相同"——PATCH 继承了 ``ProfileUpdate``，所以它在这件事上
    不可能与 PUT 不同。**注意它不等于 422**：``ProfileUpdate`` 没有配 ``extra="forbid"``，
    拼错的字段名会被静默忽略并返回 200。这是改动前 PUT 就有的行为（不是本批引入的），
    所以这里如实记录现状；要不要收紧成 422 属于产品决策，见交付报告。
    """
    _seed(client)
    payload = {"educatons": [{"school": "拼错字段名"}]}

    patched = client.patch("/api/profile", json=payload)
    put = client.put("/api/profile", json={**_BASE_PROFILE, **payload})

    assert patched.status_code == put.status_code == 200
    # 两个端点都没把它写进库，也都没报错：口径一致。
    assert [item["school"] for item in client.get("/api/profile").json()["educations"]] == [
        "天津工业大学"
    ]


# ===== QA 补第二轮：PUT/PATCH 的"同一份 payload 应当同结果"与结构漂移守卫 =====

_SECTION_KEYS = (
    "educations",
    "experiences",
    "campus_experiences",
    "projects",
    "skills",
    "awards",
)


def _normalized(saved: dict) -> dict:
    """去掉每次请求都会变的字段：子表主键与三个时间戳。

    只去掉"本来就该不同"的东西，剩下的**逐字段**比对才有意义——把整个响应当字典比会
    因为 id/updated_at 永远不等而恒假，那样的断言等于没断言。
    """
    cleaned = {
        key: value for key, value in saved.items() if key not in {"created_at", "updated_at"}
    }
    for key in _SECTION_KEYS:
        if isinstance(cleaned.get(key), list):
            cleaned[key] = [
                {field: value for field, value in item.items() if field != "id"}
                for item in cleaned[key]
            ]
    return cleaned


def test_patch_and_put_agree_on_a_fully_specified_payload(client):
    """同一份**把每个键都写全**的 payload，PUT 与 PATCH 必须落出同一份资料。

    这是"PUT 的语义一字未改"的另一半证明：PUT 与 PATCH 的差别只应出现在"没传的键"上
    （PUT 落默认值、PATCH 保留旧值）。一旦有人把 ``update_profile`` 也改成读
    ``model_fields_set``（"顺手统一两个函数"），这条用例会在"全量 payload"上仍然通过
    ——所以它必须与 ``test_put_resets_every_single_field_to_its_default`` 一起看：
    那条钉"没传的键落默认值"，这条钉"传了的键两边同价"。
    """
    full = {
        **_BASE_PROFILE,
        "phone": "13900000000",
        "city": "天津",
        "target_city": "北京",
        "job_intent": "后端开发",
        "github": "https://github.com/example",
        "section_order": ["skills", "projects"],
        "campus_experiences": [{"school": "天津工业大学", "role": "班长"}],
        "awards": [{"name": "一等奖学金"}],
    }

    _seed(client)
    via_put = _normalized(client.put("/api/profile", json=full).json())
    _seed(client)  # 回到同一份起点，PATCH 才有可比性
    via_patch = _normalized(client.patch("/api/profile", json=full).json())

    assert via_patch == via_put, "同一份完整 payload，PUT 与 PATCH 落出了不同的资料"


def test_patch_and_put_reject_null_arrays_identically(client):
    """显式 ``null`` 不是 ``[]``：两个端点都必须 422，而不是一方当清空、另一方当不动。

    "清空"只有一个写法（``[]``）。若哪一天 PATCH 把 ``null`` 也当成"清空"，前端某个
    ``JSON.stringify`` 掉字段的路径就会静默清掉用户的整个教育经历——422 才是对的。
    """
    _seed(client)

    patched = client.patch("/api/profile", json={"educations": None})
    put = client.put("/api/profile", json={**_BASE_PROFILE, "educations": None})

    assert patched.status_code == 422, patched.text
    assert put.status_code == 422, put.text
    # 被拒的请求不许留下半截写入。
    assert [item["school"] for item in client.get("/api/profile").json()["educations"]] == [
        "天津工业大学"
    ]


def test_profile_patch_mirrors_profile_update_field_for_field():
    """``ProfilePatch`` 必须与 ``ProfileUpdate`` **字段完全一致**，且子表数组全部登记在
    ``_SECTION_MODELS`` 里。

    两份 schema / 两处字段清单是这类"双端点"最常见的漂移点：新增一个字段只加进 PUT，
    PATCH 就会被 Pydantic 静默丢弃（默认忽略额外字段），用户看到的是"改了没生效"。
    这里用类型反射自动列出"子表数组"，以后新增一个 ``certificates: list[CertificateIn]``
    而忘了登记，会直接变红——而不是等到有人 PATCH 它时抛 SQLAlchemy 的赋值错误。
    """
    from typing import get_args, get_origin

    from app.schemas.profile import ProfilePatch, ProfileUpdate
    from app.services.profile.profile_service import _SECTION_MODELS
    from pydantic import BaseModel

    assert issubclass(ProfilePatch, ProfileUpdate)
    assert set(ProfilePatch.model_fields) == set(ProfileUpdate.model_fields)

    subtable_fields = set()
    for name, field in ProfileUpdate.model_fields.items():
        if get_origin(field.annotation) is not list:
            continue
        args = get_args(field.annotation)
        if args and isinstance(args[0], type) and issubclass(args[0], BaseModel):
            subtable_fields.add(name)

    assert subtable_fields == set(_SECTION_MODELS), (
        "ProfileUpdate 里的子表数组与 _SECTION_MODELS 不一致："
        f"只在 schema 里={subtable_fields - set(_SECTION_MODELS)}，"
        f"只在服务里={set(_SECTION_MODELS) - subtable_fields}"
    )


def test_put_drops_a_skill_row_whose_name_is_blank(client):
    """空名字的技能行不落库（C-22）。

    这条是"界面上的空行"与"一条数据"的边界：``SkillIn.name`` 允许空串，所以请求体
    完全合法；但那不是用户想保存的东西——它只会在资料页渲染成一个点不掉的空标签。
    所以写入侧整行跳过，响应里也不该再出现它。
    """
    payload = dict(_BASE_PROFILE)
    payload["skills"] = [
        {"name": "Python", "level": "熟练"},
        {"name": "   ", "level": "精通"},
        {"name": "", "level": ""},
    ]

    response = client.put("/api/profile", json=payload)

    assert response.status_code == 200, response.text
    assert [item["name"] for item in response.json()["skills"]] == ["Python"]
    # 落库层面同样没有：GET 是重新读库的结果，不是请求体的回显。
    assert [item["name"] for item in client.get("/api/profile").json()["skills"]] == ["Python"]


def test_patch_drops_a_skill_row_whose_name_is_blank(client):
    """PATCH 与 PUT 同一口径：局部替换技能数组时空行同样被跳过。"""
    _seed(client)

    response = client.patch(
        "/api/profile",
        json={"skills": [{"name": "Go", "level": "熟悉"}, {"name": "  ", "level": "精通"}]},
    )

    assert response.status_code == 200, response.text
    assert [item["name"] for item in response.json()["skills"]] == ["Go"]
    assert [item["name"] for item in client.get("/api/profile").json()["skills"]] == ["Go"]


def test_patch_of_only_blank_skills_clears_the_list(client):
    """全是空行 = 客户端其实什么都没填：结果是空数组，而不是留下几条空标签。"""
    _seed(client)

    response = client.patch("/api/profile", json={"skills": [{"name": "", "level": "精通"}]})

    assert response.status_code == 200, response.text
    assert response.json()["skills"] == []
