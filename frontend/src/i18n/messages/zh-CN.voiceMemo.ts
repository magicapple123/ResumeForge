// SPDX-License-Identifier: Apache-2.0
/**
 * 语音这两项新能力（T08 期）的界面文案：口述填简历的「语音记一条」，以及 TTS 的服务商档位。
 *
 * 命名空间名由主理人预先登记（`zh-CN.namespaces.ts` / `en-US.ts` 里已各有一行
 * import + spread），本文件只填内容，不再新增登记行——两个文件各有其它线在并发追加。
 *
 * 文案口径沿用 `docs/ui-copy-guide.md`：按钮写具体动作（记一条，不是"提交"），
 * 提示写清"发生了什么 + 下一步"，不用感叹号与句号。
 */
const voiceMemo = {
  // ── 口述一条（简历编辑器里的全局入口）────────────────────────────
  //
  // I-18：原名「语音记一条」读不出产出物（"记"到哪里？记成什么？），改成「口述一条」，
  // 并把"会变成一条简历内容"放到**可见的**悬停提示第一行（原来只在 aria-label 里）。
  "voiceMemo.button": "口述一条",
  "voiceMemo.buttonAria": "口述一条，录一段话自动拆成简历条目",
  "voiceMemo.status.recording": "正在录音，点一下结束",
  "voiceMemo.status.transcribing": "正在识别",
  /** I-18：tooltip 第一行——先说用途，再说限制。 */
  "voiceMemo.hint.purpose": "口述一段经历，自动整理成一条简历内容",
  "voiceMemo.hint.limit": "单段最长 {seconds} 秒",
  /** 选到不支持流式的协议时的那句解释（不许静默把上限砍掉）。 */
  "voiceMemo.hint.streamLimited": "这个转写服务不支持流式，单段上限 {seconds} 秒",
  /** 非 DeepSeek 档：上限低只是服务端限制，与"是否流式"无关。 */
  "voiceMemo.hint.serverCap": "这个转写服务单段上限 {seconds} 秒，超出会被拒绝",
  "voiceMemo.hint.privacy": "录音只发到 {host} 转成文字，不留在本地",
  "voiceMemo.error.parse": "这段话没能拆出条目，换个说法再试",
  "voiceMemo.modal.title": "口述一条",
  "voiceMemo.modal.hint": "确认后插入为可编辑条目",
  "voiceMemo.modal.apply": "插入到简历",
  "voiceMemo.modal.empty": "没有可插入的字段",
  "voiceMemo.toast.inserted": "已插入 {count} 条条目",
  "voiceMemo.toast.covered": "有 {count} 条已存在，未重复插入",
  "voiceMemo.toast.basicOnly": "只识别到基本信息，请到资料页填入",
  "voiceMemo.toast.nothing": "没有可插入的字段",
  /**
   * 用户指南的一条（I-18 方案第 6 条）：同一批人写，避免指南与界面各说一套。
   * 键放在本命名空间而不是 `userGuideFlow.*`：这两句只属于这个功能，跟着功能一起改。
   */
  "voiceMemo.guide.lead": "口述一条",
  "voiceMemo.guide.text": "在简历制作台点「口述一条」，说一段经历，核对后插入为可编辑的条目。",

  // ── 转写服务商预设：DeepSeek 第三档（T08）────────────────────────
  //
  // 这两个 key 挂在既有 `voiceInput.` 前缀下（预设表 asrPresets.ts 引用它们），但**写在本文件**：
  // `zh-CN.voiceInput.ts` 归实时语音那条线所有，只追加不接管。
  "voiceInput.settings.provider.deepseek": "DeepSeek",
  "voiceInput.settings.provider.note.deepseek": "没有模型可选，只收 WAV，单段 120 秒",

  // ── 合成服务档位（面试官语音）────────────────────────────────────
  "ttsProvider.label": "合成服务",
  "ttsProvider.hint": "两档音色各自独立，切换不改动另一档的设置",
  "ttsProvider.dashscope": "百炼",
  "ttsProvider.deepseek": "DeepSeek",
  "ttsProvider.missingKey": "这一档还没配 Key",
  /** 旧音色落在新档时的显式回落提示（静默变声等于"设置坏了"）。 */
  "ttsProvider.fallback": "音色 {previous} 属于另一档，已改用 {voice}",
} as const;

export type VoiceMemoMessages = typeof voiceMemo;
export default voiceMemo;
