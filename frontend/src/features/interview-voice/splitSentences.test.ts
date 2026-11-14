// SPDX-License-Identifier: Apache-2.0
/**
 * F17 分句：主切只认 `。！？!?`（分号不再算句末），超长句按分号/逗号补切，
 * 短句按"合并后 ≤80 字"合并。
 *
 * 守的是听感里最刺耳的两件事：一句话被剪成两三段、以及短句把一整段吞成一次长合成。
 */
import { describe, expect, it } from "vitest";
import { splitSentences } from "./remoteSpeechOutput";

const MAX = 120;
const MERGE = 80;

const CLAUSE = "这一段讲的是项目里怎么定位性能问题";

describe("splitSentences：分号不再是句末", () => {
  it("分号并列项在 120 字以内保持一段", () => {
    const text = "第一点准备项目经历；第二点量化结果；第三点讲清取舍。";
    expect(splitSentences(text)).toEqual(["第一点准备项目经历；第二点量化结果；第三点讲清取舍。"]);
  });

  it("分号不产生切点：长并列项 + 短尾句仍是同一段", () => {
    // 这一条必须在"分号算句末"的旧实现下变红：旧实现切成 86 + 8 两段，且 86+8 > 80
    // 合并不回去；新实现整体 93 字 ≤ 120，一次送出去。
    const longClause = "这一段讲的是项目里怎么定位性能问题".repeat(5);
    const pieces = splitSentences(`${longClause}；再补一句指标。`);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toContain("；");
  });
});

describe("splitSentences：超长句补切", () => {
  it("超过 120 字时在分号处补切，且每段不超上限", () => {
    const text = `${Array.from({ length: 10 }, () => CLAUSE).join("；")}；收尾一句。`;
    const pieces = splitSentences(text);
    // 旧实现按每个分号各切一刀，要发 10+ 次请求；新实现只在补切点分两段。
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(MAX);
    // 除最后一段外，切点都落在分号后面（没有在词中间硬切）。
    for (const piece of pieces.slice(0, -1)) expect(piece.endsWith("；")).toBe(true);
  });

  it("没有分号时退到逗号处补切", () => {
    const clause = "先讲背景再讲动作最后讲结果";
    const text = `${Array.from({ length: 12 }, () => clause).join("，")}。`;
    const pieces = splitSentences(text);
    expect(pieces.length).toBe(2);
    for (const piece of pieces.slice(0, -1)) expect(piece.endsWith("，")).toBe(true);
  });

  it("没有任何分隔符时整句送出去，不在词中间硬切", () => {
    const filler = "准备".repeat(30);
    const pieces = splitSentences(`${filler}MySQL${filler}。`);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBeGreaterThan(MAX);
    // 术语没有被切成两半：发音替换之后仍是一个整体。
    expect(pieces[0]).toContain("my sequel");
  });
});

describe("splitSentences：短句合并上限 80 字", () => {
  it("碎片被吸收进前一句，合并后仍在 80 字内", () => {
    const body = "我把接口响应时间从八百毫秒压到了两百毫秒，靠批量查询和缓存提升命中率。";
    const pieces = splitSentences(`好。${body}`);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBeLessThanOrEqual(MERGE);
  });

  it("合并会超过 80 字时保持两句，不吞掉一整段", () => {
    const body = `我在上一家公司负责订单链路的重构，${"把响应时间往下压了".repeat(8)}。`;
    const pieces = splitSentences(`好。${body}`);
    expect(pieces).toHaveLength(2);
    expect(pieces[0]).toBe("好。");
    expect(pieces[1].length).toBeGreaterThan(MERGE);
  });

  it("空文本与纯标记文本返回空数组", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("```ts\nconst x = 1;\n```")).toEqual([]);
  });
});
