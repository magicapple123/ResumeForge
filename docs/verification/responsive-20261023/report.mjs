/**
 * 对照页生成（方案 §7.8）：把 metrics.json 变成一张能逐屏看的 HTML。
 *
 * 用法：node harness/report.mjs --metrics screenshots/after/metrics.json --out screenshots/after/report.html
 * 图片按 `<视口>/<场景>.png` 找；缺失就显示"未采集"，不静默跳过。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const HERE = dirname(fileURLToPath(import.meta.url));

/** 仓库根：向上找 pyproject.toml + frontend/package.json（与 capture.mjs 同一判据）。 */
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

const REPO_ROOT = findRepoRoot(HERE) ?? HERE;
/** 默认读 deliverables 下的实测指标；`--metrics` 可指向任意一份。 */
const DEFAULT_METRICS = join(
  REPO_ROOT,
  "deliverables",
  "software-company",
  "responsive-20261023",
  "screenshots",
  "after",
  "metrics.json",
);
const metricsPath = resolve(argOf("metrics", DEFAULT_METRICS));
const outPath = resolve(argOf("out", join(dirname(metricsPath), "report.html")));
const root = dirname(metricsPath);
const rows = JSON.parse(readFileSync(metricsPath, "utf8"));
// 改造前的截图在审计目录（AUDIT.md 的 screenshots/<视口>/<页面>.png）。给了就并排放，
// 没给就只出 after——**不静默假装有 before**。
const beforeRoot = argOf("before", "");
const beforeFile = (row, slug) => beforeRoot && existsSync(join(beforeRoot, String(row.width), `${slug}-viewport.png`));

const viewports = [...new Set(rows.map((row) => row.viewport))];
const scenes = [...new Set(rows.map((row) => row.scene))];

const cell = (row) => {
  if (!row) return `<td class="missing">未采集</td>`;
  const image = join(root, row.viewport, `${row.scene}.png`);
  const hasImage = existsSync(image);
  const flags = [];
  if (row.error) flags.push(`<b class="fail">ERROR</b> ${row.error}`);
  if (row.docOverflow > 1) flags.push(`<b class="fail">doc ${row.docOverflow}px</b>`);
  if (row.mainOverflow > 1) flags.push(`<b class="fail">main ${row.mainOverflow}px</b>`);
  if (row.clipped?.length) flags.push(`<b class="fail">裁切 ${row.clipped.length}</b>`);
  if (row.outOfViewport?.length) flags.push(`<b class="fail">越界 ${row.outOfViewport.length}</b>`);
  const a4 = row.a4 ? `<div class="meta">纸 ${row.a4.paperWidth}px · ${Math.round(row.a4.scale * 100)}%</div>` : "";
  const beforeSlug = row.scene.replace(/^P0?\d+-/, "");
  const beforeCell = beforeFile(row, beforeSlug)
    ? `<a href="${join(beforeRoot, String(row.width), `${beforeSlug}-viewport.png`)}" target="_blank"><img src="${join(beforeRoot, String(row.width), `${beforeSlug}-viewport.png`)}" loading="lazy" alt="before ${row.width}"></a>`
    : "";
  return `<td>${beforeCell ? `<div class="pair">${beforeCell}<div class="arrow">→</div>` : ""}
    <a href="${row.viewport}/${row.scene}.png" target="_blank">
      ${hasImage ? `<img src="${row.viewport}/${row.scene}.png" loading="lazy" alt="${row.viewport} ${row.scene}">` : "<span class=missing>无图</span>"}
    </a>
    ${a4}${flags.length ? `<div class="flags">${flags.join("<br>")}</div>` : ""}
    ${beforeCell ? "</div>" : ""}
  </td>`;
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>ResumeForge 多分辨率适配 · 对照页</title>
<style>
  body { margin: 24px; font: 14px/1.6 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #1f2d3d; }
  h1 { font-size: 20px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #e5e7eb; padding: 6px; vertical-align: top; text-align: center; }
  th { position: sticky; top: 0; background: #f6f8fb; z-index: 1; white-space: nowrap; }
  td img { display: block; width: 240px; height: auto; border: 1px solid #eef1f5; }
  .pair { display: flex; gap: 6px; align-items: center; justify-content: center; }
  .pair img { width: 150px; }
  .arrow { color: #98a2b3; font-size: 18px; }
  td.missing { color: #98a2b3; }
  .meta { color: #5f6b7a; font-size: 12px; }
  .flags { font-size: 12px; color: #b42318; }
  .fail { color: #b42318; }
  .legend { color: #5f6b7a; font-size: 13px; margin-bottom: 12px; }
  code { background: #f3f5f8; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
<h1>多分辨率适配 · after 截图对照</h1>
<p class="legend">来源：<code>${metricsPath}</code>。缩略图点击看原图。
红字是机器可判的失败项（R1/R2/R3）；<b>空着不代表通过</b>——R5/R6/R8 需要人工看。</p>
<table>
  <thead><tr><th>场景 \\ 视口</th>${viewports.map((viewport) => `<th>${viewport}</th>`).join("")}</tr></thead>
  <tbody>
    ${scenes
      .map(
        (scene) =>
          `<tr><th>${scene}</th>${viewports
            .map((viewport) => cell(rows.find((row) => row.scene === scene && row.viewport === viewport)))
            .join("")}</tr>`,
      )
      .join("\n")}
  </tbody>
</table>
</body>
</html>
`;

writeFileSync(outPath, html, "utf8");
console.log(`report → ${outPath}（${rows.length} 格）`);
