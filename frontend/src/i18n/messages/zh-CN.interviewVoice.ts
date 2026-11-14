// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试「实时语音」文案（#26 P0）。
 *
 * 常开麦克风的隐私提示必须常驻：不给指示的一直录音会让人不安（26A 的验收要求），
 * 所以状态行里带一句"音频只在内存处理、不在本地留存"。
 */
const interviewVoice = {
  /** 语音总开关（一键关闭 = 同一个按钮再点一次）。 */
  "interviewVoice.action.start": "开启实时语音",
  "interviewVoice.action.stop": "关闭实时语音",
  /** 26G 双模式。 */
  "interviewVoice.mode.label": "语音模式",
  "interviewVoice.mode.alwaysOn": "常开",
  "interviewVoice.mode.pushToTalk": "按住说话模式",
  "interviewVoice.action.hold": "按住说话",
  "interviewVoice.action.holdHint": "松开立即发送",
  /** 状态行：常开指示 + 思考模式（26A / 26B）。 */
  "interviewVoice.status.off": "实时语音未开启",
  "interviewVoice.status.starting": "正在打开麦克风",
  "interviewVoice.status.listening": "正在听",
  "interviewVoice.status.waitingAsr": "正在识别",
  "interviewVoice.status.extended": "还在听你说",
  "interviewVoice.status.thinking": "已进入思考模式",
  "interviewVoice.status.bargeIn": "正在听（面试官播报已暂停）",
  "interviewVoice.hint.thinking": "想好了直接说，最多等你 5 秒",
  "interviewVoice.hint.interrupted": "已打断面试官，请继续说",
  "interviewVoice.hint.privacy": "音频只在内存里逐段识别，不在本地留存",
  "interviewVoice.room.title": "实时语音通话",
  "interviewVoice.room.enter": "进入语音通话",
  "interviewVoice.room.exit": "退出通话",
  "interviewVoice.room.interviewer": "面试官",
  "interviewVoice.room.you": "我",
  "interviewVoice.room.conversation": "对话记录",
  "interviewVoice.room.waiting": "等待面试官提问",
  "interviewVoice.room.speaking": "面试官正在说话",
  "interviewVoice.room.speechUnsupported": "当前浏览器无法朗读面试官回复，文字对话仍可继续",
  "interviewVoice.room.cameraOn": "开启摄像头",
  "interviewVoice.room.cameraStop": "关闭摄像头",
  "interviewVoice.room.cameraOff": "摄像头预览已关闭",
  "interviewVoice.room.cameraPreview": "本机摄像头预览",
  "interviewVoice.room.localPreview": "摄像头画面仅在本机显示，不会上传",
  "interviewVoice.room.cameraError": "摄像头无法开启，请检查浏览器权限后重试",
  "interviewVoice.room.micOn": "开启麦克风",
  "interviewVoice.room.micOff": "关闭麦克风",

  // ===== 三段式重排（Q1-B）=====
  /** 底栏左侧的状态行：明确说"麦克风"，此前挂在面试官名字下面读起来像面试官状态。 */
  "interviewVoice.room.micStatus": "麦克风",
  "interviewVoice.room.micIdle": "未开启",
  "interviewVoice.room.speakingBadge": "正在播报",
  "interviewVoice.room.currentTurn": "当前问答",
  "interviewVoice.room.noTurn": "还没有问答，先开启麦克风或直接说话",
  "interviewVoice.room.settings": "通话设置",
  "interviewVoice.room.expand": "展开设置",
  /** 合成失败回落浏览器音色时的说明：不许静默无声。 */
  "interviewVoice.room.fallbackLocal": "语音合成不可用，本轮改用本机音色朗读",
  "interviewVoice.room.fallbackReason": "语音合成不可用（{reason}），本轮改用本机音色朗读",
  "interviewVoice.room.revise": "改文字重问",
  "interviewVoice.room.reviseHint": "确认后会作废这一轮的面试官点评并重新提问，不能撤销。",
  "interviewVoice.room.reviseSubmit": "确认重问",
  "interviewVoice.room.reviseCancel": "取消",

  // ===== 识别待确认气泡（Q1-C L1）=====
  "interviewVoice.pending.title": "识别结果",
  "interviewVoice.pending.segment": "第 {index} 段",
  "interviewVoice.pending.hint":
    "长回答会被静音切成多段；「重说这段」只覆盖最近一段，不是整条回答。",
  "interviewVoice.pending.resay": "重说这段",
  "interviewVoice.pending.send": "就这样发",
  "interviewVoice.pending.discard": "丢弃这段",
  "interviewVoice.pending.resayArmed": "已清空这一段，请重新说一次",
  "interviewVoice.pending.editPlaceholder": "识别结果可以直接改，改完再发",

  // ===== 可配置参数（Q1-D）=====
  "interviewVoice.settings.title": "通话设置",
  "interviewVoice.settings.cardTitle": "面试语音",
  "interviewVoice.settings.cardHint":
    "实时语音通话里面试官怎么听、怎么说话。改动立即生效，只存在这台机器上。",
  "interviewVoice.settings.speak": "面试官朗读",
  "interviewVoice.settings.speakHint": "关掉后只显示文字，不出声",
  "interviewVoice.settings.voice": "播报音色",
  "interviewVoice.settings.rate": "播报语速",
  "interviewVoice.settings.volume": "播报音量",
  "interviewVoice.settings.volumeUnit": "%",
  "interviewVoice.settings.silence": "说完多久算说完",
  "interviewVoice.settings.filler": "语气词后延长",
  "interviewVoice.settings.autoSend": "识别完自动发送",
  "interviewVoice.settings.autoSendHint": "关掉后识别结果先落成待确认气泡，可以改完再发",
  "interviewVoice.settings.bargeIn": "插话灵敏度",
  "interviewVoice.settings.bargeInSlow": "迟钝",
  "interviewVoice.settings.bargeInNormal": "标准",
  "interviewVoice.settings.bargeInFast": "灵敏",
  "interviewVoice.settings.maxRecord": "单段录音上限",
  "interviewVoice.settings.seconds": "{value} 秒",
  "interviewVoice.settings.milliseconds": "{value} 毫秒",
  "interviewVoice.settings.times": "{value} 倍",
  "interviewVoice.settings.reset": "恢复默认",
  "interviewVoice.settings.resetDone": "已恢复默认通话参数",
  "interviewVoice.settings.saved": "已保存",
  "interviewVoice.settings.roomHint": "改动立即生效，只影响这台机器上的通话体验",
  /** 错误码 → 出路（说清"发生了什么 + 怎么办"）。 */
  "interviewVoice.error.unsupported": "当前浏览器不支持实时语音",
  "interviewVoice.error.microphoneDenied": "麦克风权限被拒绝：请在浏览器地址栏允许后重试",
  "interviewVoice.error.microphoneMissing": "没有找到可用的麦克风",
  "interviewVoice.error.microphoneBusy": "麦克风被其他程序占用，请关闭后重试",
  "interviewVoice.error.microphoneFailed": "打开麦克风失败，请重试",
  "interviewVoice.error.transcribeFailed": "这一段没识别出来，请再说一次",
  "interviewVoice.error.empty": "没有听清，请再说一次",
  /** 波形是无障碍装饰，给读屏一句话说明。 */
  "interviewVoice.waveform.label": "实时音量波形",
  /** F18 镜头：设置卡、房间指示与抽帧提示。 */
  "interviewCamera.settings.title": "面试 · 镜头",
  "interviewCamera.settings.hint": "只在实时语音房间里生效；默认关闭，关闭时不会申请摄像头权限。",
  "interviewCamera.settings.enable": "启用镜头",
  "interviewCamera.settings.enableHint": "开启后可在房间里打开摄像头；画面只在本机处理。",
  "interviewCamera.settings.record": "本地录像",
  "interviewCamera.settings.recordHint":
    "只录画面、不录声音；单场上限 30 分钟或 200 MB，超限自动停止。",
  "interviewCamera.settings.analyze": "抽帧分析",
  "interviewCamera.settings.analyzeHint":
    "每 15 秒抽一帧，单场最多 12 帧；原帧只在内存里，不保存。",
  "interviewCamera.settings.retention": "录像保留",
  "interviewCamera.settings.retention7": "7 天",
  "interviewCamera.settings.retention30": "30 天",
  "interviewCamera.settings.retentionNever": "不自动删除",
  "interviewCamera.settings.countInScore": "把镜头分计入总分",
  "interviewCamera.settings.countInScoreHint":
    "默认关闭。开启后镜头表现按 15% 权重并入面试总分；关闭时报告只单列「镜头与表达（实验性）」，不影响总分。",
  "interviewCamera.settings.storageHint":
    "录像保存在本机数据目录，不包含在备份里；删除面试会同时删除录像。",
  "interviewCamera.consent.title": "开启镜头前的说明",
  "interviewCamera.consent.body":
    "镜头画面属于敏感个人信息。开启后：录像只保存在本机；只录画面、不录声音；抽帧会发送给当前配置的模型做镜头表现分析，原帧不落盘；可以随时在房间里一键停止，也可以在报告里删除录像。录像不包含在备份中。",
  "interviewCamera.consent.ok": "我了解，开启",
  "interviewCamera.consent.cancel": "暂不开启",
  "interviewCamera.room.recording": "录制中",
  "interviewCamera.room.frames": "已抽帧 {count}",
  "interviewCamera.room.stop": "停止录制",
  "interviewCamera.room.uploading": "正在保存录像",
  "interviewCamera.room.uploaded": "录像已保存",
  "interviewCamera.room.uploadFailed": "录像上传失败",
  "interviewCamera.room.retry": "重试上传",
  "interviewCamera.room.unsupported": "当前浏览器不支持本地录制，录像已关闭",
  "interviewCamera.room.overwriteNote": "暂停后继续录制会另起一段；上一段保留在数据目录。",
  "interviewCamera.report.title": "镜头与表达（实验性）",
  "interviewCamera.report.score": "镜头表现 {score}",
  "interviewCamera.report.insufficient": "画面不足，无法评估",
  "interviewCamera.report.frames": "分析了 {analyzed} 帧，其中 {visible} 帧能看清面部",
  "interviewCamera.report.error": "镜头分析暂不可用：{reason}",
  "interviewCamera.report.playback": "本场录像",
  "interviewCamera.report.delete": "删除录像",
  "interviewCamera.report.deleteConfirm":
    "删除后录像不可恢复（不进回收站），面试记录与报告不受影响。",
  "interviewCamera.report.deleted": "录像已删除",
  "interviewCamera.report.notInBackup": "录像未包含在备份中。",
  "interviewCamera.report.combined": "含镜头总分 {score}",
  "interviewCamera.metric.face_visible": "面部可见",
  "interviewCamera.metric.gaze_at_camera": "视线看镜头",
  "interviewCamera.metric.head_stable": "头部稳定",
  "interviewCamera.metric.framing_ok": "构图合适",
  "interviewCamera.metric.lighting_ok": "光线充足",
} as const;

export default interviewVoice;
