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
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上。
import { dirname, join } from "node:path";
// @ts-expect-error 同上。
import { fileURLToPath } from "node:url";
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toMaterialPayload } from "../../features/interview/materialPayload";
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

  it("切到导入文件后出现入口，并说明接受哪些格式", () => {
    renderSetup();

    pickFileSource("job");

    expect(fileButton(t("interviewPage.setup.material.pickFile"))).toBeInTheDocument();
    expect(screen.getByText(t("interviewPage.setup.material.fileHint"))).toBeInTheDocument();
  });

  it("两侧的 accept 完全一致：图片 / PDF / TXT / Word / Markdown 都能选", () => {
    renderSetup();

    pickFileSource("job");
    pickFileSource("resume");

    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    expect(inputs.length).toBe(2);
    const [jobAccept, resumeAccept] = [inputs[0].accept, inputs[1].accept];
    // 同一个常量供 accept 与上传前检查共用：两处各写一份就会慢慢漂开。
    expect(resumeAccept).toBe(jobAccept);
    for (const suffix of [".pdf", ".txt", ".md", ".markdown", ".docx", ".png", ".jpg", ".webp"]) {
      expect(jobAccept).toContain(suffix);
    }
  });

  it("按扩展名分派：简历侧也能导入 Markdown（不再只收截图）", async () => {
    interviewMocks.extractInterviewMaterial.mockResolvedValue({
      name: "resume.md",
      text: RESUME_TEXT,
      warnings: [],
      parser: "text",
    });
    renderSetup();

    pickFileSource("resume");
    await upload(0, new File([RESUME_TEXT], "resume.md", { type: "text/markdown" }));

    expect(interviewMocks.extractInterviewMaterial).toHaveBeenCalledWith("resume", expect.any(File));
    await waitFor(() => expect(screen.getByText("resume.md")).toBeInTheDocument());
  });

  it("选到 .doc 时前端就拒绝，并提示另存为 .docx（不再等服务端）", async () => {
    renderSetup();

    pickFileSource("job");
    const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(inputs[0], "files", {
      value: [new File(["legacy"], "old.doc", { type: "application/msword" })],
      configurable: true,
    });
    fireEvent.change(inputs[0]);

    expect(
      await screen.findByText(t("interviewPage.setup.material.legacyDoc")),
    ).toBeInTheDocument();
    expect(interviewMocks.extractInterviewMaterial).not.toHaveBeenCalled();
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

  it("字数文案按实际解析路径选词，不按左右侧（问题 6）", async () => {
    interviewMocks.extractInterviewMaterial
      .mockResolvedValueOnce({ name: "jd.txt", text: JOB_TEXT, warnings: [], parser: "vision" })
      .mockResolvedValueOnce({ name: "jd.txt", text: JOB_TEXT, warnings: [], parser: "text" });
    renderSetup();

    pickFileSource("job");
    await upload(0, new File([JOB_TEXT], "jd.txt", { type: "text/plain" }));
    expect(
      await screen.findByText(t("interviewPage.setup.material.recognized", { chars: JOB_TEXT.length })),
    ).toBeInTheDocument();

    await upload(0, new File([JOB_TEXT], "jd.txt", { type: "text/plain" }));
    expect(
      await screen.findByText(t("interviewPage.setup.material.parsed", { chars: JOB_TEXT.length })),
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

  /**
   * 问题 5 的回归点：**提交边界**只放行写端点接受的字段。
   *
   * 上传接口返回的是读取 DTO（带 `warnings`），写端点 `extra="forbid"`；整份回传时
   * 两侧各报一条「包含不支持的字段」，面试开不起来。这里同时钉两件事：警告条照常
   * 显示（state 保留 warnings），而投影结果里一个 warnings 都不剩。
   */
  it("带警告的材料：警告条仍在材料块里，投影后的请求体只有 name / text", async () => {
    const warning = "only the first part was read";
    interviewMocks.extractInterviewMaterial
      .mockResolvedValueOnce({ name: "jd.txt", text: JOB_TEXT, warnings: [warning] })
      .mockResolvedValueOnce({ name: "shot.png", text: RESUME_TEXT, warnings: [] });
    const { onStart } = renderSetup();

    // 两侧都切到文件：记录下拉整条不渲染，表单校验只剩这里的材料校验。
    pickFileSource("job");
    pickFileSource("resume");
    await upload(0, new File([JOB_TEXT], "jd.txt", { type: "text/plain" }));

    expect(
      await screen.findByText(t("interviewPage.setup.material.warningTitle")),
    ).toBeInTheDocument();
    // 同一句话也会闪一条 Toast，所以按警告条本身的 li 断言，避免命中两处。
    expect(
      Array.from(document.querySelectorAll(".interview-material-warning li")).map(
        (node) => node.textContent,
      ),
    ).toEqual([warning]);

    await upload(1, new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.setup.start")) }),
    );
    await waitFor(() => expect(onStart).toHaveBeenCalled());

    // SetupTab 交出去的仍是完整读取结果（简历侧那条校验要读它）……
    const values = onStart.mock.calls[0][0] as SetupForm;
    expect(values.jobMaterial?.warnings).toEqual([warning]);

    // ……而真正进写端点的是投影结果：键集合恰好是 name + text。
    const payload = toMaterialPayload(values.jobMaterial);
    expect(Object.keys(payload ?? {})).toEqual(["name", "text"]);
    expect(JSON.stringify(payload)).not.toContain("warnings");
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

/**
 * 间距契约：这一段不渲染，直接读样式表原文。
 *
 * 为什么不用 `getComputedStyle`：jsdom 不加载 `src/styles/*.css`，量出来永远是默认值，
 * 那样的断言"恒通过"，等于没写。真正会褪化的是**样式本身消失**——这三个类名曾经在
 * 全项目 CSS 里零命中，布局全靠行盒缝隙（问题 7 的根因）。所以钉住"这些规则在场且值对"。
 */
describe("面试材料来源的间距契约（样式表原文）", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../styles/modules-interview.css"),
    "utf8",
  );

  /** 取某条规则（选择器精确到名字）的声明块。 */
  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`));
    expect(match, `样式表里找不到 ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
  }

  it("三个 interview-material-* 类都有真实样式", () => {
    expect(ruleBody(".interview-material-source")).toMatch(/display:\s*grid/);
    expect(ruleBody(".interview-material-source")).toMatch(/gap:\s*8px/);
    expect(ruleBody(".interview-material-file")).toMatch(/flex-wrap:\s*wrap/);
    expect(ruleBody(".interview-material-file")).toMatch(/gap:\s*6px/);
    expect(ruleBody(".interview-material-warning")).toMatch(/margin-top:\s*4px/);
  });

  it("只在面试设定这一块补 8px（不动全局）", () => {
    // 作用域必须带自定义类：裸 `.ant-form-item-extra` 会改掉全站表单的节奏。
    expect(ruleBody(".interview-material-field .ant-form-item-extra")).toMatch(/margin-top:\s*8px/);
    expect(css).not.toMatch(/^\.ant-form-item-extra\s*\{/m);
  });
});

/**
 * 材料行的布局契约（问题 7）：两个材料字段必须包在横跨整行的容器里。
 *
 * 只按 DOM 层级断言，不量像素：jsdom 不做布局，量出来的宽度恒为 0。真正的回归点是
 * 「容器在不在、是否占满整行、边界文案是否还在容器之外」——少任何一条，右侧那片空白会
 * 随窗口宽度重新出现。
 */
describe("面试材料行的布局契约（问题 7）", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../styles/modules-interview-setup.css"),
    "utf8",
  );

  it("材料字段包在 .interview-setup-materials 里，边界文案不在其中", () => {
    renderSetup();

    const wrapper = document.querySelector(".interview-setup-materials");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelectorAll(".interview-material-field").length).toBe(2);
    // 提示语仍是外层栅格的直接子项，继续独占一整行（不能被卷进材料容器）。
    expect(wrapper?.querySelector(".interview-setup-hint")).toBeNull();
  });

  it("容器横跨整行，且自身是 auto-fit 两列（宽屏两等分、窄屏塌成一列）", () => {
    const rule = css.match(/(?:^|\n)\.interview-setup-materials \{([^}]*)\}/);
    expect(rule, "样式表里找不到 .interview-setup-materials").not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/grid-column:\s*1 \/ -1/);
    expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(240px, 1fr\)\)/);
  });
});
