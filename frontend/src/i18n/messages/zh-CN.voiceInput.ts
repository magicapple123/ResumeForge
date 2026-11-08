// SPDX-License-Identifier: Apache-2.0
/**
 * 语音听写：麦克风按钮、录音隐私提示、错误文案、设置页「语音转写」卡片，以及面试
 * 作答框 / 复盘追问两处的"录音中"提示。
 *
 * 后端判定的错误原因（鉴权失败、地址不存在、服务商返回异常）不走语言包：它们要原样
 * 透传服务端那句中文，否则用户看不到"到底哪一步配错了"。这里只放前端自己判定的那几种。
 *
 * 隐私提示里的 {host} 只显示主机名（不含路径、不含 Key），由 /api/transcribe/status 给出。
 */
const voiceInput = {
  "voiceInput.aria.start": "开始语音输入",
  "voiceInput.aria.stop": "结束录音",
  "voiceInput.status.transcribing": "识别中",
  "voiceInput.tooltip.start": "点击开始语音输入（单段最长 {seconds} 秒）",

  "voiceInput.hint.privacy": "音频会发送到 {host}",
  "voiceInput.hint.notConfigured": "未配置语音服务",
  "voiceInput.hint.notConfiguredHelp": "请到 设置 → 语音转写 填写地址与 Key",

  "voiceInput.error.noMicrophone": "没有找到可用的麦克风，请连接麦克风后重试",
  "voiceInput.error.permissionDenied": "麦克风权限被拒绝，请在浏览器地址栏里允许麦克风后重试",
  "voiceInput.error.recordingFailed": "录音失败，请重新录音",
  "voiceInput.error.unsupported": "当前浏览器不支持录音，请换用新版 Chrome、Edge 或 Safari",
  "voiceInput.error.timeout": "识别超时，请确认语音服务可用后重试",
  "voiceInput.error.notConfigured": "未配置语音服务，请到 设置 → 语音转写 填写地址与 Key",
  "voiceInput.error.tooLarge": "音频超过 10 MB，请缩短录音后重试",
  "voiceInput.error.empty": "没有识别到语音内容，请靠近麦克风重说一遍",
  "voiceInput.error.serviceFailed": "语音服务暂时不可用，请稍后重试",
  /** 后端还是旧进程（/api/transcribe 返回 404/405）：不要让用户看到英文的 Not Found。 */
  "voiceInput.error.backendTooOld": "当前后端版本不支持语音，重启后再试",

  "voiceInput.action.submitBlocked": "请先结束录音",

  "voiceInput.settings.title": "语音转写",
  "voiceInput.settings.intro":
    "语音只用于听写：说完点结束，识别出的文字先填进输入框，由你确认后再提交。音频会发给下面配置的服务商；本应用不保存音频。",
  "voiceInput.settings.providerNote":
    "DeepSeek 没有语音转写能力，这里要单独配置一家 OpenAI 兼容服务（OpenAI、Groq、硅基流动等）。",
  "voiceInput.settings.baseUrl.label": "服务地址",
  "voiceInput.settings.baseUrl.aria": "语音服务地址",
  "voiceInput.settings.baseUrl.placeholder": "https://api.openai.com/v1",
  "voiceInput.settings.baseUrl.hint":
    "填 OpenAI 兼容服务的 Base URL，要包含服务商要求的路径前缀（多数是 /v1）。",
  "voiceInput.settings.model.label": "模型",
  "voiceInput.settings.model.aria": "语音转写模型",
  "voiceInput.settings.model.placeholder": "填入模型名，如 whisper-1",
  "voiceInput.settings.model.hint":
    "填服务商支持的转写模型名，例如 whisper-1、whisper-large-v3、FunAudioLLM/SenseVoiceSmall。",
  "voiceInput.settings.key.label": "语音服务密钥",
  "voiceInput.settings.key.aria": "语音服务 API Key",
  "voiceInput.settings.key.placeholder": "粘贴语音服务商的 API Key",
  "voiceInput.settings.key.hint":
    "已保存的 Key 回显为 ********；留空表示不修改，点「清除已保存的 Key」才会真正删除。",
  "voiceInput.settings.key.clear": "清除已保存的 Key",
  "voiceInput.settings.key.cleared": "已清除语音服务的 Key",
  "voiceInput.settings.save": "保存",
  "voiceInput.settings.saved": "已保存语音转写配置",
  "voiceInput.settings.saveFailed": "保存语音转写配置失败",
  "voiceInput.settings.test": "测试连接",
  "voiceInput.settings.testing": "测试中…",
  "voiceInput.settings.testFailed": "测试连接失败",
  "voiceInput.settings.loadErrorTitle": "没能读取已保存的语音转写配置",
  "voiceInput.settings.loadErrorBody":
    "{message}。下面显示的是空配置，保存会覆盖服务端当前的设置。",
  "voiceInput.settings.loadFailed": "读取语音转写配置失败",
  "voiceInput.settings.badge.configured": "已配置",
  "voiceInput.settings.badge.notConfigured": "未配置",
  "voiceInput.settings.limitHint": "单段上限 3 分钟 / 10 MB；面试作答 3 分钟、复盘追问 1 分钟。",
  "voiceInput.settings.privacyNote": "保存后，录音会发送到 {host}；本应用不保存音频。",
} as const;

export default voiceInput;
