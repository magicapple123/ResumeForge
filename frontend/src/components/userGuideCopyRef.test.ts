// SPDX-License-Identifier: Apache-2.0
/**
 * 指南引用守卫：**指南让用户点的东西，源码里必须真的存在**。
 *
 * 触发这条守卫的真实事故：全站错误指引里写着「导出诊断包」，而网申页只有「导出诊断」——
 * 用户照着找，找不到。这类问题 tsc 与 eslint 都抓不到（两边都是字符串），
 * 而指南是"照着做就能成"的文体，指引错了比没有指南更糟。
 *
 * ## 判定方式（2026-10-28 指南正文迁入语言包后）
 *
 * 指南正文已从 components/user-guide/*.ts 迁进 zh-CN.userGuide.ts（数据文件只存 key），
 * 所以引用来源从"指南数据文件原文"改为**语言包里的中文值**：
 *
 * 1. 从 userGuide.* 的每个中文值里抽出所有「…」（U+300C / U+300D）引用；
 * 2. 过滤掉明显不是单个控件名的（规则集中在 isCheckableCitation）；
 * 3. 每条引用必须满足其一：
 *    a) 作为字面量出现在 src 下的界面源码（排除语言包、指南数据、测试）；
 *    b) 等于某条语言包消息的中文值，且**那个 key 在界面源码里被引用过**
 *       （t("key")、labelKey: "key"、Record<协议值, MessageKey> 里的 key 字面量都算）。
 *    判据 b) 是关键：只把文案搬进语言包、却没有任何界面在用那条 key，
 *    用户同样找不到这个东西。
 *
 * ## 已知局限
 *
 * - 只能证明"这条 key 在源码某处被引用"，不能证明它渲染在用户要点的位置。
 * - 只能做子串匹配：指南写简称会命中源码里的全名。
 * - 检不出插值拼接：这类要么改成静态全名，要么走 CITATION_EXEMPTIONS。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error 同上：@types/node 未安装。
import { dirname, join, relative, resolve, sep } from "node:path";
// @ts-expect-error 同上：@types/node 未安装。
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import zhCN from "../i18n/messages/zh-CN";
import { stripComments } from "../i18n/cjkScan";

/** 换行符常量：模板里直接写它最容易被编辑器转义吃掉。 */
const CH_NEWLINE = String.fromCharCode(10);

/** src/ 根目录：本文件在 src/components/ 下，向上一层即是。 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 指南数据目录：数据文件只存 key；正文在 zh-CN.userGuide.ts。 */
const GUIDE_DIR = join(SRC_ROOT, "components", "user-guide");

/** 指南正文语言包里的值：全部以 userGuide. 开头的 key。 */
const GUIDE_PACK_ENTRIES: [string, string][] = Object.entries(
  zhCN as Record<string, string>,
).filter(([key]) => key.startsWith("userGuide.") || key.startsWith("userGuideFlow."));

/** 指南数据文件：仍用于"结构存在"与 key 可解析两条断言。 */
const GUIDE_FILES: string[] = readdirSync(GUIDE_DIR)
  .filter((name: string) => name.endsWith(".ts") && !/\.(test|spec)\./.test(name))
  .sort()
  .map((name: string) => join(GUIDE_DIR, name));

/** 不扫的目录：测试目录、构建产物、语言包（语言包里是文案本体，不是界面源码）。 */
const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage", "messages"]);

/** 不扫的文件：测试自己会写"故意的坏样板"。 */
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

/** 引号内的候选：只认同一种引号，避免把英文引号里的内容也算进来。 */
const QUOTE_PATTERN = /「([^「」]+)」/g;

/** 并列写法（A → B、A / B）：拆开逐个校验。 */
const COMPOUND_SEPARATOR = /\s*(?:→|\/)\s*/;

/** 候选名的长度上限：超过它的基本是整句说明而不是控件名。 */
const MAX_CITATION_LENGTH = 12;

/** 计数占位：参考来源（N）、已处理 N/M 这类"条数是运行时的"标签。 */
const COUNT_PLACEHOLDER = /(?<![A-Za-z])N(?![A-Za-z])/;

/** 不是"控件名"的「」引用：逐条登记理由，不做模糊匹配。 */
const CITATION_EXEMPTIONS: Record<string, string> = {
  历历:
    "受控浏览器里的悬浮球名字。它是后端注入到招聘网站页面里的（backend/app/services/webform/live_control.py），" +
    "不在前端源码里；前端界面上的吉祥物叫「投投」，两者不是同一个东西。",
  问历历: "同上：受控浏览器悬浮球菜单项，由后端注入脚本渲染，不在前端源码里。",
  自动填写当前页面:
    "同上：受控浏览器悬浮球菜单项，由后端注入脚本渲染（backend/app/services/webform/live_control.py）。",
  需要你自己点选:
    "同上：受控浏览器填充结果里的说明文案，由后端（backend/app/services/webform/engine/core.py）写进页面。",
  没抓到: "反例措辞——这一句说的是「系统不会这样说」，不是界面上的任何控件名。",
  "采到 0 个": "反例措辞——同上，和「没抓到」成对出现，用来解释两者不会被混为一谈。",
  感谢投递: "引用的是招聘网站自动回执邮件的正文措辞，不是本应用的控件名。",
  申请已收到: "同上：邮件/通知正文措辞，是识别进度的输入，不是界面上的按钮。",
  成功填写数: "描述成功率的口径（分子），界面上实际显示的是「成功率 12%（3/25）」。",
  页面表单框总数: "同上：口径的分母。",
  你有几个岗位: "引用的是用户可能问助手的问题，不是控件名。",
  "公司 + 岗位":
    "描述投递记录的合并键怎么算（同公司 + 同岗位合并成一条），不是让用户去点的东西；" +
    "界面上的对应说法是投递设置里的「同公司只投一个岗位」。",
};

interface Citation {
  /** 拆开并列写法之后的单个名字。 */
  name: string;
  /** 指南正文来源 key（userGuide.*）。 */
  key: string;
}

interface UiSource {
  /** 相对 src/ 的路径，如 pages/SkillsPage.tsx。 */
  file: string;
  /** 已剥掉注释的源码。 */
  text: string;
}

/** 递归收集界面源码（绝对路径）。 */
function collectUiFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      collectUiFiles(absolute, collected);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (TEST_FILE_PATTERN.test(entry.name)) continue;
    collected.push(absolute);
  }
  return collected;
}

/** 读入全部界面源码，剥掉注释（避免"只在注释里出现过"就算数）。 */
function readUiSources(root: string = SRC_ROOT): UiSource[] {
  return (
    collectUiFiles(root)
      .map((absolute) => ({
        file: relative(root, absolute).split(sep).join("/"),
        text: stripComments(readFileSync(absolute, "utf8")),
      }))
      // 指南数据不是界面：不排除的话，它引用的 key 会在自己身上找到。
      .filter(
        (source) =>
          source.file !== "components/userGuideSteps.ts" &&
          !source.file.startsWith("components/user-guide/"),
      )
  );
}

/**
 * 这条引用能不能作为"用户要点的东西"来校验。
 *
 * 只过滤不可能有对应控件的形态，不做语义判断——语义判断交给 CITATION_EXEMPTIONS。
 */
function isCheckableCitation(raw: string): boolean {
  const name = raw.replace(/\*\*/g, "").trim();
  if (name.includes(String.fromCharCode(36) + "{")) return false;
  const length = [...name].length;
  if (length < 2 || length > MAX_CITATION_LENGTH) return false;
  if (COUNT_PLACEHOLDER.test(name)) return false;
  if (name.includes("…")) return false;
  return true;
}

/** 从指南正文（语言包中文值）里抽出待校验的引用。 */
function extractCitations(entries: [string, string][]): Citation[] {
  const citations = new Map<string, Citation>();
  for (const [key, value] of entries) {
    for (const match of value.matchAll(QUOTE_PATTERN)) {
      const raw = match[1];
      for (const part of raw.replace(/\*\*/g, "").split(COMPOUND_SEPARATOR)) {
        const name = part.trim();
        if (!isCheckableCitation(name)) continue;
        if (!citations.has(name)) citations.set(name, { name, key });
      }
    }
  }
  return [...citations.values()];
}

/** zh 值 → 拥有该值的 key 列表（一个值可能被多条 key 共用）。 */
function valueToKeys(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [key, value] of Object.entries(zhCN as Record<string, string>)) {
    const keys = map.get(value) ?? [];
    keys.push(key);
    map.set(value, keys);
  }
  return map;
}

/**
 * 找出"指南提到了、界面里却没有"的引用。
 *
 * 抽成纯函数是为了能用合成样本验证守卫本身有效：一个永远匹配不到东西的正则会让守卫
 * 看起来是绿的，那比没有守卫更危险。
 */
function findMissingCitations(
  entries: [string, string][],
  sources: UiSource[],
  catalog: Map<string, string[]> = valueToKeys(),
  exemptions: Record<string, string> = CITATION_EXEMPTIONS,
): Citation[] {
  const haystack = sources.map((source) => source.text).join(CH_NEWLINE);
  // 判据 b 的等价形态：key 在源码里被引用时，它对应的界面文案算"存在"（与原
  // 字面量 haystack 一样按子串匹配——指南常写简称，源码里是带后缀的全名）。
  const referencedCopy: string[] = [];
  for (const [value, keys] of catalog) {
    if (keys.some((key) => haystack.includes(key))) referencedCopy.push(value);
  }
  const referencedHaystack = referencedCopy.join(CH_NEWLINE);
  return extractCitations(entries).filter((citation) => {
    if (citation.name in exemptions) return false;
    if (haystack.includes(citation.name)) return false;
    return !referencedHaystack.includes(citation.name);
  });
}

/** 指南数据文件里引用的用户指南 key（双引号包住的 userGuide.*）。 */
const GUIDE_KEY_PATTERN = /"(userGuide(?:Flow)?\.[A-Za-z0-9_.]+)"/g;

function extractGuideKeys(sources: string[]): string[] {
  const keys: string[] = [];
  for (const text of sources) {
    for (const match of text.matchAll(GUIDE_KEY_PATTERN)) {
      if (!keys.includes(match[1])) keys.push(match[1]);
    }
  }
  return keys;
}

/** 解析不到的 key（文案移位后 key 写错/删掉时直接变红）。 */
function missingMessageKeys(keys: string[], catalog: Record<string, string> = zhCN): string[] {
  return keys.filter((key) => typeof catalog[key] !== "string" || !catalog[key]);
}

describe("使用指南引用守卫", () => {
  const sources = readUiSources();
  const catalog = valueToKeys();
  const guideFileTexts = GUIDE_FILES.map((file: string) => readFileSync(file, "utf8"));

  it("指南正文仍在语言包里（防止读错来源空跑）", () => {
    expect(GUIDE_FILES.length).toBeGreaterThanOrEqual(5);
    expect(GUIDE_PACK_ENTRIES.length).toBeGreaterThan(300);
    const fileNames = GUIDE_FILES.map((file: string) =>
      relative(SRC_ROOT, file).split(sep).join("/"),
    );
    expect(fileNames).toContain("components/user-guide/setupProfileSteps.ts");
    expect(fileNames).toContain("components/user-guide/resumeSteps.ts");
  });

  it("指南里提到的每个控件名，界面源码里都能找到（字面量或正在使用的 key）", () => {
    const missing = findMissingCitations(GUIDE_PACK_ENTRIES, sources, catalog);
    expect(
      missing,
      "指南引用了界面里找不到的字符串。改指南，或确认按钮已被改名/删除：" +
        CH_NEWLINE +
        missing.map((item) => item.key + "  「" + item.name + "」").join(CH_NEWLINE),
    ).toEqual([]);
  });

  it("指南数据文件里的静态 key 都能在语言包解析（文案移位不空跑）", () => {
    const keys = extractGuideKeys(guideFileTexts);
    expect(keys.length).toBeGreaterThan(300);
    expect(missingMessageKeys(keys).join(CH_NEWLINE)).toEqual("");
    // 自测：解析器本身能抓到不存在的 key（否则这条会因"解析器写错"而假绿）。
    expect(missingMessageKeys(["definitely.missing.key"])).toEqual(["definitely.missing.key"]);
  });

  it("校验集合不是空壳（正则或过滤写错时，上一条会假绿）", () => {
    expect(extractCitations(GUIDE_PACK_ENTRIES).length).toBeGreaterThan(100);
  });

  it("守卫自身能抓到人造缺口，也会跳过非控件名的引用", () => {
    const sampleSources: UiSource[] = [
      {
        file: "pages/Sample.tsx",
        text: '<Button>开始深挖</Button><Button>{t("sample.deep")}</Button>',
      },
    ];
    const sampleCatalog = new Map<string, string[]>([["拿去深挖", ["sample.deep"]]]);
    const sampleEntries: [string, string][] = [
      ["guide.a", "点「开始深挖」进入深挖。"], // 字面量存在 → 通过
      ["guide.b", "点「拿去深挖」进入深挖。"], // key 在源码被引用 → 通过
      ["guide.c", "点「继续深挖」进入深挖。"], // 既无字面量也无 key → 必须报
      ["guide.d", "「全部展开 / 全部收起」在页头。"], // 并列：两半都缺 → 必须报
      ["guide.e", "长句引用「这一整句是在解释为什么不让助手一次性读完所有东西」不校验。"],
      ["guide.f", "占位引用「已接收 " + String.fromCharCode(36) + "{count} 字」不校验。"],
      ["guide.g", "计数标签「参考来源（N）」不校验。"],
    ];
    const missing = findMissingCitations(sampleEntries, sampleSources, sampleCatalog, {}).map(
      (item) => item.name,
    );
    expect(missing).toEqual(["继续深挖", "全部展开", "全部收起"]);
  });

  it("豁免项不过期：还在指南里，且确实在界面里找不到", () => {
    const cited = new Set(extractCitations(GUIDE_PACK_ENTRIES).map((citation) => citation.name));
    const haystack = sources.map((source) => source.text).join(CH_NEWLINE);
    const problems: string[] = [];
    for (const [name, reason] of Object.entries(CITATION_EXEMPTIONS)) {
      if (reason.trim().length === 0) problems.push("「" + name + "」：豁免没写理由");
      if (!cited.has(name)) problems.push("「" + name + "」：指南已不再引用它，删掉这条豁免");
      const satisfied =
        haystack.includes(name) || (catalog.get(name) ?? []).some((key) => haystack.includes(key));
      if (satisfied) {
        problems.push("「" + name + "」：界面里已经能找到它了，从豁免移到主断言");
      }
    }
    expect(problems, problems.join(CH_NEWLINE)).toEqual([]);
  });
});
