// SPDX-License-Identifier: Apache-2.0
/**
 * 指南引用守卫：**指南让用户点的东西，源码里必须真的存在**。
 *
 * 触发这条守卫的真实事故：全站错误指引里写着「导出诊断包」，而网申页只有「导出诊断」——
 * 用户照着找，找不到。这类问题 `tsc` 与 eslint 都抓不到（两边都是字符串），
 * 而指南是"照着做就能成"的文体，指引错了比没有指南更糟。
 *
 * ## 判定方式
 *
 * 1. 从 components/user-guide/ 下的**全部步骤数据文件**抽出所有「…」（U+300C / U+300D）引号内的文本；
 * 2. 过滤掉明显不是单个控件名的（规则集中在 `isCheckableCitation`，见那里的逐条理由）；
 * 3. 断言每一条作为**字面量**出现在 `src/**\/*.ts`、`src/**\/*.tsx`（排除 `*.test.*`）里。
 *
 * ## 扫描范围为什么含 `.ts`（规格写的是 `.tsx`）
 *
 * 有界面文案并不写在 `.tsx` 里：通知标题在 `utils/backgroundTasks.ts`（`简历已生成`），
 * 岗位来源名在 `types/job.ts`（`岗位采集`）。只扫 `.tsx` 会把这两条正确引用判成缺失，
 * 于是守卫要么被迫加豁免、要么逼着人去改对的文案——两种结果都在削弱它。
 *
 * ## 已知局限（别把它当成"文案全对"的证明）
 *
 * - 只能证明**这个字符串在源码里某个位置出现过**，不能证明它在可渲染的位置上
 *   （注释里出现也算；已用 `stripComments` 剥掉注释，但字符串里的字面量无法区分语义）。
 * - 只能做**子串**匹配：指南写简称（`自定义模型`）会命中源码里的全名
 *   （`自定义模型（OpenAI 兼容）`），所以简写查不出来。
 * - 检不出 `${}` 动态拼接出来的文案：这类要在本文件显式豁免并写明理由，
 *   或者把指南改成静态全名。
 * - 并列写法（`A / B`、`A → B`）会先拆成单个名字再校验，所以"顺序对不对"不验。
 *
 * ## 豁免
 *
 * 只有一种形式：`CITATION_EXEMPTIONS` 里逐条登记 + 写明理由（把"为什么不算控件名"钉在
 * 字符串旁边，review 时一眼能审）。另有两道防腐烂：
 * 1. 豁免的字符串必须仍被指南引用（指南改过了 → 这条豁免要删）；
 * 2. 豁免的字符串不许能在源码里找到（能找到就说明该回主断言了）。
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

/** `src/` 根目录：本文件在 `src/components/` 下，向上一层即是。 */
const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 指南数据目录：拆分后正文分在 user-guide/ 的多个数据文件里（门面不再含文案）。 */
const GUIDE_DIR = join(SRC_ROOT, "components", "user-guide");

/** 指南正文来源：全部 *.ts 数据文件（排除测试）。 */
const GUIDE_FILES: string[] = readdirSync(GUIDE_DIR)
  .filter((name: string) => name.endsWith(".ts") && !/\.(test|spec)\./.test(name))
  .sort()
  .map((name: string) => join(GUIDE_DIR, name));

/** 不扫的目录：测试目录与构建产物。 */
const SKIP_DIRECTORIES = new Set(["__tests__", "node_modules", "dist", "coverage"]);

/** 不扫的文件：测试自己会写"故意的坏样板"，不该被当成界面文案来源。 */
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

/** 引号内的候选：只认同一种引号，避免把 `“…”` 里的英文引号也算进来。 */
const QUOTE_PATTERN = /「([^「」]+)」/g;

/** 并列写法（`A → B`、`A / B`）的分隔符：拆开逐个校验。 */
const COMPOUND_SEPARATOR = /\s*(?:→|\/)\s*/;

/**
 * 候选名的长度上限（按字符数，不按字节）。
 *
 * 超过它的基本是"整句说明"而不是控件名（实测最长的一批是
 * `基本信息 → 实习/工作经历 → 项目经历 → …` 这种排列说明）。取 12 是因为实测中
 * 最长的真实控件名是 `从我的资料追加一条`（9 字）与 `导入技能（.md / .zip）` 拆开后的
 * `导入技能`，留出余量后仍能把整句挡在外面。
 */
const MAX_CITATION_LENGTH = 12;

/** 计数占位：`参考来源（N）`、`已处理 N/M` 这类"条数是运行时的"标签。 */
const COUNT_PLACEHOLDER = /(?<![A-Za-z])N(?![A-Za-z])/;

/**
 * 不是"控件名"的「」引用：逐条登记理由，不做模糊匹配。
 *
 * 判据只有一句话：**用户能不能照着这句去点一个东西**。不能，就不是本守卫的对象。
 */
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
  /** 在指南数据文件里的行号（1 起），便于报错时直接定位。 */
  line: number;
  /** 来源数据文件（相对 src/ 的路径）。 */
  file: string;
}

/** 一份指南数据源（拆分后的子模块）。 */
interface GuideSource {
  file: string;
  text: string;
}

interface UiSource {
  /** 相对 `src/` 的路径，如 `pages/SkillsPage.tsx`。 */
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
      // 指南数据不是界面：不排除的话，它引用的每个字符串都能在自己身上找到，守卫恒绿。
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
 * 只过滤不可能有对应控件的形态，不做语义判断——语义判断交给 `CITATION_EXEMPTIONS`，
 * 那样每条豁免都得写清理由，而不是被一条越来越宽的正则悄悄吞掉。
 */
function isCheckableCitation(raw: string): boolean {
  // Markdown 粗体只是行文强调，不是名字的一部分。
  const name = raw.replace(/\*\*/g, "").trim();
  // 模板占位：指南里出现 `${` 说明这句话是拼出来的，无法静态比对。
  if (name.includes("${")) return false;
  // 单字符（如「⋮」这种图标字形）无法作为可靠的字面量依据。
  const length = [...name].length;
  if (length < 2 || length > MAX_CITATION_LENGTH) return false;
  // 计数占位：条数是运行时算出来的。
  if (COUNT_PLACEHOLDER.test(name)) return false;
  // 省略号：`新建数据集…` 这类"半截名字"，源码里是完整名字。
  if (name.includes("…")) return false;
  return true;
}

/** 从指南数据文件里抽出待校验的引用（去重、保留首次出现的文件 + 行号）。 */
function extractCitations(guideSources: GuideSource[]): Citation[] {
  const citations = new Map<string, Citation>();
  for (const source of guideSources) {
    const withoutComments = stripComments(source.text);
    for (const match of withoutComments.matchAll(QUOTE_PATTERN)) {
      const raw = match[1];
      const line = withoutComments.slice(0, match.index ?? 0).split(CH_NEWLINE).length;
      // 并列写法拆成单个名字：「全部展开 / 全部收起」是两个按钮，各自都要存在。
      for (const part of raw.replace(/\*\*/g, "").split(COMPOUND_SEPARATOR)) {
        const name = part.trim();
        if (!isCheckableCitation(name)) continue;
        if (!citations.has(name)) citations.set(name, { name, line, file: source.file });
      }
    }
  }
  return [...citations.values()];
}

/**
 * 找出"指南提到了、源码里却没有"的引用。
 *
 * 抽成纯函数是为了能用合成样本验证守卫本身有效：一个永远匹配不到东西的正则会让守卫
 * 看起来是绿的，那比没有守卫更危险（本仓 `antdStaticGuard` 的自测也是这个目的）。
 */
function findMissingCitations(
  guideSources: GuideSource[],
  sources: UiSource[],
  exemptions: Record<string, string> = CITATION_EXEMPTIONS,
): Citation[] {
  const haystack = sources.map((source) => source.text).join(CH_NEWLINE);
  return extractCitations(guideSources).filter((citation) => {
    if (citation.name in exemptions) return false;
    return !haystack.includes(citation.name);
  });
}

/** 指南里静态 t("消息 key") 的 key（拆分后指南可能把正文迁进语言包）。 */
const T_CALL_PATTERN = /\bt\(\s*["']([^"']+)["']/g;

function extractGuideMessageKeys(guideSources: GuideSource[]): string[] {
  const keys: string[] = [];
  for (const source of guideSources) {
    for (const match of source.text.matchAll(T_CALL_PATTERN)) {
      if (!keys.includes(match[1])) keys.push(match[1]);
    }
  }
  return keys;
}

/** 解析不到的 t() key（文案移位后 key 写错/删掉时直接变红）。 */
function missingMessageKeys(keys: string[]): string[] {
  const catalog = zhCN as Record<string, string | undefined>;
  return keys.filter((key) => typeof catalog[key] !== "string" || !catalog[key]);
}

describe("使用指南引用守卫", () => {
  const guideSources: GuideSource[] = GUIDE_FILES.map((file: string) => ({
    file: relative(SRC_ROOT, file).split(sep).join("/"),
    text: readFileSync(file, "utf8"),
  }));
  const sources = readUiSources();

  it("指南数据拆分后仍有正文（防止读错路径空跑）", () => {
    expect(GUIDE_FILES.length).toBeGreaterThanOrEqual(5);
    const files = guideSources.map((source) => source.file);
    expect(files).toContain("components/user-guide/setupProfileSteps.ts");
    expect(files).toContain("components/user-guide/resumeSteps.ts");
    expect(extractCitations(guideSources).length).toBeGreaterThan(100);
  });

  it("指南里提到的每个控件名，源码里都存在", () => {
    const missing = findMissingCitations(guideSources, sources);
    expect(
      missing,
      "指南引用了源码里找不到的字符串。改指南，或确认按钮已被改名/删除：" +
        CH_NEWLINE +
        missing.map((item) => `${item.file}:${item.line}  「${item.name}」`).join(CH_NEWLINE),
    ).toEqual([]);
  });

  it("指南里的静态 t() 消息 key 都能在语言包解析（文案移位不空跑）", () => {
    const keys = extractGuideMessageKeys(guideSources);
    expect(missingMessageKeys(keys), missingMessageKeys(keys).join(CH_NEWLINE)).toEqual([]);
    // 自测：解析器本身能抓到不存在的 key（否则这条会因"指南目前没有 t()"而假绿）。
    expect(missingMessageKeys(["definitely.missing.key"])).toEqual(["definitely.missing.key"]);
  });

  it("校验集合不是空壳（正则或过滤写错时，上一条会假绿）", () => {
    // 实测 150 条上下；阈值只用来发现"抽取整体失效"，不是给人卡的配额。
    expect(extractCitations(guideSources).length).toBeGreaterThan(100);
  });

  it("守卫自身能抓到人造缺口，也会跳过非控件名的引用", () => {
    const sampleSources: UiSource[] = [
      { file: "pages/Sample.tsx", text: "<Button>开始深挖</Button>" },
    ];
    const sampleGuide = [
      "点「开始深挖」进入深挖。", // 存在 → 通过
      "点「拿去深挖」进入深挖。", // 改过名 → 必须报
      "「全部展开 / 全部收起」在页头。", // 并列：一半缺失也要报
      "长句引用「这一整句是在解释为什么不让助手一次性读完所有东西」不校验。",
      "占位引用「已接收 ${count} 字」不校验。",
      "计数标签「参考来源（N）」不校验。",
    ].join(CH_NEWLINE);

    const missing = findMissingCitations(
      [{ file: "sample", text: sampleGuide }],
      sampleSources,
      {},
    ).map((item) => item.name);
    expect(missing).toEqual(["拿去深挖", "全部展开", "全部收起"]);
  });

  it("豁免项不过期：还在指南里，且确实不在源码里", () => {
    const cited = new Set(extractCitations(guideSources).map((citation) => citation.name));
    const haystack = sources.map((source) => source.text).join(CH_NEWLINE);
    const problems: string[] = [];
    for (const [name, reason] of Object.entries(CITATION_EXEMPTIONS)) {
      if (reason.trim().length === 0) problems.push(`「${name}」：豁免没写理由`);
      if (!cited.has(name)) problems.push(`「${name}」：指南已不再引用它，删掉这条豁免`);
      if (haystack.includes(name)) {
        problems.push(`「${name}」：源码里已经能找到它了，从豁免移到主断言`);
      }
    }
    expect(problems, problems.join(CH_NEWLINE)).toEqual([]);
  });
});
