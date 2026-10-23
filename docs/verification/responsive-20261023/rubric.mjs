/**
 * 指标 → rubric 判定（方案 §7.5 / §7.6）。
 *
 * 判 R1–R8；没有对应数据的项输出 `SKIP`——**SKIP 不等于 PASS**。
 * R5 只统计动作组（筛选条/页头按设计允许换行），R6 取同网格相邻列距极差，R8 只在大屏判。
 *
 * 用法：node harness/rubric.mjs                      # 默认读 deliverables 下的 metrics.json
 *      node harness/rubric.mjs --metrics <path>
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);

/**
 * 仓库根与 playwright 的解析（2026-10-24 改）。
 *
 * 原先是 `createRequire("D:/ResumeForge/frontend/package.json")` —— 硬编码作者机器路径，
 * 别人 clone 下来第一行就崩。现在从脚本位置向上找 `pyproject.toml` + `frontend/package.json`，
 * 于是同一份脚本在 `deliverables/` 与 `docs/verification/` 下都能跑。
 */
function findRepoRoot(start) {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, "pyproject.toml")) && existsSync(join(dir, "frontend", "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO_ROOT = findRepoRoot(HERE);
if (!REPO_ROOT) {
  console.error("找不到仓库根：需要同时存在 pyproject.toml 与 frontend/package.json");
  process.exit(2);
}

/** 截图与指标的默认落点：仓库内的 deliverables（该目录被 .gitignore 排除）。 */
const DEFAULT_OUT = join(
  REPO_ROOT,
  "deliverables",
  "software-company",
  "responsive-20261023",
  "screenshots",
  "after",
);

const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const DEFAULT_METRICS = join(
  REPO_ROOT,
  "deliverables",
  "software-company",
  "responsive-20261023",
  "screenshots",
  "after",
  "metrics.json",
);
const file = path.resolve(argOf("metrics", DEFAULT_METRICS));
const rows = JSON.parse(readFileSync(file, "utf8"));

function judge(row) {
  if (row.error) {
    return { R1: "FAIL", R2: "FAIL", R3: "FAIL", R4: "SKIP", R5: "SKIP", R6: "SKIP", R7: "SKIP", R8: "SKIP", note: row.error };
  }
  const R1 = row.docOverflow <= 1 && row.mainOverflow <= 1 && row.outOfViewport.length === 0;
  const R2 = row.clipped.length === 0;
  const R3 = row.outOfViewport.length === 0;
  const prose = row.prose ?? [];
  const R4 = prose.length === 0 ? "SKIP" : prose.every((item) => item.width >= 280 && item.width / item.fontSize >= 8);
  const R7 = row.a4 ? row.a4.scale >= 0.55 && row.a4.paperWidth >= 437 : "SKIP";
  // R5 只判 A–D 档（≥1092）：E 档只要求"能用"，工具条折行是允许的。
  const toolbars = row.toolbars ?? [];
  const R5 = row.width < 1092 || toolbars.length === 0 ? "SKIP" : toolbars.every((item) => item.lines === 1);
  const gridGaps = row.gridGaps ?? [];
  const R6 = gridGaps.length === 0 ? "SKIP" : gridGaps.every((item) => item.delta <= 4);
  // R8 只在大屏判：正文单行 ≤900（没有正文容器就算不判），或内容没有全挤在左边。
  const proseWide = (row.prose ?? []).some((item) => item.width > 900);
  const R8 =
    row.width < 1920 ? "SKIP" : !proseWide || (row.emptyRight ?? 0) <= 320;
  const note = R1
    ? ""
    : `doc=${row.docOverflow} main=${row.mainOverflow} 越界=${row.outOfViewport.join("|")}`;
  return {
    R1: R1 ? "PASS" : "FAIL",
    R2: R2 ? "PASS" : "FAIL",
    R3: R3 ? "PASS" : "FAIL",
    R4: R4 === "SKIP" ? "SKIP" : R4 ? "PASS" : "FAIL",
    R5: R5 === "SKIP" ? "SKIP" : R5 ? "PASS" : "FAIL",
    R6: R6 === "SKIP" ? "SKIP" : R6 ? "PASS" : "FAIL",
    R7: R7 === "SKIP" ? "SKIP" : R7 ? "PASS" : "FAIL",
    R8: R8 === "SKIP" ? "SKIP" : R8 ? "PASS" : "FAIL",
    note: R1
      ? ""
      : `${note}${
          R5 === false ? ` 工具栏折行=${toolbars.filter((t) => t.lines > 1).map((t) => t.selector).join("|")}` : ""
        }${R6 === false ? ` 间距极差=${gridGaps.filter((g) => g.delta > 4).map((g) => `${g.selector}:${g.delta}`).join("|")}` : ""}`,
  };
}

const failures = [];
console.log("视口            场景              R1   R2   R3   R4   R5   R6   R7   R8   备注");
for (const row of rows) {
  const verdict = judge(row);
  const line = [
    row.viewport.padEnd(15),
    row.scene.padEnd(17),
    verdict.R1.padEnd(4),
    verdict.R2.padEnd(4),
    verdict.R3.padEnd(4),
    verdict.R4.padEnd(4),
    verdict.R5.padEnd(4),
    verdict.R6.padEnd(4),
    verdict.R7.padEnd(4),
    verdict.R8.padEnd(4),
    verdict.note,
  ].join(" ");
  console.log(line);
  if (["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"].some((key) => verdict[key] === "FAIL")) {
    failures.push({ row, verdict });
  }
}

console.log("");
if (failures.length === 0) {
  console.log(`rubric: ${rows.length} 格全部通过（R1–R8；无数据的项为 SKIP，不等于 PASS）。`);
  process.exit(0);
}
console.log(`rubric: ${failures.length} 格不通过——按 §7.6 的归因表回对应任务：`);
for (const { row, verdict } of failures) {
  const failed = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8"]
    .filter((key) => verdict[key] === "FAIL")
    .join("/");
  console.log(`  ${row.viewport} ${row.scene}: ${failed} ${verdict.note}`);
}
process.exit(1);
