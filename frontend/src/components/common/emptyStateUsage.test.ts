// SPDX-License-Identifier: Apache-2.0
/**
 * 空态插图守卫（2026-11-20）：全站只允许经 `EmptyState` 渲染 antd `<Empty>`。
 *
 * 背景：`EmptyState` 已把默认插图收口为线稿水印，但各页面直接 `import { Empty } from "antd"`
 * 的裸空态会绕开它，于是出现"有的换了、有的还是灰插画"。这条守卫把绕过口封死：
 * 除三个刻意另用插图的组件外，任何 `.tsx` 都不许再从 antd 导入 `Empty`。
 *
 * 白名单：`EmptyState`（唯一合法出口）、`ErrorState`（错误态自带图标）、
 * `AssistantEmptyState`（投投品牌图，另一种语义）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ALLOWED = new Set([
  "components/common/EmptyState.tsx",
  "components/common/ErrorState.tsx",
  "features/assistant/components/AssistantEmptyState.tsx",
]);

/** 从一段源码里取出所有 `import { … } from "antd"` 具名导入的标识符。 */
export function antdImportNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /import\s+(?:type\s+)?\{([^{}]*)\}\s+from\s+"antd"/g;
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function listTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(
    (entry: { name: string; isDirectory(): boolean }) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listTsx(full);
      return entry.name.endsWith(".tsx") ? [full] : [];
    },
  );
}

describe("EmptyState usage guard", () => {
  it("detects `Empty` inside an antd import (self-check)", () => {
    expect(antdImportNames('import { Button, Empty } from "antd";')).toEqual(["Button", "Empty"]);
    expect(antdImportNames('import {\n  Card,\n  Empty as AntdEmpty,\n} from "antd";')).toEqual([
      "Card",
      "Empty",
    ]);
    expect(antdImportNames('import { Button } from "antd";')).toEqual(["Button"]);
  });

  it("only the three whitelisted components may import antd Empty", () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const files = listTsx(srcRoot);
    // 扫描根写错时会静默通过，这条兜底：仓库里确有大量 tsx。
    expect(files.length).toBeGreaterThan(100);

    const offenders = files
      .filter((file) => antdImportNames(readFileSync(file, "utf8")).includes("Empty"))
      .map((file) => relative(srcRoot, file).split(sep).join("/"))
      .filter((file) => !ALLOWED.has(file));

    expect(offenders).toEqual([]);
  });
});
