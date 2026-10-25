// SPDX-License-Identifier: Apache-2.0
/**
 * 「导出交付包 / 导出配置 / 交付原件」（W19 / D18–D20）这一批**新增**界面文案。
 *
 * 术语按 docs/ui-copy-guide.md：**模板 / 版式 / 排版参数 / 版面**四层不混用；
 * 「导出配置」= 数据集级命名预设，「交付原件」= 可选归档的文件字节（与投递快照区分）。
 * 按钮写具体动作（导出交付包、删除这份原件），二次确认三段式（动作+对象+后果）。
 */

const delivery = {
  // ── 面板/弹层 ─────────────────────────────────────────────
  "delivery.config.title": "导出交付包",
  "delivery.config.formats": "格式",
  "delivery.config.preset": "导出配置",
  "delivery.config.presetPlaceholder": "选择已保存的配置",
  "delivery.config.noPresets": "还没有保存的导出配置",
  "delivery.config.presetName": "配置名称",
  "delivery.config.presetNamePlaceholder": "例如「对外发送」",
  "delivery.config.savePreset": "保存为配置",
  "delivery.config.deletePreset": "删除配置",
  "delivery.config.defaultPreset": "设为默认",
  "delivery.config.dirty": "导出配置有未保存的修改",
  "delivery.config.loadFailed": "导出配置加载失败，请重试",
  "delivery.config.presetSaved": "已保存配置",
  "delivery.config.presetDeleted": "已删除配置",
  "delivery.config.presetSaveFailed": "保存配置失败，请重试",
  "delivery.config.presetNameRequired": "请填写配置名称",

  // ── 格式名与能力矩阵 ───────────────────────────────────────
  "delivery.format.pdf": "PDF",
  "delivery.format.docx": "Word",
  "delivery.format.html": "HTML",
  "delivery.format.md": "Markdown",
  "delivery.format.txt": "纯文本",
  "delivery.format.json": "交付 JSON",
  "delivery.capability.full": "完整支持",
  "delivery.capability.approx": "近似",
  "delivery.capability.unsupported": "不支持",
  "delivery.capability.layout": "近似：版面由查看器重排",
  "delivery.capability.fonts": "近似：字体可能被替换",
  "delivery.capability.not-applicable": "不支持",

  // ── 命名规则 ──────────────────────────────────────────────
  "delivery.naming.label": "文件命名规则",
  "delivery.naming.hint": "用占位符拼文件名，留空则用默认命名",
  "delivery.naming.tokens": "可用占位符",
  "delivery.naming.preview": "文件名预览",
  "delivery.naming.default": "默认命名",
  "delivery.naming.token.name": "姓名",
  "delivery.naming.token.company": "公司",
  "delivery.naming.token.job_title": "岗位",
  "delivery.naming.token.template": "模板",
  "delivery.naming.token.date": "日期",
  "delivery.naming.token.revision": "版本",
  "delivery.naming.token.language": "语言",

  // ── 后处理 ────────────────────────────────────────────────
  "delivery.config.includePhoto": "包含照片",
  "delivery.config.watermark": "水印",
  "delivery.config.watermarkPlaceholder": "例如「内部评审」",
  "delivery.config.redact": "脱敏后导出（对外发送）",
  "delivery.config.archive": "归档原件",
  "delivery.config.archiveHint": "归档后可在交付原件里核对哈希；不会自动清理",

  // ── 配置校验（保存预设时）──────────────────────────────────
  "delivery.issue.no-formats": "至少选一种格式",
  "delivery.issue.bad-naming": "命名规则里的占位符不认识：{tokens}",
  "delivery.issue.watermark-too-long": "水印最多 64 字",
  "delivery.issue.duplicate-format": "格式重复",
  "delivery.issue.unknown-format": "有格式不受支持",

  // ── D20 导出前核对 ─────────────────────────────────────────
  "delivery.check.title": "导出前核对",
  "delivery.check.target": "目标岗位",
  "delivery.check.targetEmpty": "未关联岗位",
  "delivery.check.resumeTitle": "简历标题",
  "delivery.check.contact": "联系方式",
  "delivery.check.contactPresent": "已填写",
  "delivery.check.contactMissing": "缺少电话或邮箱",
  "delivery.check.revision": "版本",
  "delivery.check.documentMode": "文档模式",
  "delivery.check.mode.resume": "普通简历",
  "delivery.check.mode.long_cv": "长 CV",
  "delivery.check.hidden": "隐藏条目",
  "delivery.check.hiddenCount": "{count} 条（正式导出会排除）",
  "delivery.check.hiddenNone": "没有隐藏条目",
  "delivery.check.refresh": "重新核对",
  "delivery.check.checking": "正在核对",
  "delivery.check.failed": "核对失败，请重试",
  "delivery.check.source.server": "核对基于导出同一快照（服务端）",
  "delivery.check.source.local": "服务端核对未启用，按同一份导出输入在本机核对",
  "delivery.check.warning.no-target": "未关联目标岗位，导出前请确认用途",
  "delivery.check.warning.no-contact": "简历里没有电话或邮箱，对方可能联系不上",
  "delivery.check.warning.has-hidden": "有隐藏条目，正式导出会排除它们",
  "delivery.check.warning.revision-changed": "版本已更新，请刷新后再导出",
  "delivery.check.warning.long-cv": "长 CV 模式：页数与资源预算独立",

  // ── 配置预览（W04：水印/脱敏配置预览，不是编辑预览）──────────
  "delivery.preview.action": "预览这份配置",
  "delivery.preview.loading": "正在生成配置预览",
  "delivery.preview.title": "配置预览",
  "delivery.preview.notEditPreview": "这是配置预览（水印/脱敏），不是编辑预览",
  "delivery.preview.failed": "配置预览生成失败，请重试",
  "delivery.preview.unsupported": "当前后端还不支持带水印/脱敏的预览；正式导出仍会按这份配置生成",
  "delivery.preview.pages": "按当前配置约需 {pages} 页（上限 {limit} 页）",
  "delivery.preview.overflow": "超出页数上限，内容会被截断",
  "delivery.preview.hide": "收起预览",

  // ── 岗位变体（W16：按变体导出）─────────────────────────────
  "delivery.variant.label": "岗位变体",
  "delivery.variant.none": "当前简历（不选变体）",
  "delivery.variant.hint": "选择后导出使用该变体的内容与排版",
  "delivery.variant.loadFailed": "变体列表加载失败，仍可导出当前简历",

  // ── 版本冲突（strict_revision 409）─────────────────────────
  "delivery.revision.title": "版本已更新",
  "delivery.revision.body": "这份简历已被其他窗口修改；刷新后按最新版本核对再导出",
  "delivery.revision.refresh": "刷新并核对",

  // ── 导出动作 ──────────────────────────────────────────────
  "delivery.export.action": "导出交付包",
  "delivery.export.exporting": "正在打包…",
  "delivery.export.success": "交付包已下载",
  "delivery.export.failed": "导出失败，请重试",
  "delivery.export.emptyFormats": "至少选一种格式",
  "delivery.export.noRevision": "还没拿到简历版本，请稍后重试",
  "delivery.export.snapshotKept": "导出使用当前内容与排版参数的同一次快照",
  "delivery.export.archiveKept": "本次会同时归档原件，可在「交付原件」里核对",

  // ── 交付原件列表 ──────────────────────────────────────────
  "delivery.archive.title": "交付原件",
  "delivery.archive.resumePicker": "查看这份简历的交付原件",
  "delivery.archive.resumePickerPlaceholder": "选择一份简历",
  "delivery.archive.count": "{count} 份",
  "delivery.archive.empty": "还没有归档的原件",
  "delivery.archive.emptyHint": "导出时勾选「归档原件」才会保留文件字节",
  "delivery.archive.loadFailed": "原件加载失败，请重试",
  "delivery.archive.sha": "哈希",
  "delivery.archive.size": "大小",
  "delivery.archive.created": "归档时间",
  "delivery.archive.delete": "删除原件",
  "delivery.archive.deleteTitle": "删除这份原件",
  "delivery.archive.deleteBody": "删除后无法从本机恢复；重新导出会生成新原件",
  "delivery.archive.deleted": "已删除这件原件",
  "delivery.archive.deleteFailed": "删除失败，请重试",
  "delivery.archive.limit": "每份简历最多保留 {max} 份原件，满了请先删旧",
} as const;

export default delivery;
