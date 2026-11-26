// SPDX-License-Identifier: Apache-2.0
/**
 * 块几何换算的单测。
 *
 * 这里守的是**一处减法**：PDF 的原点在左下角，热区要按屏幕坐标（左上原点）画，所以
 * `top` 必须用 `page_height - y1`。写反了页面照样渲染、点击照样触发，只是点到的是别的块
 * —— 没有断言就永远发现不了（反证：删掉那次翻转，第一条用例精确变红）。
 */
import { describe, expect, it } from "vitest";
import type { ExternalResumeBlock } from "../../../api/externalResumes";
import {
  blockPercentRect,
  blockPreviewText,
  blockRoleOf,
  blocksOfPage,
  exceedsBlockWidth,
  formatCharDelta,
  maxBlockSize,
  MAX_SHIFT_PT,
  reasonKey,
  revisionDiffChars,
  revisionSourceKey,
  shiftBelowAmount,
} from "./blockGeometry";

function block(over: Partial<ExternalResumeBlock> = {}): ExternalResumeBlock {
  return {
    block_id: "p1b0",
    page: 1,
    text: "标题",
    editable: true,
    reason: "",
    x0: 0,
    y0: 0,
    x1: 0,
    y1: 0,
    size: 12,
    leading: 16,
    align: "left",
    ...over,
  };
}

describe("blockPercentRect", () => {
  it("把左下原点的 bbox 翻成屏幕坐标的百分比矩形", () => {
    // 600×800 的页面；块在 x 60–360、y 700–720（距页面顶边 80pt）。
    const rect = blockPercentRect(block({ x0: 60, y0: 700, x1: 360, y1: 720 }), {
      width: 600,
      height: 800,
    });
    expect(rect).toEqual({ left: 10, top: 10, width: 50, height: 2.5 });
  });

  it("bbox 的上下边界写颠倒（y0 > y1）也画在同一个位置", () => {
    const normal = blockPercentRect(block({ x0: 0, y0: 100, x1: 300, y1: 140 }), {
      width: 600,
      height: 800,
    });
    const flipped = blockPercentRect(block({ x0: 300, y0: 140, x1: 0, y1: 100 }), {
      width: 600,
      height: 800,
    });
    expect(flipped).toEqual(normal);
    expect(normal?.top).toBe(82.5);
  });

  it("页面尺寸缺失（docx / text 的 0）时不画", () => {
    expect(blockPercentRect(block({ x0: 0, y0: 0, x1: 10, y1: 10 }), { width: 0, height: 0 })).toBeNull();
  });

  it("退化的 bbox（宽或高为 0）不画，避免出现点不到的 0×0 热区", () => {
    expect(blockPercentRect(block({ x0: 10, y0: 10, x1: 10, y1: 20 }), { width: 600, height: 800 })).toBeNull();
    expect(blockPercentRect(block({ x0: 10, y0: 20, x1: 40, y1: 20 }), { width: 600, height: 800 })).toBeNull();
  });
});

describe("blocksOfPage", () => {
  it("只取该页的块，并保持后端给的顺序", () => {
    const blocks = [
      block({ block_id: "p1b0", page: 1 }),
      block({ block_id: "p2b0", page: 2 }),
      block({ block_id: "p1b1", page: 1 }),
    ];
    expect(blocksOfPage(blocks, 1).map((item) => item.block_id)).toEqual(["p1b0", "p1b1"]);
    expect(blocksOfPage(blocks, 3)).toEqual([]);
  });
});

describe("shiftBelowAmount", () => {
  it("取上整且至少 1pt：少移一点就会压住下一行", () => {
    expect(shiftBelowAmount(3.2)).toBe(4);
    expect(shiftBelowAmount(0.1)).toBe(1);
    expect(shiftBelowAmount(24)).toBe(24);
  });

  it("块没变高时返回 0（不该动任何东西）", () => {
    expect(shiftBelowAmount(0)).toBe(0);
    expect(shiftBelowAmount(-8)).toBe(0);
    expect(shiftBelowAmount(Number.NaN)).toBe(0);
  });

  it("上限与后端的 0–200pt 对齐", () => {
    expect(shiftBelowAmount(900)).toBe(MAX_SHIFT_PT);
    expect(MAX_SHIFT_PT).toBe(200);
  });
});

describe("协议值到文案 key", () => {
  it("认识后端给的原因码，认不出的回落到通用解释", () => {
    expect(reasonKey("pdf_block_rotated")).toBe("externalEdit.reason.pdf_block_rotated");
    expect(reasonKey("docx_text_in_table")).toBe("externalEdit.reason.docx_text_in_table");
    expect(reasonKey("")).toBe("externalEdit.reason.unknown");
    expect(reasonKey("brand_new_code")).toBe("externalEdit.reason.unknown");
  });

  it("版本来源三档 + 未知", () => {
    expect(revisionSourceKey("upload")).toBe("externalEdit.revisions.source.upload");
    expect(revisionSourceKey("edit")).toBe("externalEdit.revisions.source.edit");
    expect(revisionSourceKey("restore")).toBe("externalEdit.revisions.source.restore");
    expect(revisionSourceKey("mystery")).toBe("externalEdit.revisions.source.unknown");
  });
});

describe("块列表的读法（T11）", () => {
  it("字号最大的短块算标题；没有字号信息（DOCX）一律正文", () => {
    const largest = maxBlockSize([block({ size: 18 }), block({ size: 10 })]);
    expect(largest).toBe(18);
    expect(blockRoleOf(block({ size: 18, text: "黄岑果" }), largest)).toBe("title");
    expect(blockRoleOf(block({ size: 10, text: "正文" }), largest)).toBe("body");
    // 字号够大但整段很长：那是正文，不标标题。
    expect(blockRoleOf(block({ size: 18, text: "很".repeat(50) }), largest)).toBe("body");
    expect(blockRoleOf(block({ size: 0, text: "段落" }), 0)).toBe("body");
  });

  it("清单摘要只取首行，超长截断", () => {
    expect(blockPreviewText("第一行\n第二行")).toBe("第一行");
    expect(blockPreviewText("  留白  ")).toBe("留白");
    expect(blockPreviewText("a".repeat(60), 10)).toBe("aaaaaaaaaa…");
  });

  it("按字号折算每行字数：超出原块宽度才提示，几何缺失时不提示", () => {
    // 300pt 宽、字号 10 → 每行 30 字。
    const wide = block({ x0: 0, x1: 300, size: 10 });
    expect(exceedsBlockWidth(wide, "あ".repeat(30))).toBe(false);
    expect(exceedsBlockWidth(wide, "あ".repeat(31))).toBe(true);
    // 多行只要有一行超了就算超。
    expect(exceedsBlockWidth(wide, `短\n${"あ".repeat(40)}`)).toBe(true);
    // DOCX / TXT 没有几何信息：永远不提示（由服务端判定溢出）。
    expect(exceedsBlockWidth(block({ x0: 0, x1: 0, size: 0 }), "あ".repeat(200))).toBe(false);
  });
});

describe("历史版本的字数差（T12）", () => {
  const items = [{ text_chars: 40 }, { text_chars: 12 }, { text_chars: 0 }];

  it("与下一条（上一版）比；最老的一版没有上一版", () => {
    expect(revisionDiffChars(items, 0)).toBe(28);
    expect(revisionDiffChars(items, 1)).toBe(12);
    expect(revisionDiffChars(items, 2)).toBeNull();
  });

  it("展示串永远带符号，0 写成 ±0", () => {
    expect(formatCharDelta(13)).toBe("+13");
    expect(formatCharDelta(-5)).toBe("-5");
    expect(formatCharDelta(0)).toBe("±0");
  });
});
