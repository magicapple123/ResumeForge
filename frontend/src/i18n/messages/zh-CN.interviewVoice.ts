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
  "interviewVoice.status.bargeIn": "正在听（已降低面试官音量）",
  "interviewVoice.hint.thinking": "想好了直接说，最多等你 5 秒",
  "interviewVoice.hint.interrupted": "已打断面试官，请继续说",
  "interviewVoice.hint.privacy": "音频只在内存里逐段识别，不在本地留存",
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
} as const;

export default interviewVoice;
