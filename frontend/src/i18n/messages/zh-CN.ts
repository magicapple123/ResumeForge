// SPDX-License-Identifier: Apache-2.0
/**
 * 唯一的界面语言包（简体中文）。**扁平点分 key**，不嵌套、不拆命名空间。
 *
 * ## key 命名规则
 *
 * ` <领域>.<对象>.<用途> `，例如 `resume.language.label`。
 *
 * 1. **全小写 kebab 片段**：`resume.language.zh-CN` 的值是「中文」，但 key 里那一段是
 *    语言标签本身（`zh-CN` / `en-US`），不是界面位置，因此保留原样大小写。
 * 2. **禁止把中文当 key**（`t("教育经历")`）：加 `en-US` 时那样的 key 全都要重写。
 * 3. **禁止为了"以后可能要改"把整句拆成词块拼接**（`t("a") + t("b")`）：词序、格变化、
 *    空格规则在别的语言里一定不一样，拼接出来的句子一定是错的。一条 key 就是一句完整的话。
 * 4. **禁止在 key 里编码语言或界面位置**（`zh-CN.button.top` 之类）。
 *
 * ## 这里**只放界面文案**
 *
 * 简历**纸面上**的固定文案（小节标题 `Education` / 字段前缀 `Objective` 等）**不在这里**，
 * 它在后端 `backend/app/services/resume/resume_labels.py`，由服务端渲染或下发。
 * 前端再存一份 "Education" 就会有两份真相——改一处、另一处悄悄过期。
 *
 * ## 这里是"数据"，不是"渲染"
 *
 * 不许放 HTML/JSX（`<b>`、`{'\n'}`）。需要强调或换行时，由调用方拆成多段 `t()`。
 */
import fonts from "./zh-CN.fonts";
import preview from "./zh-CN.preview";
import responsive from "./zh-CN.responsive";
import rich from "./zh-CN.rich";
import workbench from "./zh-CN.workbench";

const zhCN = {
  /** 版式下拉的无障碍名（视觉标签是同一句，见 `ResumeTemplateControls`）。 */
  "resume.format.label": "版式",
  /** 排版栏里那个下拉框的标题（也是它的无障碍名）。 */
  "resume.language.label": "简历语言",
  /** 下拉框旁的说明：讲清"它只改纸面固定文案，不翻译正文"。 */
  "resume.language.hint": "决定导出文件里的小节标题与字段名用哪种语言；正文内容不会被翻译。",
  /** 中文选项。 */
  "resume.language.zh-CN": "中文",
  /** 英文选项（英文语言名按惯例用英文本身，不译成「英文」）。 */
  "resume.language.en-US": "English",

  /** 「更新方式」一行在桌面安装形态下的取值：页面内下载走不通，只能用安装包。 */
  "update.method.desktop": "下载 Setup.exe 安装包，双击安装后覆盖旧版本。",
  /** 浏览器/控制台形态的更新方式（既有行为）。 */
  "update.method.in-app": "应用内下载，确认后自动覆盖并重启（Windows）。",
  /** 桌面形态的说明块标题。 */
  "update.desktop.title": "桌面版请使用安装包更新",
  /** 桌面形态说明块的正文（比上面那行"更新方式"更详细，单独成 key 不拼接）。 */
  "update.desktop.description": "下载 Setup.exe 后双击安装，应用会自动退出并覆盖旧版本。",
  /** 安装包已下载完成（Alert 标题）。 */
  "update.downloaded.title": "更新包已下载完成",

  /** 版式来源标签：值来自模板自带的默认值（四个度量控件共用这一条）。 */
  "resume.measure.hintTemplate": "随模板",
  /** 版式来源标签：值来自当前选中的版式预设（预设优先于模板默认）。 */
  "resume.measure.hintPreset": "随版式",

  /** 总页边距滑杆的标签。 */
  "resume.pagePadding.label": "页边距",
  /** 双击 / 回车复位总页边距的可发现性提示。 */
  "resume.pagePadding.resetTooltip": "双击或按回车恢复默认页边距",
  /** 总页边距标签的无障碍名（读屏用户拿不到 Tooltip）。 */
  "resume.pagePadding.resetLabel": "页边距（双击或按回车恢复默认）",
  /** 总页边距滑杆的无障碍名。 */
  "resume.pagePadding.sliderLabel": "页边距（拖动调整）",
  /** `-0.1mm` 按钮的无障碍名。 */
  "resume.pagePadding.decrease": "减小页边距",
  /** `+0.1mm` 按钮的无障碍名。 */
  "resume.pagePadding.increase": "增大页边距",
  /** 四边不全相等时，总滑杆的读数（此位置上没有"一个"页边距值）。 */
  "resume.pagePadding.custom": "自定义",
  /** 上一句的补充说明：四条支路各是多少（悬停可见，读屏会读到）。 */
  "resume.pagePadding.customHint": "上 {top} · 右 {right} · 下 {bottom} · 左 {left}",
  /** 展开 / 收起"分边调整"那一块的无障碍名。 */
  "resume.pagePadding.sidesToggle": "分边调整页边距",

  /** 四个方向的简称（分边滑杆的行首标签）。 */
  "resume.pageMargin.top": "上",
  /** 见 `resume.pageMargin.top`。 */
  "resume.pageMargin.right": "右",
  /** 见 `resume.pageMargin.top`。 */
  "resume.pageMargin.bottom": "下",
  /** 见 `resume.pageMargin.top`。 */
  "resume.pageMargin.left": "左",
  /** `-0.1mm` 按钮：`{side}` 是方向简称，拼出来是「减小上边距」。 */
  "resume.pageMargin.decrease": "减小{side}边距",
  /** `+0.1mm` 按钮。 */
  "resume.pageMargin.increase": "增大{side}边距",
  /** 单边滑杆的无障碍名。 */
  "resume.pageMargin.sliderLabel": "{side}边距（拖动调整）",
  /** 单边标签的无障碍名（回车 / 双击复位）。 */
  "resume.pageMargin.resetLabel": "{side}边距（双击或按回车恢复为统一值）",
  /** 单边复位的 Tooltip。复位的是"回到统一值"，不是回到模板默认——措辞要跟着改。 */
  "resume.pageMargin.resetTooltip": "双击或按回车把{side}边距恢复为统一值",
  /** 分边面板的无障碍名（面板本身没有标题行，读屏靠这条知道自己在哪一块）。 */
  "resume.pageMargin.sidesTitle": "四边页边距",
  /** 面板底部的一行说明：解释"没出现复位图标的边"是什么语义。 */
  "resume.pageMargin.sidesNote": "未单独调整的边跟随统一页边距",
  /** 只出现在已单独调整过的那条边上的复位按钮。 */
  "resume.pageMargin.resetAction": "把{side}边距恢复为统一值",

  /** 照片大小控件的标签。 */
  "resume.photo.scale.label": "照片",
  /** 双击 / 回车复位照片大小。 */
  "resume.photo.scale.resetTooltip": "双击或按回车恢复默认照片大小",
  /** 照片大小标签的无障碍名。 */
  "resume.photo.scale.resetLabel": "照片大小（双击或按回车恢复默认）",
  /** 照片大小滑杆的无障碍名。 */
  "resume.photo.scale.sliderLabel": "照片大小（拖动调整）",
  /** `-2%` 按钮的无障碍名。 */
  "resume.photo.scale.decrease": "缩小照片",
  /** `+2%` 按钮的无障碍名。 */
  "resume.photo.scale.increase": "放大照片",
  /** 照片大小的来源标签：没设过覆盖时显示。 */
  "resume.photo.scale.hintTemplate": "随模板",
  /**
   * 没有照片时滑杆旁边的原因说明。
   *
   * 只说"为什么拖不动"，不给"去上传"的入口：照片是**个人资料**的属性（一份照片用于所有
   * 简历），把它做成排版栏里的一个按钮，等于在"调这一份简历"时改"我的全局资料"。
   */
  "resume.photo.scale.noPhoto": "未上传照片",

  // ── 简历编辑弹窗的内联确认条（footer 换态，不开第二层弹窗） ──────────────
  /** 丢弃确认条的正文：说清丢的是什么（这份简历的改动）。 */
  "resume.editor.discard.body": "这份简历还有改动没有保存",
  /** 覆盖填入确认条的正文：说清后果（整份表单会被替换）。 */
  "resume.editor.fill-all.body": "将用「我的资料」覆盖当前已填写的内容",
  /** 覆盖填入的确认按钮：写具体动作，不用「确定」。 */
  "resume.editor.fill-all.confirm": "覆盖填入",

  /** 备选岗位表单的主按钮（描述结果，不用默认的「确定」）。 */
  "jobs.candidate.action.save": "保存备选岗位",

  // ── 备选岗位抽屉（B3：三个弹层改成抽屉内视图） ─────────────────────
  /** 抽屉列表视图的标题。 */
  "jobs.candidate.title": "备选岗位",
  /** 详情视图的标题（替代原详情弹窗的标题）。 */
  "jobs.candidate.detail.title": "备选岗位详情",
  /** 表单视图的标题（新建）。 */
  "jobs.candidate.form.title-create": "添加备选岗位",
  /** 表单视图的标题（编辑）。 */
  "jobs.candidate.form.title-edit": "编辑备选岗位",
  /** CSV 导入视图的标题。 */
  "jobs.candidate.import.title": "导入备选岗位 CSV",
  /** 非列表视图里那颗返回箭头按钮的文字与无障碍名。 */
  "jobs.candidate.back": "返回列表",
  /** 抽屉右上角：新建一条备选。 */
  "jobs.candidate.action.add": "添加备选",
  /** 抽屉右上角：进 CSV 导入视图。 */
  "jobs.candidate.action.import-csv": "导入 CSV",
  /** 详情视图的次按钮。 */
  "jobs.candidate.action.edit": "编辑",
  /** 详情视图的主按钮：把这条备选变成正式岗位。 */
  "jobs.candidate.action.import": "导入到岗位",
  /** 列表视图顶部的说明（不带采集批次筛选时）。 */
  "jobs.candidate.hint":
    "这里放还没核对的招聘信息（粘贴的文本或截图）。点卡片查看详情；选中后可以批量删除或导出。",
  /** 列表视图顶部的说明（从采集记录进入、只显示某一批时）。 */
  "jobs.candidate.hint-filtered":
    "这里只显示选中采集记录的岗位（{count} 条记录）。点卡片查看详情；选中后可以批量删除或导出。",
  /** 搜索框占位符。 */
  "jobs.candidate.search.placeholder": "搜岗位、公司、原文或备注",
  /** 搜索框的无障碍名。 */
  "jobs.candidate.search.label": "搜索备选岗位",
  /** 已提交搜索词时的命中数。 */
  "jobs.candidate.search.matched": "「{keyword}」匹配 {count} 条",
  /** 搜到 0 条时的空态。 */
  "jobs.candidate.empty-search": "没有匹配「{keyword}」的备选岗位",
  /** 搜到 0 条时的清空按钮。 */
  "jobs.candidate.empty-search-clear": "清空搜索",
  /** 一条都没有时的空态。 */
  "jobs.candidate.empty-list": "还没有备选岗位。看到感兴趣但来不及整理的招聘信息，先放到这里。",
  /** 分页右侧的总数。 */
  "jobs.candidate.total": "共 {count} 条",
  /** 抽屉底部的说明：已导入的候选不会被删掉。 */
  "jobs.candidate.footnote": "已导入的备选会保留在列表里，方便回看它变成了哪个岗位。",
  /** 列表请求失败（没有更具体的原因时）。 */
  "jobs.candidate.load-failed": "加载备选岗位失败",
  /** 详情请求失败（没有更具体的原因时）。 */
  "jobs.candidate.load-one-failed": "读取这条备选岗位失败",
  /** 更新成功。 */
  "jobs.candidate.updated": "备选岗位已更新",
  /** 新建成功。 */
  "jobs.candidate.created": "已放进备选岗位",
  /** 保存失败（没有更具体的原因时）。 */
  "jobs.candidate.save-failed": "保存失败",
  /** 单条删除成功。 */
  "jobs.candidate.deleted": "已删除这个备选岗位",
  /** 删除失败（没有更具体的原因时）。 */
  "jobs.candidate.delete-failed": "删除失败",
  /** 批量删除的就地确认标题（Popconfirm）：动作 + 对象。条数让标题超 12 字，所以移入正文（§4.4 例外）。 */
  "jobs.candidate.batch.delete-confirm": "删除选中的备选岗位？",
  /** 就地确认的正文：条数 + 后果。备选岗位是**软删除**（进回收站，可恢复），如实说去哪找回。 */
  "jobs.candidate.batch.delete-note": "这 {count} 条会移入「回收站」，之后可以恢复。",
  /** 确认按钮：写具体动作，不用「确定」。 */
  "jobs.candidate.batch.delete-action": "删除",
  /** 单张截图超过体积上限。 */
  "jobs.candidate.image-too-large": "单张截图不能超过 2 MB",
  /** 截图数量到上限。 */
  "jobs.candidate.image-limit": "最多添加 {count} 张截图",
  /** 读取图片失败。 */
  "jobs.candidate.image-read-failed": "读取截图失败，请重试",
  /** 表单全空时的拦截提示。 */
  "jobs.candidate.need-content": "请粘贴招聘信息、上传截图，或至少填写岗位名称",
  /** CSV 导入成功后的 Toast。 */
  "jobs.candidate.imported-from-csv": "已从 CSV 导入 {count} 条备选岗位",
  /** 拖入的文件类型不支持。 */
  "jobs.candidate.image-type-rejected": "招聘截图只支持 JPG、PNG 或 WebP",

  // ── 备选岗位表单视图 ─────────────────────────────────────────
  /** 「招聘信息来源」这一行的标签（只读，由系统判定）。 */
  "jobs.candidate.form.source-label": "招聘信息来源",
  /** 来源的说明：告诉用户它是自动标注的。 */
  "jobs.candidate.form.source-hint": "由系统按你添加的内容自动标注（{source}）",
  /** 来源取值：有截图。 */
  "jobs.candidate.form.source-image": "招聘截图",
  /** 来源取值：只有文本。 */
  "jobs.candidate.form.source-text": "粘贴文本",
  /** 岗位名称的标签。 */
  "jobs.candidate.form.title-label": "岗位名称（可留空，导入时再补）",
  /** 岗位名称的占位符。 */
  "jobs.candidate.form.title-placeholder": "如：市场营销专员",
  /** 公司名称的标签。 */
  "jobs.candidate.form.company-label": "公司名称",
  /** 公司名称的占位符。 */
  "jobs.candidate.form.company-placeholder": "如：字节跳动",
  /** 岗位链接的标签。 */
  "jobs.candidate.form.url-label": "岗位链接（选填）",
  /** 链接格式不对时的说明。 */
  "jobs.candidate.form.url-warning":
    "链接需要以 http:// 或 https:// 开头，否则保存时会无法通过校验",
  /** 岗位链接的占位符。 */
  "jobs.candidate.form.url-placeholder": "粘贴该岗位在招聘网站上的地址（导入岗位时预填投递链接）",
  /** 招聘原文的标签。 */
  "jobs.candidate.form.raw-label": "招聘原文",
  /** 招聘原文的占位符。 */
  "jobs.candidate.form.raw-placeholder": "把招聘信息原样粘贴进来，导入时会用它预填 JD",
  /** 截图表单域标签（含张数与体积上限）。 */
  "jobs.candidate.form.images-label": "招聘截图（最多 {count} 张，单张不超过 2 MB）",
  /** 拖放区的提示。 */
  "jobs.candidate.form.drop-hint": "松开即可添加招聘截图",
  /** 添加截图按钮。 */
  "jobs.candidate.form.add-image": "添加截图",
  /** 拖放区旁的补充说明。 */
  "jobs.candidate.form.drag-tip": "也可以直接拖进来",
  /** 截图缩略图的替代文本。 */
  "jobs.candidate.form.image-alt": "招聘截图 {index}",
  /** 移除截图按钮的无障碍名。 */
  "jobs.candidate.form.remove-image": "移除截图 {index}",
  /** 备注的标签。 */
  "jobs.candidate.form.note-label": "备注",
  /** 备注的占位符。 */
  "jobs.candidate.form.note-placeholder": "为什么先留着它、准备什么时候投（选填）",

  // ── 备选岗位详情视图 ─────────────────────────────────────────
  /** 详情里「公司」一行。 */
  "jobs.candidate.detail.company": "公司",
  /** 公司为空时的取值。 */
  "jobs.candidate.detail.company-unknown": "未识别公司",
  /** 详情里「来源」一行。 */
  "jobs.candidate.detail.source": "来源",
  /** 来源为空时的取值。 */
  "jobs.candidate.detail.source-manual": "手动添加",
  /** 已导入状态的标签；`{id}` 是正式岗位 id。 */
  "jobs.candidate.detail.status-imported": "已导入 #{id}",
  /** 待处理状态的标签。 */
  "jobs.candidate.detail.status-pending": "待处理",
  /** 原岗位链接这一行。 */
  "jobs.candidate.detail.source-url": "原岗位链接",
  /** 打开原站页面的链接文字。 */
  "jobs.candidate.detail.open-source": "开原站岗位页面",
  /** 岗位描述小节标题。 */
  "jobs.candidate.detail.jd": "岗位描述",
  /** 任职要求小节标题。 */
  "jobs.candidate.detail.requirements": "任职要求",
  /** 其他招聘信息小节标题。 */
  "jobs.candidate.detail.additional": "其他招聘信息",
  /** 招聘原文小节标题。 */
  "jobs.candidate.detail.raw": "招聘原文",
  /** 招聘截图小节标题。 */
  "jobs.candidate.detail.images": "招聘截图",
  /** 打开截图副本按钮。 */
  "jobs.candidate.detail.open-copy": "打开",
  /** 备注一行。 */
  "jobs.candidate.detail.note": "备注：{note}",
  /** 截图副本查不到。 */
  "jobs.candidate.detail.copy-missing": "未找到对应的文件副本",
  /** 调起系统程序成功。 */
  "jobs.candidate.detail.copy-opened": "已调用系统程序打开",
  /** 打开失败（没有更具体的原因时）。 */
  "jobs.candidate.detail.copy-failed": "打开失败",

  // ── 备选岗位 CSV 导入视图 ────────────────────────────────────
  /** 导入视图的顶部说明：与岗位广场那条通道互不相干。 */
  "jobs.candidate.import.intro":
    "这里导入的是备选岗位：先暂存在这个抽屉里，之后点卡片上的「导入到岗位」才会进入岗位广场。与岗位广场的 CSV 导入是两条独立通道，别混用两份文件。",
  /** 粘贴区域的无障碍名。 */
  "jobs.candidate.import.region": "CSV 导入区",
  /** 拖放区主文案。 */
  "jobs.candidate.import.drop": "点击或拖拽 CSV 文件到这里（可多选）",
  /** 拖放区说明：表头口径与上限。 */
  "jobs.candidate.import.hint":
    "第一行是表头（岗位名称 / 公司名称 / 岗位链接 / 招聘原文 / 备注），也可以先下载空模板照着填；一次最多 10 个文件、合计 2000 行",
  /** 粘贴入口的说明。 */
  "jobs.candidate.import.paste-hint": "也可以直接在这块区域按 Ctrl+V 粘贴从表格复制的 CSV 内容",
  /** 解析中。 */
  "jobs.candidate.import.parsing": "正在解析…",
  /** 已选文件的合计账目。 */
  "jobs.candidate.import.summary": "已选 {files} 个文件：合计可导入 {rows} 条",
  /** 坏行数。 */
  "jobs.candidate.import.errors-count": "{count} 行有问题",
  /** 去重丢弃的行数。 */
  "jobs.candidate.import.duplicates-count": "已去除重复 {count} 行",
  /** 单个文件正在解析。 */
  "jobs.candidate.import.file-parsing": "解析中…",
  /** 单个文件可导入的行数。 */
  "jobs.candidate.import.file-ok": "可导入 {count} 条",
  /** 单个文件解析失败。 */
  "jobs.candidate.import.file-error": "解析失败",
  /** 单个文件内重复的行数。 */
  "jobs.candidate.import.file-duplicates": "重复 {count} 行",
  /** 移除某个已选文件。 */
  "jobs.candidate.import.remove-file": "移除",
  /** 坏行清单的标题。 */
  "jobs.candidate.import.errors-title": "以下行不会导入（改好 CSV 后可以重新选择文件）",
  /** 坏行的一条：行号 + 原因。 */
  "jobs.candidate.import.errors-line": "第 {line} 行：{message}",
  /** 预览区标题。 */
  "jobs.candidate.import.preview": "前几条预览",
  /** 预览的一条：行号 + 岗位名。 */
  "jobs.candidate.import.preview-line": "第 {line} 行：{title}",
  /** 预览里没有岗位名时的取值。 */
  "jobs.candidate.import.no-title": "（无岗位名）",
  /** 预览里的公司与来源文件。 */
  "jobs.candidate.import.preview-meta": "{company} · {file}",
  /** 下载空模板按钮。 */
  "jobs.candidate.import.download-template": "下载空模板",
  /** 空模板的文件名。 */
  "jobs.candidate.import.template-file": "备选岗位导入模板.csv",
  /** 从剪贴板粘贴的纯文本包装成的文件名。 */
  "jobs.candidate.import.pasted-file": "粘贴内容.csv",
  /** 后端在「该行已存在」这类跳过行上给的措辞：只用于把跳过数从失败数里分出来。 */
  "jobs.candidate.import.skip-token": "已跳过",
  /** 确认导入按钮（带条数）。 */
  "jobs.candidate.import.confirm": "确认导入 {count} 条",
  /** 分块提交中断的标题。 */
  "jobs.candidate.import.failed-title": "导入中断",
  /** 分块提交中断的正文。 */
  "jobs.candidate.import.failed-chunk": "第 {chunk} 批导入失败（已导入 {imported} 条）：{message}",
  /** 中断时的通用原因。 */
  "jobs.candidate.import.failed-retry": "请检查网络后重试",
  /** 导入结束的标题。 */
  "jobs.candidate.import.done-title": "CSV 导入完成",
  /** 导入结束的账目（三项都给，不做拼接）。 */
  "jobs.candidate.import.done-detail":
    "导入 {imported} 条，重复跳过 {skipped} 条，失败 {failed} 条",
  /** 一行都不可导入。 */
  "jobs.candidate.import.no-rows": "没有可导入的行",
  /** 提交失败（没有更具体的原因时）。 */
  "jobs.candidate.import.failed": "导入失败，请重试",
  /** 空模板的表头：岗位名称。 */
  "jobs.candidate.import.col-title": "岗位名称",
  /** 空模板的表头：公司名称。 */
  "jobs.candidate.import.col-company": "公司名称",
  /** 空模板的表头：岗位链接。 */
  "jobs.candidate.import.col-url": "岗位链接",
  /** 空模板的表头：招聘原文。 */
  "jobs.candidate.import.col-raw": "招聘原文",
  /** 空模板的表头：备注。 */
  "jobs.candidate.import.col-note": "备注",

  // ── 导出面板（B3：409 草稿闸门改成页内 Alert） ────────────────
  /** 409 闸门的 Alert 标题。 */
  "export.incomplete.title": "简历里还有未完成标记",
  /** 闸门出现后主按钮换成这句：再点一次就是明确要继续。 */
  "export.incomplete.action": "仍要导出草稿",
  /** Alert 上的出口按钮：回去补完再导。 */
  "export.incomplete.dismiss": "我去改简历",
  /** 导出面板的主按钮。 */
  "export.action.export": "导出",

  // ── 通用动作（每个 ≤4 字，见 popupCopy.test.ts 的长度断言） ────────────
  /** 表单弹层左下角那颗按钮。 */
  "common.action.cancel": "取消",
  /** 只读弹层的语义动作（具体形态仍走右上角 ×）。 */
  "common.action.close": "关闭",
  /** 抽屉内视图切换的返回动作。 */
  "common.action.back": "返回",
  /** 内联确认条上的危险动作：放弃这次修改。 */
  "common.action.discard": "放弃修改",
  /** 内联确认条上的安全动作（默认焦点落在它上面）。 */
  "common.action.keep-editing": "继续编辑",

  // ── 未保存内容（footer 内联确认条） ──────────────────────────────
  /** 内联确认条的标题；同时替换弹窗标题。 */
  "common.discard.title": "放弃未保存的修改？",
  /** 内联确认条的正文：讲清后果，不讲"请确认"。 */
  "common.discard.body": "关掉弹窗后这些改动就没有了",

  // ── 草稿 ───────────────────────────────────────────────────
  /** 草稿恢复条的标题。 */
  "draft.restore.title": "找到了上次没提交的内容",
  /** 恢复条正文：`{time}` 是时刻，`{count}` 是字段数。 */
  "draft.restore.body": "保存于 {time}，共 {count} 项",
  /** 恢复条正文的简版：只讲时刻（调用方拿不到字段数时用）。 */
  "draft.restore.body-plain": "保存于 {time}",
  /** 恢复条主按钮。 */
  "draft.restore.action": "恢复这份草稿",
  /** 恢复条次按钮：丢掉这份草稿。 */
  "draft.discard.action": "丢掉草稿",
  /** 草稿里被剔除的附件类字段数量说明。 */
  "draft.dropped-fields": "{count} 项附件需要重新添加",
  /** 草稿超过体积上限时的提示（一次会话只说一次）。 */
  "draft.too-large": "内容太大，这次没自动存草稿",
  /** 有草稿时关闭弹窗的告知（关闭无损，所以不是警告）。 */
  "draft.kept": "已存为草稿，下次打开可恢复",

  // ── Toast / 撤销（每条 ≤20 字） ──────────────────────────────
  /** 单条删除成功。 */
  "toast.deleted.single": "已删除",
  /** 批量删除成功；`{count}` 是条数。 */
  "toast.deleted.batch": "已删除 {count} 条",
  /** 单条恢复成功。 */
  "toast.restored.single": "已恢复",
  /** 批量恢复成功。 */
  "toast.restored.batch": "已恢复 {count} 条",
  /** 撤销失败：必须给出路（去回收站）。 */
  "toast.restore.failed": "恢复失败，请到回收站重试",
  /** 撤销按钮上的字。 */
  "toast.undo.label": "撤销",

  // ── 公告条 ─────────────────────────────────────────────────
  /** 公告条这个区域的无障碍名。 */
  "announcement.region": "全站公告",
  /** × 的无障碍名：只关掉这一条。 */
  "announcement.dismiss": "关闭这条公告",
  /** 更新类公告：有可用新版本。 */
  "announcement.update.ready": "有新版本可用",
  /** 更新类公告：安装包已下载完成。 */
  "announcement.update.downloaded": "更新包已下载好，可以安装了",
  /** 更新类公告的动作按钮。 */
  "announcement.update.action": "去更新",
  /** 「不再提醒」按钮上的字。 */
  "announcement.mute.action": "不再提醒",
  /** 「不再提醒」的无障碍名：点明可撤销，这是唯一的说明书。 */
  "announcement.mute": "不再提醒这类公告，可在设置里恢复",
  /** 设置页那张卡片的标题。 */
  "announcement.settings.title": "公告提醒",
  /** 没有静音项时的空态。 */
  "announcement.settings.empty": "暂时没有静音的公告提醒",
  /** 设置页恢复按钮。 */
  "announcement.settings.restore": "恢复提醒",
  /** 恢复后的告知：用户在设置页当场看不到公告条（hideOnPaths），所以要说"回到页面"。 */
  "toast.announcement.unmuted": "已恢复提醒，回到页面就能看到",

  // ── 简历制作台（2026-10-23）────────────────────────────────
  // 本轮新增的四十来条文案单独放在 `zh-CN.workbench.ts`：这个文件只剩几十行余量，
  // 而单文件 500 行是零豁免的硬预算。spread 保持字面量类型，`MessageKey` 自动包含新 key。
  ...workbench,

  // ── 简历预览的缩放条（2026-10-23）────────────────────────
  ...preview,

  // ── 多分辨率适配（2026-10-23）────────────────────────────
  ...responsive,

  // ── 简历字体（内置思源黑体按需下载）与工作台「版式」页签（2026-11）
  // 同上：`zh-CN.ts` 只剩几十行余量，新增文案放独立命名空间文件。
  ...fonts,

  // ── 字符级加粗（右键菜单）与制作台实时预览（R4 / R5）────────
  ...rich,
} as const;

export type ZhCNMessages = typeof zhCN;

export default zhCN;
