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
  /** #8：申请麦克风是异步的，这一态负责把"点一下没反应"变成"明确在打开"。 */
  "voiceInput.status.starting": "正在打开麦克风…",
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
  /** #8 的三道闸门：任一命中都不上传，直接给出可行动的原因。 */
  "voiceInput.error.tooShort": "录音太短，请说完再点「结束录音」",
  "voiceInput.error.noSound": "没有检测到声音（峰值 {peak}），请检查麦克风设备",
  "voiceInput.error.noHeard": "没有听清，请再说一遍",

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

  /**
   * 麦克风设备选择（#8.2）：Chrome/Edge 会按站点记住首次授权时选的设备，而前端一直
   * 只传 `audio:true`，用户无从改选——错选成虚拟声卡/显示器麦克风时会一直"没声音"。
   */
  "voiceInput.settings.device.label": "麦克风",
  "voiceInput.settings.device.aria": "选择麦克风设备",
  "voiceInput.settings.device.default": "系统默认",
  "voiceInput.settings.device.unnamed": "麦克风 {index}",
  "voiceInput.settings.device.empty": "没有读到设备列表，授权后再点刷新",
  "voiceInput.settings.device.refresh": "刷新麦克风列表",
  "voiceInput.settings.device.hint": "首次授权后才会显示设备名称",
  "voiceInput.settings.device.lost": "原来的麦克风不在了，已切回系统默认",

  /** 「测试麦克风」（#8.3）：只做电平，不上传、不依赖语音服务额度。 */
  "voiceInput.settings.micTest.open": "测试麦克风",
  "voiceInput.micTest.title": "测试麦克风",
  "voiceInput.micTest.intro": "录 3 秒看电平，不上传、不消耗语音额度",
  "voiceInput.micTest.start": "开始测试",
  "voiceInput.micTest.stop": "结束测试",
  "voiceInput.micTest.remaining": "录音中，还剩 {seconds} 秒",
  "voiceInput.micTest.device": "设备：{name}",
  "voiceInput.micTest.deviceDefault": "系统默认麦克风",
  "voiceInput.micTest.peak": "峰值 {peak}",
  "voiceInput.micTest.idle": "点开始测试，说一句话看看电平",
  "voiceInput.micTest.result.silent": "几乎没有声音，检查麦克风设备与系统输入",
  "voiceInput.micTest.result.ok": "电平正常",
  "voiceInput.micTest.noSupport": "当前浏览器不支持录音",

  /** 服务商卡片层（条目 03）：预设只填默认值，保存与测试仍走真请求。 */
  "voiceInput.settings.cardHint": "音频只发给所选服务商，本应用不保存录音",

  "voiceInput.settings.provider.label": "服务商",
  "voiceInput.settings.provider.aria": "选择语音服务商",
  "voiceInput.settings.provider.hint": "选一家会填好地址、协议与默认模型，仍可手动改",
  "voiceInput.settings.provider.openai": "OpenAI 官方",
  "voiceInput.settings.provider.groq": "Groq 官方",
  "voiceInput.settings.provider.siliconflow": "SiliconFlow 官方",
  "voiceInput.settings.provider.dashscope": "阿里云百炼",
  "voiceInput.settings.provider.custom": "自定义",
  "voiceInput.settings.provider.note.openai": "官方推荐 gpt-transcribe",
  "voiceInput.settings.provider.note.groq": "OpenAI 兼容，免费档 25 MB",
  "voiceInput.settings.provider.note.siliconflow": "中文效果好，单文件 50 MB",
  "voiceInput.settings.provider.note.dashscope": "Qwen-ASR 走 chat 接口，不是 whisper",
  "voiceInput.settings.provider.note.custom": "地址、协议与模型全部手填",

  /** 调用协议：两套请求体互不兼容，必须显式选（见后端 asr_client）。 */
  "voiceInput.settings.protocol.label": "调用协议",
  "voiceInput.settings.protocol.aria": "语音服务的调用协议",
  "voiceInput.settings.protocol.openai": "OpenAI 兼容",
  "voiceInput.settings.protocol.dashscope": "阿里云百炼",
  "voiceInput.settings.protocol.hint": "百炼的兼容地址不支持 whisper 式上传，选错会一直返回 400",

  /** 模型字段：可输入 + 可拉取候选。 */
  "voiceInput.settings.model.fetch": "拉取模型列表",
  "voiceInput.settings.model.fetched": "已拉取 {count} 个模型",
  "voiceInput.settings.model.fetchEmpty": "没拉到模型，手动填写即可",
  "voiceInput.settings.model.fetchFailed": "拉取模型列表失败，可手动填写",
  "voiceInput.settings.model.showAll": "显示全部模型",
  "voiceInput.settings.model.retiredOption": "{model}（{date} 下线）",
  "voiceInput.settings.model.retiredHint": "这个模型 {date} 下线，新项目请选 gpt-transcribe",

  "voiceInput.settings.badge.active": "生效中",
  "voiceInput.settings.testOk": "连接成功，耗时 {ms} 毫秒",
  "voiceInput.settings.key.clearTitle": "清除已保存的 Key",
  "voiceInput.settings.key.clearConfirm": "清除后需要重新填写才能语音输入",
  /** 命名配置列表：语音配置改为「全局一份 + 多条命名配置」，首屏是列表而不是常驻表单。 */
  "voiceInput.settings.profiles.create": "新建配置",
  "voiceInput.settings.profiles.emptyHint":
    "点右上角「新建配置」添加一条，保存后点「使用」即可生效",
  "voiceInput.settings.profile.use": "使用",
  "voiceInput.settings.profile.using": "使用中",
  "voiceInput.settings.profile.activated": "已切换语音配置",
  "voiceInput.settings.profile.deleted": "已删除这条语音配置",
  "voiceInput.settings.profile.more": "{name} 的更多操作",
  "voiceInput.settings.profile.editAria": "编辑配置「{name}」",
  "voiceInput.settings.profile.edit": "编辑",
  "voiceInput.settings.profile.duplicate": "复制",
  "voiceInput.settings.profile.delete": "删除",
  "voiceInput.settings.profile.deleteTitle": "删除这条配置",
  "voiceInput.settings.profile.deleteConfirm": "删除后会切到剩下第一条；没有剩余则语音输入不可用",
  "voiceInput.settings.profile.duplicateSuffix": " 副本",
  "voiceInput.settings.profile.unset": "未填写",
  "voiceInput.settings.profile.incomplete": "缺 {fields}，补齐后才能使用",
  "voiceInput.settings.profile.missingSeparator": "、",
  "voiceInput.settings.profile.missing.baseUrl": "服务地址",
  "voiceInput.settings.profile.missing.model": "模型",
  "voiceInput.settings.profile.missing.key": "密钥",
  "voiceInput.settings.modal.createTitle": "新建配置",
  "voiceInput.settings.modal.editTitle": "编辑配置",
  "voiceInput.settings.modal.save": "保存配置",
  "voiceInput.settings.modal.activeHint": "这是生效中的配置，保存后立即用于语音输入",
  "voiceInput.settings.modal.duplicateHint": "复制只带地址、协议与模型，Key 需要重新填写",
  "voiceInput.settings.modal.name.label": "配置名称",
  "voiceInput.settings.modal.name.hint": "最多 64 个字符，不能与已有配置重名",
  "voiceInput.settings.modal.name.placeholder": "例如：公司 OpenAI",
  "voiceInput.settings.validation.nameRequired": "请填写配置名称",
  "voiceInput.settings.validation.nameTooLong": "配置名称最多 64 个字符",
  "voiceInput.settings.validation.nameConflict": "已有同名配置，请换一个名称",
  "voiceInput.settings.validation.profileLimit": "最多保存 10 份语音配置",
  "voiceInput.settings.key.keepHint": "已保存的 Key 不回显；留空表示保留，改地址或协议会清除",
  "voiceInput.settings.key.createHint": "新建配置需要填写 Key 才能用于语音输入",
  "voiceInput.settings.key.willClear": "地址或协议变了，保存后会清除旧 Key，需要重新填写",
} as const;

export default voiceInput;
