// SPDX-License-Identifier: Apache-2.0
/**
 * 面试材料来源（#41 / Q3）：**岗位只从记录选，简历才是「从记录选 / 导入文件」二选一**。
 *
 * 这里钉住四件事：
 * 1. 岗位侧没有来源开关，也没有文件入口——没有合适岗位时给一句去岗位广场的引导；
 * 2. 简历侧切到"导入文件"后才出现"选择文件"入口（两种来源互斥，不会同时生效）；
 * 3. 上传成功后**当场**显示文件名与读取到的字数——用户不必等到点"开始面试"才知道
 *    这份文件能不能用；
 * 4. 简历选了"导入文件"却没上传就提交：**不回调** onStart（否则会开出一场没有材料的面试）。
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
import { MemoryRouter } from "react-router-dom";
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

const JOB_OPTIONS = [{ id: 7, title: "market-ops", company: "" }];
const RESUME_TEXT = "Alex, backend engineer";

function SetupHarness(props: { onStart: (values: SetupForm) => void }) {
  const [form] = Form.useForm<SetupForm>();
  // SetupTab 读 ?externalResumeId= 深链（第 21 条）：测试要有 Router 上下文。
  return (
    <MemoryRouter initialEntries={["/interview"]}>
      <AntdApp>
        <SetupTab form={form} starting={false} onStart={props.onStart} />
      </AntdApp>
    </MemoryRouter>
  );
}

function renderSetup() {
  const onStart = vi.fn();
  render(<SetupHarness onStart={onStart} />);
  return { onStart };
}

/** 简历侧唯一的来源开关（岗位侧已经没有这一组了）。 */
function resumeSourceRadio(label: string) {
  return screen.getByRole("radio", { name: label });
}

/** 把简历侧切到"导入文件"。 */
function pickResumeFileSource() {
  fireEvent.click(resumeSourceRadio(t("interviewPage.setup.material.fromFile")));
}

/** 「选择文件 / 换一份」按钮：按钮里带图标，accessible name 会被图标的 aria-label 前缀污染。 */
function fileButton(label: string) {
  return screen.getByRole("button", { name: new RegExp(label) });
}

/** 给文件输入框喂一个文件（antd Upload 的 beforeUpload 会在 change 时触发）。 */
async function upload(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  Object.defineProperty(input!, "files", { value: [file], configurable: true });
  fireEvent.change(input!);
  await waitFor(() => expect(interviewMocks.extractInterviewMaterial).toHaveBeenCalled());
}

/** 打开岗位下拉并按文案点选项（材料开关只在右侧，不影响岗位这一侧）。 */
async function pickJob(title: string) {
  fireEvent.mouseDown(screen.getByLabelText(t("interviewPage.setup.jobLabel")));
  await waitFor(() =>
    expect(document.querySelectorAll(".ant-select-item-option").length).toBeGreaterThan(0),
  );
  const options = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option"));
  const target = options.find((option) => option.textContent?.includes(title));
  if (!target) throw new Error(`option not found: ${title}`);
  fireEvent.click(target);
}

function submitClick() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("interviewPage.setup.start")) }));
}

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: JOB_OPTIONS, total: 1 });
  jobsMocks.getJob.mockReset().mockResolvedValue(JOB_OPTIONS[0]);
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  resumesMocks.getResume.mockReset().mockResolvedValue(null);
  interviewMocks.extractInterviewMaterial.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("面试材料来源（Q3：岗位只从记录选）", () => {
  it("默认从记录选：岗位与简历都没有文件入口", () => {
    renderSetup();

    expect(screen.getByLabelText(t("interviewPage.setup.jobLabel"))).not.toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: new RegExp(t("interviewPage.setup.material.pickFile")),
      }),
    ).toBeNull();
  });

  it("岗位侧没有来源开关：整页只剩简历那一组（两个按钮）", () => {
    renderSetup();

    // 岗位侧不渲染 Radio.Group，所以"导入文件"只剩简历侧那一个。
    expect(
      screen.getAllByRole("radio", { name: t("interviewPage.setup.material.fromFile") }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("radio", { name: t("interviewPage.setup.material.fromRecord") }),
    ).toHaveLength(1);
  });

  it("岗位侧给一句去岗位广场的引导（不再让用户上传 JD）", () => {
    renderSetup();

    expect(screen.getByText(t("interviewPage.setup.jobFromLink"))).toBeInTheDocument();
  });

  it("简历切到导入文件后出现入口，并说明接受哪些格式", () => {
    renderSetup();

    pickResumeFileSource();

    expect(fileButton(t("interviewPage.setup.material.pickFile"))).toBeInTheDocument();
    expect(screen.getByText(t("interviewPage.setup.material.fileHint"))).toBeInTheDocument();
  });

  it("accept 覆盖图片 / PDF / TXT / Word / Markdown", () => {
    renderSetup();

    pickResumeFileSource();

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    for (const suffix of [".pdf", ".txt", ".md", ".markdown", ".docx", ".png", ".jpg", ".webp"]) {
      expect(input!.accept).toContain(suffix);
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

    pickResumeFileSource();
    await upload(new File([RESUME_TEXT], "resume.md", { type: "text/markdown" }));

    expect(interviewMocks.extractInterviewMaterial).toHaveBeenCalledWith(
      "resume",
      expect.any(File),
    );
    await waitFor(() => expect(screen.getByText("resume.md")).toBeInTheDocument());
  });

  it("选到 .doc 时前端就拒绝，并提示另存为 .docx（不再等服务端）", async () => {
    renderSetup();

    pickResumeFileSource();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input!, "files", {
      value: [new File(["legacy"], "old.doc", { type: "application/msword" })],
      configurable: true,
    });
    fireEvent.change(input!);

    expect(
      await screen.findByText(t("interviewPage.setup.material.legacyDoc")),
    ).toBeInTheDocument();
    expect(interviewMocks.extractInterviewMaterial).not.toHaveBeenCalled();
  });

  it("上传成功后立刻显示文件名与读取到的字数", async () => {
    interviewMocks.extractInterviewMaterial.mockResolvedValue({
      name: "cv.txt",
      text: RESUME_TEXT,
      warnings: [],
    });
    renderSetup();

    pickResumeFileSource();
    await upload(new File([RESUME_TEXT], "cv.txt", { type: "text/plain" }));

    await waitFor(() => expect(screen.getByText("cv.txt")).toBeInTheDocument());
    expect(
      screen.getByText(t("interviewPage.setup.material.parsed", { chars: RESUME_TEXT.length })),
    ).toBeInTheDocument();
  });

  it("字数文案按实际解析路径选词，不按左右侧（问题 6）", async () => {
    interviewMocks.extractInterviewMaterial
      .mockResolvedValueOnce({
        name: "shot.png",
        text: RESUME_TEXT,
        warnings: [],
        parser: "vision",
      })
      .mockResolvedValueOnce({ name: "shot.png", text: RESUME_TEXT, warnings: [], parser: "text" });
    renderSetup();

    pickResumeFileSource();
    await upload(new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    expect(
      await screen.findByText(
        t("interviewPage.setup.material.recognized", { chars: RESUME_TEXT.length }),
      ),
    ).toBeInTheDocument();

    // 换一份同类文件：同一个输入框，重新上传。
    await upload(new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    expect(
      await screen.findByText(
        t("interviewPage.setup.material.parsed", { chars: RESUME_TEXT.length }),
      ),
    ).toBeInTheDocument();
  });

  it("岗位从记录选 + 简历用导入文件：提交带 resumeMaterial，jobMaterial 恒为 null", async () => {
    interviewMocks.extractInterviewMaterial.mockResolvedValue({
      name: "shot.png",
      text: RESUME_TEXT,
      warnings: [],
    });
    const { onStart } = renderSetup();

    await pickJob("market-ops");
    pickResumeFileSource();
    await upload(new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());

    submitClick();

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const values = onStart.mock.calls[0][0] as SetupForm;
    expect(values.resumeMaterial?.name).toBe("shot.png");
    expect(values.resumeId).toBeUndefined();
    expect(values.jobId).toBe(7);
    // 岗位侧已没有文件这一路：这个字段永远是 null。
    expect(values.jobMaterial).toBeNull();
  });

  /**
   * 问题 5 的回归点：**提交边界**只放行写端点接受的字段。
   *
   * 上传接口返回的是读取 DTO（带 `warnings`），写端点 `extra="forbid"`；整份回传会报
   * 「包含不支持的字段」，面试开不起来。这里同时钉两件事：警告条照常显示（state 保留
   * warnings），而投影结果里一个 warnings 都不剩。
   */
  it("带警告的材料：警告条仍在材料块里，投影后的请求体只有 name / text", async () => {
    const warning = "only the first part was read";
    interviewMocks.extractInterviewMaterial.mockResolvedValue({
      name: "cv.txt",
      text: RESUME_TEXT,
      warnings: [warning],
    });
    const { onStart } = renderSetup();

    await pickJob("market-ops");
    pickResumeFileSource();
    await upload(new File([RESUME_TEXT], "cv.txt", { type: "text/plain" }));

    expect(
      await screen.findByText(t("interviewPage.setup.material.warningTitle")),
    ).toBeInTheDocument();
    // 同一句话也会闪一条 Toast，所以按警告条本身的 li 断言，避免命中两处。
    expect(
      Array.from(document.querySelectorAll(".interview-material-warning li")).map(
        (node) => node.textContent,
      ),
    ).toEqual([warning]);

    submitClick();
    await waitFor(() => expect(onStart).toHaveBeenCalled());

    // SetupTab 交出去的仍是完整读取结果（简历侧那条校验要读它）……
    const values = onStart.mock.calls[0][0] as SetupForm;
    expect(values.resumeMaterial?.warnings).toEqual([warning]);

    // ……而真正进写端点的是投影结果：键集合恰好是 name + text。
    const payload = toMaterialPayload(values.resumeMaterial);
    expect(Object.keys(payload ?? {})).toEqual(["name", "text"]);
    expect(JSON.stringify(payload)).not.toContain("warnings");
  });

  it("简历选了导入文件却没上传：不回调 onStart", async () => {
    const { onStart } = renderSetup();

    await pickJob("market-ops");
    pickResumeFileSource();
    submitClick();

    await waitFor(() =>
      expect(
        screen.getByText(t("interviewPage.setup.material.resumeRequired")),
      ).toBeInTheDocument(),
    );
    expect(onStart).not.toHaveBeenCalled();
  });

  it("识别失败时清掉上一次的结果（不把旧文件偷偷带进面试）", async () => {
    interviewMocks.extractInterviewMaterial
      .mockResolvedValueOnce({ name: "shot.png", text: RESUME_TEXT, warnings: [] })
      .mockRejectedValueOnce(new Error(t("interviewPage.setup.material.parseFailed")));
    renderSetup();

    pickResumeFileSource();
    await upload(new File([RESUME_TEXT], "shot.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("shot.png")).toBeInTheDocument());

    await upload(new File([RESUME_TEXT], "blur.png", { type: "image/png" }));

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
 * 材料行的布局契约（问题 7 + 第 8 条）：两个材料字段必须包在独立容器里。
 *
 * 第 8 条起外层改成纵向堆叠，容器不再需要 grid-column 跨行；两侧高度改为
 * align-items: start 各自按内容排。只按 DOM 层级与 CSS 原文断言，不量像素：
 * jsdom 不做布局，量出来的宽度恒为 0。
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
    // 提示语是外层纵向堆叠的直接子项，继续独占一整行（不能被卷进材料容器）。
    expect(document.querySelector(".interview-setup-stack")).not.toBeNull();
    expect(wrapper?.querySelector(".interview-setup-hint")).toBeNull();
  });

  it("容器自身是 auto-fit 两列 + align-items: start，不再跨栅格行", () => {
    const rule = css.match(/(?:^|\n)\.interview-setup-materials \{([^}]*)\}/);
    expect(rule, "样式表里找不到 .interview-setup-materials").not.toBeNull();
    const body = rule?.[1] ?? "";
    expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(240px, 1fr\)\)/);
    // 第 8 条：外层已不是栅格，grid-column 必须去掉（否则是过时规则）。
    expect(body).toMatch(/align-items:\s*start/);
    expect(body).not.toMatch(/grid-column/);
  });
});
