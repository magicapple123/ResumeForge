/** 面试官设定卡：深链 ?job_id= 预填关联岗位（RF-11），以及提交时把岗位一起带出。 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetupTab, type SetupForm } from "./SetupTab";

const JOB_OPTIONS = [
  { value: 7, label: "市场运营专员 · 示例科技" },
  { value: 9, label: "后端开发工程师 · 另一家" },
];

/** antd 的 form 实例必须来自 Form.useForm，用一层包装组件注入。 */
function SetupHarness(props: { initialJobId?: number; onStart: (values: SetupForm) => void }) {
  const [form] = Form.useForm<SetupForm>();
  return (
    <AntdApp>
      <SetupTab
        form={form}
        jobOptions={JOB_OPTIONS}
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SetupTab 关联岗位预填（RF-11）", () => {
  it("带 initialJobId 进入：关联岗位 Select 已预填该岗位", () => {
    renderSetup({ initialJobId: 7 });

    // antd Select 显示选中项的 label。
    expect(screen.getByText("市场运营专员 · 示例科技")).toBeInTheDocument();
  });

  it("id 不在选项里：仍设置值（显示原始 id），不强造选项", () => {
    renderSetup({ initialJobId: 123 });

    expect(screen.getByText("123")).toBeInTheDocument();
    expect(screen.queryByText(/强造/)).toBeNull();
  });

  it("不带 initialJobId：关联岗位为空（保持现状）", () => {
    renderSetup();

    expect(screen.queryByText(/市场运营专员/)).toBeNull();
  });

  it("预填的岗位随表单一起提交", async () => {
    const onStart = vi.fn();
    renderSetup({ initialJobId: 7, onStart });

    fireEvent.click(screen.getByRole("button", { name: /开始面试/ }));

    // 表单校验默认全过（类型/难度/风格/轮数都有初值），预填的 jobId 原样带出。
    // antd 提交是异步校验，等一个微任务周期。
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ jobId: 7 }));
  });
});

describe("SetupTab 轮数选择", () => {
  it("默认固定轮数：提交带具体轮数值", async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    expect(screen.getByLabelText("轮数")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /开始面试/ }));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ rounds: 6 }));
  });

  it("轮数下拉选「自动」：提交带 auto（页面据此改走后台任务的自动收尾模式）", async () => {
    const onStart = vi.fn();
    renderSetup({ onStart });

    // antd Select 的下拉选项挂在 body portal 上：先点开选择框再点选项。
    fireEvent.mouseDown(screen.getByLabelText("轮数"));
    fireEvent.click(await screen.findByText("自动（AI 判断收尾）"));

    fireEvent.click(screen.getByRole("button", { name: /开始面试/ }));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ rounds: "auto" }));
  });
});
