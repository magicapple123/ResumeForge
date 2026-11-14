// SPDX-License-Identifier: Apache-2.0
/**
 * F17 播放队列：`enqueue` 进来的整段回复要按 `splitSentences` 的切分**逐句、按序**合成与播放。
 *
 * 为什么单独测：分句规则再对，只要 `enqueue` 没把切分结果接上队列，用户听到的还是原来那样；
 * 而队列顺序错了比切碎更难发现——说话顺序乱了但每句都完整。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteSpeechOutput } from "./remoteSpeechOutput";

/** 只实现 `play` / `pause` / `src` / 事件回调那一小块，够 `pump` 跑完一轮。 */
class FakeAudio {
  src = "";
  playbackRate = 1;
  volume = 1;
  preload = "auto";
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

  play(): Promise<void> {
    // 播放"立刻结束"：把 onended 放进下一轮宏任务，避免在 pump 的同步段里递归。
    setTimeout(() => this.onended?.(), 0);
    return Promise.resolve();
  }

  pause(): void {
    // 队列走完时 pump 会 release 一次，这里不需要做任何事。
  }
}

const SENTENCE_A = "甲".repeat(50);
const SENTENCE_B = "乙".repeat(50);
const SENTENCE_C = "丙".repeat(50);

describe("RemoteSpeechOutput：按 splitSentences 的切分顺序合成与播放", () => {
  let urlSeq = 0;
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    urlSeq = 0;
    createObjectURL = vi.fn(() => `blob:f17-${(urlSeq += 1)}`);
    revokeObjectURL = vi.fn();
    // jsdom 没有这两个方法：补上再 spy，测试里就能数"播了几个 object URL"。
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("三句各 51 字（合并不回去）→ 三次合成、三次播放，顺序与原文一致", async () => {
    const requests: string[] = [];
    const played: string[] = [];
    const output = new RemoteSpeechOutput({
      voice: "Cherry",
      rate: 1,
      volume: 1,
      fetchAudio: (text) => {
        requests.push(text);
        return Promise.resolve(new Blob(["audio"]));
      },
      createAudio: () => {
        const audio = new FakeAudio();
        const play = audio.play.bind(audio);
        audio.play = () => {
          played.push(audio.src);
          return play();
        };
        return audio as unknown as HTMLAudioElement;
      },
    });

    output.enqueue(`${SENTENCE_A}。${SENTENCE_B}。${SENTENCE_C}。`);
    await vi.waitFor(() => expect(played).toHaveLength(3));

    expect(requests).toEqual([`${SENTENCE_A}。`, `${SENTENCE_B}。`, `${SENTENCE_C}。`]);
    expect(played).toEqual(["blob:f17-1", "blob:f17-2", "blob:f17-3"]);
    output.stop();
  });

  it("短句被合并后只发一次合成请求（碎句不再各自合成）", async () => {
    const requests: string[] = [];
    const output = new RemoteSpeechOutput({
      voice: "Cherry",
      rate: 1,
      volume: 1,
      fetchAudio: (text) => {
        requests.push(text);
        return Promise.resolve(new Blob(["audio"]));
      },
      createAudio: () => new FakeAudio() as unknown as HTMLAudioElement,
    });

    output.enqueue("好。那就开始吧。");
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toBe("好。那就开始吧。");
    output.stop();
  });
});
