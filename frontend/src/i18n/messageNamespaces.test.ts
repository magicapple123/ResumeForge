// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import zhCN from "./messages/zh-CN";
import { validateMessageContract, type MessagePack } from "./guards/messageContract";

// Every completed namespace is checked immediately; the full pack gets a separate
// unconditional contract once all namespaces have landed.
const chineseNamespaces = import.meta.glob<MessagePack>("./messages/zh-CN.*.ts", {
  eager: true,
  import: "default",
});
const englishNamespaces = import.meta.glob<MessagePack>("./messages/en-US.*.ts", {
  eager: true,
  import: "default",
});
const domainKeys = new Set(
  Object.entries(chineseNamespaces)
    .filter(([path]) => !path.endsWith(".namespaces.ts"))
    .flatMap(([, pack]) => Object.keys(pack)),
);
const chineseCore = Object.fromEntries(
  Object.entries(zhCN).filter(([key]) => !domainKeys.has(key)),
);

describe("completed en-US namespace contracts", () => {
  it("discovers real namespace files rather than passing with an empty glob", () => {
    expect(Object.keys(chineseNamespaces).length).toBeGreaterThan(25);
    expect(Object.keys(englishNamespaces).length).toBeGreaterThan(0);
  });

  for (const [path, english] of Object.entries(englishNamespaces)) {
    it(`validates keys, translations and placeholders in ${path}`, () => {
      const chinese = path.endsWith(".core.ts")
        ? chineseCore
        : chineseNamespaces[path.replace("en-US.", "zh-CN.")];
      expect(chinese, `Missing Chinese namespace for ${path}`).toBeDefined();
      expect(Object.keys(english).length).toBeGreaterThan(0);
      expect(validateMessageContract(chinese, english)).toEqual([]);
    });
  }

  it("does not allow later namespaces to silently overwrite earlier keys", () => {
    const owners = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [path, pack] of Object.entries(englishNamespaces)) {
      for (const key of Object.keys(pack)) {
        const previous = owners.get(key);
        if (previous) duplicates.push(`${key}: ${previous} / ${path}`);
        owners.set(key, path);
      }
    }
    expect(duplicates).toEqual([]);
  });
});
