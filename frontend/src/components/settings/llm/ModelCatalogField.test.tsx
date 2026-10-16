import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Form, Input } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMModelsResult } from "../../../types";
import type { RecordFormValues } from "../../../features/settings/useLLMRecordTools";
import ModelCatalogField from "./ModelCatalogField";

afterEach(cleanup);

function Harness({
  fetchModels,
  open = true,
  disabled = false,
}: {
  fetchModels: () => Promise<LLMModelsResult>;
  open?: boolean;
  disabled?: boolean;
}) {
  const [form] = Form.useForm<RecordFormValues>();
  return (
    <Form
      form={form}
      initialValues={{
        base_url: "https://models.example.com/v1",
        api_key: "",
        model: "draft-model",
      }}
    >
      <Form.Item name="base_url" label="服务地址">
        <Input />
      </Form.Item>
      <Form.Item name="api_key" label="密钥">
        <Input />
      </Form.Item>
      <ModelCatalogField
        open={open}
        requestScope="test-record"
        disabled={disabled}
        form={form}
        onFetchModels={fetchModels}
        onModelChange={vi.fn()}
      />
    </Form>
  );
}

function deferred() {
  let resolve!: (value: LLMModelsResult) => void;
  const promise = new Promise<LLMModelsResult>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("model catalog feedback and lifecycle", () => {
  it("shows the returned models and fills the chosen model without saving the draft", async () => {
    const fetchModels = vi
      .fn()
      .mockResolvedValue({ models: ["available-model"], message: "找到 1 个模型" });
    render(<Harness fetchModels={fetchModels} />);
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    const picker = await screen.findByRole("dialog", { name: "选择模型" });
    expect(within(picker).getByText("available-model")).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole("button", { name: /使\s*用/ }));
    expect(screen.getByRole("textbox", { name: "模型名称" })).toHaveValue("available-model");
    expect(fetchModels).toHaveBeenCalledOnce();
  });

  it("shows an empty response and supports retrying with the draft intact", async () => {
    const fetchModels = vi
      .fn()
      .mockResolvedValueOnce({ models: [], message: "密钥无效，请重新填写" })
      .mockResolvedValue({ models: ["retry-model"], message: "已获取" });
    render(<Harness fetchModels={fetchModels} />);
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveClass("ant-alert-error");
    expect(error).toHaveTextContent("密钥无效，请重新填写");
    expect(screen.getByRole("textbox", { name: "模型名称" })).toHaveValue("draft-model");
    fireEvent.click(screen.getByRole("button", { name: /重\s*试/ }));
    expect(await screen.findByRole("dialog", { name: "选择模型" })).toHaveTextContent(
      "retry-model",
    );
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it("keeps network failures visible and allows manual model entry", async () => {
    const fetchModels = vi.fn().mockRejectedValue(new Error("网络异常，请检查地址"));
    render(<Harness fetchModels={fetchModels} />);
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络异常，请检查地址");
    fireEvent.change(screen.getByRole("textbox", { name: "模型名称" }), {
      target: { value: "manual-model" },
    });
    expect(screen.getByRole("textbox", { name: "模型名称" })).toHaveValue("manual-model");
  });

  it("validates an empty endpoint without sending a request", async () => {
    const fetchModels = vi.fn();
    render(<Harness fetchModels={fetchModels} />);
    fireEvent.change(screen.getByRole("textbox", { name: "服务地址" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先填写 Base URL");
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("does not repeat a pending fetch or reopen the picker after closing the editor", async () => {
    const pending = deferred();
    const fetchModels = vi.fn(() => pending.promise);
    const view = render(<Harness fetchModels={fetchModels} />);
    const fetchButton = screen.getByRole("button", { name: /获取可用模型/ });
    fireEvent.click(fetchButton);
    fireEvent.click(fetchButton);
    expect(fetchModels).toHaveBeenCalledOnce();
    view.rerender(<Harness fetchModels={fetchModels} open={false} />);
    await act(async () => pending.resolve({ models: ["late-model"], message: "迟到结果" }));
    view.rerender(<Harness fetchModels={fetchModels} />);
    await waitFor(() => expect(screen.queryByText("wrong-model")).toBeNull());
    expect(screen.queryByText("late-model")).toBeNull();
  });

  it("ignores the old response when credentials change and accepts a new request", async () => {
    const stale = deferred();
    const fresh = deferred();
    const fetchModels = vi
      .fn()
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    render(<Harness fetchModels={fetchModels} />);
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "密钥" }), {
      target: { value: "fake-new-key" },
    });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "密钥" })).toHaveValue("fake-new-key"),
    );
    expect(screen.getByRole("button", { name: /获取可用模型/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /获取可用模型/ }));
    expect(fetchModels).toHaveBeenCalledTimes(2);
    await act(async () => stale.resolve({ models: ["wrong-model"], message: "旧结果" }));
    expect(screen.queryByText("wrong-model")).toBeNull();
    await act(async () => fresh.resolve({ models: ["right-model"], message: "新结果" }));
    expect(await screen.findByText("right-model")).toBeInTheDocument();
    expect(screen.queryByText("wrong-model")).toBeNull();
    expect(fetchModels).toHaveBeenCalledTimes(2);
  });
});
