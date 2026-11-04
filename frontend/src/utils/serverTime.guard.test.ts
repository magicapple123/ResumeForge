// SPDX-License-Identifier: Apache-2.0
/**
 * 服务端时间渲染守卫（问题 14）。
 *
 * 为什么要有它：这类回退是**静默**的——新写的组件直接 `new Date(created_at)` 或
 * `created_at.replace("T", " ").slice(0, 16)`，在开发机上看着"时间是对的"（因为
 * 本机就在东八区，或者只差 8 小时没人核对），只有用户跨日看到"昨天"才会发现。
 * 所以把规则固化成源码扫描：除了 `utils/serverTime.ts` 和下面写明理由的豁免，
 * 不允许对 `*_at` 做裸 `new Date(`，也不允许再用 `replace("T", " ").slice(`。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, resolve } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** `frontend/src`（本文件在 `src/utils/`）。 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Exemption {
  /** 为什么这里合法——必须指出具体机制，不许写"以后再说"。 */
  reason: string;
}

/** 豁免册：键是相对 `src/` 的路径（正斜杠）。 */
const EXEMPTIONS: Record<string, Exemption> = {
  "utils/serverTime.ts": {
    reason: "工具自身：它正是补 Z 与格式化的唯一实现。",
  },
  "components/settings/ManualBackupsCard.tsx": {
    reason: "`modified_at` 是备份文件的 epoch 秒（文件系统 mtime），不是服务端 ISO 字符串。",
  },
  "components/settings/BackupStatusCard.tsx": {
    reason: "同上：`modified_at` 是备份文件的 epoch 秒，不是服务端时间戳。",
  },
};

/** 旧的截断写法：`x.replace("T", " ").slice(0, 16)`。 */
const SLICE_PATTERN = /\.replace\(\s*["']T["']\s*,\s*["'] ["']\s*\)\s*\.slice\(/;

/** 对 `*_at` 的裸 `new Date(...)`（不解析偏移，等于按本地时区读 UTC）。 */
const BARE_DATE_PATTERN = /new\s+Date\(\s*[^()\n]*_at\b/;

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  text: string;
  rule: string;
}

function scan(): Offender[] {
  const offenders: Offender[] = [];
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const relative = file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/");
    if (EXEMPTIONS[relative]) continue;
    const content = readFileSync(file, "utf8");
    content.split(String.fromCharCode(10)).forEach((text: string, index: number) => {
      if (SLICE_PATTERN.test(text)) {
        offenders.push({ file: relative, line: index + 1, text: text.trim(), rule: "slice" });
        return;
      }
      if (BARE_DATE_PATTERN.test(text)) {
        offenders.push({ file: relative, line: index + 1, text: text.trim(), rule: "new Date" });
      }
    });
  }
  return offenders;
}

describe("服务端时间渲染守卫", () => {
  it('除 serverTime.ts 与豁免册外，不再出现 replace("T", " ").slice 或 *_at 的裸 new Date(', () => {
    const offenders = scan();
    expect(
      offenders,
      offenders.map((item) => `${item.file}:${item.line} [${item.rule}] ${item.text}`).join("\n"),
    ).toEqual([]);
  });

  it("扫描器本身能命中两类违规（防止守卫变成恒真断言）", () => {
    expect(SLICE_PATTERN.test('{review.created_at.replace("T", " ").slice(0, 16)}')).toBe(true);
    expect(BARE_DATE_PATTERN.test("new Date(item.created_at)")).toBe(true);
    expect(BARE_DATE_PATTERN.test("new Date(generatedAt)")).toBe(false);
    expect(SLICE_PATTERN.test("value.slice(0, 16)")).toBe(false);
  });
});
