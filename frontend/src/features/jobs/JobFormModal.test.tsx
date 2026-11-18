// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobFormModal from "./JobFormModal";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  parseJobsMultiple: vi.fn(),
  updateJob: vi.fn(),
}));

// 展开真实模块再覆盖：显式列出导出时，生产代码新增一个导出就会让调用方直接抛
// "export is not defined"，表现成组件崩了。
vi.mock("../../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/jobs")>()),
  ...apiMocks,
}));

/** createJob 的返回值会被读 `id`（备选岗位导入要靠它标记"已导入"），所以用真形状。 */
function deferredJob() {
  let resolve!: (value: { id: number }) => void;
  const promise = new Promise<{ id: number }>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  apiMocks.createJob.mockReset();
  apiMocks.parseJobsMultiple.mockReset();
  apiMocks.updateJob.mockReset();
});

afterEach(() => cleanup());

describe("JobFormModal", () => {
  it("fills additional recruitment information returned by text parsing", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({
      items: [
        {
          title: "门店店长",
          company: "示例超市",
          location: "成都市武侯区",
          salary: "",
          job_type: "社招",
          description: "负责门店经营",
          requirements: "三年零售经验",
          additional_info: "提供员工宿舍，面试包含门店案例分析",
          source_url: "",
          posted_at: "2026-08-20",
          status: "开放中",
          warnings: [],
        },
      ],
    });
    render(
      <AntdApp>
        <JobFormModal open initial={null} onClose={vi.fn()} onSaved={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText("完整招聘信息"), {
      target: { value: "门店店长招聘信息" },
    });
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    await waitFor(() => expect(apiMocks.parseJobsMultiple).toHaveBeenCalledOnce());
    // 逐字段落位（I-35）：每个字段隔 60ms 写一次，所以要等到最后一步。
    await waitFor(() =>
      expect(screen.getByLabelText("其他招聘信息（选填）")).toHaveValue(
        "提供员工宿舍，面试包含门店案例分析",
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("发布时间（选填）")).toHaveValue("2026-08-20"),
    );
  });

  it("submits only once when the save button is activated repeatedly", async () => {
    const pending = deferredJob();
    apiMocks.createJob.mockReturnValue(pending.promise);
    const onClose = vi.fn();
    const onSaved = vi.fn();
    render(
      <AntdApp>
        <JobFormModal open initial={null} onClose={onClose} onSaved={onSaved} />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "前端工程师" } });
    fireEvent.change(screen.getByLabelText("岗位描述（JD）"), {
      target: { value: "负责前端应用开发" },
    });
    const saveButton = screen.getByText(/保\s*存/).closest("button");
    if (!saveButton) throw new Error("保存按钮未渲染");
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve({ id: 42 }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onClose).toHaveBeenCalledOnce();
  });
});

const DRAFT = {
  title: "门店店长",
  company: "示例超市",
  location: "成都市武侯区",
  salary: "",
  job_type: "社招",
  description: "负责门店经营",
  requirements: "三年零售经验",
  additional_info: "",
  source_url: "",
  posted_at: "",
  status: "开放中",
  warnings: ["识别结果来自截图，请对照截图核对后再保存。"],
  parse_engine: "ai" as const,
  recognized_text: "门店店长 示例超市 成都市武侯区",
};

function renderModal(onSaved = vi.fn()) {
  const view = render(
    <AntdApp>
      <JobFormModal open initial={null} onClose={vi.fn()} onSaved={onSaved} />
    </AntdApp>,
  );
  return view;
}

function pasteScreenshot(textarea: HTMLElement, name = "shot.png") {
  const file = new File([new Uint8Array(64)], name, { type: "image/png" });
  fireEvent.paste(textarea, {
    clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
  });
}

describe("JobFormModal 图片识别", () => {
  it("sends pasted screenshots even when the textarea is empty", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
    renderModal();
    const textarea = screen.getByLabelText("完整招聘信息");

    pasteScreenshot(textarea);
    await waitFor(() => expect(screen.getByAltText("shot.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    await waitFor(() => expect(apiMocks.parseJobsMultiple).toHaveBeenCalledOnce());
    const payload = apiMocks.parseJobsMultiple.mock.calls[0][0];
    expect(payload.text).toBe("");
    expect(payload.images).toHaveLength(1);
    expect(payload.images[0].name).toBe("shot.png");
    expect(payload.images[0].data.startsWith("data:image/png;base64,")).toBe(true);
    // 只有图片、没有文本时不该再提示"请先粘贴招聘信息"
    expect(screen.queryByText("请先粘贴招聘信息，或添加截图、上传文档")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("岗位名称")).toHaveValue("门店店长"));
  });

  it("sends an uploaded document in its own field", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
    renderModal();
    const input = document.querySelector(
      'input[type="file"][aria-label="添加截图或文档"]',
    ) as HTMLInputElement;
    const file = new File([new Uint8Array(64)], "jd.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("jd.docx")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    await waitFor(() => expect(apiMocks.parseJobsMultiple).toHaveBeenCalledOnce());
    const payload = apiMocks.parseJobsMultiple.mock.calls[0][0];
    // 图片与文档是两个请求字段：后端对它们的处理方式完全不同
    expect(payload.images).toEqual([]);
    expect(payload.documents).toHaveLength(1);
    expect(payload.documents[0].name).toBe("jd.docx");
  });

  it("accepts an image chosen from the file picker and lets it be removed", async () => {
    renderModal();
    // 弹窗内容被 portal 到 body，不能用 render 的 container 查
    const input = document.querySelector(
      'input[type="file"][aria-label="添加截图或文档"]',
    ) as HTMLInputElement;
    const file = new File([new Uint8Array(64)], "picker.png", { type: "image/png" });

    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("picker.png")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "移除文件 picker.png" }));
    await waitFor(() => expect(screen.queryByAltText("picker.png")).not.toBeInTheDocument());
  });

  it("shows the text the model read and never submits it as a job field", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
    apiMocks.createJob.mockResolvedValue({});
    renderModal();
    const textarea = screen.getByLabelText("完整招聘信息");

    pasteScreenshot(textarea);
    await waitFor(() => expect(screen.getByAltText("shot.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    // 折叠块默认收起，点开后能看到模型抄录的原文
    const toggle = await screen.findByText("查看模型识别到的原文（请对照截图核对）");
    fireEvent.click(toggle);
    expect(await screen.findByText("门店店长 示例超市 成都市武侯区")).toBeInTheDocument();

    // 逐字段落位要走完才能保存（岗位描述是必填，且是第 5 步）。
    await waitFor(() =>
      expect(screen.getByLabelText("岗位描述（JD）")).toHaveValue("负责门店经营"),
    );

    // 按 role 找按钮：警告条里也有"保存"两个字
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(apiMocks.createJob).toHaveBeenCalledOnce());
    expect(apiMocks.createJob.mock.calls[0][0]).not.toHaveProperty("recognized_text");
    expect(JSON.stringify(apiMocks.createJob.mock.calls[0][0])).not.toContain("门店店长 示例超市");
  });

  it("keeps saying where the fields came from after the toast is gone", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
    renderModal();

    pasteScreenshot(screen.getByLabelText("完整招聘信息"));
    await waitFor(() => expect(screen.getByAltText("shot.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    // 提示条会自己消失，而"AI 识别的还是本地规则认的"决定这些字段要核对到什么程度，
    // 所以必须留在表单上。
    const badge = await screen.findByText("AI 识别");
    expect(badge).toBeInTheDocument();

    fireEvent.mouseEnter(badge);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("校验过能在你给的内容里找到出处");
  });

  it("marks local-rule results as less trustworthy", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({
      items: [
        {
          ...DRAFT,
          parse_engine: "local" as const,
          recognized_text: "",
          warnings: [],
        },
      ],
    });
    renderModal();

    fireEvent.change(screen.getByLabelText("完整招聘信息"), { target: { value: "门店店长" } });
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    const badge = await screen.findByText("本地规则");
    fireEvent.mouseEnter(badge);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("准确度低于 AI 识别");
  });

  it("drops the source badge once the pasted text changes", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
    renderModal();
    const textarea = screen.getByLabelText("完整招聘信息");
    fireEvent.change(textarea, { target: { value: "门店店长" } });
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));
    expect(await screen.findByText("AI 识别")).toBeInTheDocument();

    // 换了内容，上一次识别的来源不再描述现在表单里的东西。
    fireEvent.change(textarea, { target: { value: "另一家公司" } });

    expect(screen.queryByText("AI 识别")).not.toBeInTheDocument();
  });

  it("keeps typed values when recognition comes back empty", async () => {
    apiMocks.parseJobsMultiple.mockResolvedValue({
      items: [
        {
          ...DRAFT,
          title: "",
          company: "",
          location: "",
          description: "",
          requirements: "",
          recognized_text: "",
          parse_engine: "local" as const,
        },
      ],
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "我手填的岗位" } });

    pasteScreenshot(screen.getByLabelText("完整招聘信息"));
    await waitFor(() => expect(screen.getByAltText("shot.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    // 什么都没识别出来时不能把用户已经填好的内容抹掉
    await waitFor(() => expect(apiMocks.parseJobsMultiple).toHaveBeenCalledOnce());
    expect(screen.getByLabelText("岗位名称")).toHaveValue("我手填的岗位");
  });

  it("warns instead of crashing when recognition returns no items", async () => {
    // 回归：纯截图 + AI 失败时后端曾返回空 items，前端解构 items[0] 直接崩出
    // "Cannot destructure property 'warnings' of 'result.items[0]'"。
    apiMocks.parseJobsMultiple.mockResolvedValue({
      items: [],
      parse_engine: "local",
      warnings: [
        "图片识别失败，可能是当前模型不支持图片输入（需要多模态模型）；已使用本地规则识别，请核对后保存。",
      ],
    });
    renderModal();
    fireEvent.change(screen.getByLabelText("岗位名称"), { target: { value: "我手填的岗位" } });
    // 纯截图场景：先贴一张截图，否则组件会在前端就被"请先粘贴材料"拦下
    pasteScreenshot(screen.getByLabelText("完整招聘信息"));
    await waitFor(() => expect(screen.getByAltText("shot.png")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));

    await waitFor(() => expect(apiMocks.parseJobsMultiple).toHaveBeenCalledOnce());
    // 不能崩、不能抹掉已填内容，并给出人话提示与原因说明
    expect(screen.getByLabelText("岗位名称")).toHaveValue("我手填的岗位");
    expect(await screen.findByText("没有识别到内容，请检查资料或稍后重试")).toBeInTheDocument();
    expect(await screen.findByText(/图片识别失败/)).toBeInTheDocument();
  });
});

/** I-35：识别结果逐字段落位。用假定时器推进，断言"顺序"而不是"多久"。 */
describe("JobFormModal 逐字段落位", () => {
  const TEXTAREA = "完整招聘信息";

  async function startRecognition() {
    fireEvent.change(screen.getByLabelText(TEXTAREA), { target: { value: "门店店长" } });
    fireEvent.click(screen.getByRole("button", { name: /识别并填充/ }));
    // 先让接口 promise 落地（不推进定时器，此时一个字段都还没写）
    await act(async () => {});
  }

  it("fills fields in the fixed order instead of all at once", async () => {
    vi.useFakeTimers();
    try {
      apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
      renderModal();
      await startRecognition();

      // 第一步：岗位名称（顺序表的第一项）
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(screen.getByLabelText("岗位名称")).toHaveValue("门店店长");
      // 岗位描述排在第 5 步，此时必须还是空的
      expect(screen.getByLabelText("岗位描述（JD）")).toHaveValue("");

      await act(async () => {
        vi.advanceTimersByTime(240);
      });
      expect(screen.getByLabelText("岗位描述（JD）")).toHaveValue("负责门店经营");

      // 走完之后：所有有值的字段都到了，没有值的字段不被写（不会闪一下再变空）
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.getByLabelText("公司名称")).toHaveValue("示例超市");
      expect(screen.getByLabelText("薪资范围")).toHaveValue("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops writing fields once the dialog is closed mid-fill", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    apiMocks.parseJobsMultiple.mockResolvedValue({ items: [DRAFT] });
    renderModal();
    await startRecognition();

    // 第一步刚写进去就关窗：剩下的 5 个字段还排在队列里
    await waitFor(() => expect(screen.getByLabelText("岗位名称")).toHaveValue("门店店长"));
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));

    // 关闭后继续走时间：不能在已卸载的表单上继续写（React 会报 update on unmounted）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(consoleError.mock.calls.filter((call) => String(call[0]).includes("unmounted"))).toEqual(
      [],
    );
    consoleError.mockRestore();
  });

  it("shows how many seconds the recognition has been running", async () => {
    vi.useFakeTimers();
    let release!: (value: { items: unknown[] }) => void;
    apiMocks.parseJobsMultiple.mockReturnValue(
      new Promise<{ items: unknown[] }>((resolve) => {
        release = resolve;
      }),
    );
    try {
      renderModal();
      await startRecognition();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      // 读数只在等待期出现：没有它，"识别中"就是一枚永远转的圈。
      // 文案复用既有的 `backgroundTasks.bar.elapsed`（不新增键），所以按该键取。
      expect(
        screen.getByText(t("backgroundTasks.bar.elapsed", { seconds: 3 })),
      ).toBeInTheDocument();

      await act(async () => {
        release({ items: [DRAFT] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(
        screen.queryByText(t("backgroundTasks.bar.elapsed", { seconds: 4 })),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
