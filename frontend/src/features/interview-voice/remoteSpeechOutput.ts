// SPDX-License-Identifier: Apache-2.0
/**
 * 远程语音合成输出（Q1-A）：把面试官的话交给后端 `qwen3-tts-flash`（默认 Cherry）朗读。
 *
 * 与 `BrowserSpeechOutput` 实现同一个 `InterviewVoiceOutput` 接口，所以房间与
 * `useInterviewVoice` 一行都不用改——这是当初把接口抽出来的目的。
 *
 * 四个非显然的点：
 *
 * 1. **按句入队、按句合成**：`enqueue` 收进来的是一整段回复，先按句切（`splitSentences`），
 *    再逐句合成。一次合成整段 300 字要 10s+，按句合成首句 1–2.5s 就能开口。切分的粒度
 *    直接决定听感：切太碎（以前分号也算句末）会被听成"一句句剪开"。
 * 2. **播当前句时预取下一句**：下载实测 129ms–3595ms 无规律，串行"取-播-取"会在句间
 *    留一个等于下载耗时的静默空档。这里在当前句开始播放后再发下一句的请求。
 * 3. **失败必须回落，而且要说明**：没配 Key / 上游 5xx / 超时 → 这一轮改由浏览器音色朗读，
 *    并回调 `onFallback(reason)` 让界面写一句"这次用的是本机音色"。**静默无声是最差的结果**。
 * 4. **不写盘**：音频只在内存里，`revokeObjectURL` 在停播时立刻释放。
 */
import type { InterviewVoiceOutput } from "./voiceOutput";
import { speechTextFromMarkdown } from "./browserSpeechOutput";

export interface RemoteSpeechOutputOptions {
  voice: string;
  rate: number;
  volume: number;
  /** 播报开始/结束（界面据此决定头像动效）。 */
  onSpeakingChange?: (speaking: boolean) => void;
  /** 合成失败、已回落到本机音色；`reason` 直接给界面看。 */
  onFallback?: (reason: string) => void;
  /** 兜底输出（浏览器音色）。不给表示"失败就只是没有声音"，测试时会省略。 */
  fallback?: InterviewVoiceOutput;
  /** 取音频（测试注入用）。默认走后端 `/api/interview/voice/tts`。 */
  fetchAudio?: (text: string, voice: string, signal: AbortSignal) => Promise<Blob>;
  /** 造播放器（测试注入用）。 */
  createAudio?: () => HTMLAudioElement;
}

/** 单句上限：超过就先在分号/逗号处补切一刀，保住首句 1–2.5s 的开口延迟。 */
const MAX_SENTENCE_LENGTH = 120;
/** 补切时每段至少这么长，免得在句首的逗号上切出两个字碎片。 */
const MIN_CUT_LENGTH = 20;
/** 短句合并上限（F17）：合并后不超过它才并，否则"好。"会把一整段吞成一句长合成。 */
const MERGE_LIMIT = 80;

/**
 * 主切只认句末符号（F17）：**分号不算句末**。
 *
 * 旧实现把 `；` 也当句末，于是"第一…；第二…；第三…"被切成三个 TTS 请求，中间各段下载
 * 时长不同，听上去就是一句句剪开的碎句。分号是并列项之间的停顿，交给 TTS 自己处理。
 */
const SENTENCE_END = /(?<=[\u3002\uFF01\uFF1F!?])\s*/u;
const SEMICOLON = /[\uFF1B;]/g;
const COMMA = /[\uFF0C,]/g;

/** `text` 里最后一个「结束位置 ≤ limit 且不早于 MIN_CUT_LENGTH」的分隔符位置；没有返回 -1。 */
function lastCutBefore(text: string, separator: RegExp, limit: number): number {
  separator.lastIndex = 0;
  let cut = -1;
  let match: RegExpExecArray | null = separator.exec(text);
  while (match !== null) {
    const end = match.index + match[0].length;
    if (end > limit) break;
    if (end >= MIN_CUT_LENGTH) cut = end;
    match = separator.exec(text);
  }
  return cut;
}

/**
 * 超长句补切：优先分号，其次逗号；两者都没有就整句送出去——TTS 自己会断，
 * 比在词中间硬切（把 `MySQL` 切开）好得多。
 */
function cutLongSentence(sentence: string): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_SENTENCE_LENGTH) {
    const semicolon = lastCutBefore(rest, SEMICOLON, MAX_SENTENCE_LENGTH);
    const cut = semicolon >= 0 ? semicolon : lastCutBefore(rest, COMMA, MAX_SENTENCE_LENGTH);
    if (cut < 0) break;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  pieces.push(rest);
  return pieces;
}

/**
 * 按句切：主切只看 `。！？!?`，超长句再按分号/逗号补切，短句按 80 字上限合并。
 *
 * 合并规则从"上一段 <12 字就并"改成"合并后 ≤80 字才并"：前者的判据是**前一段**的长度，
 * 于是"好。"会把后面任何一个短句都吞掉；后者限制的是**结果**，碎片被吸收但不会吞掉一整段。
 */
export function splitSentences(text: string): string[] {
  const clean = speechTextFromMarkdown(text);
  if (!clean) return [];
  const merged: string[] = [];
  for (const piece of clean.split(SENTENCE_END).filter(Boolean)) {
    for (const part of cutLongSentence(piece.trim())) {
      if (!part) continue;
      const last = merged[merged.length - 1];
      if (last !== undefined && last.length + part.length <= MERGE_LIMIT) {
        merged[merged.length - 1] = last + part;
      } else {
        merged.push(part);
      }
    }
  }
  return merged;
}

async function defaultFetchAudio(text: string, voice: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch("/api/interview/voice/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal,
  });
  if (!response.ok) {
    // 原因分两步取：先试 JSON 的 detail（后端 503 会写清原因），拿不到就退回状态码本身。
    // **刻意不拼 "HTTP xxx" 前缀**：i18n 的 product-copy 扫描按 AST 判、不看语言，
    // 任何模板串都会被当成一句界面文案要求登记；状态码本身就够定位了。
    let reason = String(response.status);
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload?.detail) reason = payload.detail;
    } catch {
      // 非 JSON 错误体：保留状态码。
    }
    throw new Error(reason);
  }
  return response.blob();
}

export class RemoteSpeechOutput implements InterviewVoiceOutput {
  /** 与 BrowserSpeechOutput 对齐：远程实现总是"支持"的，能不能出声由 fallback 决定。 */
  readonly supported = true;

  private readonly fetchAudio: NonNullable<RemoteSpeechOutputOptions["fetchAudio"]>;
  private readonly createAudio: () => HTMLAudioElement;
  private readonly fallback?: InterviewVoiceOutput;

  private queue: string[] = [];
  private current: HTMLAudioElement | null = null;
  private urls: string[] = [];
  private controller: AbortController | null = null;
  private pumping = false;
  /** 这一轮已经降级到浏览器音色：后续句子直接走兜底，不再逐个试远程。 */
  private degraded = false;
  private gain = 1;
  private stopped = true;

  constructor(private options: RemoteSpeechOutputOptions) {
    this.fetchAudio = options.fetchAudio ?? defaultFetchAudio;
    this.createAudio =
      options.createAudio ??
      (() => {
        const audio = new Audio();
        audio.preload = "auto";
        return audio;
      });
    this.fallback = options.fallback;
  }

  /** 换音色/语速/音量：正在播的这一句立刻跟着变，不用重开房间。 */
  configure(patch: Partial<Pick<RemoteSpeechOutputOptions, "voice" | "rate" | "volume">>): void {
    this.options = { ...this.options, ...patch };
    if (this.current) {
      this.current.playbackRate = this.options.rate;
      this.current.volume = Math.max(0, Math.min(1, this.options.volume * this.gain));
    }
  }

  enqueue(text: string): void {
    // 分句函数内部已经做过 markdown 清洗，这里不再预处理一遍（重复清洗会多跑一次正则）。
    const sentences = splitSentences(text);
    if (sentences.length === 0) return;
    if (this.degraded) {
      this.fallback?.enqueue(text);
      return;
    }
    this.queue.push(...sentences);
    this.stopped = false;
    void this.pump();
  }

  private reportSpeaking(value: boolean): void {
    this.options.onSpeakingChange?.(value);
  }

  private release(audio: HTMLAudioElement): void {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    if (this.current === audio) this.current = null;
  }

  private releaseUrls(): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
  }

  /** 降级：这一句（以及这一轮剩下的句子）改由浏览器音色朗读。 */
  private degrade(text: string, reason: string): void {
    if (this.degraded) return;
    this.degraded = true;
    this.queue = [];
    this.options.onFallback?.(reason);
    this.reportSpeaking(false);
    this.fallback?.enqueue(text);
  }

  private play(url: string): Promise<void> {
    return new Promise((resolve) => {
      const audio = this.createAudio();
      this.current = audio;
      audio.src = url;
      audio.playbackRate = this.options.rate;
      audio.volume = Math.max(0, Math.min(1, this.options.volume * this.gain));
      const finish = () => {
        this.release(audio);
        resolve();
      };
      audio.onended = finish;
      audio.onerror = finish;
      this.reportSpeaking(true);
      // `play()` 被浏览器拦截（无用户手势）时也要 resolve，否则整条队列卡死在这里。
      void audio.play().catch(finish);
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    const controller = new AbortController();
    this.controller = controller;
    let prefetched: Promise<Blob> | null = null;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const text = this.queue.shift()!;
        let blob: Blob;
        try {
          blob = prefetched
            ? await prefetched
            : await this.fetchAudio(text, this.options.voice, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) break;
          this.degrade(text, error instanceof Error ? error.message : String(error));
          break;
        }
        prefetched = null;
        // 当前句已到手：先起下一句的请求，再播这一句（首句优先 + 预取下一句）。
        if (this.queue.length > 0 && !this.stopped) {
          prefetched = this.fetchAudio(this.queue[0], this.options.voice, controller.signal).catch(
            (error: unknown) => {
              throw error;
            },
          );
          // 预取失败不该变成未处理的 rejection：这里立即挂一个空 catch，真正 await 时再判。
          prefetched.catch(() => undefined);
        }
        const url = URL.createObjectURL(blob);
        this.urls.push(url);
        await this.play(url);
      }
    } finally {
      this.pumping = false;
      if (this.controller === controller) this.controller = null;
      this.reportSpeaking(false);
      this.releaseUrls();
    }
  }

  duck(depthDb: number): void {
    const target = depthDb >= 0 ? 1 : Math.max(0, Math.min(1, 10 ** (depthDb / 20)));
    this.gain = target;
    if (this.current) {
      this.current.volume = Math.max(0, Math.min(1, this.options.volume * target));
    }
    // 浏览器兜底那一路自己会暂停/恢复。
    this.fallback?.duck(depthDb);
  }

  flush(): void {
    this.stopped = true;
    this.queue = [];
    this.controller?.abort();
    this.controller = null;
    if (this.current) this.release(this.current);
    this.releaseUrls();
    this.degraded = false;
    this.reportSpeaking(false);
    this.fallback?.flush();
  }

  stop(): void {
    this.flush();
  }
}
