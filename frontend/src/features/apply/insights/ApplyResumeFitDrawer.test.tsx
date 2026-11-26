// SPDX-License-Identifier: Apache-2.0
/**
 * #15D 优化指派抽屉（整改 #17 后的四列版）：只推荐有提升的那些，换用走现有改简历接口。
 *
 * 五条关键判据（都不是"元素存在"级别的）：
 * - 表头**恰好四列**，且「现在」列的主行不再把 `defaultResume`（"按默认规则解析"）那句
 *   系统解释当简历名渲染——没有指定简历时写「未指定（按默认规则自动选）」；
 * - `current_coverage === null` 时 chip 是「新指派」，**全页不出现 `+` 开头的 chip**
 *   （后端 `baseline = current_coverage or 0`，那时 `gain` 是"从无到 N"，不是"提升 N"）；
 * - `gain <= 0` 的行**不渲染任何按钮**，操作列给灰色「—」；
 * - 「换用」按钮的数量 == 可换行数；提交只带 `resume_id`；
 * - 「全部换用」只处理可换的行，避免重复提交。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyQueueItem, ApplyResumeFitItem, ApplyResumeFitList } from "../../../types";

const apiMocks = vi.hoisted(() => ({
  getResumeFit: vi.fn(),
  updateQueueItem: vi.fn(),
  listResumes: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  getResumeFit: apiMocks.getResumeFit,
}));

vi.mock("../../../api/apply", () => ({
  updateQueueItem: apiMocks.updateQueueItem,
}));

vi.mock("../../../api/resumes", () => ({
  listResumes: apiMocks.listResumes,
}));

import ApplyResumeFitDrawer from "./ApplyResumeFitDrawer";

/** 长到一定会被 198px 的岗位列省略：用来钉住"省略必须配 Tooltip 全文"。 */
const LONG_JOB_TITLE = "Senior Backend Engineer (Payments Platform, Remote-Friendly)";

function queueItem(overrides: Partial<ApplyQueueItem> & Pick<ApplyQueueItem, "id">): ApplyQueueItem {
  return {
    job_id: overrides.id + 10,
    job_title: "",
    company: "Acme",
    resume_id: null,
    resume_title: "",
    greeting: "",
    sort_order: 0,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
    ...overrides,
  };
}

/**
 * 三条数据覆盖 chip 三态 + 两种「现在」：
 * - 1：有基线、有提升 → `+35`；
 * - 2：有基线、无提升 → 「已是最优 / 无需更换」+ 操作列「—」；
 * - 3：**没有基线**（`current_coverage === null`）、`gain = 67` → 「新指派」（不是 `+67`）。
 */
const ITEMS: ApplyQueueItem[] = [
  queueItem({ id: 1, job_id: 11, job_title: "Backend Engineer", resume_id: 3, resume_title: "General" }),
  queueItem({
    id: 2,
    job_id: 12,
    job_title: "Frontend Engineer",
    resume_id: 4,
    resume_title: "Frontend general",
  }),
  queueItem({ id: 3, job_id: 13, job_title: LONG_JOB_TITLE, company: "Globex" }),
];

function fitOf(rows: ApplyResumeFitItem[]): ApplyResumeFitList {
  return { items: rows };
}

const FIT = fitOf([
  {
    queue_id: 1,
    job_id: 11,
    current_resume_id: 3,
    current_coverage: 40,
    recommended_resume_id: 5,
    recommended_coverage: 75,
    gain: 35,
    reason: "more keyword hits",
  },
  {
    queue_id: 2,
    job_id: 12,
    current_resume_id: 4,
    current_coverage: 80,
    recommended_resume_id: 6,
    recommended_coverage: 80,
    gain: 0,
    reason: "",
  },
  {
    queue_id: 3,
    job_id: 13,
    current_resume_id: null,
    current_coverage: null,
    recommended_resume_id: 7,
    recommended_coverage: 67,
    gain: 67,
    reason: "",
  },
]);

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getResumeFit.mockResolvedValue(FIT);
  apiMocks.updateQueueItem.mockImplementation((id: number) =>
    Promise.resolve(ITEMS.find((item) => item.id === id)),
  );
  apiMocks.listResumes.mockResolvedValue({
    items: [
      { id: 5, title: "Backend edition" },
      { id: 6, title: "Frontend edition" },
      { id: 7, title: "ATS edition" },
    ],
    total: 2,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderDrawer() {
  return render(
    <AntdApp>
      <ApplyResumeFitDrawer open items={ITEMS} onClose={vi.fn()} onApplied={vi.fn()} />
    </AntdApp>,
  );
}

function rowOf(jobTitle: string): HTMLElement {
  const cell = screen.getByText(jobTitle);
  const row = cell.closest("tr");
  if (!row) throw new Error("row not found");
  return row as HTMLElement;
}

/** 页面上以 `+` 开头的 chip（"提升 N 个百分点"）。无基线时一个都不该有。 */
function plusChips(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".ant-tag")]
    .map((node) => (node.textContent ?? "").trim())
    .filter((text) => text.startsWith("+"));
}

const SWAP = t("applyQueue.insights.fit.swap");

describe("ApplyResumeFitDrawer · 四列两栏", () => {
  it("表头恰好四列：岗位 / 现在 / 建议换成 / 操作", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    // 抽屉是 portal（挂在 body 上），查询只能走 document，不能走 render 的 container。
    const headers = [...document.querySelectorAll(".ant-table-thead th")].map((th) =>
      (th.textContent ?? "").trim(),
    );
    expect(headers).toEqual([
      t("applyQueue.insights.fit.column.job"),
      t("applyQueue.insights.fit.column.current"),
      t("applyQueue.insights.fit.column.recommended"),
      t("applyQueue.insights.fit.column.action"),
    ]);
  });

  it("「现在」列主行是简历名／「未指定」，不再是「按默认规则解析」那句解释", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    // 有简历：主行就是队列条目自己的标题。
    expect(within(rowOf("Backend Engineer")).getByText("General")).toBeInTheDocument();
    // 没简历：主行明确写「未指定（按默认规则自动选）」。
    expect(
      within(rowOf(LONG_JOB_TITLE)).getByText(t("applyQueue.insights.fit.now.unspecified")),
    ).toBeInTheDocument();
    // 系统解释句整页都不该再出现（它占过整列 9 行）。
    expect(screen.queryByText(t("applyQueue.detail.defaultResume"))).toBeNull();
  });

  it("没有基线时 chip 是「新指派」，全页不存在 `+` 开头的 chip", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    const row = rowOf(LONG_JOB_TITLE);
    expect(
      within(row).getByText(t("applyQueue.insights.fit.chip.new")),
    ).toBeInTheDocument();
    // gain 是 67，但当前没有基线：写「+67」会把"从无到 67"说成"提升了 67 点"。
    expect(within(row).queryByText("+67")).toBeNull();
    // 全页唯一以 `+` 开头的 chip 来自**真有基线**的那一行（queue_id=1 的 +35）。
    expect(plusChips(document.body)).toEqual([
      t("applyQueue.insights.fit.gain", { gain: 35 }),
    ]);
  });

  it("全部条目都没有基线时，页面依然不出现任何 `+` chip", async () => {
    apiMocks.getResumeFit.mockResolvedValue(
      fitOf(
        ITEMS.map((item) => ({
          queue_id: item.id,
          job_id: item.job_id,
          current_resume_id: null,
          current_coverage: null,
          recommended_resume_id: 7,
          recommended_coverage: 71,
          gain: 71,
          reason: "",
        })),
      ),
    );

    renderDrawer();

    await screen.findAllByText(t("applyQueue.insights.fit.chip.new"));
    expect(plusChips(document.body)).toEqual([]);
  });

  it("有基线且有提升时才给「+N」", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    const row = rowOf("Backend Engineer");
    expect(
      within(row).getByText(t("applyQueue.insights.fit.gain", { gain: 35 })),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(t("applyQueue.insights.fit.coverageLine", { percent: 40 })),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(t("applyQueue.insights.fit.coverageLine", { percent: 75 })),
    ).toBeInTheDocument();
  });

  it("岗位列省略但 Tooltip 给全文", async () => {
    renderDrawer();

    await screen.findByText(LONG_JOB_TITLE);
    fireEvent.mouseEnter(screen.getByText(LONG_JOB_TITLE));
    await waitFor(
      () => {
        const tips = [...document.querySelectorAll(".ant-tooltip")].filter(
          (node) => !node.classList.contains("ant-tooltip-hidden"),
        );
        expect(tips).toHaveLength(1);
        expect(tips[0].textContent ?? "").toContain(LONG_JOB_TITLE);
      },
      { timeout: 2000 },
    );
  });
});

describe("ApplyResumeFitDrawer · 操作列", () => {
  it("已最优的行没有任何按钮，只有灰色「—」", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    const row = rowOf("Frontend Engineer");
    expect(
      within(row).getByText(t("applyQueue.insights.fit.bestRow")),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(t("applyQueue.insights.fit.chip.noChange")),
    ).toBeInTheDocument();
    // 点了只会变差的按钮不该存在（哪怕是 disabled）。
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("「换用」按钮数量 == 可换行数（3 行里 2 行可换）", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    expect(screen.getAllByRole("button", { name: SWAP })).toHaveLength(2);
  });

  it("点「换用」后该行变「已换用」，且只带 resume_id", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    fireEvent.click(within(rowOf("Backend Engineer")).getByRole("button", { name: SWAP }));

    await waitFor(() => expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(1, { resume_id: 5 }));
    expect(apiMocks.updateQueueItem).toHaveBeenCalledTimes(1);
    expect(
      await within(rowOf("Backend Engineer")).findByText(
        t("applyQueue.insights.fit.swapped"),
      ),
    ).toBeInTheDocument();
    // 换过的那一行不再出现「换用」按钮：可换数从 2 变 1。
    await waitFor(() => expect(screen.getAllByRole("button", { name: SWAP })).toHaveLength(1));
  });

  it("「全部换用（n）」只处理可换的行，n 与可换数一致", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    const swapAllName = t("applyQueue.insights.fit.swapAllCount", { count: 2 });
    const button = screen.getByRole("button", { name: swapAllName });
    expect(button.textContent).toBe(swapAllName);

    fireEvent.click(button);

    await waitFor(() => expect(apiMocks.updateQueueItem).toHaveBeenCalledTimes(2));
    expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(1, { resume_id: 5 });
    expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(3, { resume_id: 7 });
    // 0 收益的那条（queue_id=2）不该被顺手改掉。
    expect(apiMocks.updateQueueItem).not.toHaveBeenCalledWith(2, expect.anything());
  });
});

describe("ApplyResumeFitDrawer · 说明与摘要", () => {
  it("顶部给用途说明与「关键词覆盖率」解释，底部给摘要与取消", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    expect(screen.getByText(t("applyQueue.insights.fit.intro"))).toBeInTheDocument();
    expect(
      screen.getByText(t("applyQueue.insights.fit.coverageHelpLabel")),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        t("applyQueue.insights.fit.summary", { total: 3, swappable: 2, best: 1 }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("applyQueue.insights.fit.cancel") }),
    ).toBeInTheDocument();
  });

  it("keeps the drawer usable when coverage cannot be computed", async () => {
    apiMocks.getResumeFit.mockRejectedValue(new Error("boom"));

    renderDrawer();

    expect(await screen.findByText(t("applyQueue.insights.fit.error"))).toBeInTheDocument();
  });
});
