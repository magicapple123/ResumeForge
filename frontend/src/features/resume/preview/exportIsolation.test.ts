// SPDX-License-Identifier: Apache-2.0
/**
 * D05 的**产物隔离**结构断言：
 *
 * 1. 专业视图模块不得 import 任何 API / 导出 / 渲染接口——覆盖层没有"请求服务端"的通道；
 * 2. 覆盖层只存在于 iframe 的临时文档里，模块里不得写 `srcDoc`（纸面 HTML 由后端给）；
 * 3. 后端模板里不得出现任何 proview 标记——正式产物由后端模板渲染，这里直接扫模板源。
 *
 * 第 3 条是"辅助层绝不进入正式导出"的后端侧证据：前端不写模板，后端模板没有这些标记，
 * 导出（HTML/PDF/Word）自然不含辅助层。将来若有人把辅助线画进后端模板，这条会先红。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { existsSync, readFileSync, readdirSync } from "node:fs";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { basename, dirname, join, resolve } from "node:path";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
/**
 * 三个来源（proview 特性层、proview 组件层、photo-crop 组件层）在 B3 目录合并后都落在本目录，
 * 扫描面就是 HERE。
 */
const SCAN_DIRS = [HERE];

interface SourceFile {
  path: string;
  content: string;
}

function collectSources(dir: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
    files.push({ path: full, content: readFileSync(full, "utf8") });
  }
  return files;
}

/**
 * 合并目录口径：本目录同时收了画布侧（resume-preview 出身）与详情侧（resume 根部出身）文件，
 * 而本守卫的对象是 **proview 覆盖层**（不请求服务端、
 * 不写 srcDoc、不进导出）。这些文件不在此列：
 * - `previewPagesApi.ts` / `ResumeDetailPreview.tsx`：画布/详情取数，正常 import `api/client`；
 * - `ResumePreviewCanvas.tsx`：往 iframe 注入草稿 HTML（srcDoc），那是画布职责；
 * - `AtsCheckPanel.tsx` / `ResumeRiskPanel.tsx` / `ResumeSuggestionsModal.tsx`：B4 从
 *   `components/` 根目录并入的详情页检测 / 风险 / 建议块，本身就要请求服务端，属详情侧，
 *   不是覆盖层。
 * 覆盖层文件（previewOverlays / useProviewOverlaySync / ProviewLayer / ProviewBar 等）仍全量扫描。
 */
const NON_OVERLAY_FILES = new Set([
  "previewPagesApi.ts",
  "ResumeDetailPreview.tsx",
  "ResumePreviewCanvas.tsx",
  "AtsCheckPanel.tsx",
  "ResumeRiskPanel.tsx",
  "ResumeSuggestionsModal.tsx",
]);

const SOURCES = SCAN_DIRS.flatMap(collectSources).filter(
  (file) => !NON_OVERLAY_FILES.has(basename(file.path)),
);

describe("D05 辅助层不进入导出（结构证据）", () => {
  it("扫描到了专业视图的实现文件（防止目录写错导致空扫描假绿）", () => {
    expect(SOURCES.length).toBeGreaterThan(20);
    expect(SOURCES.some((file) => file.path.endsWith("previewOverlays.ts"))).toBe(true);
    expect(SOURCES.some((file) => file.path.endsWith("ProviewLayer.tsx"))).toBe(true);
  });

  it("不 import 任何 API / 渲染 / 导出接口（覆盖层没有服务端通道）", () => {
    const forbidden = [
      /from ".*\/api\//,
      /renderResume\s*\(/,
      /fetchResumePreviewPdf/,
      /exportResume\s*\(/,
      /from "axios"/,
      /\bfetch\s*\(/,
    ];
    const violations = SOURCES.flatMap((file) =>
      forbidden
        .filter((pattern) => pattern.test(file.content))
        .map((pattern) => file.path + " :: " + String(pattern)),
    );
    expect(violations).toEqual([]);
  });

  it("不写 srcDoc（纸面 HTML 是后端产物，前端只做覆盖层）", () => {
    const violations = SOURCES.filter((file) => /srcDoc\s*=/.test(file.content)).map(
      (file) => file.path,
    );
    expect(violations).toEqual([]);
  });

  it("后端简历模板里没有任何 proview 标记（产物侧证据）", () => {
    const templatesDir = resolve(REPO_ROOT, "backend/app/templates");
    expect(existsSync(templatesDir)).toBe(true);
    const templates = readdirSync(templatesDir).filter((name: string) => name.endsWith(".j2"));
    expect(templates.length).toBeGreaterThan(0);
    const violations = templates.flatMap((name: string) => {
      const content = readFileSync(join(templatesDir, name), "utf8");
      return /proview|data-proview|resume-proview-guide/i.test(content) ? [name] : [];
    });
    expect(violations).toEqual([]);
  });
});
