// SPDX-License-Identifier: Apache-2.0
/**
 * 存量中文扫描器：**纯函数 + 一次目录遍历**，不读基线、不写文件、没有副作用。
 *
 * 它只回答一个问题："现在还有多少处中文界面文案、多少条用中文做断言？" 把答案与
 * 基线比较、决定"只降不升"的是 `cjkRatchet.test.ts`；把扫描逻辑单独拿出来，是为了
 * 让守卫能用**构造出来的字符串**自测（否则守卫自己错了也没人知道）。
 *
 * ## 两个统计口径
 *
 * | 口径      | 扫描面                                                     | 计数规则                                     |
 * | ------- | ------------------------------------------------------- | ---------------------------------------- |
 * | `src`   | `src/**\/*.{ts,tsx}`，排除测试/快照/构建产物与两份"数据目录"        | 去注释后**含 CJK 的行数**（一行算 1），带有效豁免的行计 0        |
 * | `tests` | `src/**\/*.test.{ts,tsx}`、`src/**\/*.spec.{ts,tsx}`         | `(get\|find\|query)(All)?ByText(...)` 的参数里含 CJK 的**行数** |
 *
 * **为什么用"行数"而不是"字符数"**：行数是"还有多少处要改"的代理指标，也不受"有人把
 * 一句话改长"影响；字符数会因改标点抖动，守卫很快变成噪音。
 *
 * ## 排除项里为什么有 `src/demo/**` 与 `src/i18n/messages/**`
 *
 * 这两项与 `node_modules` / `dist` 的性质不同：它们是**内容**，不是"暂时不想管"。
 *
 * - `src/demo/**` 是**演示数据**（在线体验模式用的简历/岗位样本）。它必须是中文，因为
 *   它模拟的是用户的真实数据；把它计入棘轮等于要求"演示数据改成英文"。
 * - `src/i18n/messages/**` 是**迁移目的地**（语言包本体）。每新增一条正确的 `t()` 用法，
 *   就要在这里加一条中文——若把它计入棘轮，"做对了反而违规"，与规则的目地正好相反。
 *
 * 排除清单**只有这两项**，并由守卫用一条 `it()` 逐字钉住（照 `spinOutletGuard` 的
 * `ALLOWED_FILES` 先例）：想放宽范围，必须先把那条断言改掉——那是一次有意识的动作。
 *
 * ## 已知局限（只写在这里，不改逻辑）
 *
 * `stripComments` 是逐字符状态机，**不解析 `${…}` 插值**：模板串 `${…}` 里再嵌一个
 * 反引号（如 `` `a${x ? `b` : ""}c` ``）会被当成模板串的收尾，于是后面一段真实代码
 * 被当作字符串/注释处理。后果是**多算**（把注释里的中文算成界面文案）而不是少算——
 * 也就是守卫偏严、可能误报，但绝不会漏掉新写的中文。本库当前没有这种写法，所以没有
 * 为它引入一个真正的 JS 词法器；真的遇到了，按"改断言/加 `// i18n-ok:` 理由"处理。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但本文件只在 Node（vitest）里跑。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { join, relative, sep } from "node:path";

/**
 * CJK 判据：与 `components/analytics/barLabelLayout.ts` 的"宽字符"口径**逐字相同**
 * （汉字 + 兼容区 + 全角形式 + CJK 标点）。
 *
 * 复用同一个字符类而不是另写一份：两处判定必须一致，否则会出现"宽度计算认为是中文、
 * 棘轮认为不是"这种谁也说不清的分歧。
 */
const CJK_PATTERN = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/;

/** 匹配 `screen.getByText("保存")` 这一族查询。 */
const BY_TEXT_CALL = /(get|find|query)(All)?ByText\s*\(/;

/**
 * 不扫的目录名。`dist` / `coverage` 是构建产物，`node_modules` 不用解释。
 *
 * 注意这里**没有** `__snapshots__`：快照目录里不会有 `.ts/.tsx` 源码，加了也只是噪音。
 */
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage"]);

/**
 * 排除的**目录前缀**（相对 `src/`，以 `/` 结尾）。见文件头："内容目录"而非"构建产物"。
 *
 * 守卫会断言这个集合**正好**是下面两项，防止有人顺手多排除一个目录（那等于悄悄放宽规则）。
 */
export const EXCLUDED_DIRECTORY_PREFIXES: readonly string[] = ["demo/", "i18n/messages/"];

/** 豁免标记。冒号后**必须**写理由，空理由视为没有豁免。 */
export const EXEMPTION_MARKER = "i18n-ok:";

/** 一个口径的扫描结果。路径相对 `src/`、以 `/` 分隔。 */
export interface ScanResult {
  /** 全部文件的行数合计。 */
  total: number;
  /** 逐文件行数（0 也算一条：这样"新增文件里写中文"会被逐文件比较直接抓到）。 */
  files: Record<string, number>;
}

/** 扫描口径。 */
export type ScanMode = "src" | "tests";

/**
 * 去掉注释：**逐字符状态机**（字符串 / 模板串 / 行注释 / 块注释四态）。
 *
 * 之前这里是两条正则（块注释一条、行注释一条），靠"最近的块注释收尾符"配对。那在一种
 * 真实写法上会把**代码整段吞掉**：块注释之后出现含块注释起始符的 MIME 字符串时——
 * 先例是 `const mime = file.type || "image/<星号>"`（星号是半角），紧接着后面还有一处
 * JSX 注释的收尾符，两者一配，中间几十行真实代码连同其中的中文全部消失。
 * `components/materials/MaterialFormModal.tsx` 就是这个形状（ISSUES ③-1）。
 * 正则没法区分"字符串里的起始符"与"真的注释开头"，所以改为按**引号状态**走。
 *
 * 两条不变量（`countCjkLines` 依赖它们）：
 * 1. **行数不变**：块注释替换成等量换行（不是删掉），`split("\n")` 的下标仍与原文行号
 *    一一对应——这是"豁免看原文、CJK 看去注释后"两条规则能同时成立的前提。
 * 2. **单行字符串不跨行**：`"` / `'` 到行尾还没闭合就当普通字符（JSX 文本里出现的撇号
 *    `don't` 不该把后面几行拖进"字符串"状态）；模板串允许跨行。
 *
 * 已知局限：模板串 `${…}` 里再嵌 `` ` `` 会提前收尾。这种写法在本库不存在，且它只会
 * 造成"少剥一段注释"（多算而不是少算），不会掩盖新中文。
 */
export function stripComments(source: string): string {
  const out: string[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        // 块注释整体消失，但每个换行都要留下：行号必须与原文件一一对应。
        if (source[index] === "\n") out.push("\n");
        index += 1;
      }
      index = Math.min(index + 2, source.length);
      continue;
    }
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && regexCanStartAfter(source, index)) {
      // 正则字面量原样拷贝：里面的引号与反引号不是字符串开头（否则会把后面几十行拖进
      // "字符串"状态，连带把真实注释里的中文算成代码——实测踩过一次）。
      const end = closingRegexIndex(source, index);
      if (end !== null) {
        out.push(source.slice(index, end + 1));
        index = end + 1;
        continue;
      }
    }
    if (char === '"' || char === "'" || char === "`") {
      const end = closingQuoteIndex(source, index, char);
      if (end !== null) {
        out.push(source.slice(index, end + 1));
        index = end + 1;
        continue;
      }
    }
    out.push(char);
    index += 1;
  }
  return out.join("");
}

/** `/` 前面出现这些字符时，它是正则开头而不是除号。 */
const REGEX_PRECEDING_CHARS = new Set("(,=:[!&|?{};+-*%~^<>".split(""));

/** `/` 前面出现这些关键字时，它也可能是正则开头（`return /re/`）。 */
const REGEX_PRECEDING_WORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/** 第 `slash` 个字符处的 `/` 是不是正则字面量的开头。 */
function regexCanStartAfter(source: string, slash: number): boolean {
  let index = slash - 1;
  while (index >= 0 && /\s/.test(source[index])) index -= 1;
  if (index < 0) return true;
  if (REGEX_PRECEDING_CHARS.has(source[index])) return true;
  const word = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(source.slice(Math.max(0, index - 11), index + 1));
  return word !== null && REGEX_PRECEDING_WORDS.has(word[0]);
}

/** 从 `start`（`/` 本身）起找正则的收尾 `/`；不吃字符类里的 `/`，跨行则判为判错。 */
function closingRegexIndex(source: string, start: number): number | null {
  let inClass = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "\n") return null;
    if (char === "[") inClass = true;
    else if (char === "]") inClass = false;
    else if (char === "/" && !inClass) return index;
  }
  return null;
}

/** 从 `start`（引号本身）起找配对的收尾引号；单行字符串没闭合时返回 `null`。 */
function closingQuoteIndex(source: string, start: number, quote: string): number | null {
  const allowNewline = quote === "`";
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "\n" && !allowNewline) return null;
    if (char === quote) return index;
  }
  return null;
}

/**
 * 这一行有没有**有效**的豁免标记。
 *
 * 三条约束（都是"防止豁免变成后门"）：
 * 1. **必须在注释里**：标记要被 `stripComments` 吃掉才算数。否则
 *    `const s = "i18n-ok: x"` 这种字符串也能豁免，等于把规则交给一个字面量。
 * 2. **必须写理由**：`// i18n-ok:` 后面空了就没有豁免——否则一个 `// i18n-ok:`
 *    可以无声地放过整行。
 * 3. 不提供文件级开关，也不提供白名单文件（见 `EXCLUDED_DIRECTORY_PREFIXES` 的说明）。
 */
export function hasExemption(line: string): boolean {
  const index = line.indexOf(EXEMPTION_MARKER);
  if (index < 0) return false;
  // 标记必须**被注释吃掉**：它在去注释后的同一行里不再出现，才说明它真的写在注释里。
  // 这个判据比"标记前面有 `//`"可靠得多——`const u = "http://…"; i18n-ok: x` 这种
  // 字符串里带 `//` 的行会把后者误判成注释。
  if (stripComments(line).includes(EXEMPTION_MARKER)) return false;
  return line.slice(index + EXEMPTION_MARKER.length).trim().length > 0;
}

/**
 * 这一行是否被豁免：标记在**本行行尾**，或在**上一行**单独成行。
 *
 * 只允许这两种位置。允许"往下第 N 行"或"整块注释"会把豁免变成区域开关，
 * 而区域开关一旦存在，新增的中文只要落在区域内就自动合法——那正是本守卫要防的事。
 */
export function isExempt(line: string, previousLine?: string): boolean {
  if (hasExemption(line)) return true;
  return previousLine === undefined ? false : hasExemption(previousLine);
}

/**
 * 统计"去注释后含 CJK 的行数"，带有效豁免的行计 0。
 *
 * 豁免看**原文**：`// i18n-ok:` 本身是注释，去注释后就不存在了，所以必须回到原文那一行
 * 去认标记。
 */
export function countCjkLines(text: string): number {
  const rawLines = text.split("\n");
  const strippedLines = stripComments(text).split("\n");
  let count = 0;
  for (let index = 0; index < strippedLines.length; index += 1) {
    if (!CJK_PATTERN.test(strippedLines[index])) continue;
    if (isExempt(rawLines[index] ?? "", rawLines[index - 1])) continue;
    count += 1;
  }
  return count;
}

/**
 * 统计 `*ByText(...)` 断言里含 CJK 的**行数**。
 *
 * 两步走（两种写法都要能抓到）：
 * 1. **逐行**：调用与中文在同一行（`screen.getByText("保存")`），最常见的写法；
 * 2. **括号平衡回退**：调用与参数跨行书写——
 *    ```ts
 *    screen.getByText(
 *      "保存",
 *    );
 *    ```
 *    这时只做逐行正则永远命中不了，而跨行恰恰是"想躲过守卫"最省事的写法。
 *
 * 去注释后判定：注释里举例的 `// 比如 getByText("保存")` 不算断言，不该被计。
 * 豁免与 `src` 口径同一套（`// i18n-ok: 理由`）。
 */
export function countCjkAssertions(text: string): number {
  const rawLines = text.split("\n");
  const stripped = stripComments(text);
  const lines = stripped.split("\n");
  let count = 0;
  /** 上一行扫描到的字符位置：跨行调用只从"调用起点"往前推，避免重复计数。 */
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(BY_TEXT_CALL);
    if (!match || match.index === undefined) {
      cursor += line.length + 1;
      continue;
    }
    const start = cursor + match.index;
    const args = readCallArguments(stripped, start + match[0].length - 1);
    cursor += line.length + 1;
    if (!CJK_PATTERN.test(args)) continue;
    if (isExempt(rawLines[index] ?? "", rawLines[index - 1])) continue;
    count += 1;
  }
  return count;
}

/**
 * 从 `openParen`（一个 `(` 的下标）起读参数，返回括号内原文。
 *
 * 括号不平衡（代码被截断、或正则误命中字符串里的字样）时返回从起点到文末的片段——
 * 宁可多算一行让人看一眼，也不要静默漏算。
 */
function readCallArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, index);
    }
  }
  return source.slice(openParen + 1);
}

/** 相对 `src/` 的路径（`/` 分隔），用于基线里的键。 */
function toKey(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

/** 是否是测试文件（`*.test.ts(x)` / `*.spec.ts(x)`）。 */
function isTestFile(name: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(name);
}

/** 是否落在 `src/test/**` 或排除的"内容目录"里。 */
function isExcludedPath(key: string): boolean {
  if (key.startsWith("test/")) return true;
  return EXCLUDED_DIRECTORY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * 递归收集待扫描文件（绝对路径）。
 *
 * `mode === "src"` 取非测试源码，`mode === "tests"` 只取测试文件；两种口径共用同一份
 * 目录跳过规则与排除前缀——两份遍历迟早会漂，比如一边漏了 `coverage`。
 */
export function collectSourceFiles(root: string, mode: ScanMode = "src"): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(absolute);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (isExcludedPath(toKey(root, absolute))) continue;
      const test = isTestFile(entry.name);
      if (mode === "src" ? test : !test) continue;
      found.push(absolute);
    }
  };
  walk(root);
  return found;
}

/**
 * 扫一棵树，返回 `{ total, files }`。
 *
 * `files` **包含 0 条的文件**：逐文件比较时"新增一个文件、里面写了中文"会以
 * `current.files[f] <= baseline.files[f] ?? 0` 直接失败——若只记非零文件，这个新增
 * 文件在基线里没有条目、在当次结果里也没有，就永远抓不到。
 */
export function scanTree(root: string, mode: ScanMode = "src"): ScanResult {
  const files: Record<string, number> = {};
  let total = 0;
  for (const absolute of collectSourceFiles(root, mode)) {
    const text = readFileSync(absolute, "utf8");
    const count = mode === "src" ? countCjkLines(text) : countCjkAssertions(text);
    files[toKey(root, absolute)] = count;
    total += count;
  }
  // 键序固定：基线是进仓库的生成物，顺序抖动会让每次生成的 diff 都是整文件重写。
  return { total, files: sortKeys(files) };
}

/** 按 `files` 的键排序（同时用于生成基线与读取基线，保证两边可比）。 */
export function sortKeys(files: Record<string, number>): Record<string, number> {
  const sorted: Record<string, number> = {};
  for (const key of Object.keys(files).sort()) sorted[key] = files[key];
  return sorted;
}
