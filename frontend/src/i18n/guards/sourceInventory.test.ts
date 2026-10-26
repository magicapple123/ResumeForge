// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node built-ins are available in Vitest; @types/node is not installed.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectInventoryFiles,
  compareSourceInventory,
  MINIMUM_SOURCE_FILES,
  validateSourceInventory,
  type DirectoryReader,
} from "./sourceInventory";

function completeInventory(size = MINIMUM_SOURCE_FILES): string[] {
  const entries = [
    "App.tsx",
    "main.tsx",
    "i18n/index.ts",
    "api/client.ts",
    "components/Panel.tsx",
    "features/jobs/state.ts",
    "pages/Jobs.tsx",
  ];
  while (entries.length < size) entries.push(`components/fixture${entries.length}.ts`);
  return entries;
}

describe("source inventory validation", () => {
  it("accepts a complete inventory and a small legitimate source reduction", () => {
    const files = completeInventory(1_000);
    expect(validateSourceInventory(files, files)).toEqual([]);
    expect(validateSourceInventory(files.slice(0, 950), files)).toEqual([]);
  });

  it("rejects an empty scan even if there are no product-copy findings", () => {
    expect(validateSourceInventory([], completeInventory())).toContain(
      "Source inventory too small: 0 < 900",
    );
  });

  it("rejects too few source files, including a matching tiny baseline", () => {
    const files = completeInventory(899);
    expect(validateSourceInventory(files, files)).toContain(
      "Source inventory too small: 899 < 900",
    );
  });

  it("rejects a shifted scan that lost more than five percent of baseline files", () => {
    const baseline = completeInventory(1_000);
    expect(validateSourceInventory(baseline.slice(0, 949), baseline)).toContain(
      "Source baseline coverage too small: 949 < 950",
    );
  });

  it("rejects lost entry points and required source directories", () => {
    const baseline = completeInventory();
    const files = baseline.filter((file) => file !== "App.tsx" && !file.startsWith("pages/"));
    expect(validateSourceInventory(files, baseline)).toContain("Missing required source: App.tsx");
    expect(validateSourceInventory(files, baseline)).toContain(
      "Missing required source directory: pages/",
    );
  });

  it("rejects duplicate paths, missing baseline inventories, and paths outside the root", () => {
    const files = completeInventory();
    expect(validateSourceInventory([...files, files[0]], files)).toContain(
      "Duplicate source inventory paths",
    );
    expect(validateSourceInventory(files, [])).toContain("Source baseline inventory is empty");
    for (const path of ["../outside.ts", "/outside.ts", "D:/outside.ts", "api/../outside.ts"]) {
      expect(validateSourceInventory([...files, path], files)).toContain(
        `Source inventory path must stay relative: ${path}`,
      );
    }
  });

  it("requires the AST scan and independent enumeration to have identical file sets", () => {
    expect(compareSourceInventory(["api/client.ts"], ["api/client.ts", "App.tsx"])).toEqual([
      "Source missing from product-copy scan: App.tsx",
    ]);
    expect(compareSourceInventory(["App.tsx", "extra.ts"], ["App.tsx"])).toEqual([
      "Unexpected product-copy source: extra.ts",
    ]);
    expect(compareSourceInventory(["App.tsx", "App.tsx"], ["App.tsx"])).toContain(
      "Duplicate paths in source comparison",
    );
    expect(
      compareSourceInventory(["api\\client.ts", "App.tsx"], ["App.tsx", "api/client.ts"]),
    ).toEqual([]);
  });
});

describe("independent source enumeration", () => {
  it("includes zero-finding sources and excludes content, tests, styles, and generated trees", () => {
    const root = "fixture-root";
    const file = (name: string) => ({ name, isDirectory: () => false });
    const directory = (name: string) => ({ name, isDirectory: () => true });
    const tree: Record<string, ReturnType<DirectoryReader>> = {
      [root]: [
        file("App.tsx"),
        file("empty.ts"),
        file("style.css"),
        file("unit.test.ts"),
        file("unit.spec.tsx"),
        directory("demo"),
        directory("i18n"),
        directory("test"),
        directory("features"),
        directory("dist"),
        directory("coverage"),
        directory("node_modules"),
      ],
      [join(root, "demo")]: [file("data.ts")],
      [join(root, "test")]: [file("setup.ts")],
      [join(root, "i18n")]: [file("index.ts"), directory("messages")],
      [join(root, "i18n", "messages")]: [file("zh-CN.ts")],
      [join(root, "features")]: [file("state.ts"), file("state.test.tsx")],
    };
    const readDirectory: DirectoryReader = (path) => {
      const entries = tree[path];
      if (!entries) throw new Error(`Unexpected traversal: ${path}`);
      return entries;
    };
    expect(collectInventoryFiles(root, readDirectory)).toEqual([
      "App.tsx",
      "empty.ts",
      "features/state.ts",
      "i18n/index.ts",
    ]);
  });

  it("propagates unreadable and missing directory errors instead of treating them as empty", () => {
    expect(() =>
      collectInventoryFiles("missing", () => {
        throw new Error("ENOENT: missing");
      }),
    ).toThrow("ENOENT: missing");
  });
});
