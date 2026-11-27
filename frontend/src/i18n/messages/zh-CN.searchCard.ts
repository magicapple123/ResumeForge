// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页的「联网搜索」卡片：来源、正文抓取条数、每次返回条数。
 *
 * ## 来源的 `value` 是协议值，一个都不在这里
 *
 * `bing` / `duckduckgo` / `searxng` 会提交给后端（`SearchConfig.sources`），也用于
 * `config.sources.includes("searxng")` 的判定，属于交接单 §3 的第一类，永远不翻。
 * 这里只有它们的显示名。
 *
 * ## `Bing` / `DuckDuckGo` 不进词表
 *
 * 它们是**品牌名**，两种语言的写法完全相同。写进语言包会让中文源值恰好是纯 ASCII，
 * 被 `source-ascii-english` 判成"源文是英文却没翻译"（§8.3 的判据）。真正要翻的是
 * SearXNG 后面那个「自建实例」，所以只有它一条走词表。
 *
 * ## 搜索深度的三档（P4-08）
 *
 * `value` 是后端 `depth` 的协议值（snippet/standard/deep），`labelKey` 只负责显示。
 * 旧设置项叫「抓取正文的条数」（0~3），现在改成三档：摘要 0 页 / 标准 2 页×2 段 /
 * 深入 5 页×3 段。中文的括号是全角，英文用 ASCII 括号。
 *
 * ## `SearXNG 实例地址` 那段说明含内嵌 `<code>`
 *
 * 原文把示例地址包在 `<code>` 里。i18n 没有富文本插值，按标签切成前后两半在英文里
 * 语序不通（示例位置随语言变），因此**整段合成一个 key、示例写成句内纯文本**——
 * 地址本身是技术常量、两种语言一致，不进 `{placeholder}`。
 */
const searchCard = {
  "searchCard.title": "联网搜索",
  /**
   * `**怎么搜**` 是**原文就有的字面量星号**（Markdown 残留），迁移时逐字保留，
   * 以免顺手改掉用户可见的文案；英文同样保留同一个记号。
   */
  "searchCard.intro":
    "这里配的是助手「联网搜索」开关打开时**怎么搜**；助手页那个开关决定这一次要不要联网。抓取正文能拿到比摘要更完整的页面内容，但每次搜索会慢一些，也可能被站点拒绝。搜索来源、地址与 Key 保存在全局设置里，所有数据集共用，切换数据集不会改变它们。",

  "searchCard.action.save": "保存搜索设置",
  /**
   * 字段常驻可编辑（不再有「编辑」门禁），所以原来那颗「取消」改成语义准确的
   * 「恢复为已保存值」：它做的事就是把草稿退回上一次保存的那份，而不是"退出编辑态"。
   */
  "searchCard.action.reset": "恢复为已保存值",
  "searchCard.dirty": "有未保存的改动",

  "searchCard.loadErrorTitle": "没能读取已保存的设置",
  /** `{message}` 是原始错误消息，原样透传；只翻后面那句后果说明。 */
  "searchCard.loadErrorBody": "{message}。下面显示的是默认值，保存会覆盖服务端当前的设置。",
  "searchCard.loadFailed": "加载联网搜索设置失败",
  "searchCard.needSource": "至少要选一个搜索来源",
  /** URL 部分保持原样：校验规则里的 scheme 是技术常量。两条各自点名字段（T23）。 */
  "searchCard.badSearxngUrl": "SearXNG 实例地址要以 http:// 或 https:// 开头",
  "searchCard.badCustomUrl": "自定义搜索接口地址要以 http:// 或 https:// 开头",
  "searchCard.saving": "保存中…",
  "searchCard.saved": "已保存联网搜索设置",
  "searchCard.saveFailed": "保存联网搜索设置失败",

  "searchCard.source.bing": "Bing",
  "searchCard.source.duckduckgo": "DuckDuckGo",
  "searchCard.source.searxng": "SearXNG（自建实例）",
  /** 品牌名：两种语言写法相同，登记在 equalityExemptions。 */
  "searchCard.source.deepseek": "DeepSeek",
  /** 品牌名，同上。 */
  "searchCard.source.tavily": "Tavily",
  "searchCard.source.jina": "Jina",
  "searchCard.source.custom": "自定义",
  "searchCard.source.note.custom": "自带的搜索接口，按模板配端点",

  "searchCard.sources.title": "搜索来源",
  "searchCard.sources.hint": "多个来源会并发查询后合并去重，至少选一个。",

  "searchCard.searxng.title": "SearXNG 实例地址",
  "searchCard.searxng.placeholder": "例如 http://localhost:8080",
  "searchCard.searxng.hint":
    "公共实例经常限流，所以不预置默认值；填了自己的实例地址才会去查它，例如 http://localhost:8080。不选 SearXNG 来源时可以留空。",

  "searchCard.deepseek.title": "DeepSeek 搜索（可选）",
  "searchCard.deepseek.hint":
    "填了自己的 API Key 并勾选上面的 DeepSeek 来源后才会调用它。它不跟随大模型的对话配置，额度与账单是分开的；没填 Key 时这个来源不参与搜索，也不会显示为「搜索成功」。",
  "searchCard.deepseek.keyAria": "DeepSeek 搜索 API Key",
  /** 占位符不能写成纯 ASCII（`sk-...` 会被判成"源文是英文"），所以给一句中文。 */
  "searchCard.deepseek.keyPlaceholder": "粘贴 DeepSeek API Key",
  /** CR-12：空串规则与"同一把 Key 还供谁用"写在输入框旁。 */
  "searchCard.deepseek.keyRule":
    "留空并保存 = 移除这把 Key。扫描件 OCR 也用这一把（识别引擎在「设置 → 外部连接」）。",
  "searchCard.deepseek.cost":
    "这里配的是直连 Search / Fetch API，各约 ¥0.005 / 次成功请求，由 DeepSeek 计费；公司调研简报走的模型侧联网工具自 2026-11-18 起不再单独收取工具费。应用内只统计调用次数，不折算金额。已保存的 Key 回显为 ********，清空输入框即移除。",
  "searchCard.deepseek.privacy":
    "勾选这个来源后，抓取正文时网页地址会发送给 DeepSeek 由它读取；只有它失败时才回落到本机读取。不想发送地址就关掉这个来源。",

  "searchCard.depth.title": "搜索深度",
  "searchCard.depth.hint":
    "决定要不要打开结果页读正文：摘要只给搜索摘要（最快）；标准抓前 2 页、每页最多 2 段；深入抓前 5 页、每页最多 3 段，并且总字数上限更高（最详细，也最慢）。",
  /** 三个档位的显示名；`value` 是后端 `depth` 的取值，见文件头。 */
  "searchCard.depth.snippet": "只取摘要（最快）",
  "searchCard.depth.standard": "标准：抓前 2 页正文",
  "searchCard.depth.deep": "深入：抓前 5 页正文（最详细，也最慢）",

  "searchCard.results.title": "每次最多返回的结果条数",
  "searchCard.results.hint":
    "可填 1~50。只是上限：模型会按问题需要决定实际看几条，条数越多占用上下文越多；实际条数还受来源限制（Bing 单来源最多 8 条）。",
  "searchCard.results.aria": "每次最多返回的结果条数",
  /** 数字输入框后面的单位。 */
  "searchCard.results.unit": "条",
  /**
   * 多选卡片（条目 03）：4 个来源各一张卡，卡头右上显示已选个数。
   * 卡片的副标题是"要什么「钥匙」"，不是营销文案：免密钥 / 自建实例 / 按量付费。
   */
  "searchCard.sources.count": "已选 {count} 个",
  "searchCard.source.note.bing": "免密钥，直接可用",
  "searchCard.source.note.duckduckgo": "免密钥，直接可用",
  "searchCard.source.note.searxng": "需要自建实例地址",
  "searchCard.source.note.deepseek": "需要 API Key，按量付费",
  "searchCard.source.note.tavily": "需要 API Key，按量付费",
  "searchCard.source.note.jina": "需要 API Key，有免费额度",
  "searchCard.tavily.keyAria": "Tavily 搜索 API Key",
  "searchCard.tavily.keyPlaceholder": "粘贴以 tvly- 开头的 Key",
  "searchCard.tavily.keyRule": "留空并保存 = 移除 Tavily Key；助手搜索会少一条来源。",
  "searchCard.tavily.note":
    "一次调用就能带回摘要与整页正文，省掉逐条抓页面那一轮；免费额度每月 1000 次（basic 档每次 1 次额度）。正文同样会经过选段，不会把整页塞进上下文。",
  "searchCard.jina.keyAria": "Jina 搜索 API Key",
  "searchCard.jina.keyPlaceholder": "粘贴以 jina- 开头的 Key",
  "searchCard.jina.keyRule": "留空并保存 = 移除 Jina Key；抓取网页正文时会少一条来源。",
  "searchCard.jina.note":
    "搜索只取前 5 条干净正文；本机抓不到正文的页面（JS 渲染）会自动用它再读一次，本机能读到就不会重复请求。",

  /** 卡片区下方的通用参数与卡头的自动保存状态。 */

  /** CR-04：DeepSeek Key 的校验入口（只做 DeepSeek；失败不阻断保存）。 */
  "searchCard.deepseek.test": "测试 Key",
  "searchCard.deepseek.testing": "测试中…",
  "searchCard.deepseek.testOk": "Key 可用（{ms} ms）",
  /** T23：失败必须点名哪一把 Key + 问题落在哪个字段/哪一环（`reason` 是后端协议值）。 */
  "searchCard.deepseek.testFailed": "{name} 测试失败：{reason}",
  "searchCard.deepseek.testUnknown": "原因未识别，请查看诊断日志",
  "searchCard.deepseek.fail.missingKey": "还没有可测的 Key：先在输入框填一把，或先保存再测",
  "searchCard.deepseek.fail.unauthorized":
    "API Key 无效或没有权限：检查这把 Key 是否填错、是否已失效",
  "searchCard.deepseek.fail.balance": "这把 Key 余额不足：充值或换一把",
  "searchCard.deepseek.fail.rateLimited": "这把 Key 被限流：稍后再试",
  "searchCard.deepseek.fail.network": "连不上 DeepSeek：检查网络或代理（不是 Key 本身的问题）",
  "searchCard.deepseek.fail.parse":
    "能连上但响应无法解析：检查中转地址与接口协议（不是 Key 本身的问题）",

  /** CR-09：自定义搜索来源（模板 + 端点 + 字段映射）。 */
  "searchCard.custom.template": "协议模板",
  "searchCard.custom.templateMoonshot": "Kimi（Moonshot）",
  "searchCard.custom.templateGeneric": "通用",
  "searchCard.custom.baseUrlAria": "自定义搜索根地址",
  "searchCard.custom.baseUrlPlaceholder": "粘贴服务商提供的根地址",
  "searchCard.custom.baseUrlHint":
    "只填根地址；端点用相对路径。内网 IP 字面量会被拒绝，本机回环地址可以用。",
  "searchCard.custom.keyAria": "自定义搜索 API Key",
  "searchCard.custom.keyPlaceholder": "端点需要鉴权时填写（可留空）",
  "searchCard.custom.searchPathAria": "自定义搜索端点",
  "searchCard.custom.searchPathPlaceholder": "留空用模板默认（/v1/tools/search）",
  "searchCard.custom.fetchPathAria": "自定义抓取端点",
  "searchCard.custom.fetchPathPlaceholder": "留空用模板默认（/v1/tools/fetch）",
  "searchCard.custom.fieldAria": "结果字段路径",
  "searchCard.custom.fieldPlaceholder": "例如 data.items",
  "searchCard.custom.includeContent": "搜索结果直接带回正文",
  "searchCard.custom.keyRule": "留空并保存 = 移除自定义 Key。",
  "searchCard.custom.note":
    "自定义来源只影响资料卡片与助手联网搜索；联网简报仍固定用 DeepSeek。字段路径只支持 a.b / a[0].b 这类写法。",

  "searchCard.general.title": "通用参数",
  "searchCard.status.saved": "已自动保存",
  "searchCard.status.saving": "保存中…",
  "searchCard.status.error": "保存失败",
} as const;

export default searchCard;
