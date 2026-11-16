// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页（T11 / T12）与「识别引擎」（T01 的设置项）的界面文案。
 *
 * 为什么单独成文件：设置页主文件是 500 行零豁免预算，这批 key 有六十余条。
 *
 * ## 哪些名字来自后端、哪些在前端
 *
 * - **三档识别引擎的可读说明**（自动 / 只用 OCR / 只用视觉模型）**只由后端给**
 *   （`GET /api/ocr/settings` 的 `engine_options[].label`）。这里刻意没有对应译文：
 *   两处各写一份中文，迟早说两套（后端改了档位语义，界面还在讲旧话）。
 * - **状态与存储方式**有前端译文 + 后端标签兜底：后端加了第四种状态时页面不会白屏。
 * - **条目名称**（七个凭据 + 四个系统来源）在前端有译文，认不出的 id 回落后端 label
 *   ——registry 的 `label` 字段注释要求前端再包一层 i18n。
 */

const external = {
  // ── 分组与页面 ─────────────────────────────────────────────
  "connections.tab": "外部连接",
  "connections.intro":
    "这里集中列出这台机器对外依赖的服务与下载源：各自有没有配、存在哪、怎么改。密钥只显示掩码，就地改成空值即清除。",
  "connections.group.ai": "AI 服务",
  "connections.group.search": "搜索来源",
  "connections.group.system": "系统来源与端口",
  "connections.group.aiHint": "模型、语音转写、语义检索用的密钥。改完立刻生效，不用重启。",
  "connections.group.searchHint":
    "助手联网搜索与网页正文抓取用的密钥。DeepSeek 这把同时供扫描件 OCR 使用。",
  "connections.group.systemHint":
    "下载源与浏览器端口。它们不是密钥，会随备份带走；改完下一次调用即生效。",

  // ── 存储方式说明 ───────────────────────────────────────────
  "connections.storage.title": "本机密钥存储方式：{label}",

  // ── 三态（协议值 → 显示名；后端同名字段兜底）────────────────
  "connections.status.saved": "已保存",
  "connections.status.not_configured": "未配置",
  "connections.status.session_only": "仅本次会话",
  "connections.status.modified": "已改过",
  "connections.status.default": "默认值",

  // ── 存储保护方式 ───────────────────────────────────────────
  "connections.protection.dpapi": "DPAPI 加密",
  "connections.protection.plaintext": "当前平台无系统加密",
  "connections.protection.memory_only": "仅内存，不落盘",
  "connections.protection.config_file": "明文配置文件",

  // ── 动作与提示 ─────────────────────────────────────────────
  // 主按钮按状态变（issue I-09）：未配置 →「设置」，已配置 →「更换」，系统来源 →「修改」。
  // 「清除」「恢复默认」收进 `⋯` 菜单，但「清除」仍带二次确认（不可逆）。
  "connections.action.primary.set": "设置",
  "connections.action.primary.change": "更换",
  "connections.action.primary.modify": "修改",
  "connections.action.more": "{name} 的更多操作",
  "connections.action.copy": "复制当前值",
  "connections.action.save": "保存",
  "connections.action.cancel": "取消",
  "connections.action.clear": "清除",
  "connections.action.reset": "恢复默认",
  // 无障碍名必须**含可见文字**（label-in-name）：可见是「设置」/「更换」，两者都在这句里。
  "connections.action.editAria": "设置或更换 {name} 的 Key",
  "connections.action.saveAria": "保存 {name} 的新 Key",
  "connections.action.clearAria": "清除 {name} 的 Key",
  "connections.action.editValue": "修改 {name}",
  "connections.action.saveValue": "保存 {name}",
  "connections.action.resetValue": "把 {name} 恢复默认",
  "connections.emptyMask": "未填写",
  "connections.input.label": "{name} 的新 Key",
  "connections.input.placeholder": "粘贴新的 Key",
  "connections.hint.aria": "查看 {name} 的说明与存储方式",
  "connections.hint.storage": "存储方式：{label}",
  "connections.clear.title": "清除这把 Key",
  "connections.clear.body": "清除后相关能力立刻不可用，要重新填写",
  "connections.loadFailed": "读取外部连接失败",
  "connections.loadErrorBody": "原因：{message}",
  "connections.saveFailed": "没有保存成功：{message}",
  "connections.toast.saved": "已保存 {name}",
  "connections.toast.cleared": "已清除 {name}",
  "connections.toast.reset": "已把 {name} 恢复默认",
  "connections.toast.copied": "已复制 {name} 的当前值",
  "connections.toast.copyFailed": "复制失败，请手动选中后复制",
  "connections.system.factoryValue": "出厂值 {value}",
  "connections.system.resetHint": "改错了可以随时恢复默认",
  "connections.error.emptyValue": "新 Key 不能为空；要移除请点「清除」",
  "connections.error.unsupported": "这一项不能在这里修改",
  "connections.error.noAsrProfile": "还没有可写的语音配置，请先在「语音与面试 → 语音转写」里建一条",

  // ── 条目名称与就地编辑说明（后端同名字段兜底）────────────────
  "connections.item.llm.default.label": "大模型 API Key（当前生效配置）",
  "connections.item.llm.default.hint":
    "这里只改 Key。服务商与模型在「AI 模型」里改；换服务商时 Key 不会跟过去。",
  "connections.item.llm.session.label": "仅本次会话使用的大模型 Key",
  "connections.item.llm.session.hint":
    "只存在后端内存，程序重启即失效；清除后立刻回到已保存的那把 Key。",
  "connections.item.asr.default.label": "语音转写 API Key（当前生效配置）",
  "connections.item.asr.default.hint": "改的是当前这条语音配置的 Key。地址或协议一变就要重填。",
  "connections.item.embedding.default.label": "语义检索 API Key（当前生效配置）",
  "connections.item.embedding.default.hint":
    "语义检索的 Key 在「AI 模型 → 语义检索」里配置；这里只显示有没有配，不回掩码。",
  "connections.item.web_search.deepseek.label": "DeepSeek（联网搜索 / 抓取 / OCR 共用）",
  "connections.item.web_search.deepseek.hint":
    "改这里等于改「联网搜索」里的 DeepSeek Key；清空即移除。扫描件 OCR 用的是同一把。",
  "connections.item.web_search.tavily.label": "Tavily（联网搜索来源）",
  "connections.item.web_search.tavily.hint": "清空即移除 Tavily Key，助手搜索会少一条来源。",
  "connections.item.web_search.jina.label": "Jina（网页正文抓取来源）",
  "connections.item.web_search.jina.hint": "清空即移除 Jina Key，抓取网页正文时会少一条来源。",
  "connections.item.system.update_repo.label": "更新源（GitHub 仓库）",
  "connections.item.system.update_repo.hint":
    "检查新版本时查询的仓库，形如 owner/repo。换自托管发行源时改这里。",
  "connections.item.system.font_base_url.label": "字体下载源",
  "connections.item.system.font_base_url.hint":
    "内置字体（思源黑体）的下载根地址，需要 http 或 https 开头。",
  "connections.item.system.rag_asset_base_url.label": "RAG 资产下载源",
  "connections.item.system.rag_asset_base_url.hint":
    "本地语义检索模型的整包下载根地址；填目录，不要填到具体文件。",
  "connections.item.system.browser_port.label": "浏览器调试端口",
  "connections.item.system.browser_port.hint":
    "投递专用浏览器的调试端口，1024 到 65535 之间。网申填表固定用 9334，请避开。",

  // ── 识别引擎（档位文字由后端给，这里只有界面骨架）────────────
  "ocrEngine.title": "识别引擎",
  "ocrEngine.intro":
    "扫描件里的文字用哪条路识别。两条路把原件发给不同的第三方：OCR 发给 DeepSeek（按页计费），视觉模型发给你自己配的多模态模型。",
  "ocrEngine.current": "当前使用：{label}",
  "ocrEngine.keyMissing.title": "还没有配置 DeepSeek API Key",
  "ocrEngine.keyMissing.body":
    "OCR 复用联网搜索里的 DeepSeek Key（本页「搜索来源」那一组）。选「自动」时没 Key 会继续用视觉模型；选「只用 OCR」会直接报错，不会偷偷换服务商，也不会替你花钱。",
  "ocrEngine.saveFailed": "没有切换成功：{message}",
  "ocrEngine.saved": "识别引擎已切换",
  "ocrEngine.loadFailed": "读取识别引擎设置失败",
};

export default external;
