# SPDX-License-Identifier: Apache-2.0
"""`ResumeRef` 的服务端解析（T29 基座，契约见 `CONTRACT.md` 第 2 节）。

## 为什么要这一层

「关联一份简历」这件事在这个产品里有**两个来源**：`resume_record`（内部简历，结构化
文档）与 `external_resume`（外部简历，原件 + 提取出来的文本）。两张表的 id 各自从 1
开始、**会撞号**，所以"哪一张表的第 7 份"必须由复合引用 `internal:12` / `external:7`
表达（前端同一份语法在 `frontend/src/types/resumeRef.ts`）。

在这之前，每个消费方都自己写了一段"拿到 id → 打开对应记录 → 看看有没有文本"的代码：
助手工具只认 `resume_id`、面试只认 `resume_id`、匹配把外部简历当"没有"处理。后果不是
崩溃，而是**沉默的错误答案**——"这份简历没有内容""读不到正文"，用户无从判断是文件
真的没有文字层，还是链路根本没去看。所以这里收成唯一入口：

```python
resolved = resolve_resume_ref(db, "external:7", "text")
if not resolved.ok:
    # resolved.reason 说的是「为什么没有 + 怎么办」，可以直接给用户看
```

## 三条硬约定

1. **不抛异常**：ref 写错、id 不存在、文件没了、没有文字层，一律用 `reason` 说明。
   抛异常会让调用方（助手工具 / 任务）把它当成系统故障，用户看到的是"分析失败"而不是
   "这份是扫描件，先做一次文本检查"。
2. **`reason` 必带怎么办**：只说"没有文字层"等于把问题丢回给用户。每条缺失路径都要
   给出下一步（去哪、点什么、或者换一条通道），这也是 `CONTRACT.md` 的原话。
3. **只为要的东西取数**：`need="file"` 不去提取正文（那是 IO + 解析），`need="text"`
   不去解析原件，`need="document"` 只给内部简历。多取一份数据就有多一份失败面。

## 与契约的一处差异

`CONTRACT.md` 写的是 `resolve_resume_ref(ref, need)`；实现多一个**首位** `db: Session`。
理由：解析必须读库，而本项目的服务层一律"会话由调用方持有"（不在这里 `SessionLocal()`，
否则测试库隔离与事务边界都会失控）。参数名与语义不变，下游按 `(db, ref, need)` 调用。

## 关于 `document`

`ResolvedResume` 比契约多一个 `document` 字段：`need="document"` 只对内部简历成立，
它返回的就是 v2 文档 dict（与 `document_io.document_for_record` 同一份形状，不做二次
转换）。外部简历没有结构化文档——原文只在 PDF/DOCX 与提取出来的 `text` 里，强行还原成
"板块 + 字段"必然错位，所以那条路径只给 `reason`。契约字段都是**新增**而非改名，
既有消费方（只读 `kind/id/name/text/file_id/reason`）不受影响。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.orm import Session

from ..models.external_resume import ExternalResume
from ..models.resume import ResumeRecord
from . import trash
from .external_resumes import ExternalResumeFileMissing, extract_text, resolve_original_path
from .resume import document_io
from .resume.document_view import document_text

logger = logging.getLogger(__name__)

#: 简历来源（与前端 `types/resumeRef.ResumeKind` 同一字面量）。
ResumeKind = Literal["internal", "external"]

#: 要取的东西：正文 / 原件文件 / 结构化文档。
ResumeNeed = Literal["text", "file", "document"]

#: 合法的 `need` 取值（供参数校验与测试引用）。
NEEDS: tuple[ResumeNeed, ...] = ("text", "file", "document")

#: 新旧前缀 → 来源。旧写法 `r:` / `e:` 只在读侧被接受（模拟面试与进度页在用），
#: `encode_resume_ref` **只产出**新写法，避免两套语法继续扩散。
_KIND_BY_PREFIX: dict[str, ResumeKind] = {
    "internal": "internal",
    "external": "external",
    "r": "internal",
    "e": "external",
}

# ===== 缺失原因：每条都必须回答「为什么没有」+「怎么办」=====

# 机器可读的原因分类（`ResolvedResume.code`）。调用方按它分支，不解析中文。
CODE_INVALID_REF = "invalid_ref"
CODE_NOT_FOUND = "not_found"
CODE_NO_TEXT = "no_text"
CODE_NO_FILE = "no_file"
CODE_NO_DOCUMENT = "no_document"

INVALID_REF = (
    "看不出这是哪一份简历（{ref}）。怎么办：在「内部简历」或「外部简历」列表里重新选中一份；"
    "复合引用写成 internal:12 或 external:7。"
)
INTERNAL_NOT_FOUND = (
    "内部简历 #{resume_id} 不存在或已删除。怎么办：在「简历中心」确认它还在——"
    "进了回收站的要先恢复；或者重新选一份。"
)
INTERNAL_NO_TEXT = (
    "这份内部简历还没有正文（可能只是刚建的空白草稿），所以没有可分析的文字。"
    "怎么办：先在简历制作台把内容补上（或让 AI 生成一版）再回来。"
)
INTERNAL_NO_FILE = (
    "内部简历是结构化文档，没有「上传的原件」可以下载——它的 PDF/DOCX 是导出时现渲染的。"
    "怎么办：在简历详情里点「导出」生成 PDF/DOCX 再用导出的文件；"
    "若这条流程要的正是原始上传件，请改用外部简历。"
)
EXTERNAL_NOT_FOUND = (
    "外部简历 #{resume_id} 不存在或已删除。怎么办：在「简历中心 → 外部简历」确认它还在"
    "（回收站里的要先恢复），或者重新上传一份。"
)
EXTERNAL_NO_TEXT = (
    "这一份没有可提取的文字层（扫描件，或整页是图片的 PDF），所以读不到正文。"
    "怎么办：先打开这份外部简历做一次「文本检查」确认；或者换成一份带文字层的 PDF / DOCX。"
    "扫描件可以走面试材料那条通道做视觉识别，那里会调视觉模型。"
)
EXTERNAL_NO_FILE = (
    "原件文件已经不在磁盘上了（可能被清理，或从备份里恢复时只回了库、没回文件）。"
    "怎么办：在外部简历详情的「历史版本」里恢复一版（会用那一版的文件重开一条原件），"
    "或者重新上传这份文件。"
)
EXTERNAL_NO_DOCUMENT = (
    "外部简历只有原件和提取出来的文本，没有可编辑的结构化文档，所以做不到按板块 / 按字段的读写。"
    "怎么办：只改文字请用详情里的块编辑；要按板块分析或改写，先用「导入制作台」把它转成内部简历。"
)


@dataclass(frozen=True)
class ResolvedResume:
    """一次解析的结果：**要的东西在就填上，不在就只给 `reason`**。

    `reason is None` 等价于"要到了"，用 :attr:`ok` 读。
    """

    #: `internal` / `external`；ref 都解析不出来时是空串。
    kind: str
    #: 那张表里的 id；ref 解析不出来时是 0（**不是** None：下游不必为"有没有 id"分叉）。
    id: int
    #: 展示名：内部 `resume_record.title` / 外部 `external_resume.name`。
    name: str
    #: `need="text"` 时填正文，其余为 None。
    text: str | None = None
    #: `need="file"` 时填 `user_file.id`，其余为 None。
    file_id: int | None = None
    #: `need="document"` 时填 v2 文档 dict，其余为 None。
    document: dict | None = None
    #: 没要到时的「为什么没有 + 怎么办」；要到了就是 None。
    reason: str | None = None
    #: 机器可读的原因分类（见下方 `CODE_*` 常量）；要到了就是 None。
    #:
    #: 为什么不只给 `reason`：文案改一个字就会变，而调用方要按**类别**做不同的处置——
    #: 助手把「记录不存在」当 4xx（用户指错了东西），把「没有文字层」当正常上下文
    #: （如实告诉模型"读不到"并让它改口），两者不许混。按类别分支，文案随便改。
    code: str | None = None

    @property
    def ok(self) -> bool:
        """要到了吗（等价于 `reason is None`）。"""
        return self.reason is None

    @property
    def ref(self) -> str:
        """回写成复合串（`internal:12`）；ref 本身无效时是空串。"""
        return encode_resume_ref(self.kind, self.id) if self.kind and self.id else ""


def encode_resume_ref(kind: str, resume_id: int) -> str:
    """`("external", 7)` → `"external:7"`（与前端 `encodeResumeRef` 逐字一致）。"""
    return f"{kind}:{resume_id}"


def parse_resume_ref(ref: str | None) -> tuple[ResumeKind, int] | None:
    """`"internal:12"` / `"r:12"` → `("internal", 12)`；任何不合法的串一律 `None`。

    不抛错是刻意的：ref 来自 URL 参数、表单旧值、助手工具的字符串参数与任务快照，
    脏数据的正确处理是"退回未选择 / 让 reason 说清楚"，不是 500。
    """
    text = (ref or "").strip()
    separator = text.find(":")
    if separator <= 0:
        return None
    kind = _KIND_BY_PREFIX.get(text[:separator].lower())
    if kind is None:
        return None
    id_text = text[separator + 1 :]
    # 只认纯数字：`internal:3x` / `internal:-1` / `internal:3.5` 都不是合法 id。
    if not id_text.isdigit():
        return None
    resume_id = int(id_text)
    if resume_id <= 0:
        return None
    return kind, resume_id


def resolve_resume_ref(db: Session, ref: str | None, need: ResumeNeed) -> ResolvedResume:
    """按复合引用取 `need` 要的东西；取不到时用 `reason` 说明「为什么 + 怎么办」。

    :param db: 调用方持有的会话（服务层不自己开会话，见模块顶部）。
    :param ref: `internal:12` / `external:7`，也接受旧写法 `r:12` / `e:7`。
    :param need: `text`（正文）/ `file`（原件）/ `document`（结构化文档）。
    :returns: :class:`ResolvedResume`；**永远不抛异常**（除 `need` 传错这种编码错误）。
    """
    if need not in NEEDS:
        raise ValueError(f"need 只能是 {'/'.join(NEEDS)}，收到 {need!r}")
    parsed = parse_resume_ref(ref)
    if parsed is None:
        # kind 空、id 0：下游按 `ok is False` 处理即可，不必再判空。
        return ResolvedResume(
            kind="",
            id=0,
            name="",
            reason=INVALID_REF.format(ref=ref or ""),
            code=CODE_INVALID_REF,
        )
    kind, resume_id = parsed
    if kind == "internal":
        return _resolve_internal(db, resume_id, need)
    return _resolve_external(db, resume_id, need)


def _not_found(kind: str, resume_id: int, template: str, *, name: str = "") -> ResolvedResume:
    """找不到记录时的统一出口（名字尽量带上，方便用户确认是不是找错了那一份）。"""
    return ResolvedResume(
        kind=kind,
        id=resume_id,
        name=name,
        reason=template.format(resume_id=resume_id),
        code=CODE_NOT_FOUND,
    )


def _resolve_internal(db: Session, resume_id: int, need: ResumeNeed) -> ResolvedResume:
    """内部简历：正文与文档来自同一份 v2 文档；原件不存在（导出时才渲染）。"""
    record = trash.get_live(db, ResumeRecord, resume_id)
    if record is None:
        return _not_found("internal", resume_id, INTERNAL_NOT_FOUND)
    name = str(record.title or "")
    if need == "file":
        # 不在这里顺手导出：导出要渲染整份 PDF，成本和副作用都远超"取一个文件 id"。
        return ResolvedResume(
            kind="internal",
            id=resume_id,
            name=name,
            reason=INTERNAL_NO_FILE,
            code=CODE_NO_FILE,
        )
    document = document_io.document_for_record(db, record)[0]
    if need == "document":
        return ResolvedResume(kind="internal", id=resume_id, name=name, document=document)
    text = document_text(document)
    if not text.strip():
        return ResolvedResume(
            kind="internal",
            id=resume_id,
            name=name,
            text="",
            reason=INTERNAL_NO_TEXT,
            code=CODE_NO_TEXT,
        )
    return ResolvedResume(kind="internal", id=resume_id, name=name, text=text)


def _resolve_external(db: Session, resume_id: int, need: ResumeNeed) -> ResolvedResume:
    """外部简历：`text` / `file` 各自一条路径；没有结构化文档。"""
    row = trash.get_live(db, ExternalResume, resume_id)
    if row is None:
        return _not_found("external", resume_id, EXTERNAL_NOT_FOUND)
    name = str(row.name or "")
    if need == "document":
        return ResolvedResume(
            kind="external",
            id=resume_id,
            name=name,
            reason=EXTERNAL_NO_DOCUMENT,
            code=CODE_NO_DOCUMENT,
        )
    if need == "file":
        try:
            # 只看路径是否真的还在：`resolve_original_path` 同时挡住"副本行丢了"与
            # "文件被手工删了"两种情况，两种情况对用户的处置是同一句。
            resolve_original_path(db, row)
        except ExternalResumeFileMissing:
            logger.info("外部简历原件缺失 ref=external:%s", resume_id)
            return ResolvedResume(
                kind="external",
                id=resume_id,
                name=name,
                reason=EXTERNAL_NO_FILE,
                code=CODE_NO_FILE,
            )
        return ResolvedResume(kind="external", id=resume_id, name=name, file_id=int(row.file_id))
    # need == "text"：`extract_text` 自带自愈（库里的 text 空、但原件还在时会重提取一次）。
    text = extract_text(db, row)
    if not text.strip():
        return ResolvedResume(
            kind="external",
            id=resume_id,
            name=name,
            text="",
            reason=EXTERNAL_NO_TEXT,
            code=CODE_NO_TEXT,
        )
    return ResolvedResume(kind="external", id=resume_id, name=name, text=text)


__all__ = [
    "CODE_INVALID_REF",
    "CODE_NOT_FOUND",
    "CODE_NO_DOCUMENT",
    "CODE_NO_FILE",
    "CODE_NO_TEXT",
    "EXTERNAL_NO_DOCUMENT",
    "EXTERNAL_NO_FILE",
    "EXTERNAL_NO_TEXT",
    "EXTERNAL_NOT_FOUND",
    "INTERNAL_NO_FILE",
    "INTERNAL_NO_TEXT",
    "INTERNAL_NOT_FOUND",
    "INVALID_REF",
    "NEEDS",
    "ResolvedResume",
    "ResumeKind",
    "ResumeNeed",
    "encode_resume_ref",
    "parse_resume_ref",
    "resolve_resume_ref",
]
