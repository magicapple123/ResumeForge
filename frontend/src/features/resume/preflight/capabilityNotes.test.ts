// SPDX-License-Identifier: Apache-2.0
/**
 * R-26：能力表的「为什么」只传码，文案在前端 i18n。
 *
 * 这条测试是"英文界面显示英文"的**硬判据**：后端只下发 `no_italic_glyph` 这类码，
 * 中文/英文各自查自己的词条。如果哪天有人图省事把中文写进后端，中文界面上看不出问题，
 * 而英文界面会漏出中文——所以这里同时校验：
 * 1. 码 → 词条映射覆盖全部码；
 * 2. 每个词条在中英两套 message 里都存在；
 * 3. 解析函数对坏数据不炸、不把裸码当文案。
 */
import { describe, expect, it } from "vitest";
import { NOTE_MESSAGE_KEY, parseCapabilityNotes } from "./capabilities";
import enUS from "../../../i18n/messages/en-US";
import zhCN from "../../../i18n/messages/zh-CN";

// 与后端 `format_capabilities.NOTE_CODES` 逐字一致（后端有同名守卫，两边一起改）。
const BACKEND_CODES = [
  "browser_print",
  "browser_no_page_number",
  "no_italic_glyph",
  "link_text_only",
  "font_substitute",
  "table_approx",
  "plain_text_no_style",
  "plain_text_no_pagination",
  "plain_text_no_layout",
  "plain_text_only",
  "data_only",
] as const;

const zh = zhCN as Record<string, string>;
const en = enUS as Record<string, string>;

describe("能力原因码 → 文案", () => {
  it("后端每个码都有前端映射", () => {
    const missing = BACKEND_CODES.filter((code) => !NOTE_MESSAGE_KEY[code]);
    expect(missing).toEqual([]);
  });

  it("每个词条在中英两套 message 里都存在且非空", () => {
    for (const code of BACKEND_CODES) {
      const key = NOTE_MESSAGE_KEY[code];
      expect(zh[key], `zh-CN 缺少 ${key}`).toBeTruthy();
      expect(en[key], `en-US 缺少 ${key}`).toBeTruthy();
    }
  });

  it("英文文案确实是英文（不是从中文复制过来的）", () => {
    for (const code of BACKEND_CODES) {
      const key = NOTE_MESSAGE_KEY[code];
      expect(zh[key]).not.toBe(en[key]);
      // 中文词条里必须有 CJK，英文词条里必须没有。
      expect(/[\u4e00-\u9fff]/.test(zh[key])).toBe(true);
      expect(/[\u4e00-\u9fff]/.test(en[key])).toBe(false);
    }
  });

  it("解析后端形状：只收非空字符串，坏数据忽略", () => {
    const notes = parseCapabilityNotes({
      pdf: { italic: "no_italic_glyph", bold: "" },
      docx: "not-an-object",
      txt: { bold: 42 },
    });
    expect(notes).toEqual({ "pdf:italic": "no_italic_glyph" });
    expect(parseCapabilityNotes(null)).toEqual({});
  });
});
