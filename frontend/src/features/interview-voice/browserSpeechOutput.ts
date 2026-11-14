// SPDX-License-Identifier: Apache-2.0
/**
 * 本地朗读：用浏览器自带的 speechSynthesis 读面试官的回复。
 *
 * 四点：
 * - `speechTextFromMarkdown` 只保留**可朗读**的内容：代码块、图片、HTML 标签、列表符号、
 *   加粗/斜体/标题标记全部去掉，链接只留文字——否则语音会把 `**` 和 `[]()` 一起念出来；
 * - 换行要转成标点（F17）：压成空格会让列表项粘成一句，含中文转 `。`、纯英文转 `. `；
 * - 术语走发音词表（F17，`speechPronunciation.ts`）：`MySQL` 不逐字母读；
 * - 打断（duck）只暂停、不取消：面试官的下半句还要接着读；只有 flush（换一轮）才 cancel。
 */
/** Local interviewer speech using the browser's installed speech synthesis voices. */
import { applyPronunciation } from "./speechPronunciation";
import type { InterviewVoiceOutput } from "./voiceOutput";

export interface SpeechSynthesisRuntime {
  speaking: boolean;
  speak: (utterance: SpeechSynthesisUtterance) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
}

export interface BrowserSpeechOutputOptions {
  synthesis?: SpeechSynthesisRuntime | null;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  locale?: string;
  /** 语速（Q1-D）：与远程 TTS 共用同一个设置项。 */
  rate?: number;
  /** 音量（Q1-D）：兜底时也要尊重用户调过的音量。 */
  volume?: number;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: () => void;
}

/** 宽字符口径与 `i18n/cjkScan.ts` 一致：汉字、兼容区、全角形式、CJK 标点。 */
const CJK_PATTERN = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/;

/**
 * 换行转标点（F17）：直接把 `\n+` 压成空格，列表项之间会失去停顿，"第一 / 第二 / 第三"
 * 会被连成一句念完。含 CJK 的文本转句号，纯英文转 ". "（英文里句号加空格才是停顿）。
 *
 * 必须在去掉列表符号**之后**做：`1. foo` 的 `1.` 先被当成符号剥掉，否则会被转成 `1。`。
 */
function lineBreaksToPunctuation(text: string): string {
  if (!text.includes("\n")) return text;
  const mark = CJK_PATTERN.test(text) ? "\u3002" : ". ";
  return text.replace(/\n+/g, mark);
}

/**
 * 收敛重复标点：换行转句号后会造出 `。。`；原文里也会有 `，。` 这种"逗号紧跟句号"的写法。
 * 只处理 CJK 句末符号——英文的 `...` 省略号不能被压成 `.`。
 */
function collapsePunctuation(text: string): string {
  return text
    .replace(/([\u3002\uFF01\uFF1F])\s*(?:\1\s*)+/g, "$1")
    .replace(/[\uFF0C,\uFF1B;\u3001]\s*([\u3002\uFF01\uFF1F])/g, "$1");
}

/** 剥掉 markdown 标记，只留下会被念出来的字；换行在这里**先不压**，留给下一步转标点。 */
function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/^[ \t]*(?:[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/(?:\*\*|__|[*_`#>])/g, "");
}

export function speechTextFromMarkdown(markdown: string): string {
  const stripped = lineBreaksToPunctuation(stripMarkdown(markdown));
  const spoken = collapsePunctuation(stripped).replace(/\s+/g, " ").trim();
  return applyPronunciation(spoken);
}

function browserSynthesis(): SpeechSynthesisRuntime | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  return window.speechSynthesis;
}

export class BrowserSpeechOutput implements InterviewVoiceOutput {
  readonly supported: boolean;

  private paused = false;
  private rate = 1;
  private volume = 1;

  private constructor(
    private readonly synthesis: SpeechSynthesisRuntime | null,
    private readonly createUtterance: ((text: string) => SpeechSynthesisUtterance) | null,
    private locale: string,
    private readonly onSpeakingChange: (speaking: boolean) => void,
    private readonly onError: () => void,
    rate: number,
    volume: number,
  ) {
    this.supported = Boolean(synthesis && createUtterance);
    this.rate = rate;
    this.volume = volume;
  }

  static create(options: BrowserSpeechOutputOptions = {}): BrowserSpeechOutput {
    const synthesis = options.synthesis === undefined ? browserSynthesis() : options.synthesis;
    const createUtterance =
      options.createUtterance ??
      (typeof SpeechSynthesisUtterance === "undefined"
        ? null
        : (text: string) => new SpeechSynthesisUtterance(text));
    return new BrowserSpeechOutput(
      synthesis,
      createUtterance,
      options.locale ?? "zh-CN",
      options.onSpeakingChange ?? (() => undefined),
      options.onError ?? (() => undefined),
      options.rate ?? 1,
      options.volume ?? 1,
    );
  }

  enqueue(text: string): void {
    const spokenText = speechTextFromMarkdown(text);
    if (!this.supported || !spokenText || !this.synthesis || !this.createUtterance) return;

    const utterance = this.createUtterance(spokenText);
    utterance.lang = this.locale;
    utterance.rate = this.rate;
    utterance.volume = this.volume;
    utterance.onstart = () => this.onSpeakingChange(true);
    utterance.onend = () => this.onSpeakingChange(false);
    utterance.onerror = () => {
      this.onSpeakingChange(false);
      this.onError();
    };
    this.synthesis.speak(utterance);
  }

  setLocale(locale: string): void {
    this.locale = locale;
  }

  /** 语速/音量（Q1-D）：改完立即对**下一句**生效（已入队的那句按入队时的值播完）。 */
  configure(patch: { rate?: number; volume?: number }): void {
    if (patch.rate !== undefined) this.rate = patch.rate;
    if (patch.volume !== undefined) this.volume = patch.volume;
  }

  duck(depthDb: number): void {
    if (!this.synthesis?.speaking) return;
    if (depthDb < 0 && !this.paused) {
      this.synthesis.pause();
      this.paused = true;
    } else if (depthDb >= 0 && this.paused) {
      this.synthesis.resume();
      this.paused = false;
    }
  }

  flush(): void {
    this.synthesis?.cancel();
    this.paused = false;
    this.onSpeakingChange(false);
  }

  stop(): void {
    this.flush();
  }
}
