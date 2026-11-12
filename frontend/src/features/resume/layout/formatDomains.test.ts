// SPDX-License-Identifier: Apache-2.0
/**
 * `format_config` 域协议（wave2 契约 §1）的读写语义：版本宽容读、空域不落库、
 * 只裁死数据、不碰别的域。
 */
import { describe, expect, it } from "vitest";
import {
  FORMAT_DOMAIN_VERSION,
  domainEntries,
  domainIsEmpty,
  domainVersion,
  pruneStaleDomainEntries,
  pruneStaleObjectOverrides,
  readFormatDomain,
  withFormatDomain,
  withFormatDomainEntry,
} from "./formatDomains";

describe("formatDomains · 读取", () => {
  it("缺域 / 非对象 / 数组都读成 null", () => {
    expect(readFormatDomain(undefined, "roles")).toBeNull();
    expect(readFormatDomain({}, "roles")).toBeNull();
    expect(readFormatDomain({ roles: "x" } as never, "roles")).toBeNull();
    expect(readFormatDomain({ roles: [] } as never, "roles")).toBeNull();
  });

  it("缺 version 按 1 读，非法 version 也按 1 读", () => {
    expect(domainVersion(undefined)).toBe(FORMAT_DOMAIN_VERSION);
    expect(domainVersion({ version: 0 })).toBe(1);
    expect(domainVersion({ version: 1.5 })).toBe(1);
    expect(domainVersion({ version: "1" })).toBe(1);
    expect(readFormatDomain({ roles: { body: { bold: true } } } as never, "roles")).toEqual({
      version: 1,
      body: { bold: true },
    });
  });

  it("version 高于本端支持 → 整域丢弃", () => {
    expect(readFormatDomain({ roles: { version: 2 } } as never, "roles")).toBeNull();
  });

  it("domainEntries 去掉 version，域空判定只看条目", () => {
    expect(domainEntries({ version: 1, body: {} })).toEqual({ body: {} });
    expect(domainIsEmpty({ version: 1 })).toBe(true);
    expect(domainIsEmpty({ version: 1, body: {} })).toBe(false);
  });
});

describe("formatDomains · 写入", () => {
  it("写域带 version 1，并保留 config 其余键", () => {
    const next = withFormatDomain({ accent: "#123456" }, "roles", { body: { bold: true } });
    expect(next).toEqual({ accent: "#123456", roles: { version: 1, body: { bold: true } } });
  });

  it("null 删域（恢复继承）", () => {
    const next = withFormatDomain(
      { roles: { version: 1, body: { bold: true } } } as never,
      "roles",
      null,
    );
    expect(next).toEqual({});
  });

  it("空域不落库（R3）", () => {
    expect(withFormatDomain({ accent: "#123456" }, "objects", {})).toEqual({
      accent: "#123456",
    });
    expect(withFormatDomain({}, "objects", { version: 1 })).toEqual({});
  });

  it("条目里的 null / undefined 被清掉", () => {
    const next = withFormatDomain({}, "objects", {
      exp_12345678: { bold: true, align: null } as never,
    });
    expect(next).toEqual({ objects: { version: 1, exp_12345678: { bold: true } } });
  });

  it("改域内一个条目时保留 reservedKeys 与其它条目", () => {
    const config = {
      pagination: {
        version: 1,
        entries: { exp_12345678: { break_before: "page" } },
        continuation: { repeat_name: true },
      },
    } as never;
    const next = withFormatDomainEntry(config, "pagination", "sections", { break_before: "page" }, [
      "sections",
      "continuation",
    ]);
    expect(next.pagination).toEqual({
      version: 1,
      entries: { exp_12345678: { break_before: "page" } },
      continuation: { repeat_name: true },
      sections: { break_before: "page" },
    });
    const removed = withFormatDomainEntry(next, "pagination", "sections", null, [
      "sections",
      "continuation",
    ]);
    expect((removed.pagination as unknown as Record<string, unknown>).sections).toBeUndefined();
    expect((removed.pagination as unknown as Record<string, unknown>).continuation).toEqual({
      repeat_name: true,
    });
  });
});

describe("formatDomains · 裁剪死数据", () => {
  const config = {
    accent: "#123456",
    objects: {
      version: 1,
      exp_12345678: { bold: true },
      exp_deadbeef: { bold: false },
    },
  } as never;

  it("掉的只有不再存在的对象，其余键原样保留", () => {
    const next = pruneStaleObjectOverrides(config, ["exp_12345678"]);
    expect(next).toEqual({
      accent: "#123456",
      objects: { version: 1, exp_12345678: { bold: true } },
    });
  });

  it("没有可裁的条目时返回原对象引用（调用方据此不写库）", () => {
    expect(pruneStaleObjectOverrides(config, ["exp_12345678", "exp_deadbeef"])).toBe(config);
  });

  it("全部条目失效时整域删掉", () => {
    const next = pruneStaleObjectOverrides(config, []);
    expect(next).toEqual({ accent: "#123456" });
  });

  it("reservedKeys 不被当死数据裁掉", () => {
    const pagination = {
      pagination: { version: 1, entries: {}, continuation: { page_numbers: true } },
    } as never;
    const next = pruneStaleDomainEntries(
      pagination,
      "pagination",
      [],
      ["entries", "sections", "continuation"],
    );
    expect(next).toBe(pagination);
  });
});
