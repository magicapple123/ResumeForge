// SPDX-License-Identifier: Apache-2.0
/**
 * 存量中文棘轮守卫：**只降不升**。
 *
 * AST identifies product copy independently of its language. Legacy CJK ceilings
 * remain in force while fingerprint budgets reject new English or Chinese copy.
 *
 * ## 为什么是"行数"和"逐文件"两个口径
 *
 * 只看总量会漏掉「A 文件删 3 行、B 文件加 3 行」——表面上达标，实质上还在往里写中文。
 * 所以除总量之外，**每个文件**也各自与基线比较：新增文件里写中文会因为"基线里没有它"
 * 而直接失败。
 *
 * ## 收紧基线
 *
 * 基线只在上限方向起作用，"下降了但没更新基线"不会失败（下降本来就允许）。想把基线
 * 收紧到当前实际值，用生成模式：
 *
 * ```powershell
 * cd D:\ResumeForge\frontend
 * $env:CJK_BASELINE_WRITE = "1"
 * npx vitest run src/i18n/cjkRatchet
 * Remove-Item Env:CJK_BASELINE_WRITE
 * ```
 *
 * Maintenance validates every ceiling and fingerprint before writing. It cannot
 * register new copy or skip the normal guard assertions. Initial AST capture is
 * explicit and only available when the AST baseline does not exist yet.
 *
 * ## 豁免
 *
 * Legacy CJK counters retain historical inline markers for compatibility.
 * The product-copy AST ignores those markers; they cannot authorize new copy.
 * Technical strings are classified by their syntax and consumption sites.
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { existsSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, resolve } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countBudgetProblems,
  tightenBaseline,
  type I18nBaseline,
} from "./guards/baselineMaintenance";
import { scanProductCopy } from "./guards/productCopyAst";
import {
  diffProductCopyBudget,
  fingerprintFindings,
  type ProductCopyBudget,
} from "./guards/productCopyBaseline";
import { collectInventoryFiles, validateSourceInventory } from "./guards/sourceInventory";
import {
  collectSourceFiles,
  countCjkAssertions,
  countCjkLines,
  EXCLUDED_DIRECTORY_PREFIXES,
  hasExemption,
  isExempt,
  scanTree,
  stripComments,
  type ScanResult,
} from "./cjkScan";

// `@types/node` 没装：只声明本文件用到的那一小块，比装一整套类型便宜。
declare const process: { env: Record<string, string | undefined> };

/** 本文件在 `src/i18n/` 下，上一层就是 `src/`。 */
const I18N_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(I18N_DIR, "..");
const BASELINE_FILE = join(I18N_DIR, "i18nBaseline.json");

/**
 * 「保存」的转义写法。
 *
 * 自测夹具**不能**被自己的口径计中：`screen.getByText("保存")` 出现在本文件里，会让
 * 本文件在 tests 口径里凭空多一条"违规"。用 `\u` 转义写出来，运行时仍是同一个字符，
 * 静态扫描看不到 CJK——守卫不该给自己加噪声，否则以后每次收紧基线都要为它解释一遍。
 */
const SAVE = "\u4fdd\u5b58";

function readBaseline(): I18nBaseline | null {
  if (!existsSync(BASELINE_FILE)) return null;
  return JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as I18nBaseline;
}

const sourceFiles = collectSourceFiles(SRC_ROOT);
const relativeKey = (absolute: string) =>
  absolute.replace(/\\/g, "/").slice(SRC_ROOT.replace(/\\/g, "/").length + 1);
const productFiles = Object.fromEntries(
  sourceFiles.map((absolute) => [
    relativeKey(absolute),
    fingerprintFindings(scanProductCopy(readFileSync(absolute, "utf8"), absolute)),
  ]),
);
const currentProductCopy: ProductCopyBudget = {
  total: Object.values(productFiles).reduce((sum, file) => sum + file.count, 0),
  files: productFiles,
};

/**
 * 当前值与基线的差异（空数组 = 达标）。
 *
 * **只遍历当前文件**：基线里有、现在消失了的文件天然不会被比较——删文件是下降，
 * 不是违规。反过来（当前有、基线里没有）按 `?? 0` 处理，于是"新增文件里写了中文"
 * 一定会被抓住。
 */
function diffAgainstBaseline(current: ScanResult, baseline: ScanResult): string[] {
  const problems: string[] = [];
  if (current.total > baseline.total) {
    problems.push(
      `总量 ${baseline.total} → ${current.total}（+${current.total - baseline.total}）`,
    );
  }
  for (const [file, count] of Object.entries(current.files)) {
    const allowed = baseline.files[file] ?? 0;
    if (count > allowed) problems.push(`${file}：${allowed} → ${count}（+${count - allowed}）`);
  }
  return problems;
}

/** 生成模式开关。只在人手动 `CJK_BASELINE_WRITE=1` 时打开，CI 里永远为假。 */
const WRITE_MODE = process.env.CJK_BASELINE_WRITE === "1";

// ===== 自测：夹具不依赖仓库现状，守卫本身错了必须能被看到 =====

describe("扫描器自测（不读仓库）", () => {
  it("去注释后含 CJK 的代码行计 1，纯注释行计 0", () => {
    expect(countCjkLines('const a = "\u4f60\u597d";')).toBe(1);
    expect(countCjkLines("// \u8fd9\u91cc\u89e3\u91ca\u5386\u53f2")).toBe(0);
    expect(countCjkLines('const a = "ok"; // \u6ce8\u91ca\u91cc\u7684\u4e2d\u6587')).toBe(0);
  });

  it("块注释里的中文不计；去注释保留行数，不会把两行拼成一行", () => {
    const source = ["/*", "  \u8fd9\u662f\u5757\u6ce8\u91ca", "*/", 'const a = "ok";'].join("\n");
    expect(stripComments(source).split("\n")).toHaveLength(4);
    expect(countCjkLines(source)).toBe(0);
  });

  it("字符串字面量里的 `/*` 不是块注释开头，后面的代码不许被吞掉", () => {
    // 真实案例见 ISSUES ③-1：`MaterialFormModal.tsx` 的 `"image/*"` 之后还有一处 JSX
    // 注释 `{/* … */}`，旧实现（"最近的 `*/`"）于是把两者之间的真实代码整段当注释吃掉，
    // 那一片中文全部漏统计。
    const source = [
      'const mime = "image/*";',
      'const label = "\u4f60\u597d";',
      "{/* \u5757\u6ce8\u91ca */}",
    ].join("\n");
    expect(countCjkLines(source)).toBe(1);
    // 行号必须仍然一一对应：多行块注释是换成等量换行、不是删掉。
    expect(stripComments(source).split("\n")).toHaveLength(3);
  });

  it("注释在前、含 `/*` 的字符串在后，同样不许吞掉后续代码", () => {
    const source = [
      "/* \u6ce8\u91ca */",
      'const mime = "image/*";',
      'const label = "\u4f60\u597d";',
      "/* \u53c8\u4e00\u5757 */",
    ].join("\n");
    expect(countCjkLines(source)).toBe(1);
  });

  it("模板串与正则里的引号不会让注释判定错位", () => {
    const template = ['const tpl = `a${"}"}b`;', 'const label = "\u4f60\u597d";'].join("\n");
    expect(countCjkLines(template)).toBe(1);
    // 正则字面量里的引号/斜杠不是字符串也不是注释。
    const regex = ["const re = /a\\/\\/b/;", 'const label = "\u4f60\u597d";'].join("\n");
    expect(countCjkLines(regex)).toBe(1);
  });

  it("有效豁免（行尾或上一行，且写了理由）计 0", () => {
    expect(countCjkLines('const a = "\u4f60\u597d"; // i18n-ok: \u5b58\u91cf\u6587\u6848')).toBe(0);
    const withPreviousLine = [
      "// i18n-ok: \u5b58\u91cf\u6587\u6848\uff0c\u4e0b\u4e00\u6b65\u8fc1 t()",
      'const a = "\u4f60\u597d";',
    ].join("\n");
    expect(countCjkLines(withPreviousLine)).toBe(0);
  });

  it("空理由、或标记不在注释里，都不算豁免（仍计 1）", () => {
    expect(hasExemption("// i18n-ok:")).toBe(false);
    expect(countCjkLines('const a = "\u4f60\u597d"; // i18n-ok:')).toBe(1);
    // 标记必须真的在注释里：字符串字面量里的 "i18n-ok: x" 不能拿来豁免。
    expect(hasExemption('const note = "i18n-ok: fake";')).toBe(false);
    expect(countCjkLines('const a = "\u4f60\u597d"; const note = "i18n-ok: fake";')).toBe(1);
    // 字符串里带 `//`（网址）也不等于注释：这种行同样不能拿来豁免。
    expect(hasExemption('const u = "http://x"; i18n-ok: 理由')).toBe(false);
    expect(isExempt('const a = "\u4f60\u597d";', undefined)).toBe(false);
  });

  it("ByText 家族：参数里含 CJK 的计 1，用 t() 的不计", () => {
    expect(countCjkAssertions(`screen.getByText("${SAVE}")`)).toBe(1);
    expect(countCjkAssertions('screen.getByText(t("save"))')).toBe(0);
    expect(countCjkAssertions("screen.findByText(dynamicLabel)")).toBe(0);
    expect(countCjkAssertions("screen.queryAllByText(/\\d+/)")).toBe(0);
  });

  it("跨行书写的 ByText 也要抓到（逐行正则命不中，靠括号平衡回退）", () => {
    const multiline = ["screen.getByText(", `  "${SAVE}",`, ");"].join("\n");
    expect(countCjkAssertions(multiline)).toBe(1);
  });
});

describe("排除清单就是 demo 与语言包", () => {
  it("排除的目录前缀正好两项，多一项都要先改这条断言", () => {
    // 与 `spinOutletGuard` 的 `ALLOWED_FILES` 同一套做法：把"放宽范围"变成一次
    // 必须显式修改断言的动作，避免有人顺手多排除一个目录（那等于悄悄放宽规则）。
    expect(EXCLUDED_DIRECTORY_PREFIXES).toEqual(["demo/", "i18n/messages/"]);
  });

  it("扫描结果里确实没有 demo 与语言包，也没有测试文件", () => {
    const keys = collectSourceFiles(SRC_ROOT).map((absolute) =>
      absolute.replace(/\\/g, "/").slice(SRC_ROOT.replace(/\\/g, "/").length + 1),
    );
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => key.startsWith("demo/"))).toEqual([]);
    expect(keys.filter((key) => key.startsWith("i18n/messages/"))).toEqual([]);
    expect(keys.filter((key) => /\.(test|spec)\.tsx?$/.test(key))).toEqual([]);
  });
});

// Maintenance runs before, and never disables, the ordinary guard assertions.

describe.skipIf(!WRITE_MODE)("生成基线（CJK_BASELINE_WRITE=1）", () => {
  it("写入 i18nBaseline.json 并打印新旧差", () => {
    const previous = readBaseline();
    if (!previous) throw new Error("Legacy baseline is required");
    const inventoryProblems = validateSourceInventory(
      sourceFiles.map(relativeKey),
      Object.keys(previous.src.files),
    );
    expect(inventoryProblems).toEqual([]);
    expect(collectInventoryFiles(SRC_ROOT)).toEqual(sourceFiles.map(relativeKey).sort());
    const next = tightenBaseline(
      previous,
      scanTree(SRC_ROOT, "src"),
      scanTree(SRC_ROOT, "tests"),
      currentProductCopy,
      process.env.I18N_AST_BASELINE_INIT === "1",
    );
    writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`, "utf8");

    const before = `src ${previous?.src.total ?? "（无基线）"} / tests ${previous?.tests.total ?? "（无基线）"}`;
    const after = `src ${next.src.total} / tests ${next.tests.total}`;
    console.log(`[cjkRatchet] ${before} → ${after}`);
    console.log(
      `[cjkRatchet] 文件条目：src ${Object.keys(next.src.files).length} / tests ${Object.keys(next.tests.files).length}`,
    );

    // 写出去的东西必须是可读回来的：格式坏了等于基线丢了。
    const written = readBaseline();
    expect(written?.src.total).toBe(next.src.total);
    expect(written?.tests.total).toBe(next.tests.total);
  });
});

// ===== 三条断言：只降不升 =====

describe("棘轮：存量中文只许下降", () => {
  it("requires the tracked baseline; maintenance cannot recreate a missing baseline", () => {
    const baseline = readBaseline();
    expect(
      baseline,
      "Missing src/i18n/i18nBaseline.json. Restore the tracked baseline before running maintenance.",
    ).not.toBeNull();
  });

  it("src 的含 CJK 行数不超过基线", () => {
    const baseline = readBaseline();
    if (!baseline) throw new Error("基线缺失");
    const current = scanTree(SRC_ROOT, "src");
    expect(countBudgetProblems(current, baseline.src)).toEqual([]);
    const problems = diffAgainstBaseline(current, baseline.src);
    expect(
      problems,
      "存量中文只能下降，新增的中文界面文案要进语言包：frontend/src/i18n/messages/zh-CN.<命名空间>.ts" +
        '（同批加 en-US.*，占位符保持一致），组件里用 t("<ns>.<key>") 取。' +
        '只有「永远不该翻」的三类才用 // i18n-ok: 理由 —— 协议值、includes("中文") 匹配后端文案、喂给模型的 prompt。' +
        `（当前 ${current.total} / 基线 ${baseline.src.total}）`,
    ).toEqual([]);
  });

  it("has a complete source inventory and no new product copy in either language", () => {
    const baseline = readBaseline();
    if (!baseline?.productCopy) throw new Error("AST product-copy baseline is required");
    expect(
      validateSourceInventory(sourceFiles.map(relativeKey), Object.keys(baseline.src.files)),
    ).toEqual([]);
    expect(collectInventoryFiles(SRC_ROOT).sort()).toEqual(sourceFiles.map(relativeKey).sort());
    expect(diffProductCopyBudget(currentProductCopy, baseline.productCopy)).toEqual([]);
  });

  it("tests 的中文 ByText 断言行数不超过基线", () => {
    const baseline = readBaseline();
    if (!baseline) throw new Error("基线缺失");
    const current = scanTree(SRC_ROOT, "tests");
    expect(countBudgetProblems(current, baseline.tests)).toEqual([]);
    const problems = diffAgainstBaseline(current, baseline.tests);
    expect(
      problems,
      '测试里的断言文案也属于「将来要迁移」的中文：新增用例请用 `t("...")` 或 role/label 定位。' +
        `（当前 ${current.total} / 基线 ${baseline.tests.total}）`,
    ).toEqual([]);
  });
});

// ===== 比较逻辑自测：三条断言的边界条件（不依赖仓库内容） =====

describe("基线比较的边界", () => {
  it("基线里有、当前已消失的文件不报错（删文件是下降，不是违规）", () => {
    const baseline: ScanResult = { total: 5, files: { "a.ts": 3, "gone.ts": 2 } };
    const current: ScanResult = { total: 3, files: { "a.ts": 3 } };
    expect(diffAgainstBaseline(current, baseline)).toEqual([]);
  });

  it("逐文件比较抓到「A 减 3、B 加 3」这种表面达标", () => {
    const baseline: ScanResult = { total: 6, files: { "a.ts": 3, "b.ts": 3 } };
    const current: ScanResult = { total: 6, files: { "a.ts": 0, "b.ts": 6 } };
    expect(diffAgainstBaseline(current, baseline)).toEqual(["b.ts：3 → 6（+3）"]);
  });

  it("新增文件里写中文（基线里没有它）直接算违规", () => {
    const baseline: ScanResult = { total: 1, files: { "a.ts": 1 } };
    const current: ScanResult = { total: 3, files: { "a.ts": 1, "new.ts": 2 } };
    expect(diffAgainstBaseline(current, baseline)).toEqual([
      "总量 1 → 3（+2）",
      "new.ts：0 → 2（+2）",
    ]);
  });
});

/**
 * 只读报告：打印当前总量与最大的 20 个文件。
 *
 * 用途是给**迁移批次收尾**用——把 baseline 的数字对准真实值，而不是靠猜。
 * 只在 `CJK_BASELINE_WRITE=1` 时执行；不写文件，所以不受"不能登记新文案"的限制。
 * 用法：`CJK_BASELINE_WRITE=1 npx vitest run src/i18n/cjkRatchet -t 打印`
 */
it("打印当前中文计数（只读，不写文件）", () => {
  if (!WRITE_MODE) return;
  const current = scanTree(SRC_ROOT, "src");
  // eslint-disable-next-line no-console
  console.log(`[i18n] total=${current.total}`);
  const rows = Object.entries(current.files)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 400);
  for (const [file, count] of rows) {
    // eslint-disable-next-line no-console
    console.log(`[i18n] ${count}	${file}`);
  }
});
