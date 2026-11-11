// SPDX-License-Identifier: Apache-2.0
/**
 * 「查重复条目」判据（#27A 复用 #20）：同分区 + 锚点相等/前缀 + 日期与角色不冲突。
 * 反向样本来自 #20 的反证清单（C# / C++ / .NET / Java vs JavaScript / 同公司两段任职）。
 */
import { describe, expect, it } from "vitest";
import {
  DUPLICATE_ANCHOR_MIN_LENGTH,
  duplicateAnchorsFromProfile,
  findDuplicatePairs,
  hasDateConflict,
  hasRoleConflict,
  normalizeAnchor,
  sameAnchor,
  type DuplicateEntryAnchor,
} from "./touTouDuplicateCriteria";
import type { Profile } from "../../types";

function anchor(
  id: string,
  section: string,
  value: string,
  extra: Partial<DuplicateEntryAnchor> = {},
): DuplicateEntryAnchor {
  return { id, section, anchor: value, ...extra };
}

describe("锚点归一化", () => {
  it("NFKC + 去空白 + 小写", () => {
    expect(normalizeAnchor("  Java  Script ")).toBe("javascript");
    expect(normalizeAnchor("Ｎｏｄｅ．ｊｓ")).toBe("node.js");
  });

  it("剥首尾装饰符号（#20 FIX-1），但短名保留（C# / .NET）", () => {
    expect(normalizeAnchor("*清华大学**")).toBe("清华大学");
    // 归一化会 casefold：C# / .NET 的"保留原样"指**不被剥成短名**，不是保留大小写。
    expect(normalizeAnchor("C#")).toBe("c#");
    expect(normalizeAnchor(".NET")).toBe(".net");
  });

  it("前缀匹配的最短长度是 4（#20 同值）", () => {
    expect(DUPLICATE_ANCHOR_MIN_LENGTH).toBe(4);
    expect(sameAnchor("浙江大学", "浙江大学 计算机科学与技术 本科")).toBe(true);
    expect(sameAnchor("IBM", "IBM 中国")).toBe(false); // 短侧 3 字：不并
    expect(sameAnchor("C#", "C++")).toBe(false);
    expect(sameAnchor("字节跳动", "字节")).toBe(false);
    // 注：「Java / JavaScript 不合并」是 #20 对**技能**的保护——技能分区不参与锚点合并，
    // 本判据只用于教育/工作/校园/项目四个有锚点的分区，所以不拿它做同前缀反例。
  });

  it("装饰符号变体视为同一学校", () => {
    expect(sameAnchor("*浙江大学**", "浙江大学")).toBe(true);
  });
});

describe("日期 / 角色保护（#20 的两条硬门槛）", () => {
  it("两侧日期都填且不相等 → 不合并（同公司两段任职合法）", () => {
    const left = anchor("a", "experiences", "腾讯", { startDate: "2018-01", endDate: "2019-01" });
    const right = anchor("b", "experiences", "腾讯", { startDate: "2020-01", endDate: "2021-01" });
    expect(hasDateConflict(left, right)).toBe(true);
    expect(findDuplicatePairs([left, right], "腾讯 后端工程师 2018-01 至 2019-01")).toEqual([]);
  });

  it("一侧日期为空 → 不构成冲突", () => {
    const left = anchor("a", "experiences", "腾讯", { startDate: "2018-01" });
    const right = anchor("b", "experiences", "腾讯");
    expect(hasDateConflict(left, right)).toBe(false);
  });

  it("角色不同 → 不合并（工程师 / 高级工程师是两段任职）", () => {
    const left = anchor("a", "experiences", "腾讯", { role: "工程师" });
    const right = anchor("b", "experiences", "腾讯", { role: "高级工程师" });
    expect(hasRoleConflict(left, right)).toBe(true);
    expect(findDuplicatePairs([left, right], "腾讯 工程师")).toEqual([]);
  });
});

describe("选中文本 vs 资料条目", () => {
  it("同内容贴两遍的教育经历：选中文本里两个锚点 → 报一对重复", () => {
    const entries = [
      anchor("e1", "educations", "浙江大学"),
      anchor("e2", "educations", "浙江大学 计算机科学与技术 本科"),
    ];
    const pairs = findDuplicatePairs(entries, "浙江大学 计算机科学与技术 本科 2014-09 至 2018-06");
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ section: "educations" });
  });

  it("跨分区同名不会被判重复（分区必须相同）", () => {
    const entries = [anchor("a", "educations", "浙江大学"), anchor("b", "experiences", "浙江大学")];
    expect(findDuplicatePairs(entries, "浙江大学")).toEqual([]);
  });

  it("选中的文本里没有任何锚点 → 不猜，返回空", () => {
    const entries = [anchor("a", "projects", "分布式任务调度平台")];
    expect(findDuplicatePairs(entries, "这里完全无关的一段文字")).toEqual([]);
  });

  it("Profile → 判据输入：四个有锚点意义的分区都被映射", () => {
    const profile = {
      educations: [
        { school: "浙江大学", major: "计算机", start_date: "2014-09", end_date: "2018-06" },
      ],
      experiences: [{ company: "腾讯", role: "后端工程师", start_date: "2019-07", end_date: "" }],
      campus_experiences: [{ organization: "学生会", role: "部长", start_date: "", end_date: "" }],
      projects: [{ name: "调度平台", role: "核心开发", start_date: "", end_date: "" }],
    } as unknown as Profile;
    const anchors = duplicateAnchorsFromProfile(profile);
    expect(anchors.map((entry) => entry.section)).toEqual([
      "educations",
      "experiences",
      "campus_experiences",
      "projects",
    ]);
    expect(anchors[0].anchor).toBe("浙江大学");
    expect(anchors[1].role).toBe("后端工程师");
  });
});
