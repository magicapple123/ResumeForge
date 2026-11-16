// SPDX-License-Identifier: Apache-2.0
/**
 * 文案预算守卫（I-24）：三道闸，全部走**基线 ratchet**。
 *
 * ## 为什么是 ratchet 而不是一次改完
 *
 * 实测 11169 条文案里 ≥80 字的有一百多条，其中约 60 处真的渲染在界面上。一次性
 * 全改会同时动到术语一致性（方案/板块/条目）与 messageContract 的插值契约，风险
 * 远高于收益。所以先把存量登记进 `copyBudgetBaseline.ts`（带到期日），**新增的超标
 * 文案立即变红**；每修掉一条就从基线删一条，基线空了删文件、只剩规则。
 *
 * ## 三道闸
 *
 * - **L1 长度**：中文值 ≤80 字、英文值 ≤160 字符。中文按 `Array.from` 数（一个 emoji
 *   或生僻字算 1 个），英文按 `.length`。
 * - **L2 口吻**：提示语不许用「这里 / 本功能 / 这个页面 / 你可以」开场。这类开头在
 *   界面上读起来像说明书，且几乎总是伴随超长。
 * - **L3 提示位**：带 `data-hint` 的文案必须走短文案档（≤120 字）。真机上 120px 的
 *   像素预算无法静态测量，这里用字符预算作代理——它是"同一类问题"的可执行判据。
 */
import { describe, expect, it } from "vitest";
import copyBudgetBaseline from "./copyBudgetBaseline";

/** 中文文案上限（字）。超过就不是"一句提示"，而是一段说明。 */
const ZH_MAX_CHARS = 80;
/** 英文文案上限（字符）。中文的 80 字大致对应英文 160 字符。 */
const EN_MAX_CHARS = 160;
/** 带 `data-hint` 的提示位上限（字）。 */
const HINT_MAX_CHARS = 120;

/** 口吻红线：这些开场白在界面上像说明书。 */
const TONE_PREFIXES = ["这里", "本功能", "这个页面", "你可以"];

interface MessageEntry {
  key: string;
  value: string;
  chars: number;
}

/**
 * 读取语言包里的全部消息。
 *
 * 用 `import.meta.glob` 的 eager 模式而不是手写 import 清单：新增语言包分片时守卫
 * 自动覆盖，不会出现"新加了一个 `zh-CN.xxx.ts`、守卫完全看不见"的漏网。
 */
const zhModules = import.meta.glob("../../i18n/messages/zh-CN.*.ts", { eager: true }) as Record<
  string,
  { default: Record<string, string> }
>;
const enModules = import.meta.glob("../../i18n/messages/en-US.*.ts", { eager: true }) as Record<
  string,
  { default: Record<string, string> }
>;

function flatten(modules: Record<string, { default: Record<string, string> }>): MessageEntry[] {
  const entries: MessageEntry[] = [];
  for (const module of Object.values(modules)) {
    for (const [key, value] of Object.entries(module.default ?? {})) {
      if (typeof value !== "string") continue;
      entries.push({ key, value, chars: Array.from(value).length });
    }
  }
  return entries;
}

const ZH = flatten(zhModules);
const EN = flatten(enModules);
/** 基线：`key → 到期日`。命中基线的是存量，允许暂时超标。 */
const BASELINE = new Map(Object.entries(copyBudgetBaseline));

function expired(keys: string[]): string[] {
  const today = new Date().toISOString().slice(0, 10);
  return keys.filter((key) => {
    const expiry = BASELINE.get(key);
    return typeof expiry === "string" && expiry < today;
  });
}

describe("文案预算 · L1 长度", () => {
  it("中文文案不超过 80 字（基线内除外）", () => {
    const over = ZH.filter((entry) => entry.chars > ZH_MAX_CHARS);
    const offenders = over.filter((entry) => !BASELINE.has(entry.key));
    expect(
      offenders.map((entry) => `${entry.key}（${entry.chars} 字）`),
      "新增的超长文案要么改短，要么登记进 copyBudgetBaseline（带到期日）",
    ).toEqual([]);
    // 基线过期即红：到期日不是装饰。
    expect(expired(over.map((entry) => entry.key))).toEqual([]);
  });

  it("英文文案不超过 160 字符（基线内除外）", () => {
    const over = EN.filter((entry) => entry.chars > EN_MAX_CHARS);
    expect(over.filter((entry) => !BASELINE.has(entry.key)).map((entry) => entry.key)).toEqual([]);
  });

  it("基线里不允许有幽灵条目（文案已改短或键已删除）", () => {
    const live = new Set([...ZH, ...EN].map((entry) => entry.key));
    const stale = [...BASELINE.keys()].filter((key) => !live.has(key));
    expect(stale, "这些键已不存在，请从 copyBudgetBaseline 删除").toEqual([]);
  });
});

describe("文案预算 · L2 口吻", () => {
  it("提示语不以说明书式开场白开头", () => {
    const offenders = ZH.filter((entry) => {
      const text = entry.value.trim();
      return TONE_PREFIXES.some((prefix) => text.startsWith(prefix)) && !BASELINE.has(entry.key);
    });
    expect(offenders.map((entry) => `${entry.key}：${entry.value.slice(0, 12)}…`)).toEqual([]);
  });
});

describe("文案预算 · L3 提示位", () => {
  it("带 data-hint 的文案走短文案档（≤120 字）", () => {
    // `data-hint` 的取值有两种写法：`data-hint={t("key")}` 与 `data-hint="key"`。
    // 这里静态扫源文件，把两种都收进来——纯正则，不引 AST，够用且不会误伤。
    const sources = import.meta.glob(["../../**/*.tsx", "!../../**/*.test.tsx"], {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    const byKey = new Map(ZH.map((entry) => [entry.key, entry]));
    const offenders: string[] = [];
    const hintPattern = /data-hint=(?:\{t\("([^"]+)"\)\}|"([^"]+)")/g;
    for (const [file, text] of Object.entries(sources)) {
      for (const match of text.matchAll(hintPattern)) {
        const key = match[1] ?? match[2];
        const entry = byKey.get(key);
        if (!entry) continue;
        if (entry.chars > HINT_MAX_CHARS && !BASELINE.has(key)) {
          offenders.push(`${file}: ${key}（${entry.chars} 字）`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
