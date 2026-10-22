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

const zhCN = {
  /** 版式下拉的无障碍名（视觉标签是同一句，见 `ResumeTemplateControls`）。 */
  "resume.format.label": "版式",
  /** 版式栏里那个下拉框的标题（也是它的无障碍名）。 */
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
} as const;

export type ZhCNMessages = typeof zhCN;

export default zhCN;
