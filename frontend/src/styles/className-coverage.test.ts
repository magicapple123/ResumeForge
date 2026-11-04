// SPDX-License-Identifier: Apache-2.0
/**
 * CSS 类名存在性守卫（需求 2）。
 *
 * 防的是"组件不报错、测试全绿、只是看起来没排过版"的静默退化：`.task-notice-actions`、
 * `.interview-material-source` 这一族类名都曾在 JSX 里挂着、在全仓 CSS 里零命中，
 * 症状只是间距塌陷，任何文本断言都抓不到。
 *
 * 口径：
 * 1. 扫 `src/**\/*.tsx` 的 `className`，只取**可静态确定**的部分——字符串字面量、
 *    模板字符串的静态片段、`clsx(...)` 里的字符串参数；纯变量（`styles.foo`）跳过，不猜。
 * 2. 按空白拆 token，**只守项目自有前缀**（antd 的 `ant-*`、CSS-in-JS 的 `css-*` 不归我们管）。
 * 3. token 必须作为选择器出现在**项目 CSS** 里（`.token` 后不能紧跟字母数字或 `-`）。扫描面是
 *    `src/**\/*.css` 而不只是 `src/styles/**`：本仓库既有集中分片，也有与组件同目录的样式
 *    （`components/resume-editor/document-editor.css` 承载全部 `document-*` 类名），只扫
 *    `styles/` 会把 200 多个有样式的类名误判成零样式。
 * 4. 以分隔符结尾的 token（`` `rf-announcement-${severity}` ``）是**动态修饰符**，改查基类
 *    `rf-announcement` 是否存在——这样拼错前缀仍然会红，但不会误伤合法的动态拼接。
 *
 * 存量：dry-run 实测 61 个类名零样式（见下方 `_EXEMPTIONS`，每条带具体理由 + 到期日）。
 * 豁免是**待还的债**，不是许可：类名一旦补上样式、或不再被任何组件使用，对应条目必须同批
 * 删除，否则 `幽灵豁免` 用例变红。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectClasses,
  collectUsage,
  missingTokens,
  walk,
  type SourceFile,
} from "./classNameCoverageScan";

declare const process: { cwd(): string };

const SRC = `${process.cwd()}/src`;

interface Exemption {
  /** 为什么这个类名现在没有样式是可接受的——必须能指向具体机制，禁止"暂缓"式空话。 */
  reason: string;
  /** 到期日（ISO）。到期后守卫变红，逼着续期时重新判断。 */
  expires: string;
}

const REVIEW_DATE = "2026-12-31";

const EXEMPTIONS: Record<string, Exemption> = {
  // —— 双语预览 / 文档编辑 ——
  "bilingual-variant-preview": {
    reason: "预览抽屉的 section 容器，内部 Flex 与 strong 自带布局，容器本身无自有视觉",
    expires: REVIEW_DATE,
  },
  "document-add-field-option": {
    reason: "菜单项标签 span，文本与内联 Tag 自带样式，span 只作结构锚点",
    expires: REVIEW_DATE,
  },
  "document-add-field-tag": {
    reason: "antd Tag 根元素上的定位类，视觉由 antd token 与父级决定",
    expires: REVIEW_DATE,
  },
  "document-photo-thumb": {
    reason: "照片缩略图容器的定位类，尺寸由父级槽位与图片组件自身控制",
    expires: REVIEW_DATE,
  },
  "document-zone-hidden": {
    reason: "与 .document-zone 同时出现（该类有样式），本类只标识隐藏投放区供拖拽逻辑选中",
    expires: REVIEW_DATE,
  },
  // —— 面试 ——
  "interview-dimension": {
    reason: "报告卡的维度块，标题与分条由 .interview-dimension-head / .interview-report-lists 承担",
    expires: REVIEW_DATE,
  },
  "interview-page": {
    reason: "页面根 div，头部用 .profile-page-header、内容用 .interview-setup，根节点无自有视觉",
    expires: REVIEW_DATE,
  },
  "interview-ready-gate": {
    reason: "Card 上的定位类，卡片外观由 antd token 与 .interview-ready-gate-head 等子元素承担",
    expires: REVIEW_DATE,
  },
  "interview-report": {
    reason: "Card 上的定位类，内部由 .interview-report-score / .interview-report-lists 承担",
    expires: REVIEW_DATE,
  },
  "interview-setup": {
    reason: "设置区容器，字段布局由 SetupTab 内的栅格与 .interview-setup-grid 承担",
    expires: REVIEW_DATE,
  },
  // —— 资料 / 方案 ——
  "profile-basic-section": {
    reason: "antd Row（带 gutter），栅格间距由 Row 属性控制，本类只作定位锚点",
    expires: REVIEW_DATE,
  },
  "profile-entry-section": {
    reason: "条目区容器，子表单与 .profile-field-grid 自带样式",
    expires: REVIEW_DATE,
  },
  "profile-field-inputs": {
    reason: "字段输入区容器，内部用 .profile-field-grid 栅格",
    expires: REVIEW_DATE,
  },
  "profile-field-settings": {
    reason: "字段设置视图根容器，面包屑与卡片自带样式",
    expires: REVIEW_DATE,
  },
  "profile-group-form": {
    reason: "方案表单容器，标签与控件的间距由 antd Form.Item 布局提供",
    expires: REVIEW_DATE,
  },
  "profile-group-manager-groups": {
    reason: "方案列表容器，卡片外观用 .profile-settings-card",
    expires: REVIEW_DATE,
  },
  "profile-list-item-content": {
    reason: "行内容容器，行本身由 .profile-list-item 承担",
    expires: REVIEW_DATE,
  },
  "profile-reference-field": {
    reason: "FileDropZone 透传的定位类，拖拽区样式由 FileDropZone 自身承担",
    expires: REVIEW_DATE,
  },
  "profile-section-empty-actions": {
    reason: "空态动作条容器，按钮由 antd Button 与父级空态布局承担",
    expires: REVIEW_DATE,
  },
  "profile-section-settings": {
    reason: "区块设置视图根容器，图例与开关列表自带样式",
    expires: REVIEW_DATE,
  },
  // —— 简历排版 / 工作台 ——
  "resume-contact-break-select": {
    reason: "antd Select 上的定位类，宽度由内联 style 的 100% 控制",
    expires: REVIEW_DATE,
  },
  "resume-delivery-info": {
    reason: "投递信息块容器，内部 Space / Typography 自带布局（data-testid 才是测试锚点）",
    expires: REVIEW_DATE,
  },
  "resume-font-slider": {
    reason: "antd Slider 上的定位类，滑杆视觉由 antd token 承担",
    expires: REVIEW_DATE,
  },
  "resume-history-preview-main": {
    reason: "历史预览主体容器，标签与数值由子元素类承担（role=status 供读屏）",
    expires: REVIEW_DATE,
  },
  "resume-line-height-slider": {
    reason: "antd Slider 上的定位类，滑杆视觉由 antd token 承担",
    expires: REVIEW_DATE,
  },
  "resume-optimizer-content": {
    reason: "候选内容 section，标题与说明由 Typography 自带排版",
    expires: REVIEW_DATE,
  },
  "resume-page-padding-slider": {
    reason: "antd Slider 上的定位类，滑杆视觉由 antd token 承担",
    expires: REVIEW_DATE,
  },
  "resume-pagination-break-jump": {
    reason: "antd Button 上的定位类，外观由 size=small 与 antd token 承担",
    expires: REVIEW_DATE,
  },
  "resume-photo-scale-slider": {
    reason: "antd Slider 上的定位类，滑杆视觉由 antd token 承担",
    expires: REVIEW_DATE,
  },
  "resume-preview-click-edit": {
    reason: "Tooltip 内的 span 包裹层，勾选框自带样式，span 只作对齐锚点",
    expires: REVIEW_DATE,
  },
  "resume-preview-toolbar-row-hint": {
    reason: "与 .resume-preview-toolbar-row 同时出现（该类有样式），本类只标识提示行",
    expires: REVIEW_DATE,
  },
  "resume-preview-toolbar-row-measure": {
    reason: "与 .resume-preview-toolbar-row 同时出现（该类有样式），本类只标识测量行",
    expires: REVIEW_DATE,
  },
  "resume-typography-entry-select": {
    reason: "antd Select 上的定位类，宽度与伸展由内联 style 控制",
    expires: REVIEW_DATE,
  },
  "resume-typography-multi": {
    reason: "多选样式 section，内部 Space / Typography 自带布局",
    expires: REVIEW_DATE,
  },
  "resume-typography-scope": {
    reason: "作用域提示容器，内部 Space 控制排版",
    expires: REVIEW_DATE,
  },
  "resume-typography-source": {
    reason: "与 .resume-measure-source 同时出现（该类有样式），本类作来源标记锚点",
    expires: REVIEW_DATE,
  },
  "resume-wb-conflict-diff": {
    reason: "冲突差异块，外边距由内联 style 提供，内部行为内联 flex",
    expires: REVIEW_DATE,
  },
  "resume-wb-scenario-bar": {
    reason: "场景条容器，配色与间距由内联 style 提供",
    expires: REVIEW_DATE,
  },
  "resume-wb-stack": {
    reason: "外层容器，布局由内联 STACK_STYLE 提供",
    expires: REVIEW_DATE,
  },
  "resume-wb-structure-layout": {
    reason: "结构布局 section，内部 EntryLayoutPanel 自带样式",
    expires: REVIEW_DATE,
  },
  "resume-wb-subgroup-title": {
    reason: "分组小标题容器，字号由 antd Text strong 承担",
    expires: REVIEW_DATE,
  },
  "resume-wb-v2-fill-menu": {
    reason: "快捷填充菜单浮层，定位由父级浮层容器承担",
    expires: REVIEW_DATE,
  },
  "resume-writing-modal-hint": {
    reason: "Typography.Paragraph type=secondary，颜色由 antd token 承担",
    expires: REVIEW_DATE,
  },
  // —— 全局组件 ——
  "rf-ai-polish-instruction": {
    reason: "Input.TextArea 上的定位类，输入框视觉由 antd token 承担",
    expires: REVIEW_DATE,
  },
  "rf-entry-layout-node-inspector": {
    reason: "检查器 section，内部 ItemEditor 自带样式",
    expires: REVIEW_DATE,
  },
  "rf-form-modal-heading": {
    reason: "弹层标题容器，字号由父级 Modal title 继承",
    expires: REVIEW_DATE,
  },
  "rf-structure-badge-page-break": {
    reason: "与 .rf-structure-badge 同时出现（该类有样式），本类只标识分页标记",
    expires: REVIEW_DATE,
  },
  "rf-structure-panel-meta-sep": {
    reason: "元信息分隔符 ·，颜色与字号继承父级",
    expires: REVIEW_DATE,
  },
  "template-gallery": {
    reason: "画廊根容器，工具栏/栅格/卡片各有 .template-gallery-* 子样式",
    expires: REVIEW_DATE,
  },
  "template-gallery-capability": {
    reason: "Typography.Text type=secondary，颜色与字号由 antd token 承担",
    expires: REVIEW_DATE,
  },
  "template-recognition-confidence": {
    reason: "识别置信度条容器，文字由 Typography 承担",
    expires: REVIEW_DATE,
  },
};

function expiredExemptions(exemptions: Record<string, Exemption>, today = new Date()): string[] {
  return Object.entries(exemptions)
    .filter(([, exemption]) => new Date(exemption.expires) < today)
    .map(([token, exemption]) => `${token}（${exemption.expires} 已到期）`);
}

const tsxFiles = walk(SRC).filter((file) => file.endsWith(".tsx") && !file.includes(".test.tsx"));
const cssFiles = walk(SRC).filter((file) => file.endsWith(".css"));

const usage = collectUsage(
  tsxFiles.map((file) => ({ file: file.slice(SRC.length + 1), text: readFileSync(file, "utf8") })),
);
const classes = collectClasses(cssFiles.map((file) => readFileSync(file, "utf8")).join("\n"));

describe("className 覆盖：JSX 里写的项目类名必须在样式表里存在", () => {
  it("没有未登记的零样式类名", () => {
    expect(missingTokens(usage, classes, EXEMPTIONS)).toEqual([]);
  });

  it("新增一个没有样式的类名会变红并报出文件", () => {
    const fake: SourceFile[] = [
      {
        file: "components/Foo.tsx",
        text: '<div className="resume-ghost-class">x</div>',
      },
    ];
    expect(missingTokens(collectUsage(fake), classes, {})).toEqual([
      "resume-ghost-class <- components/Foo.tsx",
    ]);
  });

  it("把已有类名的样式删掉会变红", () => {
    const fake: SourceFile[] = [
      { file: "components/Foo.tsx", text: '<div className="task-notice-footer">x</div>' },
    ];
    expect(missingTokens(collectUsage(fake), new Set<string>(), {})).toHaveLength(1);
  });

  it("三种动态写法不产生误报", () => {
    const fake: SourceFile[] = [
      { file: "A.tsx", text: "const x = <div className={styles.foo} />;" },
      {
        file: "B.tsx",
        text: 'const y = <div className={clsx("task-a", active && "task-b")} />;',
      },
      {
        file: "C.tsx",
        text: 'const z = <div className={`task-c ${open ? "task-d" : "task-e"}`} />;',
      },
      { file: "D.tsx", text: 'const w = <div className="ant-btn css-xyz" />;' },
    ];
    expect([...collectUsage(fake).keys()].sort()).toEqual([
      "task-a",
      "task-b",
      "task-c",
      "task-d",
      "task-e",
    ]);
  });

  it("动态修饰符按基类判定", () => {
    const fake: SourceFile[] = [
      { file: "E.tsx", text: "const v = <div className={`rf-announcement-${kind}`} />;" },
    ];
    const sparse = collectClasses(".rf-announcement { color: red; }");
    expect(missingTokens(collectUsage(fake), sparse, {})).toEqual([]);
    // 基类不存在时仍然要红：拼错前缀不能被"动态"两个字掩护过去。
    expect(missingTokens(collectUsage(fake), new Set<string>(), {})).toHaveLength(1);
  });
});

describe("豁免册：每条带理由与到期日，且不得是幽灵", () => {
  it("每条豁免都写了具体理由与到期日", () => {
    for (const [token, exemption] of Object.entries(EXEMPTIONS)) {
      expect(exemption.reason.length, token).toBeGreaterThan(12);
      expect(exemption.expires, token).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("没有已到期的豁免", () => {
    expect(expiredExemptions(EXEMPTIONS)).toEqual([]);
  });

  it("豁免到期后会被点名", () => {
    const stale = { "task-old": { reason: "示例：已到期的条目必须变红", expires: "2020-01-01" } };
    expect(expiredExemptions(stale)).toEqual(["task-old（2020-01-01 已到期）"]);
  });

  it("类名已补样式或已不再使用时，豁免条目必须删除（幽灵豁免）", () => {
    const ghosts = Object.keys(EXEMPTIONS).flatMap((token) => {
      const record = usage.get(token);
      if (!record) return [`${token}：JSX 里已不再使用`];
      if (classes.has(token)) return [`${token}：样式已存在（${[...record.files].join(", ")}）`];
      return [];
    });
    expect(ghosts).toEqual([]);
  });
});
