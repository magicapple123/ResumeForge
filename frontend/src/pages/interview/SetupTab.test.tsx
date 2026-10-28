// SPDX-License-Identifier: Apache-2.0
/**
 * 面试官设定卡：深链 ?job_id= 预填关联岗位（RF-11）+ 0066 的「岗位与简历都必选」。
 *
 * 0066 的两条硬约束在这里钉住：
 * 1. 未选岗位/简历时点「开始面试」**不会**回调 onStart，而是给出校验提示
 *    （后端也会 422，但用户不该走到那一步）；
 * 2. 关联简历的候选 = 所选岗位关联的简历 + 通用简历，岗位未选时下拉是禁用的；
 *    岗位一变，已选简历被清空（面试官只读"这份简历 + 这个岗位的 JD"，不能串）。
 *
 * 断言一律用 `t()` 或 role/label 定位（不用中文 `*ByText`）：测试里的中文断言也属于
 * 将来要迁移的存量，守卫会盯着。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { SetupTab, type SetupForm } from "./SetupTab";

// 关联岗位 / 关联简历下拉都是组件内部远程搜索（P0-1）：取数与按 id 回查走这两个 API。
const jobsMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
}));
const resumesMocks = vi.hoisted(() => ({
  listResumes: vi.fn(),
  getResume: vi.fn(),
}));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);

const JOB_OPTIONS = [
  { id: 7, title: "市场运营专员", company: "示例科技" },
  { id: 9, title: "后端开发工程师", company: "另一家" },
];
const RESUME_OPTIONS = [
  { id: 1, title: "本岗位简历" },
  { id: 2, title: "通用简历" },
];

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: JOB_OPTIONS, total: 2 });
  jobsMocks.getJob
    .mockReset()
    .mockImplementation((id: number) =>
      Promise.resolve(JOB_OPTIONS.find((job) => job.id === id) ?? null),
    );
  resumesMocks.listResumes
    .mockReset()
    .mockResolvedValue({ items: RESUME_OPTIONS, total: RESUME_OPTIONS.length });
  resumesMocks.getResume
    .mockReset()
    .mockImplementation((id: number) =>
      Promise.resolve(RESUME_OPTIONS.find((item) => item.id === id) ?? null),
    );
});

/** antd 的 form 实例必须来自 Form.useForm，用一层包装组件注入。 */
function SetupHarness(props: { initialJobId?: number; onStart: (values: SetupForm) => void }) {
  const [form] = Form.useForm<SetupForm>();
  return (
    <AntdApp>
      <SetupTab
        form={form}
        initialJobId={props.initialJobId}
        starting={false}
        onStart={props.onStart}
      />
    </AntdApp>
  );
}

function renderSetup(props: { initialJobId?: number; onStart?: (values: SetupForm) => void } = {}) {
  const onStart = props.onStart ?? vi.fn();
  render(<SetupHarness initialJobId={props.initialJobId} onStart={onStart} />);
  return { onStart };
}

/**
 * 打开某个 Select 并按文案点选项。
 *
 * 不用 `findAllByRole("option")`：antd 6 的下拉项是 `div.ant-select-item-option`，
 * `role="option"` 只出现在一个只含"当前值"的无障碍节点上（实测拿到的是 `7` 这种原始值）。
 * 同样不用中文 `*ByText`——测试里的中文断言也要计入存量。
 */
async function pickOption(label: string, optionText: string) {
  fireEvent.mouseDown(screen.getByLabelText(label));
  await waitFor(() =>
    expect(document.querySelectorAll(".ant-select-item-option").length).toBeGreaterThan(0),
  );
  const options = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option"));
  const target = options.find((option) => option.textContent?.includes(optionText));
  if (!target) {
    throw new Error(
      `没有找到选项：${optionText}；实际候选：${options.map((item) => item.textContent).join(" | ")}`,
    );
  }
  fireEvent.click(target);
}

/** 把必填的两项都选好（岗位 7 + 该岗位的简历 1）。 */
async function pickJobAndResume() {
  await pickOption(t("interviewPage.setup.jobLabel"), "市场运营专员");
  await waitFor(() =>
    expect(screen.getByLabelText(t("interviewPage.setup.resumeLabel"))).not.toBeDisabled(),
  );
  await pickOption(t("interviewPage.setup.resumeLabel"), "本岗位简历");
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("interviewPage.setup.start")) }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SetupTab 关联岗位预填（RF-11）", () => {
  it("带 initialJobId 进入：按 id 回查后，关联岗位 Select 显示该岗位", async () => {
    renderSetup({ initialJobId: 7 });

    // antd Select 显示选中项的 label；label 来自 ensure 的按 id 回查（P0-1）。
    expect(await screen.findByText("市场运营专员 · 示例科技")).toBeInTheDocument();
  });

  it("回查不到的 id：仍设置值（显示原始 id），不强造选项", async () => {
    renderSetup({ initialJobId: 123 });

    // getJob(123) 返回 null（岗位不存在），Select 保持显示原始值。
    await waitFor(() => expect(jobsMocks.getJob).toHaveBeenCalledWith(123));
    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.queryByText(/强造/)).toBeNull();
  });

  it("不带 initialJobId：关联岗位为空（保持现状）", () => {
    renderSetup();

    expect(screen.queryByText(/市场运营专员/)).toBeNull();
  });
});

describe("SetupTab 关联岗位与关联简历都必选（0066）", () => {
  it("两项都没选就点开始：不回调 onStart，并给出校验提示", async () => {
    const { onStart } = renderSetup();

    await submit();

    expect(await screen.findByText(t("interviewPage.setup.jobRequired"))).toBeInTheDocument();
    expect(screen.getByText(t("interviewPage.setup.resumeRequired"))).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("岗位未选时关联简历下拉是禁用的（候选要有岗位才有意义）", () => {
    renderSetup();

    expect(screen.getByLabelText(t("interviewPage.setup.resumeLabel"))).toBeDisabled();
  });

  it("选好岗位后候选变成「该岗位的 + 通用的」简历，提交时两项一起带出", async () => {
    const { onStart } = renderSetup();

    await pickJobAndResume();
    await submit();

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ jobId: 7, resumeId: 1 }));
    // 候选请求带 include_general：真实面试里通用简历同样可选。
    expect(resumesMocks.listResumes).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 7, include_general: true }),
    );
  });

  it("改了岗位就清空已选简历（不让上一份岗位的简历被带过来）", async () => {
    const { onStart } = renderSetup();

    await pickJobAndResume();
    // 换成另一个岗位：已选简历作废，提交流程必须重新选。
    await pickOption(t("interviewPage.setup.jobLabel"), "后端开发工程师");
    await submit();

    expect(await screen.findByText(t("interviewPage.setup.resumeRequired"))).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("SetupTab 轮数选择", () => {
  it("默认固定轮数：提交带具体轮数值", async () => {
    const { onStart } = renderSetup();

    await pickJobAndResume();
    expect(screen.getByLabelText(t("interviewPage.setup.roundsLabel"))).toBeInTheDocument();
    await submit();

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ rounds: 6 }));
  });

  it("轮数下拉选「自动」：提交带 auto（页面据此改走自动收尾模式）", async () => {
    const { onStart } = renderSetup();

    await pickJobAndResume();
    await pickOption(t("interviewPage.setup.roundsLabel"), t("interviewPage.setup.roundsAuto"));
    await submit();

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ rounds: "auto" }));
  });
});
