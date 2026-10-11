/**
 * 「采集记录」摘要行：搜索采集与「补齐详情」是两种口径，不能混。
 *
 * 两者都是 `kind=collect`、都会出现在这份记录里。若按同一套搜索口径渲染，补详情批次会显示成
 * 「已暂存 0 个」「采集条件：关键词：xxx」——两个字段对它都没有意义，纯误导。这里钉住两种口径
 * 各自正确，且互不串味。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyTask } from "../../types";
import { formatDateTime } from "../../utils/format";
import CollectRecordsPanel from "./CollectRecordsPanel";

const apiMocks = vi.hoisted(() => ({ listApplyTasksPage: vi.fn() }));

vi.mock("../../api/apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/apply")>();
  return { ...actual, listApplyTasksPage: apiMocks.listApplyTasksPage };
});

// 展开后的「本次采集结果」会自己去拉候选接口；这里只想验摘要行，替换掉它。
vi.mock("./CollectResultPanel", () => ({ default: () => null }));

const BACKFILL_MESSAGE =
  "已为 1 条岗位补齐职位描述。另有 1 条跳过（已有描述 / 仍然抓不到 / 已在回收站里）。";

function task(overrides: Partial<ApplyTask> = {}): ApplyTask {
  return {
    id: 1,
    kind: "collect",
    status: "completed",
    total: 3,
    processed: 3,
    succeeded: 3,
    failed: 0,
    skipped: 2,
    current_step: "idle",
    stop_reason: "done",
    config: { keywords: ["后端"], city: "北京" },
    message: "采集完成：已暂存 3 个岗位。",
    started_at: null,
    finished_at: "2026-09-18T10:05:00",
    created_at: "2026-09-18T10:00:00",
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <CollectRecordsPanel />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** listApplyTasksPage 的响应是 `Page{items,total}`，测试里统一从这个工厂出。 */
function pageOf(items: ApplyTask[], total: number) {
  return { items, total };
}

beforeEach(() => {
  apiMocks.listApplyTasksPage.mockReset();
});

afterEach(cleanup);

describe("CollectRecordsPanel", () => {
  it("搜索批次照旧显示关键词/城市与已暂存条数", async () => {
    apiMocks.listApplyTasksPage.mockResolvedValue(pageOf([task()], 1));
    renderPanel();

    expect(await screen.findByText("已暂存 3 个，重复 2 个")).toBeInTheDocument();
    expect(screen.getByText("关键词：后端；城市：北京")).toBeInTheDocument();
    expect(screen.getByText(formatDateTime("2026-09-18T10:05:00"))).toBeInTheDocument();
  });

  it("按服务端分页请求 /apply/tasks/page：kind=collect、第 1 页、每页 20 条", async () => {
    // 收口轮：面板改走 GET /api/apply/tasks/page（服务端分页），请求参数必须钉住
    // kind=collect（只列采集批次，不带投递批次）、page=1、page_size=20。
    apiMocks.listApplyTasksPage.mockResolvedValue(pageOf([task()], 1));
    renderPanel();

    expect(await screen.findByText("已暂存 3 个，重复 2 个")).toBeInTheDocument();
    expect(apiMocks.listApplyTasksPage).toHaveBeenCalledWith("collect", 1, 20);
  });

  it("total 来自响应并在分页器上显示（共 N 次采集）", async () => {
    apiMocks.listApplyTasksPage.mockResolvedValue(pageOf([task()], 110));
    renderPanel();

    expect(await screen.findByText("已暂存 3 个，重复 2 个")).toBeInTheDocument();
    expect(screen.getByText("共 110 次采集")).toBeInTheDocument();
  });

  it("翻到第 2 页时以 (collect, 2, 20) 重新拉取并渲染第 2 页内容", async () => {
    // 110 条、每页 20：第 1 页 20 条、第 2 页 20 条。摘要行不渲染 message（那在展开区里），
    // 所以两页用**逐条不同的 succeeded 计数**（避免 20 条重复文案让 findByText 报
    // multiple elements）：第 2 页首条是「已暂存 100 个，重复 2 个」。
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      task({ id: index + 1, succeeded: 3 + index, skipped: 2 }),
    );
    const secondPage = Array.from({ length: 20 }, (_, index) =>
      task({ id: 100 + index, succeeded: 100 + index, skipped: 2 }),
    );
    apiMocks.listApplyTasksPage
      .mockResolvedValueOnce(pageOf(firstPage, 110))
      .mockResolvedValueOnce(pageOf(secondPage, 110));
    renderPanel();

    // 先等第一页渲染完成（分页器出现「共 110 次采集」），确认只请求过一次。
    expect(await screen.findByText("共 110 次采集")).toBeInTheDocument();
    expect(apiMocks.listApplyTasksPage).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("listitem", { name: "2" }));

    expect(await screen.findByText("已暂存 100 个，重复 2 个")).toBeInTheDocument();
    expect(apiMocks.listApplyTasksPage).toHaveBeenLastCalledWith("collect", 2, 20);
  });

  it("搜索批次没有条件时显示占位文案，不会渲染成空行", async () => {
    // conditionText 对搜索批次永远给一句可读文案（真条件，或"（未记录采集条件）"），
    // 因此 `{condition && <Text/>}` 不会漏出一个空节点、摘要行也不会被多余分隔符撕开。
    apiMocks.listApplyTasksPage.mockResolvedValue(
      pageOf(
        [task({ config: {}, succeeded: 1, skipped: 0, message: "采集完成：已暂存 1 个岗位。" })],
        1,
      ),
    );
    renderPanel();

    expect(await screen.findByText("（未记录采集条件）")).toBeInTheDocument();
    // 摘要行仍在同一标签里：占位与结果之间没有被断成空行。
    expect(screen.getByText("已暂存 1 个")).toBeInTheDocument();
  });

  it("补详情批次不显示「已暂存」和采集条件，改用后端文案", async () => {
    apiMocks.listApplyTasksPage.mockResolvedValue(
      pageOf(
        [
          task({
            id: 9,
            total: 2,
            processed: 2,
            succeeded: 2,
            skipped: 1,
            // 补详情的 config 里确实带着已保存的采集配置（keywords/city），但显示时不该拿它当"条件"。
            config: {
              keywords: ["测试关键词"],
              city: "上海",
              backfill_job_ids: [1, 2],
              backfilled: 1,
              backfill_skipped: 1,
            },
            message: BACKFILL_MESSAGE,
          }),
        ],
        1,
      ),
    );
    renderPanel();

    // 后端文案被直接采用（不另造一套措辞）。
    expect((await screen.findAllByText(BACKFILL_MESSAGE)).length).toBeGreaterThan(0);
    // 搜索口径的摘要与"采集条件"都不能出现。
    expect(screen.queryByText(/已暂存/)).not.toBeInTheDocument();
    expect(screen.queryByText(/测试关键词/)).not.toBeInTheDocument();
    expect(screen.queryByText(/上海/)).not.toBeInTheDocument();
  });

  it("补详情批次 message 为空时按 task.succeeded/skipped 兜底，不读 config 的账目", async () => {
    // 模拟「用户中途停止」：停止路径不写 message、run() 的收尾（写 config.backfilled /
    // backfill_skipped）也没执行，所以 config 里**只有** backfill_job_ids。此时若兜底去读
    // config.backfilled，会拿到 undefined→0，显示成「已补齐 0 条」（其实已补好 5 条）。
    // 只有 succeeded/skipped 是逐条同步、停止时也正确的数据源。
    apiMocks.listApplyTasksPage.mockResolvedValue(
      pageOf(
        [
          task({
            id: 11,
            status: "stopped",
            total: 7,
            processed: 7,
            succeeded: 5,
            skipped: 2,
            failed: 0,
            config: { backfill_job_ids: [1, 2, 3] },
            message: "",
          }),
        ],
        1,
      ),
    );
    renderPanel();

    expect(await screen.findByText(/已补齐 5 条/)).toBeInTheDocument();
    expect(screen.getByText(/跳过 2 条/)).toBeInTheDocument();
    // 关键回归判据：绝不能出现从 config 读出的 0，也不能串成搜索口径的「已暂存」。
    expect(screen.queryByText(/已补齐 0 条/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已暂存/)).not.toBeInTheDocument();
  });

  it("已完成的采集批次给出「查看候选岗位」下一步跳转（→ 岗位广场 /jobs）", async () => {
    apiMocks.listApplyTasksPage.mockResolvedValue(pageOf([task()], 1));
    renderPanel();

    // Collapse 折叠态不渲染 children：先展开记录，再断言展开区里的跳转入口。
    fireEvent.click(await screen.findByText("已暂存 3 个，重复 2 个"));
    const link = await screen.findByRole("link", { name: "查看候选岗位" });
    expect(link).toHaveAttribute("href", "/jobs");
  });

  it("仍在推进的批次不显示下一步跳转（跑完之前没有「然后呢」可看）", async () => {
    apiMocks.listApplyTasksPage.mockResolvedValue(
      pageOf([task({ status: "running", finished_at: null })], 1),
    );
    renderPanel();

    fireEvent.click(await screen.findByText("已暂存 3 个，重复 2 个"));
    // 展开区已渲染（message 提示只在展开区里），但跳转入口不该出现。
    await screen.findByText("采集完成：已暂存 3 个岗位。");
    expect(screen.queryByRole("link", { name: "查看候选岗位" })).not.toBeInTheDocument();
  });
});
