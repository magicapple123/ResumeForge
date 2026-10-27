// SPDX-License-Identifier: Apache-2.0
/**
 * 「粘贴整段资料并识别」弹窗（简历资料与网申资料两种宿主）的标题、占位示例、说明段落、
 * 上传与解析状态、校对提示、动作按钮，以及多条警告之间的分隔符。
 */
const profileTextModal = {
  /** 简历资料宿主：弹窗标题。 */
  "profileTextModal.profile.title": "粘贴个人资料并识别",
  /** 简历资料宿主：输入框占位示例（保留用户粘贴时的分行形态）。 */
  "profileTextModal.profile.placeholder":
    "例如：\n姓名：张三\n教育经历\n示例大学｜市场营销｜本科｜2022.09-2026.06\n项目经历\n校园招聘会策划｜负责人｜活动策划、渠道对接",
  /** 简历资料宿主：输入框上方的说明段落。 */
  "profileTextModal.profile.intro":
    "可粘贴包含基本信息、教育经历、实习/工作经历、校园经历、项目经历、技能和获奖情况的整段文字，也可以贴上这些内容的截图（在下面的输入框里按 Ctrl+V），或者上传简历文档（pdf/docx）。文档文字在本机提取，不上传原文件；若已配置大模型，内容会发送到该模型进行结构化识别。识别结果会先列成清单供你核对，确认后才填入表单。识别图片需要支持图片输入的多模态模型。",
  /** 网申资料宿主：弹窗标题。 */
  "profileTextModal.webform.title": "粘贴网申资料并识别",
  /** 网申资料宿主：输入框占位示例（一屏网申栏目）。 */
  "profileTextModal.webform.placeholder":
    "例如：\n政治面貌：中共党员\n是否有高中毕业证：是\n紧急联系人：张三 13800000000",
  /** 网申资料宿主：输入框上方的说明段落。 */
  "profileTextModal.webform.intro":
    "把网申页面上的一屏栏目整段粘进来（也可以给截图或 PDF/Word），程序会按网申资料的字段目录逐条归位。**目录外的新栏目会先列成待确认项**，由你逐条勾选后才新增——识别可以猜，但你的资料不该被猜出来。",
  /** 校对阶段：放弃这次识别结果，不写表单。 */
  "profileTextModal.action.cancel": "取消",
  /** 输入阶段：直接关窗（识别中禁用）。 */
  "profileTextModal.action.close": "关闭",
  /** 识别中替代主按钮：中止请求。 */
  "profileTextModal.action.cancelRecognize": "取消识别",
  /** 输入阶段主按钮：开始识别并填入。 */
  "profileTextModal.action.recognize": "识别并填入",
  /** 校对阶段主按钮：{count} 是将写入表单的条目数。 */
  "profileTextModal.action.apply": "确认填入 {count} 项",
  /** 校对阶段顶部提示：{count} 是识别出的条目数。 */
  "profileTextModal.review.count": "识别到 {count} 项，核对无误后再填入（可原地修改）",
  /** 校对阶段顶部提示的补充说明。 */
  "profileTextModal.review.hint":
    "识别是自动推断，可能与原文有出入：逐条看过再确认，比事后再改回来省事。",
  /** 文本输入框的无障碍名。 */
  "profileTextModal.input.textAria": "个人资料文本",
  /** 附件上传进度条的无障碍名。 */
  "profileTextModal.upload.progressAria": "附件上传进度",
  /** 字节已发完、服务端解析中的不确定态提示。 */
  "profileTextModal.upload.parsing": "正在解析资料…",
  /** 多条警告合成一句时的分隔符（中文全角分号，英文用 "; "）。 */
  "profileTextModal.separator.warning": "；",
} as const;

export default profileTextModal;
