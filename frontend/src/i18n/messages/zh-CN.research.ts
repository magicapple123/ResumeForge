// SPDX-License-Identifier: Apache-2.0
/**
 * 「科研栏目」（W14 / P2-02）与「长 CV 文档模式」这一批**新增**的界面文案。
 *
 * 为什么单独成文件：`messages/zh-CN.ts` 已接近 500 行硬预算，拆法与
 * `zh-CN.outline.ts` / `zh-CN.proview.ts` 完全一致——扁平点分 key、一个默认导出、
 * `as const`；由 lead 在 `zh-CN.ts` 末尾 `...research` 展开合并，`MessageKey` 自动包含新 key。
 *
 * ## 边界
 *
 * - 只放本批新增的 key。已有的「教育」「技能」「板块」等一律复用。
 * - 术语按 `docs/ui-copy-guide.md`：**板块 / 条目 / 要点**；三个板块名与后端
 *   `resume_labels.SECTION_TITLES` 逐字一致（R-70 起：学术成果 / 科研项目 / 知识产权；
 *   论文、专利是内容类型词，不再作板块名）。
 * - 发表状态严格区分：**在投 ≠ 已发表**（plan §P2-02）；专利状态同理。
 * - 按钮写具体动作；不用「确定」「是」「否」。
 */

const research = {
  // ── 三个板块（页签名 / 分组名） ───────────────────────────────
  "research.tab.publications": "学术成果",
  "research.tab.projects": "科研项目",
  "research.tab.patents": "知识产权",
  "research.section.count": "共 {count} 条",
  "research.section.hint": "顺序即展示顺序；上移/下移可用键盘",

  // ── 可重复条目的通用动作 ─────────────────────────────────────
  "research.list.add": "添加{label}",
  "research.list.remove": "删除这一条{label}",
  "research.list.removeAria": "删除{label}第 {index} 条",
  "research.list.moveUp": "上移",
  "research.list.moveDown": "下移",
  "research.list.moveUpAria": "把{label}第 {index} 条上移",
  "research.list.moveDownAria": "把{label}第 {index} 条下移",
  "research.required.title": "请填写题目",
  "research.required.name": "请填写名称",

  // ── 空态（列表内，紧凑容器） ─────────────────────────────────
  "research.empty.publications": "还没有论文，添加一篇即可开始",
  "research.empty.projects": "还没有科研项目，添加一个即可开始",
  "research.empty.patents": "还没有专利，添加一项即可开始",

  // ── 论文 ────────────────────────────────────────────────────
  "research.publications.title": "题目",
  "research.publications.titlePlaceholder": "论文题目",
  "research.publications.venue": "期刊/会议",
  "research.publications.venuePlaceholder": "期刊或会议全名",
  "research.publications.year": "年份",
  "research.publications.yearPlaceholder": "2026",
  "research.publications.status": "发表状态",
  "research.publications.doi": "DOI",
  "research.publications.doiPlaceholder": "10.1000/xyz123",
  "research.publications.url": "链接",
  "research.publications.urlPlaceholder": "https://…",
  "research.publications.volumePages": "卷期页码",
  "research.publications.volumePagesPlaceholder": "Vol 12, 1-15",
  "research.publications.note": "备注",
  "research.publications.outcomeType": "成果类型",
  "research.publications.outcomeTypePlaceholder": "如：期刊论文 / 会议论文",
  "research.publications.myRank": "我的署名位次",
  "research.publications.myRankPlaceholder": "如：第一作者 / 二作",
  "research.projects.level": "项目级别",
  "research.projects.levelPlaceholder": "如：国家级 / 省部级",

  // ── 作者 / 发明人（列表顺序即署名顺序） ───────────────────────
  "research.authors.label": "作者",
  "research.authors.name": "姓名",
  "research.authors.namePlaceholder": "作者姓名",
  "research.authors.self": "本人",
  "research.authors.corresponding": "通讯",
  "research.authors.add": "添加作者",
  "research.authors.empty": "还没有作者",
  "research.authors.removeAria": "删除第 {index} 位作者",
  "research.authors.moveUpAria": "第 {index} 位作者上移",
  "research.authors.moveDownAria": "第 {index} 位作者下移",
  "research.authors.selfHint": "勾选后简历里会把你的名字加粗显示，姓名文本不变",
  "research.inventors.label": "发明人",
  "research.inventors.add": "添加发明人",
  "research.inventors.empty": "还没有发明人",

  // ── 发表 / 专利状态 ──────────────────────────────────────────
  "research.status.published": "已发表",
  "research.status.accepted": "已接收",
  "research.status.in_press": "出版中",
  "research.status.under_review": "在投",
  "research.status.preprint": "预印本",
  "research.status.other": "其他",
  "research.patentStatus.filed": "已申请",
  "research.patentStatus.pending": "审查中",
  "research.patentStatus.granted": "已授权",
  "research.patentStatus.expired": "已失效",
  "research.patentStatus.other": "其他",
  "research.status.hint": "「在投」「审查中」不会被当成已完成，导出按这里的值",

  // ── 科研项目 ────────────────────────────────────────────────
  "research.projects.name": "项目名称",
  "research.projects.namePlaceholder": "科研项目名称",
  "research.projects.role": "本人角色",
  "research.projects.rolePlaceholder": "负责人 / 参与者",
  "research.projects.organization": "实验室/机构",
  "research.projects.start": "开始",
  "research.projects.end": "结束",
  "research.projects.funding": "基金/资助",
  "research.projects.fundingPlaceholder": "国家自然科学基金",
  "research.projects.description": "项目描述",
  "research.projects.descriptionPlaceholder": "每行一个要点",
  "research.projects.outcomes": "研究成果",
  "research.projects.outcomesPlaceholder": "每行一项",

  // ── 专利 ────────────────────────────────────────────────────
  "research.patents.name": "专利名称",
  "research.patents.namePlaceholder": "专利名称",
  "research.patents.number": "专利号",
  "research.patents.numberPlaceholder": "CN123456789A",
  "research.patents.country": "国家/地区",
  "research.patents.countryPlaceholder": "中国",
  "research.patents.status": "专利状态",
  "research.patents.filed": "申请日",
  "research.patents.granted": "授权日",
  "research.patents.url": "链接",
  "research.patents.urlPlaceholder": "https://…",
  "research.patents.numberHint": "专利号按公开号原样填写，不改写",

  // ── 链接安全 ────────────────────────────────────────────────
  "research.link.open": "在新窗口打开链接",
  "research.link.invalid": "只支持 http(s) 链接，当前内容不会变成可点链接",

  // ── 文档模式（长 CV） ────────────────────────────────────────
  "research.mode.label": "文档模式",
  "research.mode.resume": "普通简历",
  "research.mode.longCv": "长 CV",
  "research.mode.hint": "长 CV 用于科研简历，上限 10 页；普通简历仍为 1–3 页",
  "research.mode.limitLabel": "篇幅上限",
  "research.mode.limitOption": "{count} 页",
  "research.mode.budget": "长 CV 最多 10 页；装不下时提示并截断，不自动缩小字号",
  "research.mode.overBudget": "按当前设置需要 {pages} 页，超过上限 {limit} 页",
  "research.mode.clampedToResume": "已按普通简历上限调整为 3 页",
  "research.mode.readonlyHint": "文档模式由整屏动作条统一保存",
} as const;

export default research;
