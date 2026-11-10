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
 * ## 抓取正文的四档
 *
 * `value`（0/1/2/3）是后端 `fetch_pages` 的档位，`labelKey` 只负责显示。
 * 中文的括号是全角，英文用 ASCII 括号。
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
  /** URL 部分保持原样：校验规则里的 scheme 是技术常量。 */
  "searchCard.badUrl": "SearXNG 地址要以 http:// 或 https:// 开头",
  "searchCard.saving": "保存中…",
  "searchCard.saved": "已保存联网搜索设置",
  "searchCard.saveFailed": "保存联网搜索设置失败",

  "searchCard.source.searxng": "SearXNG（自建实例）",
  /** 品牌名：两种语言写法相同，登记在 equalityExemptions。 */
  "searchCard.source.deepseek": "DeepSeek",

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
  "searchCard.deepseek.cost":
    "Search 与 Fetch 各约 ¥0.005 次成功请求，由 DeepSeek 计费；本应用不统计这部分用量。已保存的 Key 回显为 ********，清空输入框即移除。",
  "searchCard.deepseek.privacy":
    "勾选这个来源后，抓取正文时网页地址会发送给 DeepSeek 由它读取；只有它失败时才回落到本机读取。不想发送地址就关掉这个来源。",

  "searchCard.fetch.title": "抓取正文的条数",
  "searchCard.fetch.hint": "对排在最前的几条结果打开页面读取正文；抓得越多越慢。",
  /** 四个档位的显示名；`value` 是后端 `fetch_pages` 的取值，见文件头。 */
  "searchCard.fetch.0": "只取摘要（最快）",
  "searchCard.fetch.1": "抓前 1 条正文",
  "searchCard.fetch.2": "抓前 2 条正文",
  "searchCard.fetch.3": "抓前 3 条正文（最详细，也最慢）",

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

  /** 卡片区下方的通用参数与卡头的自动保存状态。 */
  "searchCard.general.title": "通用参数",
  "searchCard.status.saved": "已自动保存",
  "searchCard.status.saving": "保存中…",
  "searchCard.status.error": "保存失败",
} as const;

export default searchCard;
