// SPDX-License-Identifier: Apache-2.0
/**
 * L 验收（**分阶段退役**）：补充事实（旧事实目录）已经没有任何用户入口。
 *
 * 2026-10-25 最终裁决：features/profile-facts/** 与 zh-CN.profileFacts.ts **本轮不物理删除**
 * （计划 §13：只解除生产引用/可达入口，物理删除需走回收站流程单独授权）。因此本守卫按
 * 阶段断言，并把"暂留"写成显式白名单而不是靠豁免注释：
 *
 * 阶段一（本文件断言，必须为 0）：
 * - ProfilePage / 指南 / 路由 没有任何补充事实入口；
 * - 生产代码不再 import features/profile-facts、不再挂载 ProfileFactsSection、
 *   不再使用 PROFILE_FACTS_SECTION_KEY（定义暂留可，使用不可）；
 * - 旧事实 API 标识符不再被调用；
 * - 指南数据文件与 App 路由不再出现旧事实；
 * - README 功能表没有「补充事实」行，feature_catalog 也不再有该能力。
 *
 * 阶段二（等物理删除授权后收紧）：文件目录删除 + namespaces 取消注册；目前这两项
 * 显式允许，见 STAGED_ALLOWANCES 的理由。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "../../i18n/cjkScan";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SRC_ROOT = join(REPO_ROOT, "frontend", "src");
const NAMESPACES_TS = join(SRC_ROOT, "i18n", "messages", "zh-CN.namespaces.ts");
const APP_TSX = join(SRC_ROOT, "App.tsx");
const GUIDE_DIR = join(SRC_ROOT, "components", "user-guide");
const README_MD = join(REPO_ROOT, "README.md");
const FEATURE_CATALOG = join(REPO_ROOT, "backend", "app", "services", "feature_catalog.py");

const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;
const RETIRED_DIR = "features/profile-facts";

/**
 * 阶段一允许保留的旧事实残留（**逐条写理由**，物理删除授权后一并清零）：
 * - 目录本身与语言包文件：本轮不物理删除（Lead 2026-10-25 裁决）；
 * - namespaces 注册：catalog-owner 暂时恢复以保持 tsc 可编译；
 * - CredentialsEditor 的 profileFacts.* 文案 key：证书编辑器属 F4 迁移，文案 key 迁移
 *   在 resume-paper 的后续批次，删注册会先把它打红；
 * - ProfileSectionConfig 里的常量定义：定义本身暂留，但**生产使用**必须为 0（下方单独断言）。
 */
const STAGED_ALLOWANCES: Record<string, string> = {
  "features/profile-facts/**": "计划 §13：本轮只解除生产引用，物理删除需单独授权",
  "i18n/messages/zh-CN.profileFacts.ts": "语言包文件本轮保留（同上）",
  "i18n/messages/zh-CN.namespaces.ts": "暂时保留注册以维持 tsc；阶段二删除",
  "components/resume/CredentialsEditor.tsx": "证书编辑器文案迁移属 F4 批次",
  "components/profile/ProfileSectionConfig.ts": "旧锚点常量定义暂留；生产使用必须为 0",
};

interface SourceFile {
  file: string;
  text: string;
}

function collectProductionSources(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (relative(SRC_ROOT, absolute).split(sep).join("/") === RETIRED_DIR) continue;
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

/** 旧事实目录 api.ts 曾导出的标识符：再被调用说明旧取数链路又接回来了。 */
const RETIRED_API_IDENTIFIERS = [
  "listProfileFacts",
  "createProfileFact",
  "updateProfileFact",
  "deleteProfileFact",
  "getProfileFactSchema",
  "saveProfileFactKindSchema",
  "resetProfileFactKindSchema",
  "ProfileFactSection",
  "ProfileFactsSection",
  "TrainingFields",
];

function offenders(
  sources: SourceFile[],
  needles: string[],
  allowed: Record<string, string> = STAGED_ALLOWANCES,
): string[] {
  const found: string[] = [];
  for (const source of sources) {
    if (allowed[source.file]) continue;
    for (const needle of needles) {
      if (source.text.includes(needle)) found.push(source.file + " → " + needle);
    }
  }
  return found;
}

describe("补充事实退役守卫（L，分阶段）", () => {
  const sources = productionSources();

  it("生产代码不再 import features/profile-facts（暂留白名单见文件头）", () => {
    const problems = offenders(sources, ["features/profile-facts", "profile-facts.css"]);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("旧事实 API 标识符 / 旧事实组件不再被生产代码调用或挂载", () => {
    const problems = offenders(sources, RETIRED_API_IDENTIFIERS);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("PROFILE_FACTS_SECTION_KEY 只允许定义，不允许生产使用", () => {
    const usage = offenders(sources, ["PROFILE_FACTS_SECTION_KEY"]).filter(
      (item) => item !== "components/profile/ProfileSectionConfig.ts → PROFILE_FACTS_SECTION_KEY",
    );
    expect(usage, usage.join("\n")).toEqual([]);
  });

  it("使用指南数据文件不再出现「补充事实」入口", () => {
    const allowed = Object.fromEntries(
      Object.keys(STAGED_ALLOWANCES)
        .filter((file) => file.startsWith("components/") || file.startsWith("i18n/"))
        .map((file) => [file, STAGED_ALLOWANCES[file]]),
    );
    const guideSources = readdirSync(GUIDE_DIR)
      .filter((name: string) => name.endsWith(".ts") && !TEST_FILE_PATTERN.test(name))
      .map((name: string) => ({
        file: "components/user-guide/" + name,
        text: stripComments(readFileSync(join(GUIDE_DIR, name), "utf8")),
      }));
    expect(offenders(guideSources, ["补充事实"], allowed)).toEqual([]);
  });

  it("App.tsx 路由表没有 facts 路径（回归：没有入口）", () => {
    const appSource = stripComments(readFileSync(APP_TSX, "utf8"));
    expect(appSource).not.toContain("/profile/facts");
  });

  it("README 功能表没有「补充事实」行，feature_catalog 不再登记该能力", () => {
    const readme = readFileSync(README_MD, "utf8");
    // 只查功能表**行的第一个单元格**（功能名）：回收站行里提到"历史遗留的补充事实仍可
    // 恢复"是备份/恢复口径的合法说明，不是功能入口，不能误判。
    const featureRows = readme.split(/\r?\n/).filter((line: string) => line.startsWith("|"));
    const staleRows = featureRows.filter((line: string) => {
      const firstCell = line.split("|")[1] ?? "";
      return firstCell.includes("补充事实");
    });
    expect(staleRows, staleRows.join("\n")).toEqual([]);
    const catalog = readFileSync(FEATURE_CATALOG, "utf8");
    expect(catalog).not.toContain("补充事实");
  });

  it("阶段二待办显式留存：目录与语言包暂留，注册暂留（物理删除授权后清零）", () => {
    // 这条不是"允许脏"，而是把下一批要删的东西钉住：目录文件仍在、namespaces 仍注册。
    // 删除授权到位时，这两个断言会一起变红，提醒把上面的 STAGED_ALLOWANCES 清空。
    const namespaces = stripComments(readFileSync(NAMESPACES_TS, "utf8"));
    expect(namespaces).toContain("./zh-CN.profileFacts");
    expect(namespaces).toContain("...profileFacts");
  });
});
