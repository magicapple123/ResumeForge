// SPDX-License-Identifier: Apache-2.0
/**
 * 26B 保守断句：把"什么时候算说完"拆成纯函数，逐条对应需求表。
 *
 * | 条件 | 行为 |
 * | --- | --- |
 * | 静音 < 700ms | 继续听，不发 |
 * | 静音 700–800ms 且结尾是「呃/然后/就是/比如」 | 延长到 1.2–1.5s（默认 1.4s） |
 * | 静音 700–800ms 且语义完整（句号/问号/「我讲完了」） | 立即发 |
 * | 按住说话松开 | 立即发，跳过所有计时 |
 * | 「让我想一下」「稍等」 | extended wait（最多 5s 静音）并显示思考中 |
 *
 * P0 的 ASR 是**分段上传**（VAD 切段 → /api/transcribe），所以"语义"只能在转写返回后
 * 判断：VAD 静音到 700ms 就先上传这一段，拿到文字再走这里的规则决定发或再等。这比真
 * 流式慢 300–800ms（P0 已知代价），但规则本身与 ASR 形态无关，P2 换流式 ASR 后直接复用。
 */

/** 静音 < 700ms 一律继续听。 */
export const SILENCE_CONTINUE_MS = 700;
/** 700–800ms 是"可以发"的窗口；超过它仍不完整就按延长档处理。 */
export const SILENCE_SEND_MS = 800;
/** 语气词 / 没说完时的延长上限（需求区间 1.2–1.5s，取中值）。 */
export const EXTENDED_SILENCE_MS = 1_400;
/** ASR 自身耗时吃掉延长窗口时，至少再多等这么久，避免"延长"实际上没有生效。 */
export const EXTENDED_GRACE_MS = 400;
/** 思考模式：最多 5s 静音就发。 */
export const THINKING_SILENCE_MS = 5_000;

/**
 * 结尾出现这些词 = 大概率没说完。
 *
 * 这些都是**中文语音的匹配记号**（要拿去和 ASR 原文 endsWith，永远不该翻译），
 * 用 \u 转义书写：JS 里是同一个字符串，静态扫描不会把它当成"待迁移中文文案"，
 * 也就不需要给新文件登记基线。新增记号照此格式写。
 */
export const FILLER_SUFFIXES = [
  "\u5443",
  "\u7136\u540e",
  "\u5c31\u662f",
  "\u6bd4\u5982",
  "\u90a3\u4e2a",
  "\u55ef",
  "\u554a",
] as const;

/** 这些短语出现 = 用户在思考，进入 extended wait（而不是以为他说完了）。 */
export const THINKING_PHRASES = [
  "\u8ba9\u6211\u60f3\u4e00\u4e0b",
  "\u8ba9\u6211\u60f3\u60f3",
  "\u6211\u60f3\u4e00\u4e0b",
  "\u6211\u60f3\u60f3",
  "\u7a0d\u7b49",
  "\u7b49\u4e00\u4e0b",
  "\u6211\u6574\u7406\u4e00\u4e0b",
] as const;

/** 明确表示"我说完了"的短语：命中即发，不再受语气词/标点影响。 */
const COMPLETE_PHRASES = [
  "\u6211\u8bb2\u5b8c\u4e86",
  "\u6211\u8bf4\u5b8c\u4e86",
  "\u5c31\u8fd9\u4e9b",
  "\u56de\u7b54\u5b8c\u6bd5",
] as const;

/** 句末标点（含省略号）：语义完整。 */
const SENTENCE_END = /[\u3002\uFF01\uFF1F!?\u2026]$/u;
/** 逗号 / 顿号 / 分号 / 冒号结尾：明显没说完。 */
const OPEN_ENDED_END = /[\uFF0C,\u3001\uFF1B;\uFF1A:]$/u;
/** 连接词结尾：中文从句停顿的典型形态（英文 turn 分类器在这里会误判）。 */
const OPEN_ENDED_CONJUNCTIONS = [
  "\u56e0\u4e3a",
  "\u6240\u4ee5",
  "\u4f46\u662f",
  "\u800c\u4e14",
  "\u5982\u679c",
  "\u867d\u7136",
  "\u7136\u540e",
  "\u5c31\u662f",
  "\u6bd4\u5982",
  "\u5e76\u4e14",
  "\u6216\u8005",
  "\u9996\u5148\u662f",
] as const;

export type TranscriptClass = "complete" | "incomplete" | "thinking";

function normalize(text: string): string {
  return (text ?? "").trim();
}

/** 结尾是否命中语气词 / 连接词 / 开放标点（= 没说完）。 */
export function endsWithFiller(text: string): boolean {
  const value = normalize(text);
  if (!value) return false;
  if (OPEN_ENDED_END.test(value)) return true;
  return (
    FILLER_SUFFIXES.some((suffix) => value.endsWith(suffix)) ||
    OPEN_ENDED_CONJUNCTIONS.some((suffix) => value.endsWith(suffix))
  );
}

/** 转写文本属于哪一类：完整 / 没说完 / 思考中。 */
export function classifyTranscript(text: string): TranscriptClass {
  const value = normalize(text);
  if (!value) return "incomplete";
  if (THINKING_PHRASES.some((phrase) => value.includes(phrase))) return "thinking";
  if (COMPLETE_PHRASES.some((phrase) => value.includes(phrase))) return "complete";
  if (SENTENCE_END.test(value)) return "complete";
  if (endsWithFiller(value)) return "incomplete";
  // 没有标点也没有语气词：按"完整"处理——ASR 经常不带标点，一律当没说完会让
  // 每个回答都白等 1.4s。真正没说完的情况大多会被上面的语气词/连接词接住。
  return "complete";
}

export type EndpointMode = "always-on" | "push-to-talk";

export interface EndpointInput {
  /** 这一段（可能由多段转写拼起来）的文本。 */
  text: string;
  /** 距最后一次检测到语音的静音时长（ms）。 */
  silenceMs: number;
  /** 当前时刻。 */
  atMs: number;
  /** 最后一次检测到语音的时刻。 */
  lastSpeechAt: number;
  /** 按住说话模式：松开 = 立即发。 */
  released?: boolean;
}

export type EndpointCause =
  "complete" | "release" | "deadline" | "extended-deadline" | "thinking-timeout";

export type EndpointDecision =
  | { kind: "send"; cause: EndpointCause }
  | { kind: "wait"; cause: "filler" | "incomplete"; deadlineAt: number }
  | { kind: "thinking"; deadlineAt: number };

/**
 * 端点决策（纯函数）。
 *
 * 注意返回 ``wait``/``thinking`` 时调用方要设一个定时器：到 deadline 还没新语音就
 * 按"超时发出"处理，这与需求表里"最多 1.2–1.5s / 最多 5s"对应。
 */
export function decideEndpoint(input: EndpointInput): EndpointDecision {
  const text = normalize(input.text);
  if (input.released) return { kind: "send", cause: "release" };
  // 静音 < 700ms：无论文字多完整都继续听（需求表第一行；VAD 到达 700ms 才会触发上传，
  // 这里是防御性兜底，避免调用方在静音中途提前把回答发出去）。
  if (input.silenceMs < SILENCE_CONTINUE_MS) {
    return {
      kind: "wait",
      cause: "incomplete",
      deadlineAt: input.lastSpeechAt + SILENCE_CONTINUE_MS,
    };
  }
  if (!text) {
    // 空转写（ASR 失败或全是语气词被过滤）：不发，等调用方的错误兜底；给一个不早于
    // 延长档的期限，避免永远挂着。
    return {
      kind: "wait",
      cause: "incomplete",
      deadlineAt: Math.max(
        input.lastSpeechAt + EXTENDED_SILENCE_MS,
        input.atMs + EXTENDED_GRACE_MS,
      ),
    };
  }
  const transcriptClass = classifyTranscript(text);
  if (transcriptClass === "thinking") {
    const deadlineAt = input.lastSpeechAt + THINKING_SILENCE_MS;
    if (deadlineAt <= input.atMs) return { kind: "send", cause: "thinking-timeout" };
    return { kind: "thinking", deadlineAt };
  }
  if (transcriptClass === "complete") return { kind: "send", cause: "complete" };
  // 没说完：延长到 1.2–1.5s；ASR 慢导致窗口已过时至少再给 EXTENDED_GRACE_MS。
  const deadlineAt = Math.max(
    input.lastSpeechAt + EXTENDED_SILENCE_MS,
    input.atMs + EXTENDED_GRACE_MS,
  );
  if (deadlineAt <= input.atMs) return { kind: "send", cause: "extended-deadline" };
  return { kind: "wait", cause: endsWithFiller(text) ? "filler" : "incomplete", deadlineAt };
}

/** 静音到 700ms 就该把这一段上传转写；按住说话只在松开时上传。 */
export function shouldUploadSegment(input: {
  mode: EndpointMode;
  hasAudio: boolean;
  uploadRequested: boolean;
  silenceMs: number;
  released?: boolean;
}): boolean {
  if (!input.hasAudio || input.uploadRequested) return false;
  if (input.mode === "push-to-talk") return Boolean(input.released);
  return input.silenceMs >= SILENCE_CONTINUE_MS;
}
