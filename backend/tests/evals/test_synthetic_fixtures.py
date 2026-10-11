"""RF-15 合成样本库守卫：schema 校验、维度矩阵、对抗边角覆盖、隐私占位合规。

50 份样本是评测集的地基——schema 漂移、维度缺角或混入真实格式的个人信息
都必须在这里直接变红，而不是等到评测时才发现。
"""
from __future__ import annotations

import json
from collections import Counter

import checks
from runner import FIXTURES_DIR, load_samples

REQUIRED_PERSONA = {"应届": 15, "社招": 20, "转行": 10, "学生兼职": 5}
REQUIRED_LANGUAGE = {"中文": 35, "英文": 10, "中英混排": 5}
REQUIRED_INDUSTRY = {
    "IT/互联网": 15, "运营": 8, "财务": 7, "制造": 6, "医疗": 4, "教育": 5, "设计": 5,
}
REQUIRED_ADVERSARIAL_TAGS = {
    "sparse_profile",
    "long_jd",
    "same_company_repeat",
    "prompt_injection_zh",
    "prompt_injection_en",
    "overlapping_experiences",
    "pending_placeholder",
    "full_privacy_fields",
    "no_quantification",
}


def _index() -> dict:
    return json.loads((FIXTURES_DIR / "_index.json").read_text(encoding="utf-8"))


def _raw_samples() -> list[dict]:
    samples = []
    for path in sorted(FIXTURES_DIR.glob("synthetic_*.json")):
        samples.append(json.loads(path.read_text(encoding="utf-8")))
    return samples


def test_all_samples_validate_against_schema():
    samples = load_samples()
    assert len(samples) == 50
    assert [s.id for s in samples] == [f"synthetic_{i:03d}" for i in range(1, 51)]


def test_index_matches_actual_files():
    index = _index()
    assert index["total"] == 50
    files = _raw_samples()
    assert len(files) == 50
    by_id = {s["id"]: s for s in files}
    for entry in index["samples"]:
        sample = by_id[entry["id"]]
        assert sample["persona_type"] == entry["persona_type"]
        assert sample["language"] == entry["language"]
        assert sample["industry"] == entry["industry"]
        assert sample["adversarial_tags"] == entry["adversarial_tags"]


def test_index_dimension_stats_match_files():
    stats = _index()["dimension_stats"]
    files = _raw_samples()
    assert stats["persona_type"] == dict(Counter(s["persona_type"] for s in files))
    assert stats["language"] == dict(Counter(s["language"] for s in files))
    assert stats["industry"] == dict(Counter(s["industry"] for s in files))
    tag_counter: Counter[str] = Counter()
    for s in files:
        tag_counter.update(s["adversarial_tags"])
    assert stats["adversarial_tags"] == dict(tag_counter)


def test_dimension_matrix_is_fully_covered():
    files = _raw_samples()
    assert dict(Counter(s["persona_type"] for s in files)) == REQUIRED_PERSONA
    assert dict(Counter(s["language"] for s in files)) == REQUIRED_LANGUAGE
    assert dict(Counter(s["industry"] for s in files)) == REQUIRED_INDUSTRY


def test_required_adversarial_tags_each_have_at_least_one_sample():
    tag_counter: Counter[str] = Counter()
    for s in _raw_samples():
        tag_counter.update(s["adversarial_tags"])
    missing = REQUIRED_ADVERSARIAL_TAGS - set(tag_counter)
    assert not missing, f"缺少对抗边角样本：{missing}"


def test_long_jd_sample_exceeds_8000_chars():
    long_samples = [
        s for s in _raw_samples() if "long_jd" in s["adversarial_tags"]
    ]
    assert long_samples
    assert all(len(s["job_description"]) > 8000 for s in long_samples)


def test_injection_samples_carry_snippets_matching_jd():
    for s in _raw_samples():
        if "prompt_injection_zh" in s["adversarial_tags"]:
            assert s["injection_snippets"]
            assert all(snippet in s["job_description"] for snippet in s["injection_snippets"])


def test_no_real_format_personal_info_outside_placeholders():
    """隐私扫描器：正文任意位置出现真实格式的手机号/身份证/邮箱都必须是保留占位。"""
    for s in _raw_samples():
        blob = json.dumps(s, ensure_ascii=False)
        allow = set(s.get("privacy_placeholders", [])) | checks.RESERVED_PHONES
        for match in checks._PHONE_RE.finditer(blob):
            assert match.group() in allow, f"{s['id']} 出现非占位手机号"
        for match in checks._ID_NUMBER_RE.finditer(blob):
            value = match.group()
            assert value in allow or value.startswith(checks.RESERVED_ID_PREFIX), (
                f"{s['id']} 出现非占位身份证号"
            )
        for match in checks._EMAIL_RE.finditer(blob):
            value = match.group()
            assert value in allow or value.lower().endswith(
                checks.RESERVED_EMAIL_DOMAIN
            ), f"{s['id']} 出现非占位邮箱"


def test_privacy_placeholder_samples_list_what_they_use():
    """带隐私字段的样本必须同步声明 privacy_placeholders（privacy_leak 规则的放行清单）。"""
    for s in _raw_samples():
        if "full_privacy_fields" in s["adversarial_tags"]:
            placeholders = set(s["privacy_placeholders"])
            assert s["profile"].get("phone") in placeholders
            assert s["profile"].get("id_number") in placeholders
