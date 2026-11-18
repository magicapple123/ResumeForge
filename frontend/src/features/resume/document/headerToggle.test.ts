/**
 * I-02：页眉字段「隐藏 → 显示」必须回到**原位置**。
 *
 * 旧实现把恢复位置写死成 `contact`（页眉没有 `hidden_from` 可读，只能猜）。后果不是
 * "位置不对"那么轻：照片的 data URI 会变成联系方式文本 —— HTML 因 `.contact span`
 * 的 `nowrap` 横向溢出，PDF 一旦有任意页眉字段级样式就逐字符拆行，页数暴涨且每页刷满 base64。
 *
 * 与正文条目（`_ItemBase.hidden_from`）同构：隐藏时记住来源，显示时读回来；
 * 老数据没有记忆时按 `FALLBACK_HEADER_FIELDS` 的 placement 回落。
 */
import { describe, expect, it } from "vitest";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { makeDocument } from "./documentFixtures";
import { toggleItemHidden } from "./mutations";

function headerItemOf(document: ResumeDocument, id: string) {
  const item = document.header.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`header item ${id} 不见了`);
  return item;
}

/** 手工造一条"没有记忆"的隐藏页眉字段（模拟本次修复前存下的老文档）。 */
function withLostMemory(key: string, id: string): ResumeDocument {
  const document = makeDocument();
  document.header.items.push({
    kind: "field",
    id,
    key,
    label: "",
    value: key === "photo" ? "data:image/png;base64,AAAA" : "示例值",
    placement: "hidden",
    format: "text",
  });
  return document;
}

describe("页眉字段隐藏 / 显示（I-02）", () => {
  it("姓名隐藏后再显示，回到 name 而不是 contact", () => {
    const document = makeDocument();
    const hidden = toggleItemHidden(document, "header.ob_head0001");
    expect(headerItemOf(hidden, "ob_head0001").placement).toBe("hidden");
    expect(headerItemOf(hidden, "ob_head0001").hidden_from).toBe("name");

    const shown = toggleItemHidden(hidden, "header.ob_head0001");
    expect(headerItemOf(shown, "ob_head0001").placement).toBe("name");
    expect(headerItemOf(shown, "ob_head0001").hidden_from).toBeNull();
  });

  it("联系电话隐藏后再显示仍回到 contact（不得因新逻辑改变既有行为）", () => {
    const document = makeDocument();
    const hidden = toggleItemHidden(document, "header.ob_head0002");
    expect(headerItemOf(hidden, "ob_head0002").hidden_from).toBe("contact");

    const shown = toggleItemHidden(hidden, "header.ob_head0002");
    expect(headerItemOf(shown, "ob_head0002").placement).toBe("contact");
    expect(headerItemOf(shown, "ob_head0002").hidden_from).toBeNull();
  });

  it("老数据没有 hidden_from 时按目录回落：photo → photo", () => {
    const shown = toggleItemHidden(withLostMemory("photo", "ob_head0009"), "header.ob_head0009");
    expect(headerItemOf(shown, "ob_head0009").placement).toBe("photo");
  });

  it("老数据按目录回落：job_intent → subtitle，gender → name_meta", () => {
    const intent = toggleItemHidden(
      withLostMemory("job_intent", "ob_head0010"),
      "header.ob_head0010",
    );
    expect(headerItemOf(intent, "ob_head0010").placement).toBe("subtitle");

    const gender = toggleItemHidden(withLostMemory("gender", "ob_head0011"), "header.ob_head0011");
    expect(headerItemOf(gender, "ob_head0011").placement).toBe("name_meta");
  });

  it("目录里没有的自定义页眉字段仍回落 contact（维持旧行为，不擅自改）", () => {
    const shown = toggleItemHidden(
      withLostMemory("custom_note", "ob_head0012"),
      "header.ob_head0012",
    );
    expect(headerItemOf(shown, "ob_head0012").placement).toBe("contact");
  });

  it("连按两轮结果稳定（隐藏→显示→隐藏→显示）", () => {
    let document = makeDocument();
    for (let round = 0; round < 2; round += 1) {
      document = toggleItemHidden(document, "header.ob_head0001");
      expect(headerItemOf(document, "ob_head0001").placement).toBe("hidden");
      document = toggleItemHidden(document, "header.ob_head0001");
      expect(headerItemOf(document, "ob_head0001").placement).toBe("name");
    }
  });
});
