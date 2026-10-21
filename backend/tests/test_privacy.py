# SPDX-License-Identifier: Apache-2.0
"""``privacy`` 脱敏变换的纯函数测试。"""
from app.schemas.resume import ResumeContent
from app.services.privacy import MASK, RedactionOptions, redact


def _resume() -> ResumeContent:
    return ResumeContent(
        name="张三",
        phone="13800000000",
        email="a@example.com",
        github="github.com/zhangsan",
        personal_website="https://zhangsan.dev",
        summary="负责 XX 产品从 0 到 1 的搭建",
        education=[{"school": "清华大学", "major": "计算机"}],
        experience=[
            {"company": "字节跳动", "role": "工程师", "description": ["参与 XX 产品研发"]}
        ],
        projects=[
            {
                "name": "XX 产品",
                "role": "核心开发",
                "tech_stack": ["Python"],
                "description": ["在字节跳动负责 XX 产品"],
                "highlights": [],
            }
        ],
    )


def test_default_masks_pii_but_not_school_or_project():
    resume = redact(_resume())
    assert resume.name == MASK
    assert resume.phone == MASK
    assert resume.email == MASK
    # GitHub 与个人主页是一个 handle / 域名就能反查到人的字段，默认必须一起遮。
    # 它们曾经不在脱敏范围里，于是"脱敏导出"的联系方式行里原样留着完整主页 URL。
    assert resume.github == MASK
    assert resume.personal_website == MASK
    assert resume.experience[0].company == MASK
    # 学校 / 项目默认不遮罩。
    assert resume.education[0].school == "清华大学"
    assert resume.projects[0].name == "XX 产品"


def test_links_can_be_kept_by_turning_the_options_off():
    """链接是可选遮罩项：用户想保留作品集链接时必须能留住。"""
    resume = redact(_resume(), RedactionOptions(mask_github=False, mask_website=False))
    assert resume.github == "github.com/zhangsan"
    assert resume.personal_website == "https://zhangsan.dev"
    # 其余 PII 仍然照遮，关掉链接不等于关掉整份脱敏。
    assert resume.name == MASK
    assert resume.phone == MASK


def test_optional_masks():
    resume = redact(
        _resume(),
        RedactionOptions(mask_school=True, mask_project=True),
    )
    assert resume.education[0].school == MASK
    assert resume.projects[0].name == MASK


def test_mask_product_replaces_known_tokens_in_prose():
    resume = redact(_resume(), RedactionOptions(mask_product=True))
    assert "XX 产品" not in resume.summary
    assert "字节跳动" not in resume.experience[0].description[0]
    assert "XX 产品" not in resume.projects[0].description[0]


def test_redact_does_not_mutate_input():
    original = _resume()
    redact(original)
    assert original.name == "张三"
    assert original.phone == "13800000000"
    assert original.experience[0].company == "字节跳动"
    assert original.projects[0].name == "XX 产品"


def test_empty_values_stay_empty():
    resume = redact(ResumeContent())
    assert resume.name == ""
    assert resume.phone == ""
