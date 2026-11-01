// SPDX-License-Identifier: Apache-2.0
/** #11a：枚举字段在 UI 上的显示名（chip / 结构树 / 填入菜单同源解析）。 */
import { describe, expect, it } from "vitest";
import { effectiveFieldFormat, enumLabelOf } from "./fieldCatalog";
import type { MessageKey } from "../../i18n";

/** 测试专用解析：把 labelKey 的尾段当中文标签（不依赖 i18n 初始化）。 */
const resolve = (key: MessageKey) => {
  const tail = key.split(".").pop() ?? "";
  const table: Record<string, string> = {
    fullTime: "全职",
    partTime: "兼职",
    internship: "实习",
    published: "已发表",
    in_press: "印刷中",
    under_review: "审稿中",
    preprint: "预印本",
    granted: "已授权",
    filed: "已申请",
    active: "有效期内",
    expired: "已过期",
    unknown: "待核实",
  };
  return table[tail] ?? tail;
};

describe("enumLabelOf #11a", () => {
  it("已知枚举值解析成本地化标签（工作类型）", () => {
    expect(enumLabelOf(null, "experience", "experience_kind", "full_time", resolve)).toBe("全职");
    expect(enumLabelOf(null, "experience", "experience_kind", "internship", resolve)).toBe("实习");
  });

  it("未知枚举值回落原值，绝不返回空串吞掉内容", () => {
    expect(enumLabelOf(null, "experience", "experience_kind", "freelance", resolve)).toBe(
      "freelance",
    );
    expect(enumLabelOf(null, "experience", "experience_kind", "", resolve)).toBe("");
  });

  it("非枚举字段（目录里没有该 key）回落原值", () => {
    expect(enumLabelOf(null, "education", "gpa", "3.8/4.0", resolve)).toBe("3.8/4.0");
  });

  it("profileSectionKey 也能命中（documents 用系统键、目录兜底两种键都可查）", () => {
    // experiences 是 experience 的 profileSectionKey，两条路径都应解析到同一张表
    expect(enumLabelOf(null, "experiences", "experience_kind", "full_time", resolve)).toBe("全职");
  });
});

describe("enumLabelOf · 4 类枚举 + A5 自建板块兜底", () => {
  it("论文 / 专利 / 凭证三种 status 都按板块本地化", () => {
    expect(enumLabelOf(null, "publications", "status", "published", resolve)).toBe("已发表");
    expect(enumLabelOf(null, "patents", "status", "granted", resolve)).toBe("已授权");
    expect(enumLabelOf(null, "credentials", "status", "active", resolve)).toBe("有效期内");
  });

  it("板块 key 的单数别名同样能命中", () => {
    expect(enumLabelOf(null, "patent", "status", "filed", resolve)).toBe("已申请");
    expect(enumLabelOf(null, "publication", "status", "under_review", resolve)).toBe("审稿中");
    expect(enumLabelOf(null, "credential", "status", "unknown", resolve)).toBe("待核实");
  });

  it("A5：自建板块 / 新加字段没有目录表时，跨家族唯一值仍本地化", () => {
    expect(enumLabelOf(null, "custom:sec_abc", "custom:fld_abc", "full_time", resolve)).toBe(
      "全职",
    );
    expect(enumLabelOf(null, "custom:sec_abc", "custom:fld_abc", "published", resolve)).toBe(
      "已发表",
    );
    // 内置板块里的自定义枚举字段（key 以 custom: 开头）同样走兜底
    expect(enumLabelOf(null, "education", "custom:fld_edu", "full_time", resolve)).toBe("全职");
  });

  it("有歧义的 code（多家族共用）不猜：回落原值", () => {
    expect(enumLabelOf(null, "custom:sec_abc", "custom:fld_abc", "pending", resolve)).toBe(
      "pending",
    );
  });
});

describe("effectiveFieldFormat · A5 自定义枚举字段", () => {
  it("目录把自定义字段报成 text，但 field_type=enum 的字段应按枚举渲染", () => {
    expect(effectiveFieldFormat({ format: "text", field_type: "enum" })).toBe("enum");
  });

  it("内置格式原样返回", () => {
    expect(effectiveFieldFormat({ format: "date_range", field_type: "date_text" })).toBe(
      "date_range",
    );
  });
});
