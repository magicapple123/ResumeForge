// SPDX-License-Identifier: Apache-2.0
/**
 * JD 两版文本的**逐行对齐**（#15B）。纯函数、零依赖。
 *
 * 为什么自己写而不引 diff 库：需求只有"左右两栏 + 新增绿底 / 删除红底"，而 LCS 的行级实现
 * 不到 60 行；新增一个包要跟着升级、过许可证审查、还会让 `npm audit` 多一条要盯的线。
 *
 * 输出是**成对的行**（`rows`），而不是两份独立列表：左右各排一栏时，两栏必须逐行对齐，
 * 否则用户看到的是"左边第 8 行 vs 右边第 3 行"，比不看还糟。
 *
 * 一次"删除 + 新增"紧挨着时按索引**配对成一行**（左红右绿）：JD 里最常见的变更就是
 * 一句改写成另一句，不配对会让 diff 高度翻倍、同一处改动要上下各看一次。
 */

/** 未变更的行。 */
type SameOp = { type: "same"; text: string };
/** 旧版独有的行。 */
type RemovedOp = { type: "removed"; text: string };
/** 新版独有的行。 */
type AddedOp = { type: "added"; text: string };
type DiffOp = SameOp | RemovedOp | AddedOp;

/** 一个格子：`kind` 决定底色（`same` 不上色）。 */
export interface JdDiffCell {
  text: string;
  kind: "same" | "added" | "removed";
}

/**
 * 一行对比：`left` = 上次采集、`right` = 本次采集。
 * 一侧为 `null` 表示这一行只存在于另一侧（渲染成空槽，保住两栏的行对齐）。
 */
export interface JdDiffRow {
  /** 稳定 key：左右两侧在原始文本里的行号拼起来，重复行也不会串。 */
  key: string;
  left: JdDiffCell | null;
  right: JdDiffCell | null;
}

/** LCS 表的规模上限：JD 通常 30–200 行，O(n·m) 完全够用；超了就不配对，只做整段增删。 */
const MAX_LCS_CELLS = 250_000;

/** 按行切分：统一 `\r\n` / `\r`，丢掉末尾那个空行（文本以换行结尾是常态，不是一行空白）。 */
function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 行级 LCS → 编辑序列（`same` / `removed` / `added`，顺序即原文顺序）。 */
function diffOps(before: readonly string[], after: readonly string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  if (n * m > MAX_LCS_CELLS) {
    // 超长文本（几千行）：逐行配对没有意义，直接整段"旧的全删、新的全增"。
    return [
      ...before.map<DiffOp>((text) => ({ type: "removed", text })),
      ...after.map<DiffOp>((text) => ({ type: "added", text })),
    ];
  }
  // `table[i][j]` = before[i..] 与 after[j..] 的 LCS 长度。
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ type: "same", text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "removed", text: before[i] });
      i += 1;
    } else {
      ops.push({ type: "added", text: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "removed", text: before[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "added", text: after[j] });
    j += 1;
  }
  return ops;
}

/**
 * 把两版 JD 文本对齐成可渲染的行。
 *
 * 空文本不产生任何行（调用方据 `rows.length === 0` 显示「还没有第二版描述可比」）。
 */
export function diffJdText(before: string, after: string): JdDiffRow[] {
  const ops = diffOps(splitLines(before), splitLines(after));
  const rows: JdDiffRow[] = [];
  let index = 0;
  let cursor = 0;
  while (cursor < ops.length) {
    const op = ops[cursor];
    if (op.type === "same") {
      index += 1;
      rows.push({
        key: `same-${index}`,
        left: { text: op.text, kind: "same" },
        right: { text: op.text, kind: "same" },
      });
      cursor += 1;
      continue;
    }
    // 收集紧邻的一段「删除 + 新增」，再按索引配对成一行行。
    const removed: string[] = [];
    const added: string[] = [];
    while (cursor < ops.length && ops[cursor].type !== "same") {
      const changed = ops[cursor];
      if (changed.type === "removed") removed.push(changed.text);
      else if (changed.type === "added") added.push(changed.text);
      cursor += 1;
    }
    const pairs = Math.max(removed.length, added.length);
    for (let k = 0; k < pairs; k += 1) {
      index += 1;
      const leftText = removed[k];
      const rightText = added[k];
      rows.push({
        key: `changed-${index}`,
        left: leftText === undefined ? null : { text: leftText, kind: "removed" },
        right: rightText === undefined ? null : { text: rightText, kind: "added" },
      });
    }
  }
  return rows;
}
