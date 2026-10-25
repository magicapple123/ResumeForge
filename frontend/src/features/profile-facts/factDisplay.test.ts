// SPDX-License-Identifier: Apache-2.0
/** 补充事实展示摘要：新类型标题/副标题/徽标、隐藏字段不展示、自定义字段行。 */
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { factBadge, factCustomLines, factSecondary, factTitle } from "./factDisplay";
import {
  AWARD_FACT,
  CUSTOM_FIELD_DEF,
  LANGUAGE_FACT,
  PUBLICATION_FACT,
  TRAINING_FACT,
} from "./testFixtures";

describe("新类型的列表摘要", () => {
  it("荣誉与获奖：名称标题、机构与时间副标题、级别徽标", () => {
    expect(factTitle(AWARD_FACT)).toBe(AWARD_FACT.payload.name);
    expect(factSecondary(AWARD_FACT)).toBe("Example Education Board · 2025-06");
    expect(factBadge(AWARD_FACT)).toEqual({ text: "National" });
  });

  it("培训与课程：名称标题、机构与起止副标题、学时为徽标", () => {
    expect(factTitle(TRAINING_FACT)).toBe(TRAINING_FACT.payload.name);
    expect(factSecondary(TRAINING_FACT)).toBe("Example Academy · 2024-03 – 2024-05");
    expect(factBadge(TRAINING_FACT)).toEqual({ text: "32" });
  });

  it("语言能力：名称标题、证书/分数/时间副标题、水平徽标", () => {
    expect(factTitle(LANGUAGE_FACT)).toBe("English");
    expect(factSecondary(LANGUAGE_FACT)).toBe("College English Test Band 6 · 512 · 2023-12");
    expect(factBadge(LANGUAGE_FACT)).toEqual({ text: "CET-6" });
  });
});

describe("隐藏字段不进入展示", () => {
  it("标题字段隐藏时返回空串（由列表显示「未命名」），副标题跳过隐藏项", () => {
    expect(factTitle(PUBLICATION_FACT, ["title"])).toBe("");
    expect(factSecondary(PUBLICATION_FACT, ["venue"])).toBe("2025");
    expect(factSecondary(PUBLICATION_FACT, ["venue", "year"])).toBe("");
  });

  it("状态/级别类字段隐藏时不给徽标", () => {
    expect(factBadge(PUBLICATION_FACT, ["status"])).toBeNull();
    expect(factBadge(AWARD_FACT, ["level"])).toBeNull();
    expect(factBadge(TRAINING_FACT, ["hours"])).toBeNull();
    expect(factBadge(LANGUAGE_FACT, ["level"])).toBeNull();
  });
});

describe("自定义字段行", () => {
  it("只展示当前定义里有值的字段，label 取定义里的名字", () => {
    const fact = {
      ...PUBLICATION_FACT,
      payload: {
        ...PUBLICATION_FACT.payload,
        custom_fields: [{ key: CUSTOM_FIELD_DEF.key, label: "旧名字", value: "4" }],
      },
    };
    expect(factCustomLines(fact, [CUSTOM_FIELD_DEF])).toEqual([
      t("profileFacts.fact.customFieldLine", { label: CUSTOM_FIELD_DEF.label, value: "4" }),
    ]);
    // 定义已删除（不在 defs 里）→ 不再展示；空值也不展示。
    expect(factCustomLines(fact, [])).toEqual([]);
    expect(
      factCustomLines({ ...fact, payload: { ...fact.payload, custom_fields: [] } }, [
        CUSTOM_FIELD_DEF,
      ]),
    ).toEqual([]);
  });
});

describe("旧记录兼容", () => {
  it("灵活字段上线前的 payload 没有 custom_fields：展示不崩溃且不回填假值", () => {
    const legacy = {
      ...PUBLICATION_FACT,
      payload: { ...PUBLICATION_FACT.payload },
    } as unknown as Parameters<typeof factCustomLines>[0];
    delete (legacy.payload as unknown as Record<string, unknown>).custom_fields;
    expect(factCustomLines(legacy, [CUSTOM_FIELD_DEF])).toEqual([]);
    // 其它摘要照常可渲染。
    expect(factTitle(legacy)).toBe(PUBLICATION_FACT.payload.title);
  });
});
