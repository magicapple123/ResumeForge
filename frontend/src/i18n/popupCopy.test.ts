// SPDX-License-Identifier: Apache-2.0
/**
 * 文案守卫 P5（见方案 §6.3）：新形态的界面文案必须"扫一眼能读完"，且必须来自 `t()`。
 *
 * 为什么需要它而不是只靠 `cjkRatchet`：棘轮只管"中文行数不涨"，它**允许**在 `.tsx` 里
 * 写中文（只要总量没涨）。P5 把"这三个新文件必须干净"与"这些 key 必须短"钉死。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, resolve } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripComments } from "./cjkScan";
import zhCN from "./messages/zh-CN";

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 长度上限按 key 前缀给。`Array.from` 计数，避免代理对被算成 2。 */
const LENGTH_RULES: readonly { prefix: string; max: number }[] = [
  { prefix: "announcement.", max: 30 },
  { prefix: "toast.", max: 20 },
  { prefix: "common.action.", max: 4 },
  { prefix: "draft.", max: 30 },
];

/** 语气：不许感叹号、句号、问号（`common.discard.title` 是唯一的确认提问）。 */
const FORBIDDEN_PUNCTUATION = /[!！。?？]/;
const QUESTION_KEY = "common.discard.title";

const CJK = /[\u4e00-\u9fff]/;

/** 必须"一个字都不许有中文"的源文件（中文只许出现在注释里）。 */
const CJK_FREE_FILES = [
  "components/common/FormModal.tsx",
  "components/common/FormModalFooter.tsx",
  "components/common/AnnouncementBar.tsx",
  "components/common/DraftRestoreBar.tsx",
];

const entries = Object.entries(zhCN) as [string, string][];

describe("文案长度与语气", () => {
  it("按前缀断言长度上限", () => {
    const problems: string[] = [];
    for (const [key, value] of entries) {
      for (const rule of LENGTH_RULES) {
        if (!key.startsWith(rule.prefix)) continue;
        const length = Array.from(value).length;
        if (length > rule.max) problems.push(`${key}：${length} > ${rule.max}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("新形态的文案不使用感叹号、句号、问号（确认提问除外）", () => {
    const problems = entries
      .filter(([key]) => LENGTH_RULES.some((rule) => key.startsWith(rule.prefix)))
      .filter(([key]) => key !== QUESTION_KEY)
      .filter(([, value]) => FORBIDDEN_PUNCTUATION.test(value))
      .map(([key, value]) => `${key}：${value}`);
    expect(problems).toEqual([]);
  });
});

describe("新形态的组件源码里不许出现中文字面量", () => {
  for (const relativePath of CJK_FREE_FILES) {
    const absolute = join(SRC_ROOT, relativePath);
    // AnnouncementBar 由 B4 引入；文件还没落地时不算违规（落地后自动纳入本守卫）。
    if (!existsSync(absolute)) continue;
    it(`${relativePath} 的代码里没有中文`, () => {
      const source = stripComments(readFileSync(absolute, "utf8"));
      const offenders = source
        .split("\n")
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter((item) => CJK.test(item.line));
      expect(offenders.map((item) => `${item.number}: ${item.line}`)).toEqual([]);
    });
  }

  it("底座与恢复条已经落地（否则上面那两条是空跑）", () => {
    const required = ["components/common/FormModal.tsx", "components/common/DraftRestoreBar.tsx"];
    const missing = required.filter((path) => !existsSync(join(SRC_ROOT, path)));
    expect(missing).toEqual([]);
  });
});
