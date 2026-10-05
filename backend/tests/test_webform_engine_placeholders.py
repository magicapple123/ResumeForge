"""网申填表引擎 · 占位符权威性与旁文污染。

占位符什么时候**一对一地**陈述字段（"请输入导师"）、什么时候只是装饰（光杆"请输入"）
或一段说明文，以及"整表标签串"这种表单级旁文污染的处理。主文件与共享替身见
``test_webform_engine.py``；基础映射见 ``test_webform_engine_match.py``，
日期映射见 ``test_webform_engine_dates.py``，证据消歧见
``test_webform_engine_ambiguity.py``。
"""
from app.services.webform.engine import FormEngine


def test_a_bare_placeholder_falls_back_to_the_leading_nearby_label():
    """光杆「请输入」不含字段信息：回退到旁文**开头那一段**（2026-10-05 京东校招页实测）。

    那个页面姓名 / 手机号码 / 电子邮箱三个框的占位符都只是"请输入"，真标签在旁文
    （"*姓名:" / "*手机号码:" / "*电子邮箱:…"）。把光杆占位符当权威，三个最基础的
    字段会全体"认不出"。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 3,
                "type": "text",
                "placeholder": "请输入",
                "nearby_text": "*姓名:",
                "selector": '[data-rf-index="3"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"name": "张示例"})

    assert [(mapping.field, mapping.control.index) for mapping in result.mappings] == [
        ("name", 3)
    ]


def test_a_bare_placeholder_does_not_borrow_from_a_long_polluted_nearby():
    """但光杆占位符**不许**拿整段旁文当证据——那可能是区块级文本。

    2026-10-05 鹰角页实测：学历框（占位符"请选择"）的旁文里带着整块教育背景的
    "就读时间"，用整段旁文会把学历填成入学时间；只认开头那一段才落在"学历"上。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 20,
                "type": "text",
                "placeholder": "请选择",
                "nearby_text": "学历 就读时间-学校名称专业名称学历删除本条 教育背景添加就读时间-学校名称专业名称学历删除本条",
                "selector": '[data-rf-index="20"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"education_start": "2019-09", "degree": "本科"})

    assert [(mapping.field, mapping.control.index) for mapping in result.mappings] == [
        ("degree", 20)
    ]


def test_a_long_instructional_placeholder_falls_back_to_its_label():
    """长说明文（多行 / 带"您可以…建议…"）不是一对一的字段陈述。

    2026-10-05 腾讯校招页实测：「补充信息」框的占位符是一整段"建议格式"说明文，把
    自我评价 / 爱好特长 / 补充信息 三个概念揉在一起——按权威解析会因并列整个放弃，
    退回后由它的真标签（旁文里的"补充信息*"）一对一命中 summary。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 66,
                "type": "textarea",
                "placeholder": (
                    "请输入其他相关信息，如自我评价，爱好特长，补充信息等。您可以按照如下建议格式填写：\n"
                    "1、自我评价：您可以从专业技能、软性素质几个方面对自己的情况进行综合评价\n"
                    "2、爱好特长：您可以分享您的兴趣爱好，个人特长及闪光点"
                ),
                "nearby_text": "0/500 补充信息* 0/500 补充信息* 0/500",
                "selector": '[data-rf-index="66"]',
            }
        ]
    )

    result = engine.match_fields(controls, {"summary": "示例自我评价"})

    assert [(mapping.field, mapping.control.index) for mapping in result.mappings] == [
        ("summary", 66)
    ]


def test_the_shared_form_level_label_block_is_stripped_from_nearby():
    """同一段 ≥60 字的文本出现在 ≥3 个控件的旁文里 → 是整表标签串，减掉、保留各自前缀。

    mokahr 类页面把整张表的标签串进每个控件的旁文（鹰角 apply 页：24 个控件里 11 个
    带着同一段 136 字文本）。它让每个框都"看起来"命中所有字段。
    """
    from app.services.webform.engine.pollution import (
        common_label_block,
        strip_shared_nearby,
    )

    shared = "实习经历 姓名 手机号码 邮箱 性别 出生日期 国籍 毕业时间 是否服从调剂" * 2
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": index,
                "type": "text",
                "nearby_text": f"{prefix} {shared}",
                "selector": f'[data-rf-index="{index}"]',
            }
            for index, prefix in enumerate(("毕业时间", "姓名", "邮箱", "游戏经历"))
        ]
    )

    block = common_label_block(controls)

    assert len(block) >= 60
    stripped = strip_shared_nearby(controls)
    assert all(shared not in control.nearby_text for control in stripped)
    assert [control.nearby_text for control in stripped] == [
        "毕业时间",
        "姓名",
        "邮箱",
        "游戏经历",
    ]


def test_placeholder_naming_two_fields_claims_neither():
    """占位符同时点名两个字段且同分并列时，谁都不认——宁可漏填，不可错填。

    2026-10-05 拼多多页实测：占位符「请输入毕业学校专业」同时命中 school（"学校"
    2 字）与 major（"专业"2 字），同档同分按 field_order 让 school 抢走，
    大学名被填进了专业框。消歧后该框对两个字段都如实报"认不出"，且**不许退回
    旁文**（权威分支没命中就结束）。对照框占位符唯一指向 school，照常映射。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请输入毕业学校专业",
                "nearby_text": "毕业学校专业*",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "请输入学校名称",
                "nearby_text": "学校名称*",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(
        controls, {"school": "示例大学", "major": "计算机科学"}
    )
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field == {"school": 1}


def test_placeholder_pair_resolved_by_block_hints_still_matches():
    """占位符并列但两个区块限定互不相同时不消歧——由区块机制裁决。

    美团等页面的描述框占位符就是裸的「请输入描述」，experience_description 与
    project_description 同分并列是常态；两者分别锁死在「实习经历」「项目经历」
    区块里，消歧反而会把本来填得对的框漏掉。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "textarea",
                "placeholder": "请输入描述",
                "nearby_text": "描述* 实习经历-1 删除经历 公司* 职位*",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "textarea",
                "placeholder": "请输入描述",
                "nearby_text": "描述* 项目经历-1 删除经历 项目名称* 角色*",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(
        controls,
        {
            "experience_description": "实习描述内容",
            "project_description": "项目描述内容",
        },
    )
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field == {"experience_description": 0, "project_description": 1}


def test_placeholder_pair_resolved_by_date_order_family_still_matches():
    """占位符并列但都是 start/end 家族字段时不消歧——由 DOM/date_order 裁决。

    "起止时间"写在教育、实习、项目多个家族的同义词里，占位符直接写全它时
    跨家族并列（education_start ↔ experience_start 等）不可避免；这类字段
    的开始/结束本就靠结构信息区分，占位符消歧不能接管它们。
    """
    engine = FormEngine()
    controls = engine.snapshot_controls(
        [
            {
                "index": 0,
                "type": "text",
                "placeholder": "请输入起止时间",
                "selector": '[data-rf-index="0"]',
            },
            {
                "index": 1,
                "type": "text",
                "placeholder": "请输入起止时间",
                "selector": '[data-rf-index="1"]',
            },
        ]
    )

    result = engine.match_fields(
        controls, {"education_start": "2021-09", "education_end": "2025-06"}
    )
    by_field = {mapping.field: mapping.control.index for mapping in result.mappings}

    assert by_field == {"education_start": 0, "education_end": 1}


def test_bare_placeholders_survive_a_form_level_label_list():
    """裸占位符（无"请输入"前缀）必须参与证据，整表标签列表污染不能全歼基础字段。

    2026-10-05 鹰角 apply 页实测：mokahr 把标签直接写进占位符（``ph='姓名'``/
    ``'邮箱'``/``'国籍'``），而每个控件的 ``nearby_text`` 都累积了**整张表**的标签串
    （"姓名手机号码+86邮箱性别出生日期…"）。裸占位符不参与证据时，框掉进旁文档、
    又被多字段并列触发高风险消歧——姓名/邮箱/国籍全体进"没认出来"。
    裸占位符一对一指向控件，命中按占位符档计后，档位压过旁文噪声。
    """
    engine = FormEngine()
    polluted = "姓名手机号码+86邮箱性别出生日期 (年龄)国籍毕业时间"
    controls = engine.snapshot_controls(
        [
            {
                "index": 3,
                "type": "text",
                "placeholder": "姓名",
                "nearby_text": polluted,
                "selector": '[data-rf-index="3"]',
            },
            {
                "index": 6,
                "type": "text",
                "placeholder": "邮箱",
                "nearby_text": polluted,
                "selector": '[data-rf-index="6"]',
            },
            {
                "index": 9,
                "type": "text",
                "placeholder": "国籍",
                "nearby_text": polluted,
                "selector": '[data-rf-index="9"]',
            },
        ]
    )

    by_field = {
        mapping.field: mapping.control.index
        for mapping in engine.match_fields(
            controls,
            {"name": "张三", "email": "test@example.com", "country_region": "中国"},
        ).mappings
    }

    assert by_field == {"name": 3, "email": 6, "country_region": 9}

