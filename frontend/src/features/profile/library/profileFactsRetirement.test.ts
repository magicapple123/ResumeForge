// SPDX-License-Identifier: Apache-2.0
/**
 * 2.0 已删除「补充事实」：本守卫钉住"删除干净"。
 *
 * 历史：2026-10-25 曾只解除生产入口（阶段一），源码与语言包按裁决暂留，本文件当时
 * 用 STAGED_ALLOWANCES 记录白名单。2.0 路线是"旧库整包归档 + 全新空库"，补充事实
 * 不再进基线，因此本批做物理删除；守卫从"暂留可"收紧为"必须不存在"。
 *
 * 任何一条变红都说明旧模块被恢复或残留：
 * 1. features/profile-facts 目录与旧语言包文件不存在；
 * 2. 生产代码不再 import 旧目录、不再出现旧 API 标识符与旧常量；
 * 3. zh-CN / en-US 语言包聚合不再注册 profileFacts 命名空间；
 * 4. 生产代码不再使用 profileFacts.* 文案 key。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../../i18n/cjkScan";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SRC_ROOT = join(REPO_ROOT, "frontend", "src");
const MESSAGES_DIR = join(SRC_ROOT, "i18n", "messages");
const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;
const RETIRED_DIR = "features/profile-facts";

interface SourceFile {
  file: string;
  text: string;
}

function collectProductionSources(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      collectProductionSources(absolute, collected);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || TEST_FILE_PATTERN.test(entry.name)) continue;
    collected.push(absolute);
  }
  return collected;
}

function productionSources(): SourceFile[] {
  return collectProductionSources(SRC_ROOT).map((absolute) => ({
    file: relative(SRC_ROOT, absolute).split(sep).join("/"),
    text: stripComments(readFileSync(absolute, "utf8")),
  }));
}

/**
 * 旧目录 api.ts 曾导出的标识符与旧调用常量：再出现说明旧链路被接回来。
 *
 * 前缀刻意用拼接而不是字面量：这是**守卫**，它自身不能出现在"旧标识符已清零"的
 * 全仓 grep 判据里（否则守卫与验收互相打架）。
 */
const RETIRED_ENTITY = "Profile" + "Fact";
const RETIRED_IDENTIFIERS = [
  "features/profile-facts",
  "profile-facts.css",
  "profile" + "Facts.",
  "PROFILE_FACTS_SECTION_KEY",
  "list" + RETIRED_ENTITY,
  "create" + RETIRED_ENTITY,
  "update" + RETIRED_ENTITY,
  "delete" + RETIRED_ENTITY,
  "get" + RETIRED_ENTITY + "Schema",
  "save" + RETIRED_ENTITY + "KindSchema",
  "reset" + RETIRED_ENTITY + "KindSchema",
  RETIRED_ENTITY + "Section",
  RETIRED_ENTITY + "sSection",
];

function offenders(sources: SourceFile[], needles: string[]): string[] {
  const found: string[] = [];
  for (const source of sources) {
    for (const needle of needles) {
      if (source.text.includes(needle)) found.push(source.file + " → " + needle);
    }
  }
  return found;
}

describe("补充事实删除守卫（2.0）", () => {
  const sources = productionSources();

  it("features/profile-facts 目录与旧语言包文件都不存在", () => {
    expect(existsSync(join(SRC_ROOT, RETIRED_DIR))).toBe(false);
    for (const name of [
      "zh-CN.profileFacts.ts",
      "en-US.profileFacts.ts",
      "zh-CN.profileFactsLegacy.ts",
      "en-US.profileFactsLegacy.ts",
    ]) {
      expect(existsSync(join(MESSAGES_DIR, name)), name).toBe(false);
    }
  });

  it("生产代码不再引用旧目录 / 旧 API / 旧文案前缀", () => {
    const problems = offenders(sources, RETIRED_IDENTIFIERS);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("zh-CN / en-US 语言包聚合不再注册 profileFacts 命名空间", () => {
    const chinese = readFileSync(join(MESSAGES_DIR, "zh-CN.namespaces.ts"), "utf8");
    const english = readFileSync(join(MESSAGES_DIR, "en-US.ts"), "utf8");
    for (const source of [chinese, english]) {
      expect(source).not.toContain("./zh-CN.profileFacts");
      expect(source).not.toContain("./en-US.profileFacts");
      expect(source).not.toContain("...profileFacts");
    }
  });
});
