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
    "这里配的是助手「联网搜索」开关打开时**怎么搜**；助手页那个开关决定这一次要不要联网。抓取正文能拿到比摘要更完整的页面内容，但每次搜索会慢一些，也可能被站点拒绝。",

  "searchCard.edit": "编辑搜索设置",
  "searchCard.action.save": "保存搜索设置",
  "searchCard.dirty": "有未保存的改动",

  "searchCard.loadErrorTitle": "没能读取已保存的设置",
  /** `{message}` 是原始错误消息，原样透传；只翻后面那句后果说明。 */
  "searchCard.loadErrorBody": "{message}。下面显示的是默认值，保存会覆盖服务端当前的设置。",
  "searchCard.loadFailed": "加载联网搜索设置失败",
  "searchCard.needSource": "至少要选一个搜索来源",
  /** URL 部分保持原样：校验规则里的 scheme 是技术常量。 */
  "searchCard.badUrl": "SearXNG 地址要以 http:// 或 https:// 开头",
  "searchCard.saved": "已保存联网搜索设置",
  "searchCard.saveFailed": "保存联网搜索设置失败",

  "searchCard.source.searxng": "SearXNG（自建实例）",

  "searchCard.sources.title": "搜索来源",
  "searchCard.sources.hint": "多个来源会并发查询后合并去重，至少选一个。",

  "searchCard.searxng.title": "SearXNG 实例地址",
  "searchCard.searxng.hint":
    "公共实例经常限流，所以不预置默认值；填了自己的实例地址才会去查它，例如 http://localhost:8080。不选 SearXNG 来源时可以留空。",

  "searchCard.fetch.title": "抓取正文的条数",
  "searchCard.fetch.hint": "对排序最靠前的几条结果打开页面读取正文。关闭时助手只能看到搜索摘要。",
  /** 四个档位的显示名；`value` 是后端 `fetch_pages` 的取值，见文件头。 */
  "searchCard.fetch.0": "只取摘要（最快）",
  "searchCard.fetch.1": "抓前 1 条正文",
  "searchCard.fetch.2": "抓前 2 条正文",
  "searchCard.fetch.3": "抓前 3 条正文（最详细，也最慢）",

  "searchCard.results.title": "每次返回的结果条数",
  "searchCard.results.hint": "1~15 条。条数越多，占用模型的上下文越多。",
  "searchCard.results.aria": "搜索结果数量",
  /** 数字输入框后面的单位。 */
  "searchCard.results.unit": "条",
} as const;

export default searchCard;
