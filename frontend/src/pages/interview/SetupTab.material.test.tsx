// SPDX-License-Identifier: Apache-2.0
/**
 * 面试材料「二选一」（#41）：从记录选，或导入文件。
 *
 * 这里钉住三件事：
 * 1. 默认走"从记录选"，切换后才出现"选择文件"入口（两种来源互斥，不会同时生效）；
 * 2. 上传成功后**当场**显示文件名与读取到的字数——用户不必等到点"开始面试"才知道
 *    这份文件能不能用；
 * 3. 选了"导入文件"却没上传就提交：**不回调** onStart（否则会开出一场没有材料的面试）。
 *
 * 断言一律用 `t()` 或 role 定位（不用中文 `*ByText`）：测试里的中文断言也属于将来要
 * 迁移的存量，守卫会盯着。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { SetupTab, type SetupForm } from "./SetupTab";

// 关联岗位 / 关联简历下拉是组件内部远程搜索（P0-1）：取数与按 id 回查走这两个 API。
const jobsMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
// 材料上传：解析结果由用例决定，组件只负责把它显示出来并交给页面。
const interviewMocks = vi.hoisted(() => ({ extractInterviewMaterial: vi.fn() }));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);
vi.mock("../../api/interview", () => interviewMocks);

const JOB_TEXT = "Backend JD: Python and SQL";
const RESUME_TEXT = "Alex, backend engineer";

function SetupHarness(props: { onStart: (values: SetupForm) => void }) {
  const [form] = Form.useForm<SetupForm>();
  return (
    <AntdApp>
      <SetupTab form={form} starting={false} onStart={props.onStart} />
    </AntdApp>
  );
}

function renderSetup() {
  const onStart = vi.fn();
  render(<SetupHarness onStart={onStart} />);
  return { onStart };
}

/** 取某一侧的来源开关（岗位侧在前、简历侧在后，两侧各一组按钮式 Radio）。 */
function sourceRadio(side: "job" | "resume", label: string) {
  const radios = screen.getAllByRole("radio", { name: label });
  expect(radios.length).toBe(2);
  return radios[side === "job" ? 0 : 1];
}

/** 切到某一侧的"导入文件"来源。 */
function pickFileSource(side: "job" | "resume") {
  fireEvent.click(sourceRadio(side, t("interviewPage.setup.material.fromFile")));
}

/** 「选择文件 / 换一份」按钮：按钮里带图标，accessible name 会被图标的 aria-label 前缀污染。 */
function fileButton(label: string) {
  return screen.getByRole("button", { name: new RegExp(label) });
}

/** 给第 index 个文件输入框喂一个文件（antd Upload 的 beforeUpload 会在 change 时触发）。 */
async function upload(index: number, file: File) {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  expect(inputs.length).toBeGreaterThan(index);
  Object.defineProperty(inputs[index], "files", { value: [file], configurable: true });
  fireEvent.change(inputs[index]);
  await waitFor(() => expect(interviewMocks.extractInterviewMaterial).toHaveBeenCalled());
}

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobsMocks.getJob.mockReset().mockResolvedValue(null);
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  resumesMocks.getResume.mockReset().mockResolvedValue(null);
  interviewMocks.extractInterviewMaterial.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("面试材料二选一", () => {
  it("默认从记录选：没有文件入口", () => {
    renderSetup();

    // 默认来源是"从记录选"：记录下拉可用，文件入口不出现。
    expect(screen.getByLabelText(t("interviewPage.setup.jobLabel"))).not.toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(t("interviewPage.setup.material.pickFile")),
      }),
    ).toBeNull();
  });

  it("切到导入文件后出现入口，并给出该侧接受什么格式", () => {
    renderSetup();

    pickFileSource("job");

    expect(fileButton(t("interviewPage.setup.material.pickFile"))).toBeInTheDocument();
    expect(screen.getByText(t("interviewPage.setup.material.jobFileHint"))).toBeInTheDocument();
  });

  it("上传成功后立刻显示文件名与读取到的字数", async () => {
    interviewMocks.extractInterviewMaterial.mockResolvedValue({
      name: "jd.txt",
      text: JOB_TEXT,
      warnings: [],
    });
    renderSetup();

    pickFileSource("job");
    await upload(0, new File([JOB_TEXT], "jd.txt", { type: "text/plain" }));

    expect(interviewMocks.extractInterviewMaterial).toHaveBeenCalledWith("job", expect.any(File));
    await waitFor(() => expect(screen.getByText("jd.txt")).toBeInTheDocument());
    expect(
      screen.getByText(t("interviewPage.setup.material.parsed", { chars: JOB_TEXT.length })),
    ).toBeInTheDocument();
  });

  it("两侧都用导入文件：提交时把材料一起带出，且不再传记录 id", async () => {
    interviewMocks.extractInterviewMaterial
      .mockResolvedValueOnce({ name: "jd.txt", text: JOB_TEXT, warnings: [] })
      .mockResolvedValueOnce({ name: "shot.png", text: RESUME_TEXT, warnings: [] });
    const { onStart } = renderSetup();

    pickFileSource("job");
    pickFileSource("resume");
    await upload(0, new File([JOB_TEXT], "jd.txt", { type: "text/plain" }));
    await waitFor(() => expect(screen.getByText("jd.txt")).toBeInTheDocument());
    await upload(1, new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.setup.start")) }),
    );

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const values = onStart.mock.calls[0][0] as SetupForm;
    expect(values.jobMaterial?.name).toBe("jd.txt");
    expect(values.resumeMaterial?.name).toBe("shot.png");
    expect(values.jobId).toBeUndefined();
    expect(values.resumeId).toBeUndefined();
  });

  it("选了导入文件却没上传：不回调 onStart", async () => {
    const { onStart } = renderSetup();

    pickFileSource("job");
    pickFileSource("resume");
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.setup.start")) }),
    );

    await waitFor(() =>
      expect(screen.getByText(t("interviewPage.setup.material.jobRequired"))).toBeInTheDocument(),
    );
    expect(onStart).not.toHaveBeenCalled();
  });

  it("识别失败时清掉上一次的结果（不把旧文件偷偷带进面试）", async () => {
    interviewMocks.extractInterviewMaterial
      .mockResolvedValueOnce({ name: "shot.png", text: RESUME_TEXT, warnings: [] })
      .mockRejectedValueOnce(new Error(t("interviewPage.setup.material.parseFailed")));
    renderSetup();

    pickFileSource("resume");
    await upload(0, new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());

    await upload(0, new File([RESUME_TEXT], "blur.png", { type: "image/png" }));

    await waitFor(() => expect(screen.queryByText("shot.png")).toBeNull());
    expect(fileButton(t("interviewPage.setup.material.pickFile"))).toBeInTheDocument();
  });
});
