# SPDX-License-Identifier: Apache-2.0
"""A4/A9 跨行业 24 案例的 Schema（计划 §3.2 / §9.4）。

设计纪律：

1. **复用生产 schema**：``profile`` 直接是 ``app.schemas.profile.ProfileUpdate``；
   ``facts`` 的 payload 走生产 ``validate_fact_payload``（九类 kind 的严格校验，
   与 ProfileFact API 完全同一份规则），评测与生产不会"评测一套字段、生产另一套"。
2. **纯虚构**：姓名/机构/联系方式全部来自 `_index.json` 声明的虚构清单；联系方式的
   保留号段复用合成样本的隐私约定（13800138000 / 19999990000 / 999999 开头身份证 /
   example.com 邮箱）。扫描器在 `industry/checks.py::scan_fiction`，由
   `test_industry_matrix.py` 逐文件钉住。
3. **密度合同**（计划 §3.2：每组一份资料充分、一份资料稀疏或边界）：
   - 每份案例都必须覆盖 `award` / `training` / `language` 三类扩展事实（PROFILE_FACT_KINDS
     扩到九类后的覆盖要求，与 §9.4 的"每个案例都进确定性检查"同一口径）；
   - `sufficient`：除三类扩展事实外仍有 ≥3 条原始事实，且资料里有可写的教育/经历/项目；
   - `sparse`：除三类扩展事实外只保留 1–2 条原始事实，核心栏目（教育/经历/项目）
     合计 ≤1 条——用来验证"只剩少量真实事实"时链路仍能跑通。
4. **确定性期望**：`must_appear` / `must_not_appear` / `credential_number` /
   `status_claims` 全部是"文本包含 / 枚举相等"级别的判据，不做模型评分。
   `status_claims` 与事实里的真实状态**必须一一对应**（见 model_validator）：
   论文"在投"、专利"申请中"、证照"待核"都不允许被升级成已发表/已授权/已取得。
"""
from __future__ import annotations

from typing import Any, Literal

from app.schemas.profile import ProfileUpdate
from app.schemas.profile_facts import (
    PROFILE_FACT_KIND_VALUES,
    ProfileFactKind,
    validate_fact_payload,
)
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# 计划 §3.2 的十二个行业/职能组（顺序即报告里的顺序）。
INDUSTRY_GROUP_SLUGS: dict[str, str] = {
    "软件/数据/产品": "software-data-product",
    "制造/工程/质量": "manufacturing-engineering-quality",
    "医疗/护理/健康服务": "healthcare-nursing-health",
    "教育/培训": "education-training",
    "财务/金融/法务": "finance-legal",
    "销售/客户成功": "sales-customer-success",
    "运营/行政/人力": "operations-admin-hr",
    "零售/餐饮/酒店/物流": "retail-hospitality-logistics",
    "设计/内容/传媒": "design-content-media",
    "科研/学术": "research-academia",
    "自雇/顾问/创业": "self-employed-consulting-startup",
    "公共服务/社会组织/技能工种": "public-service-social-org",
}
INDUSTRY_GROUPS: tuple[str, ...] = tuple(INDUSTRY_GROUP_SLUGS)

# 计划 §3.2 末段要求的十种就业状态/职业阶段（24 案例合计必须覆盖全部十种）。
PERSONA_VALUES: tuple[str, ...] = (
    "在校无实习",
    "在职换岗",
    "待业",
    "转行",
    "兼职并行",
    "自雇",
    "创业后求职",
    "长期间歇回归",
    "内部转岗",
    "资深再就业",
)

DENSITIES: tuple[str, ...] = ("sufficient", "sparse")
FACT_KINDS: tuple[str, ...] = tuple(PROFILE_FACT_KIND_VALUES)
# 九类里新增的三类：每份案例都必须有，且"稀疏"只约束其余原始事实的条数。
EXTENSION_FACT_KINDS: tuple[str, ...] = ("award", "training", "language")
LEGACY_FACT_KINDS: tuple[str, ...] = tuple(
    kind for kind in FACT_KINDS if kind not in EXTENSION_FACT_KINDS
)

# 事实身份字段：候选路径按它判断"这条事实在不在"，覆盖器按它报告"哪条没写"。
FACT_IDENTITY_FIELDS: dict[str, str] = {
    "publication": "title",
    "research_project": "name",
    "patent": "title",
    "credential": "name",
    "work_project": "name",
    "practice": "organization",
    # 九类扩展事实：荣誉/培训/语言都用名称做身份（映射进既有 awards/projects/skills）。
    "award": "name",
    "training": "name",
    "language": "name",
}

# 状态事实的"升级方向"：只用于断言"不允许被升级"，不用于判断真实有效性。
# 空 tuple = 该状态已是本栏目的终态（published/granted/active），没有可升级目标。
STATUS_UPGRADE_TARGETS: dict[str, dict[str, tuple[str, ...]]] = {
    "publication": {
        "published": (),
        "accepted": ("published",),
        "in_press": ("published",),
        "under_review": ("published",),
        "preprint": ("published",),
        "other": ("published",),
    },
    "patent": {
        "granted": (),
        "filed": ("granted",),
        "pending": ("granted",),
        "expired": ("granted",),
        "other": ("granted",),
    },
    "credential": {
        "active": (),
        "unknown": ("active",),
        "pending": ("active",),
        "expired": ("active",),
    },
}
STATUS_UPGRADE_WORDINGS: dict[tuple[str, str], tuple[str, ...]] = {
    ("publication", "published"): ("已发表", "已见刊"),
    ("patent", "granted"): ("已授权", "已颁发"),
    ("credential", "active"): ("已取得", "已获证"),
}


def fact_identity(kind: str, payload: dict[str, Any]) -> str:
    """一条事实的身份文本（标题/名称/机构）；候选/覆盖检查共用这一处。"""
    field = FACT_IDENTITY_FIELDS[kind]
    return str(payload.get(field) or "").strip()


def status_upgrade_targets(kind: str, status: str) -> tuple[str, ...]:
    return STATUS_UPGRADE_TARGETS[kind].get(status, ())


def status_upgrade_wordings(kind: str, status: str) -> tuple[str, ...]:
    wordings: list[str] = []
    for target in status_upgrade_targets(kind, status):
        wordings.extend(STATUS_UPGRADE_WORDINGS.get((kind, target), ()))
    return tuple(wordings)


class CaseFact(BaseModel):
    """一条补充事实：kind + 契约 §3.1 的 payload（严格校验走生产函数）。"""

    model_config = ConfigDict(extra="forbid")

    kind: ProfileFactKind
    payload: dict[str, Any]

    @model_validator(mode="after")
    def payload_must_be_valid_and_identified(self) -> CaseFact:
        self.payload = validate_fact_payload(self.kind, self.payload)
        if not fact_identity(self.kind, self.payload):
            raise ValueError(f"{self.kind} 事实缺少身份字段 {FACT_IDENTITY_FIELDS[self.kind]}")
        return self


class CaseJob(BaseModel):
    """目标岗位：虚构公司 + JD 文本（内嵌一条提示注入，用于验证不被透传）。"""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=128)
    company: str = Field(min_length=1, max_length=128)
    jd: str = Field(min_length=1, max_length=20_000)


class StatusClaim(BaseModel):
    """一条状态事实的"不得升级"声明（论文/专利/证照）。"""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["publication", "patent", "credential"]
    subject: str = Field(min_length=1, max_length=512)
    status: str = Field(min_length=1, max_length=32)
    upgraded_values: list[str] = Field(default_factory=list, max_length=4)
    upgrade_wordings: list[str] = Field(default_factory=list, max_length=8)


class CaseExpected(BaseModel):
    """确定性断言元数据（不做模型评分）。"""

    model_config = ConfigDict(extra="forbid")

    must_appear: list[str] = Field(min_length=1, max_length=8)
    must_not_appear: list[str] = Field(min_length=1, max_length=12)
    credential_number: str = Field(min_length=1, max_length=128)
    status_claims: list[StatusClaim] = Field(default_factory=list, max_length=8)

    @field_validator("must_appear", "must_not_appear")
    @classmethod
    def terms_must_be_clean(cls, value: list[str]) -> list[str]:
        cleaned = [term.strip() for term in value]
        if any(not term for term in cleaned):
            raise ValueError("期望关键词不能是空串")
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("期望关键词不能重复")
        return cleaned

    @model_validator(mode="after")
    def appear_and_absent_must_be_disjoint(self) -> CaseExpected:
        overlap = set(self.must_appear) & set(self.must_not_appear)
        if overlap:
            raise ValueError(f"同一关键词不能既 must_appear 又 must_not_appear：{sorted(overlap)}")
        if self.credential_number not in self.must_not_appear:
            raise ValueError("credential_number 必须列入 must_not_appear（私密值不得进输出）")
        for claim in self.status_claims:
            if claim.status in claim.upgraded_values:
                raise ValueError(f"状态「{claim.status}」不能同时是升级目标")
            expected_values = list(status_upgrade_targets(claim.kind, claim.status))
            expected_wordings = list(status_upgrade_wordings(claim.kind, claim.status))
            if claim.upgraded_values != expected_values:
                raise ValueError(
                    f"状态声明 {claim.kind}/{claim.status} 的升级目标应为 {expected_values}"
                )
            if claim.upgrade_wordings != expected_wordings:
                raise ValueError(
                    f"状态声明 {claim.kind}/{claim.status} 的升级措辞应为 {expected_wordings}"
                )
        return self


class IndustryCase(BaseModel):
    """一份跨行业合成验收案例（12 组 × 2）。"""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(max_length=64)
    industry_group: str
    density: Literal["sufficient", "sparse"]
    persona: str
    profile: ProfileUpdate
    facts: list[CaseFact] = Field(min_length=1, max_length=10)
    job: CaseJob
    expected: CaseExpected
    notes: str = Field(min_length=1, max_length=2000)

    @field_validator("industry_group")
    @classmethod
    def group_must_be_known(cls, value: str) -> str:
        if value not in INDUSTRY_GROUP_SLUGS:
            raise ValueError(f"未知行业组「{value}」")
        return value

    @field_validator("persona")
    @classmethod
    def persona_must_be_known(cls, value: str) -> str:
        if value not in PERSONA_VALUES:
            raise ValueError(f"未知就业状态「{value}」")
        return value

    @field_validator("id")
    @classmethod
    def id_must_encode_density(cls, value: str) -> str:
        if not value.startswith("industry_"):
            raise ValueError(f"案例 id 必须以 industry_ 开头，收到 {value!r}")
        if not value.endswith(("_sufficient", "_sparse")):
            raise ValueError(f"案例 id 必须以密度结尾，收到 {value!r}")
        return value

    @model_validator(mode="after")
    def validate_density_contract(self) -> IndustryCase:
        extension_counts = {
            kind: sum(1 for fact in self.facts if fact.kind == kind)
            for kind in EXTENSION_FACT_KINDS
        }
        missing = [kind for kind, count in extension_counts.items() if count < 1]
        if missing:
            raise ValueError(f"每份案例都必须覆盖扩展事实类型：缺少 {missing}")
        legacy_count = sum(1 for fact in self.facts if fact.kind in LEGACY_FACT_KINDS)
        dense = self.density == "sufficient"
        if dense and legacy_count < 3:
            raise ValueError("sufficient 案例除扩展事实外至少需要 3 条原始事实")
        if not dense and not 1 <= legacy_count <= 2:
            raise ValueError("sparse 案例除扩展事实外只保留 1–2 条原始事实（资料稀疏/边界）")
        core_entries = (
            len(self.profile.educations)
            + len(self.profile.experiences)
            + len(self.profile.campus_experiences)
            + len(self.profile.projects)
        )
        if dense:
            if not self.profile.summary.strip():
                raise ValueError("sufficient 案例必须有一段真实个人总结")
            if core_entries < 1:
                raise ValueError("sufficient 案例必须至少有一条教育/经历/项目")
        elif core_entries > 1:
            raise ValueError("sparse 案例的核心栏目（教育/经历/项目）合计不得超过 1 条")
        if not self.profile.name.strip():
            raise ValueError("profile.name 不能为空")
        return self

    @model_validator(mode="after")
    def credential_number_and_status_claims_must_match_facts(self) -> IndustryCase:
        credentials = [fact for fact in self.facts if fact.kind == "credential"]
        if len(credentials) != 1:
            raise ValueError("每份案例必须且只能有一条 credential 事实（私密证号断言的对象）")
        number = str(credentials[0].payload.get("credential_number") or "")
        if not number:
            raise ValueError("credential 事实必须带 credential_number（私密值）")
        if self.expected.credential_number != number:
            raise ValueError("expected.credential_number 与 credential 事实不一致")

        status_facts = [
            fact for fact in self.facts if fact.kind in ("publication", "patent", "credential")
        ]
        actual = {
            (fact.kind, fact_identity(fact.kind, fact.payload), str(fact.payload.get("status") or ""))
            for fact in status_facts
        }
        declared = {
            (claim.kind, claim.subject, claim.status) for claim in self.expected.status_claims
        }
        if actual != declared:
            raise ValueError(f"status_claims 必须与事实状态一一对应：缺少 {sorted(actual - declared)}，多余 {sorted(declared - actual)}")

        injection_terms = [term for term in self.expected.must_not_appear if term in self.job.jd]
        if not injection_terms:
            raise ValueError("JD 必须内嵌至少一条列在 must_not_appear 里的提示注入短语")
        return self

    @model_validator(mode="after")
    def id_must_encode_group_and_density(self) -> IndustryCase:
        expected_id = (
            f"industry_{INDUSTRY_GROUP_SLUGS[self.industry_group]}_{self.density}"
        )
        if self.id != expected_id:
            raise ValueError(f"案例 id 应为 {expected_id!r}（行业组+密度），收到 {self.id!r}")
        return self

    @model_validator(mode="after")
    def facts_must_be_unique(self) -> IndustryCase:
        identities = [(fact.kind, fact_identity(fact.kind, fact.payload)) for fact in self.facts]
        if len(set(identities)) != len(identities):
            raise ValueError("同一案例内的补充事实身份必须唯一")
        return self

    # ----- 派生信息（checks / index / 报告共用，避免各处再写一遍） -----

    def facts_of(self, kind: str) -> list[CaseFact]:
        return [fact for fact in self.facts if fact.kind == kind]

    @property
    def credential_fact(self) -> CaseFact:
        return self.facts_of("credential")[0]

    @property
    def injection_phrases(self) -> list[str]:
        """JD 内嵌、且被声明为不得透传的注入短语（fabricated 判据的唯一来源）。"""
        return [term for term in self.expected.must_not_appear if term in self.job.jd]

    def identity_strings(self) -> list[str]:
        return [fact_identity(fact.kind, fact.payload) for fact in self.facts]

    def person_names(self) -> set[str]:
        names = {self.profile.name.strip()} - {""}
        for fact in self.facts:
            for field in ("authors", "inventors"):
                for person in fact.payload.get(field) or []:
                    if isinstance(person, dict) and str(person.get("name") or "").strip():
                        names.add(str(person["name"]).strip())
        return names

    def organization_names(self) -> set[str]:
        orgs = {self.job.company.strip()}
        orgs.update(
            item.school.strip()
            for item in self.profile.educations
            if item.school.strip()
        )
        orgs.update(
            item.company.strip()
            for item in self.profile.experiences
            if item.company.strip()
        )
        orgs.update(
            item.organization.strip()
            for item in self.profile.campus_experiences
            if item.organization.strip()
        )
        for fact in self.facts:
            payload = fact.payload
            for field in ("organization", "issuer"):
                value = str(payload.get(field) or "").strip()
                if value:
                    orgs.add(value)
        return orgs - {""}


__all__ = [
    "CASES_DIR_NAME",
    "CaseExpected",
    "CaseFact",
    "CaseJob",
    "DENSITIES",
    "EXTENSION_FACT_KINDS",
    "FACT_IDENTITY_FIELDS",
    "FACT_KINDS",
    "LEGACY_FACT_KINDS",
    "INDUSTRY_GROUPS",
    "INDUSTRY_GROUP_SLUGS",
    "IndustryCase",
    "PERSONA_VALUES",
    "STATUS_UPGRADE_TARGETS",
    "STATUS_UPGRADE_WORDINGS",
    "StatusClaim",
    "fact_identity",
    "status_upgrade_targets",
    "status_upgrade_wordings",
]
CASES_DIR_NAME = "cases"
