// SPDX-License-Identifier: Apache-2.0
/**
 * W07-TL 可达性回归（2026-10-28 用户反馈「制作台找不到文字级别」）。
 *
 * ## 被钉住的缺陷
 *
 * 制作台里"对象身份"（局部排版 / 文字级别）以 `format_config.objects[object_id]` 和
 * `data-object-id` 为锚点。后端读取旧记录时不物化条目 id（W01），所以 content 里的条目
 * 可能没有 id；若大纲给它现生成一套随机 id、上下文面板却按 content 里的原值 findEntry，
 * 两边对不上 → `selectedObjectId` 恒为 null → 参数栏不渲染「文字级别」工具条。
 * Lead 的修复是 ResumeZoomModal 用 `ensureEntryIds` 物化**同一份** content 传给大纲 /
 * 上下文面板 / 编辑 / 保存；本文件用"不带 id 的 content + 真实左栏挂载"把这个性质变成红测试。
 *
 * ## 覆盖
 *
 * 1. content 里条目不带 id → 打开「文档大纲」→ 点第一条 → 切「排版参数」→ 出现
 *    `[data-text-level-bar]`、「文字级别」与目标数 1；
 * 2. 大纲多选两条 → 参数栏文字级别目标数为 2（批量入口同样可达）。
 *
 * 只用测试夹具里虚构的项目名；断言文案走 t()（cjkRatchet 的 tests 口径）。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeContent } from "../../../types/resume";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { renderModal } from "../ResumeZoomModal.testkit";

vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布桩：可达性与画布渲染无关，留一个空 iframe 让 shell 正常挂载。
vi.mock("../../ResumePreview", () => ({
  default: () => <iframe title="workbench-preview" />,
}));

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";

/** 关键夹具：两条项目**都没有 id**（旧记录就是这种形状），制作台必须自己物化身份。 */
const CONTENT_WITHOUT_IDS: ResumeContent = {
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [
    {
      name: PROJECT_A,
      role: "",
      start_date: "",
      end_date: "",
      tech_stack: [],
      description: ["甲一"],
      highlights: [],
    },
    {
      name: PROJECT_B,
      role: "",
      start_date: "",
      end_date: "",
      tech_stack: [],
      description: ["乙一"],
      highlights: [],
    },
  ],
  skills: [],
  awards: [],
};

function openOutlineTab(): void {
  fireEvent.click(screen.getByText(t("outline.panel.title")));
}

function openParamsTab(): void {
  fireEvent.click(screen.getByText(t("responsive.action.params")));
}

function entryRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'));
}

/** 大纲行 key 里第 3 段就是对象 id（`entry:<field>:<objectId>`）：物化后的稳定身份。 */
function objectIdOfRow(row: HTMLElement): string {
  return (row.dataset.treeKey ?? "").split(":")[2] ?? "";
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("文字级别可达性 · content 没有条目 id", () => {
  it("大纲选中一条 → 排版参数出现文字级别条（目标数 1），应用级别写回该物化 id", async () => {
    const onApplyLayout = vi.fn();
    renderModal({ content: CONTENT_WITHOUT_IDS, onApplyLayout });
    openOutlineTab();
    const tree = await screen.findByRole("tree", { name: t("outline.tree.label") });
    expect(entryRows()).toHaveLength(2);
    // 前置断言：content 里没有 id，但大纲行拿到的是物化后的合法对象 id（否则下面点击必然对不上）。
    const objectId = objectIdOfRow(entryRows()[0]);
    expect(objectId).toMatch(/^[A-Za-z0-9_-]{8,32}$/);

    fireEvent.click(within(tree).getByText(PROJECT_A));
    openParamsTab();

    const bar = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-text-level-bar="1"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(within(bar).getByText(t("typography.level.title"))).toBeInTheDocument();
    expect(within(bar).getByText(t("typography.level.count", { count: 1 }))).toBeInTheDocument();
    // 当前级别从反推结果读：没设置过 = 跟随模板（顺带证明级别状态链路可用）。
    expect(
      within(bar).getByText(
        t("typography.level.current", { level: t("typography.level.currentInherit") }),
      ),
    ).toBeInTheDocument();

    // 应用一级标题：一次 layout 提交、写到**大纲行那个**对象 id 上（两端身份对得上才算可达）。
    fireEvent.click(within(bar).getByRole("button", { name: t("typography.level.heading1") }));
    expect(onApplyLayout).toHaveBeenCalledTimes(1);
    const nextLayout = onApplyLayout.mock.calls[0][0] as {
      format_config: { objects?: Record<string, Record<string, unknown>> };
    };
    expect(nextLayout.format_config.objects?.[objectId]).toMatchObject({
      font_scale: 1.4,
      bold: true,
    });
  });

  it("大纲多选两条 → 排版参数的文字级别目标数为 2", async () => {
    renderModal({ content: CONTENT_WITHOUT_IDS });
    openOutlineTab();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    const rows = entryRows();
    expect(rows).toHaveLength(2);
    fireEvent.keyDown(rows[0], { key: " " });
    fireEvent.keyDown(rows[1], { key: " " });
    expect(screen.getByText(t("outline.batch.selected", { count: 2 }))).toBeInTheDocument();

    openParamsTab();
    const bar = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-text-level-bar="1"]');
      expect(node).not.toBeNull();
      return node as HTMLElement;
    });
    expect(within(bar).getByText(t("typography.level.count", { count: 2 }))).toBeInTheDocument();
  });
});
