// SPDX-License-Identifier: Apache-2.0
/**
 * 面试「简历材料」下拉（#25）在设定卡里的落地：分组、无正文禁用、「当前材料」、提交口径。
 *
 * 四件事必须钉住（方案详册 #25 的验证清单）：
 * 1. 下拉里同时有「本应用的简历」与「外部简历」两组；
 * 2. 选中外部简历 → 材料落到「导入文件」那一侧，「当前材料」明说用的是哪份，提交带
 *    `resume_material` 而不是 `resume_id`；
 * 3. 没有正文的外部简历在下拉里就是 disabled（选不到，而不是选完再报错）；
 * 4. 深链 `?externalResumeId=` 与下拉选中**产生完全一致的 `resumeMaterial`**（同一个函数）。
 *
 * 断言一律用 `t()` / 类名 / 英文夹具名：测试里的中文断言也属于要迁移的存量。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ExternalResumeDetail, ExternalResumeItem } from "../../api/externalResumes";
import { SetupTab, type SetupForm } from "./SetupTab";

const jobsMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
const resumesMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));
const externalMocks = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  getExternalResume: vi.fn(),
}));

vi.mock("../../api/jobs", () => jobsMocks);
vi.mock("../../api/resumes", () => resumesMocks);
vi.mock("../../api/externalResumes", () => externalMocks);

const JOB = { id: 3, title: "Backend engineer", company: "Acme" };
const INTERNAL_RESUME = { id: 1, title: "Backend resume" };
const EXTERNAL_TEXT = "External resume body";

function externalItem(overrides: Partial<ExternalResumeItem> = {}): ExternalResumeItem {
  return {
    id: 7,
    file_id: 70,
    name: "external-a.pdf",
    mime: "application/pdf",
    text_chars: EXTERNAL_TEXT.length,
    has_text: true,
    job_id: 3,
    job_title: JOB.title,
    created_at: "2026-11-11T00:00:00",
    updated_at: "2026-11-11T00:00:00",
    warnings: [],
    ...overrides,
  };
}

function externalDetail(overrides: Partial<ExternalResumeDetail> = {}): ExternalResumeDetail {
  return { ...externalItem(), text: EXTERNAL_TEXT, ...overrides };
}

function SetupHarness(props: { search?: string; onStart: (values: SetupForm) => void }) {
  const [form] = Form.useForm<SetupForm>();
  return (
    <MemoryRouter initialEntries={[props.search ?? "/interview"]}>
      <AntdApp>
        <SetupTab form={form} starting={false} onStart={props.onStart} />
      </AntdApp>
    </MemoryRouter>
  );
}

function renderSetup(search?: string) {
  const onStart = vi.fn();
  render(<SetupHarness search={search} onStart={onStart} />);
  return { onStart };
}

/**
 * 下拉里的候选节点（antd 6 的选项是 `div.ant-select-item-option`）。
 *
 * **全局取**、不按"可见的那一层"过滤：antd 关掉下拉后把节点留在 body 里，而 jsdom 没有
 * 动画帧，`-hidden` 不一定及时加上。按文案找目标项比按容器找更稳。
 */
function allOptions(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option"));
}

/** 打开某个 Select，等到目标文案出现（= 这个下拉真的渲染了候选）。 */
async function openSelect(label: string, text: string): Promise<void> {
  fireEvent.mouseDown(screen.getByLabelText(label));
  await waitFor(() =>
    expect(allOptions().some((option) => option.textContent?.includes(text))).toBe(true),
  );
}

/** 找到某个下拉里带这段文案的选项节点。 */
async function optionFor(text: string): Promise<HTMLElement> {
  await openSelect(t("interviewPage.setup.resumeLabel"), text);
  const target = allOptions().find((option) => option.textContent?.includes(text));
  if (!target) {
    throw new Error(
      `option not found: ${text}; candidates: ${allOptions()
        .map((item) => item.textContent)
        .join(" | ")}`,
    );
  }
  return target;
}

/** 带这段文案的那个下拉容器（读分组标题用）。 */
function dropdownWith(text: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(".ant-select-dropdown")).find((node) =>
    (node.textContent ?? "").includes(text),
  );
}

async function pickOption(label: string, text: string) {
  await openSelect(label, text);
  fireEvent.click(allOptions().find((option) => option.textContent?.includes(text)) as HTMLElement);
}

/** 关联岗位必须先选：简历侧的记录候选依赖它（外部组不受影响）。选完要等简历下拉**可用**，
 *  否则 `mouseDown` 打在禁用控件上，读到的还是上一个下拉的候选（实测踩过）。 */
async function pickJob() {
  await pickOption(t("interviewPage.setup.jobLabel"), JOB.title);
  await waitFor(() =>
    expect(screen.getByLabelText(t("interviewPage.setup.resumeLabel"))).not.toBeDisabled(),
  );
}

function resumeSelect(): HTMLElement {
  return screen.getByLabelText(t("interviewPage.setup.resumeLabel"));
}

function currentMaterial(): string {
  return (document.querySelector(".interview-resume-current")?.textContent ?? "").trim();
}

async function submit() {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(t("interviewPage.setup.start")) }));
}

beforeEach(() => {
  jobsMocks.listJobs.mockReset().mockResolvedValue({ items: [JOB], total: 1 });
  jobsMocks.getJob.mockReset().mockResolvedValue(JOB);
  resumesMocks.listResumes.mockReset().mockResolvedValue({ items: [INTERNAL_RESUME], total: 1 });
  resumesMocks.getResume.mockReset().mockResolvedValue(INTERNAL_RESUME);
  externalMocks.listExternalResumes.mockReset().mockResolvedValue({
    items: [externalItem(), externalItem({ id: 8, name: "scan-only.pdf", has_text: false })],
    total: 2,
    page: 1,
    page_size: 50,
  });
  externalMocks.getExternalResume.mockReset().mockResolvedValue(externalDetail());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("简历材料下拉分组（#25）", () => {
  it("下拉里同时有「本应用的简历」与「外部简历」两组", async () => {
    renderSetup();
    await pickJob();

    await openSelect(t("interviewPage.setup.resumeLabel"), "external-a.pdf");
    const dropdown = dropdownWith("external-a.pdf");
    const groupTitles = Array.from(
      dropdown?.querySelectorAll<HTMLElement>(".ant-select-item-group") ?? [],
    ).map((node) => node.textContent);
    expect(groupTitles).toEqual([
      t("interviewPage.setup.resumeGroup.internal"),
      t("interviewPage.setup.resumeGroup.external"),
    ]);
    // 两组都真的有条目：内部简历一条 + 外部简历两条（含扫描件那条，它是 disabled）。
    const options = Array.from(
      dropdown?.querySelectorAll<HTMLElement>(".ant-select-item-option") ?? [],
    );
    expect(options.some((option) => option.textContent?.includes(INTERNAL_RESUME.title))).toBe(
      true,
    );
    expect(options.some((option) => option.textContent?.includes("external-a.pdf"))).toBe(true);
  });

  it("没有正文的外部简历在下拉里就是 disabled，点了不会选中", async () => {
    const { onStart } = renderSetup();
    await pickJob();

    const scan = await optionFor("scan-only.pdf");
    expect(scan.className).toContain("ant-select-item-option-disabled");
    expect(scan.getAttribute("title")).toBe(t("interviewPage.setup.resumeNoText"));

    // 点禁用项：什么都不该发生——材料侧不出现文件名，提交仍被必选规则挡住。
    fireEvent.click(scan);
    expect(screen.queryByText("scan-only.pdf", { selector: ".ant-tag" })).toBeNull();
    await submit();
    expect(await screen.findByText(t("interviewPage.setup.resumeRequired"))).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe("选中外部简历 = 复用深链那一套（#25）", () => {
  it("切到导入文件侧并显示文件名，「当前材料」说明来源，提交带 resume_material", async () => {
    const { onStart } = renderSetup();
    await pickJob();
    await pickOption(t("interviewPage.setup.resumeLabel"), "external-a.pdf");

    // 落地的证据：记录侧下拉被禁用（文件与记录互斥），材料块显示文件名。
    await waitFor(() => expect(resumeSelect()).toBeDisabled());
    expect(await screen.findByText("external-a.pdf")).toBeInTheDocument();
    await waitFor(() =>
      expect(currentMaterial()).toBe(
        t("interviewPage.setup.currentMaterial.external", { name: "external-a.pdf" }),
      ),
    );

    await submit();
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        // 外部简历没有内部 id：这一栏必须是空的，正文走材料。
        resumeId: undefined,
        resumeMaterial: {
          name: "external-a.pdf",
          text: EXTERNAL_TEXT,
          warnings: [],
          parser: "text",
        },
      }),
    );
  });

  it("深链与下拉选中的 resumeMaterial 完全一致（同一个函数）", async () => {
    // 路径 A：下拉里选外部简历。
    const bySelect = renderSetup();
    await pickJob();
    await pickOption(t("interviewPage.setup.resumeLabel"), "external-a.pdf");
    await waitFor(() => expect(resumeSelect()).toBeDisabled());
    await submit();
    await waitFor(() => expect(bySelect.onStart).toHaveBeenCalled());
    const selectValues = bySelect.onStart.mock.calls[0][0] as SetupForm;
    cleanup();
    document.body.innerHTML = "";

    // 路径 B：从简历中心深链进来。
    const byDeepLink = renderSetup("/interview?externalResumeId=7");
    await waitFor(() => expect(resumeSelect()).toBeDisabled());
    // 深链已经把简历侧切到「导入文件」，所以这里**不**等简历下拉变可用（它本来就该是禁用的）。
    await pickOption(t("interviewPage.setup.jobLabel"), JOB.title);
    await submit();
    await waitFor(() => expect(byDeepLink.onStart).toHaveBeenCalled());
    const deepLinkValues = byDeepLink.onStart.mock.calls[0][0] as SetupForm;

    expect(selectValues.resumeMaterial).toEqual(deepLinkValues.resumeMaterial);
    expect(selectValues.resumeMaterial).toEqual({
      name: "external-a.pdf",
      text: EXTERNAL_TEXT,
      warnings: [],
      parser: "text",
    });
    expect(deepLinkValues.resumeId).toBeUndefined();
  });

  it("外部简历已被删除：提示加载失败，退回从记录选（不阻断继续设置）", async () => {
    externalMocks.getExternalResume.mockRejectedValue(new Error("404"));

    renderSetup();
    await pickJob();
    await pickOption(t("interviewPage.setup.resumeLabel"), "external-a.pdf");

    expect(
      await screen.findByText(t("interviewPage.setup.external.loadFailed")),
    ).toBeInTheDocument();
    // 记录侧仍然可用、仍然必选：用户换一条内部简历就能继续。
    await waitFor(() => expect(resumeSelect()).not.toBeDisabled());
    expect(currentMaterial()).toBe(t("interviewPage.setup.currentMaterial.empty"));
  });
});

describe("选中内部简历：值带前缀（#25）", () => {
  it("提交带 r:<id>，「当前材料」显示内部简历标题", async () => {
    const { onStart } = renderSetup();
    await pickJob();
    await pickOption(t("interviewPage.setup.resumeLabel"), INTERNAL_RESUME.title);

    await waitFor(() =>
      expect(currentMaterial()).toBe(
        t("interviewPage.setup.currentMaterial.record", { name: INTERNAL_RESUME.title }),
      ),
    );

    await submit();
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ resumeId: "r:1", resumeMaterial: null }),
    );
  });
});
