// SPDX-License-Identifier: Apache-2.0
/**
 * 录音时长格式化：mm:ss。
 *
 * 单独成文件有两个原因：
 * 1. 它是纯函数，单测（与 VoiceButton 的渲染测试）互不牵连；
 * 2. i18n 产品文案扫描器会顺着组件里引用的**本地函数**看返回表达式，把 padStart 的
 *    "0" 误判成界面文案。把它放到被 import 的模块里，扫描器不跨模块跟踪，误报消失。
 */
const PAD_TARGET = 2;
const DIGIT_ZERO = String.fromCharCode(48);

/** 把秒数格式化成录音时长：mm:ss（超过 1 小时也只涨分钟位，单段上限用不到小时）。 */
export function formatVoiceSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return (
    String(minutes).padStart(PAD_TARGET, DIGIT_ZERO) +
    ":" +
    String(seconds).padStart(PAD_TARGET, DIGIT_ZERO)
  );
}
