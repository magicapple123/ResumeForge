// SPDX-License-Identifier: Apache-2.0
/**
 * 本地朗读：把 markdown 读成可朗读文本（保留链接文字、去掉标记）；播放状态要如实上报，
 * 被打断时暂停、清空时取消；空文本不入队，浏览器不支持朗读时静默降级。
 *
 * 守的是「不念符号、不念空、不卡住」——这三件事在真实语音里用户立刻能听出来。
 */
import { describe, expect, it, vi } from "vitest";
import {
  BrowserSpeechOutput,
  speechTextFromMarkdown,
  type SpeechSynthesisRuntime,
} from "./browserSpeechOutput";

function mockUtterance(text: string): SpeechSynthesisUtterance {
  return { text, lang: "", onstart: null, onend: null, onerror: null } as SpeechSynthesisUtterance;
}

describe("BrowserSpeechOutput", () => {
  it("removes markdown presentation while retaining readable link text", () => {
    expect(speechTextFromMarkdown("**Hello** [world](https://example.test) `code`\n- next")).toBe(
      "Hello world code. next",
    );
  });

  it("folds newlines into punctuation so list items keep a pause", () => {
    // 纯英文换行转 ". "：比压成空格多一个停顿。
    expect(speechTextFromMarkdown("first line\nsecond line")).toBe("first line. second line");
    // 含中文换行转句号，列表符号先被剥掉，不会念出 "1。"。
    expect(speechTextFromMarkdown("- 第一点\n- 第二点\n1. 第三点")).toBe("第一点。第二点。第三点");
  });

  it("collapses duplicated punctuation produced by the newline folding", () => {
    expect(speechTextFromMarkdown("第一点。\n第二点")).toBe("第一点。第二点");
    expect(speechTextFromMarkdown("第一段，。\n第二段")).toBe("第一段。第二段");
  });

  it("applies the pronunciation table before handing text to the voice", () => {
    expect(speechTextFromMarkdown("用过 **MySQL** 和 PostgreSQL")).toBe(
      "用过 my sequel 和 postgres sequel",
    );
  });

  it("uses browser speech, reports playback state, pauses on duck and cancels on flush", () => {
    const utterance = mockUtterance("");
    const synthesis: SpeechSynthesisRuntime = {
      speaking: true,
      speak: vi.fn(),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    const onSpeakingChange = vi.fn();
    const output = BrowserSpeechOutput.create({
      synthesis,
      createUtterance: (text) => {
        utterance.text = text;
        return utterance;
      },
      locale: "en-US",
      onSpeakingChange,
    });

    output.enqueue("**Your turn.**");
    expect(utterance.text).toBe("Your turn.");
    expect(utterance.lang).toBe("en-US");
    expect(synthesis.speak).toHaveBeenCalledWith(utterance);
    utterance.onstart?.({} as SpeechSynthesisEvent);
    expect(onSpeakingChange).toHaveBeenLastCalledWith(true);

    output.duck(-24);
    output.duck(-24);
    expect(synthesis.pause).toHaveBeenCalledTimes(1);
    output.duck(0);
    expect(synthesis.resume).toHaveBeenCalledTimes(1);

    output.flush();
    expect(synthesis.cancel).toHaveBeenCalledTimes(1);
    expect(onSpeakingChange).toHaveBeenLastCalledWith(false);
    output.stop();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it("does not enqueue blank text or fail when speech synthesis is unavailable", () => {
    const output = BrowserSpeechOutput.create({
      synthesis: null,
      createUtterance: () => mockUtterance(""),
    });
    expect(output.supported).toBe(false);
    expect(() => output.enqueue("```ts\nconst x = 1;\n```")).not.toThrow();
  });
});
