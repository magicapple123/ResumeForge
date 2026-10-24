// SPDX-License-Identifier: Apache-2.0
/**
 * 本批（字体下载 / 删除 / 样张 · 板块顺序 · 精确模式字族说明）**全部新增文案**。
 *
 * 为什么单独成文件：`messages/zh-CN.ts` 与 `messages/zh-CN.fonts.ts` 都已到预算边缘，而
 * `cjkRatchet` 是**逐文件**比较的——往既有语言包里加中文行会直接变红，即使总量在降。
 * 所以本批所有新句子只进这一个文件：`zh-CN.ts` 末尾 `...fontDownload` 展开，`MessageKey`
 * 仍是合并后的字面量联合，`t()` 的调用点一行都不用改。
 *
 * ## 边界与措辞
 *
 * - 术语固定：**模板 / 版式 / 排版参数 / 版面**（不写"样式 / 皮肤 / 布局"）。
 * - 不写方位词 + 按钮名（"右上角的删除"这类随响应式变化的描述），控件靠自身可访问名定位。
 * - 删除类必须写明**没有恢复入口**：字体文件是直删，没有回收站。
 * - 内置字体是**按需下载**，凡提到它的地方都不能暗示"已经装好了"。
 * - 后端 `detail` 只写原因；"请 / 可以"这类引导由前端补，所以下面有 `{error}` 占位。
 *
 * ## 三处 key 前缀（与设计 §5.1 一致）
 *
 * | 前缀                | 用途                                         |
 * | ------------------ | ------------------------------------------ |
 * | `fontDownload.*`   | 下载 / 取消 / 删除 / 样张                     |
 * | `sections.*`       | 「按我的资料顺序排列」按钮与它的两条不可用说明      |
 * | `exact.serifNote`  | 精确预览的常驻字族说明（只在衬线模板 + 精确口径下出现） |
 */

const fontDownload = {
  // ── 下载 / 取消（P0-1：内置字体可中途取消）──────────────────
  /** 未下载时的主按钮（与既有 `fonts.builtin.download` 同一件事，本批在下拉里复用它）。 */
  "fontDownload.download": "下载",
  /** 下载中（拿得到总量）：`下载中… 12.0 MB / 32.0 MB`。 */
  "fontDownload.downloading": "下载中… {done} / {total}",
  /** 下载中（拿不到总量）：只报已下载的部分，不编一个分母。 */
  "fontDownload.downloadingNoTotal": "下载中… {done}",
  /** 下载中（只要一个百分比）：制作台的字体下拉只有一行放说明，塞不进两串字节数。 */
  "fontDownload.progress": "下载中… {percent}%",
  /** 失败：说清失败对象与后端给的原因。 */
  "fontDownload.downloadFailed": "下载失败：{error}",
  /** 失败但接口没给原因（旧后端 / 网络层异常）时的退化文案。 */
  "fontDownload.downloadFailedNoReason": "下载失败",
  /** 失败态的重试按钮。 */
  "fontDownload.retry": "重试",
  /** 已下载的标记（下拉里的第二行用它替代进度）。 */
  "fontDownload.downloaded": "已下载",
  /** 下载完成并已写成这份简历的字体：一次说清"下了什么"与"已经生效"。 */
  "fontDownload.downloadedAndSet": "已下载，并设为这份简历的字体",
  /** 下载中的取消按钮：短，因为它长在字体那一行的行内。 */
  "fontDownload.cancel": "取消",
  /** 取消信号已发出、线程在收尾（`cancelling` 提示位；**不是**独立状态）。 */
  "fontDownload.canceling": "正在取消…",
  /** 取消失败（网络层异常）：后端状态没变，用户还能再点一次。 */
  "fontDownload.cancelFailed": "取消失败：{error}",
  /** 409「字体正在下载中」时把已有进度接上，不重复提交、也不弹错。 */
  "fontDownload.alreadyDownloading": "字体正在下载中",
  /** 下拉里未下载的内置字体：第二行说明（弹层只有 260px，短是第一要求）。 */
  "fontDownload.optionHint": "点这一行下载",

  // ── 删除已下载的内置字体（P0-2）────────────────────────────
  /** 删除按钮。 */
  "fontDownload.delete": "删除",
  /** 二次确认的标题：点明删除对象是"已下载的字体文件"。 */
  "fontDownload.deleteConfirmTitle": "删除已下载的内置字体？",
  /** 二次确认正文：必须写明**直接删除、没有恢复入口**，并说清正在用它的简历会怎样。 */
  "fontDownload.deleteConfirmBody":
    "字体文件会被直接删除，没有恢复入口，删除后需要用它的简历重新下载。正在使用它的简历会回到系统字体。",
  /** 删除成功的通用反馈。 */
  "fontDownload.deleted": "已删除已下载的内置字体",
  /** 删掉的正是当前字体时的反馈：说清"已经回到系统字体"，用户不必再去设置页确认。 */
  "fontDownload.deletedAndResetToSystem": "已删除，简历字体已回到系统字体",
  /** 删除失败（文件被占用 / 无权限 / 接口异常）：文件原样留着，原因原样透出。 */
  "fontDownload.deleteFailed": "删除失败：{error}",

  // ── 样张（P1-1）────────────────────────────────────────
  /** 样张弹窗的标题。 */
  "fontDownload.sampleTitle": "字体样张",
  /** 字体文件读不到（CSS Font Loading 的 `reject`）：宁可说不可用，也不要静默回退系统字体。 */
  "fontDownload.sampleUnavailable": "字体文件不可用",
  /** 未下载的内置字体：点名字只给这一句，不打开空弹窗。 */
  "fontDownload.sampleNotDownloaded": "下载后即可预览",
  /** 第 1 行：中文标题（姓名 + 求职意向），用最大字号。 */
  "fontDownload.sampleLineTitle": "张三 · 后端开发工程师",
  /** 第 2 行：中英数混排（验证数字与英文的宽度、字距是否协调）。 */
  "fontDownload.sampleLineMixed": "QPS 8,500 · P99 下降 42% · 2022.07 – 2024.09",
  /** 第 3 行：中文标点（全角标点最容易暴露字族缺字或替换）。 */
  "fontDownload.sampleLinePunct": "！？、；：「」（）——·…",
  /** 第 4 行：粗体示例（缺粗体字面时笔画会发虚，这一行就是给用户核对这个的）。 */
  "fontDownload.sampleLineBold": "这一行用粗体排版，用来核对笔画是否发虚。",
  /** 样张底部：把这款字设为全局当前字体（内置字体才有这一颗）。 */
  "fontDownload.sampleActivate": "设为当前",
  /** 样张底部：这一款已经就是当前字体（按钮保持可见但不可点，说明"为什么点了没反应"）。 */
  "fontDownload.sampleActive": "当前已在使用",

  // ── 板块顺序（P0-6：一次性快照）──────────────────────────
  /** 板块顺序卡片上的按钮：把顺序改成与「我的资料」一致。 */
  "sections.arrangeByProfile": "按我的资料顺序排列",
  /** 按钮的悬停说明：讲清是**一次性快照**，之后改资料不会回头改这份简历。 */
  "sections.arrangeByProfileHint":
    "把这份简历的板块顺序改成与「我的资料」一致；之后再调整资料里的顺序，这份简历不会跟着变。",
  /** 不可用分支一：资料里没有可排序的分区（空数组）。 */
  "sections.profileOrderUnavailable": "我的资料里还没有可排序的分区",
  /** 不可用分支二：资料顺序与内置默认顺序已经相同，点了也没有变化。 */
  "sections.profileOrderSame": "资料顺序与默认顺序相同",

  // ── 精确模式的字族说明（P1-2）────────────────────────────
  /** 常驻说明：只在衬线标题模板 + 精确口径下渲染，切回草稿/换模板后自然消失。 */
  "exact.serifNote": "精确预览用本机可用的中文黑体排版，标题字族与草稿不同",
} as const;

export default fontDownload;
