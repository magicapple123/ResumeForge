// SPDX-License-Identifier: Apache-2.0
/**
 * 历史版本的**行级对比**（T12）：纯函数，无 React、无网络。
 *
 * ## 为什么按"行"比，不按"字"比
 *
 * 外部简历的正文是从 PDF / DOCX 抽出来的，逐字 diff（Myers / 字符级 LCS）会产生
 * "改了一个标点，整段飘红"的噪声；而用户真正在问的是"我回到那一版会失去哪几句话"。
 * 行是这个问题的自然粒度：一段话就是一行，增删一目了然。
 *
 * ## 为什么自己写 LCS 而不引第三方 diff 库
 *
 * 需求只有"等比对齐 + 增删行"，一个 40 行的 LCS 就够；引一个库要为它写 SSR/CJS 兼容、
 * 要审它的许可，还要在离线桌面端多打一份进包里。这里输入是**两条数组**，量级几十到
 * 几百行（`MAX_DIFF_LINES` 兜底），`O(n·m)` 的 DP 在这量级上是毫秒级。
 *
 * ## 上限
 *
 * 一份简历可能几万字、上千行。超上限时不硬算（1000×1000 的 DP 会卡住主线程），
 * 由调用方降级成"只给字数与行数差"，这一层只负责**如实报告**超限，不偷偷截断——
 * 截断后再 diff，用户会看到"中间凭空消失了一段"的假象。
 */
import type { MessageKey } from "../../../i18n";

/** 一行的差异类型：两侧一样 / 只在旧版（左）/ 只在新版（右）。 */
export type DiffKind = "same" | "removed" | "added";

/** 对比表里的一行。左 = 旧版（原版），右 = 新版（当前）。 */
export interface DiffRow {
  kind: DiffKind;
  /** 旧版这一行的文字；`added` 时为 null。 */
  left: string | null;
  /** 新版这一行的文字；`removed` 时为 null。 */
  right: string | null;
  /** 1 基行号；对应侧没有这一行时为 null。 */
  leftLine: number | null;
  rightLine: number | null;
}

/** 单侧允许的最大行数。两侧都 ≤ 它时才真的算 diff。 */
export const MAX_DIFF_LINES = 600;

/** 对比结论的一句话（字数不在这里算：字数来自版本行的 `text_chars`，那是落库时的数）。 */
export interface DiffSummary {
  added: number;
  removed: number;
  same: number;
}

/** 把正文切成行（去掉末尾空行：PDF 抽取常在文末留一串空行，逐行进表只会噪声）。 */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** 两侧行数是否在上限内（超了就由调用方降级，不调用 {@link lineDiff}）。 */
export function isDiffable(left: string, right: string): boolean {
  return splitLines(left).length <= MAX_DIFF_LINES && splitLines(right).length <= MAX_DIFF_LINES;
}

/**
 * 行级 LCS 对比。
 *
 * 相等判定用**去尾空白后的全等**：PDF 抽取的续行常带尾空格，尾空格不同不该算改动。
 * 返回的行是"对齐"过的：`same` 两侧都有值，`removed` 只有左，`added` 只有右，
 * 所以界面上左右两列可以按同一个数组下标同步滚动。
 */
export function lineDiff(leftText: string, rightText: string): DiffRow[] {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  // `lcs[i][j]` = left[i:] 与 right[j:] 的最长公共子序列长度（从后往前填，便于回溯）。
  const lcs: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        left[i] === right[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      rows.push({ kind: "same", left: left[i], right: right[j], leftLine: i + 1, rightLine: j + 1 });
      i += 1;
      j += 1;
      continue;
    }
    // 先出"删除"再出"新增"：读者按阅读顺序看，旧的那句应该出现在新的那句之前。
    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: "removed", left: left[i], right: null, leftLine: i + 1, rightLine: null });
      i += 1;
    } else {
      rows.push({ kind: "added", left: null, right: right[j], leftLine: null, rightLine: j + 1 });
      j += 1;
    }
  }
  for (; i < left.length; i += 1) {
    rows.push({ kind: "removed", left: left[i], right: null, leftLine: i + 1, rightLine: null });
  }
  for (; j < right.length; j += 1) {
    rows.push({ kind: "added", left: null, right: right[j], leftLine: null, rightLine: j + 1 });
  }
  return rows;
}

/** 统计增删行数（`same` 不计进结论条，界面只需"多了几行、少了几行"）。 */
export function diffSummary(rows: readonly DiffRow[]): DiffSummary {
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const row of rows) {
    if (row.kind === "added") added += 1;
    else if (row.kind === "removed") removed += 1;
    else same += 1;
  }
  return { added, removed, same };
}

/** 差异为空的文案 key（两侧正文一致时用，避免界面出现空白的对比表）。 */
export const DIFF_EMPTY_KEY: MessageKey = "externalEdit.compare.same";
