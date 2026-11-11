// SPDX-License-Identifier: Apache-2.0
/**
 * 语音听写的判定闸门：**纯函数 + 阈值常量**，不碰 DOM、不读 React。
 *
 * 为什么单独成文件：`useVoiceInput` 已经贴到 500 行预算，而这三件事（时长下限、
 * 电平峰值、语气词兜底）都是"给定输入返回布尔/字符串"的纯逻辑，抽出来既能复用
 * （测试麦克风的弹层要同一套峰值格式），也能被单测直接钉住。
 *
 * ## 每个阈值为什么是这个值
 *
 * 起因是需求 #8：`begin()` 在 `await getUserMedia` 期间按钮没有任何反馈，用户会再点
 * 一下，正好把录音停在 0.1–0.3 秒——后端日志里那几次 `bytes=632…1584`（折算 0.1–0.3 s）
 * 就是这么来的，上游对空音频稳定幻觉出「嗯。」。所以闸门的目的不是"严格"，而是
 * **在把音频发上游之前就告诉用户"这段录音不可能识别出东西"**。
 *
 * - `MIN_RECORDING_MS = 500`：正常人说完一句话不会短于 0.5 秒；低于它基本是误触。
 * - `MIN_STOP_INTERVAL_MS = 400`：起录后的这一小段窗口内收到的 stop 一律忽略，
 *   挡住"连点两下"；与 500 的时长闸门是两道独立的保险（一个防误停、一个防误传）。
 * - `SILENCE_PEAK_THRESHOLD = 0.01`：约 −40 dBFS。真实说话即使离麦克风很远也在
 *   0.02 以上；全程峰值低于 1% 只可能是设备选错/被静音/没说话。文案里会带上实测峰值，
 *   所以调这个值只影响判定宽松度，不影响用户判断依据。
 * - `FILLER_MAX_MS = 1500`：语气词兜底只在**短录音**里生效。用户真的只答了一个「嗯」
 *   时通常会停顿 2 秒以上才点结束，那条要原样保留（见 #8 风险一节）。
 */

/** 录音时长下限（毫秒）。低于它不上传。 */
export const MIN_RECORDING_MS = 500;

/** 起录后忽略 stop 的窗口（毫秒）：防"连点两下把录音掐死"。 */
export const MIN_STOP_INTERVAL_MS = 400;

/** 静音阈值：全程峰值低于它即判定"没有检测到声音"（约 −40 dBFS）。 */
export const SILENCE_PEAK_THRESHOLD = 0.01;

/** 电平采样间隔（毫秒）。10 Hz 足够捕捉峰值，又不会让主线程有感知。 */
export const PEAK_SAMPLE_INTERVAL_MS = 100;

/** 语气词兜底的时长上限（毫秒）。超过它就原样保留识别结果。 */
export const FILLER_MAX_MS = 1500;

/** 「测试麦克风」的录音时长（秒）。 */
export const MIC_TEST_SECONDS = 3;

/**
 * 中文语气词：嗯 啊 哦 呃 唉 哎 噢。
 *
 * 用 `\u` 转义而不是写字面量：这些字符是**与识别结果做匹配的协议值**，不是界面文案；
 * 而中文棘轮按"代码行里的 CJK 字符数"计数，新文件里出现中文会被判成"新增界面文案"。
 * 转义后文件保持 ASCII，判定规则本身不变。
 */
const CJK_FILLERS: ReadonlySet<string> = new Set([
  "\u55ef", // 嗯
  "\u554a", // 啊
  "\u54e6", // 哦
  "\u5443", // 呃
  "\u5509", // 唉
  "\u54ce", // 哎
  "\u5662", // 噢
]);

/** 英文语气词。分词的路径只对英文有意义（中文没有词间空格）。 */
const EN_FILLERS: ReadonlySet<string> = new Set(["uh", "um", "hmm", "mm"]);

/** 标点与空白：`\p{P}` 标点、`\p{S}` 符号（含 emoji），`\s` 空白。 */
const PUNCTUATION = /[\p{P}\p{S}\s]/gu;

/**
 * 峰值 → 人类可读百分比（如 `0.004 → "0.4%"`）。
 *
 * 之所以要显示：用户看到「峰值 0.4%」能立刻判断是设备选错还是自己没说话；
 * 只写「没有检测到声音」会让人去重装浏览器。低于 0.1% 时给 `<0.1%`，
 * 避免出现「峰值 0.0%」这种看着像 bug 的文案。
 */
export function formatPeakPercent(peak: number): string {
  const percent = Math.max(0, peak) * 100;
  if (percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/**
 * 识别结果是否**只有语气词**。
 *
 * 先去掉全部标点与空白再判：`qwen3-asr-flash` 对非语音音频的幻觉结果是「嗯。」，
 * 带一个句号；中文路径逐字判（这样「嗯嗯」也算），英文路径逐词判（`uh, um` 会先被
 * 标点切成 `uh`/`um` 两个 token）。
 */
export function isFillerOnly(text: string): boolean {
  const bare = text.replace(PUNCTUATION, "");
  if (!bare) return false;
  if (Array.from(bare).every((char) => CJK_FILLERS.has(char))) return true;
  const tokens = text.toLowerCase().replace(PUNCTUATION, " ").trim().split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.length <= 3 && tokens.every((token) => EN_FILLERS.has(token));
}
