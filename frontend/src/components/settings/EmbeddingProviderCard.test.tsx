// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语义检索」卡：状态机渲染 + 动作调用（mock 掉整个请求层）。
 *
 * 覆盖任务书 §5 的状态机：未启用 / 下载中 / 已就绪 / 失败 / 远程隐私确认 / 清除密钥。
 * 断言文案一律走 t()：中文写进 getByText 会撞 i18n 棘轮（新增测试文件的基线是 0）。
 * 后端 detail 是"原因"，前端另给"怎么办"，所以失败用例同时断言原因与引导语。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeStatus } from "../../test/embeddingStatusFixture";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({
  getEmbeddingStatus: vi.fn(),
  startEmbeddingLocalDownload: vi.fn(),
  cancelEmbeddingLocalDownload: vi.fn(),
  removeEmbeddingLocalAssets: vi.fn(),
  enableEmbeddingLocal: vi.fn(),
  confirmEmbeddingHost: vi.fn(),
  revokeEmbeddingHost: vi.fn(),
  testEmbeddingRemote: vi.fn(),
  fetchEmbeddingModels: vi.fn(),
  enableEmbeddingRemote: vi.fn(),
  disableEmbedding: vi.fn(),
  clearEmbedding: vi.fn(),
  embeddingProgressPercent: (progress: number) => {
    if (!Number.isFinite(progress) || progress <= 0) return 0;
    const percent = progress <= 1 ? progress * 100 : progress;
    return Math.min(100, Math.round(percent));
  },
}));

vi.mock("../../api/settings", () => apiMocks);

import EmbeddingProviderCard from "./EmbeddingProviderCard";

function renderCard() {
  return render(
    <AntdApp>
      <EmbeddingProviderCard />
    </AntdApp>,
  );
}

/** 切到远程模式的步骤是公共的：Segmented 的 label 就是可点文字。 */
async function switchToRemote() {
  fireEvent.click(await screen.findByText(t("embeddingSearch.mode.remote")));
}

/** 填好一份可提交的远端配置（地址/模型/密钥三个必填项）。 */
function fillRemoteForm() {
  fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.baseUrl.label")), {
    target: { value: "https://api.example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.model.label")), {
    target: { value: "text-embedding-3-small" },
  });
  fireEvent.change(screen.getByLabelText(t("embeddingSearch.remote.key.label")), {
    target: { value: "test-key" },
  });
}

beforeEach(() => {
  apiMocks.getEmbeddingStatus.mockReset().mockResolvedValue(makeStatus());
  for (const mock of [
    apiMocks.startEmbeddingLocalDownload,
    apiMocks.cancelEmbeddingLocalDownload,
    apiMocks.removeEmbeddingLocalAssets,
    apiMocks.enableEmbeddingLocal,
    apiMocks.confirmEmbeddingHost,
    apiMocks.revokeEmbeddingHost,
    apiMocks.testEmbeddingRemote,
    apiMocks.fetchEmbeddingModels,
    apiMocks.enableEmbeddingRemote,
    apiMocks.disableEmbedding,
    apiMocks.clearEmbedding,
  ]) {
    mock.mockReset().mockResolvedValue(undefined);
  }
});

describe("EmbeddingProviderCard", () => {
  it("未启用：显示本地/远程二选一与下载按钮（含体积约 111 MB）", async () => {
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.title"))).toBeInTheDocument();
    expect(screen.getByText(t("embeddingSearch.mode.local"))).toBeInTheDocument();
    expect(screen.getByText(t("embeddingSearch.mode.remote"))).toBeInTheDocument();
    expect(
      screen.getByText(t("embeddingSearch.local.sizeHint", { megabytes: 111 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("embeddingSearch.local.download") }),
    ).toBeInTheDocument();
  });

  it("下载中：显示百分比进度与取消，取消请求真的发出", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "downloading",
        local: { state: "downloading", progress: 0.42 },
      }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.downloading"))).toBeInTheDocument();
    expect(
      screen.getByText(t("embeddingSearch.local.progress", { percent: 42 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.local.cancel") }));
    await waitFor(() => expect(apiMocks.cancelEmbeddingLocalDownload).toHaveBeenCalledTimes(1));
  });

  it("就绪（本地）：不显示未启用入口，关闭后调用 disable", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "ready",
        provider: "local-onnx",
        local: { state: "ready" },
      }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyLocal"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("embeddingSearch.local.download") }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.disable") }));
    await waitFor(() => expect(apiMocks.disableEmbedding).toHaveBeenCalledTimes(1));
  });

  it("失败：显示后端原因与「怎么办」，重试按钮重新发起下载", async () => {
    const diskError = "磁盘空间不足";
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "failed",
        last_error: diskError,
        local: { state: "failed", error: diskError },
      }),
    );
    renderCard();
    expect(await screen.findByText(diskError)).toBeInTheDocument();
    expect(screen.getByText(t("embeddingSearch.guidance.disk"))).toBeInTheDocument();
    expect(screen.queryByText(t("embeddingSearch.state.readyLocal"))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.local.retry") }));
    await waitFor(() => expect(apiMocks.startEmbeddingLocalDownload).toHaveBeenCalledTimes(1));
  });

  it("远程首次启用：按 host 弹隐私确认，确认后先 confirm 再 enable", async () => {
    renderCard();
    await switchToRemote();
    fillRemoteForm();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.enable") }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(t("embeddingSearch.privacy.body", { host: "api.example.com" })),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("embeddingSearch.privacy.confirm") }),
    );

    await waitFor(() =>
      expect(apiMocks.confirmEmbeddingHost).toHaveBeenCalledWith("https://api.example.com/v1"),
    );
    await waitFor(() =>
      expect(apiMocks.enableEmbeddingRemote).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai-http",
          base_url: "https://api.example.com/v1",
          model: "text-embedding-3-small",
          endpoint_mode: "openai",
        }),
      ),
    );
    expect(apiMocks.enableEmbeddingRemote.mock.invocationCallOrder[0]).toBeGreaterThan(
      apiMocks.confirmEmbeddingHost.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("远程连接失败：展示原因与 401 引导，不显示为已启用", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(makeStatus());
    apiMocks.testEmbeddingRemote.mockResolvedValue({
      ok: false,
      dim: 0,
      elapsed_ms: 0,
      model: "text-embedding-3-small",
      error: "HTTP 401 unauthorized",
    });
    renderCard();
    await switchToRemote();
    fillRemoteForm();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.test") }));

    await waitFor(() => expect(apiMocks.testEmbeddingRemote).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(t("embeddingSearch.remote.testFailed"))).toBeInTheDocument();
    expect(screen.getByText(t("embeddingSearch.guidance.key"))).toBeInTheDocument();
  });

  it("已保存但已关闭：用 /status 的掩码配置回填表单，密钥不回显", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "disabled",
        provider: "openai-http",
        remote: {
          configured: true,
          enabled: false,
          host: "api.example.com",
          model: "text-embedding-3-small",
        },
        config: {
          provider: "openai-http",
          base_url: "https://api.example.com/v1",
          model: "text-embedding-3-small",
          endpoint_mode: "template",
          request_url: "https://api.example.com/embeddings",
          batch_size: 30,
          api_key: "********",
        },
      }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.remote.savedHint"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("embeddingSearch.remote.baseUrl.label"))).toHaveValue(
      "https://api.example.com/v1",
    );
    expect(screen.getByLabelText(t("embeddingSearch.remote.model.label"))).toHaveValue(
      "text-embedding-3-small",
    );
    expect(
      (screen.getByLabelText(t("embeddingSearch.remote.key.label")) as HTMLInputElement).value,
    ).toBe("");
  });

  it("就绪（远程）清除密钥：确认后调用 clear", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "ready",
        provider: "openai-http",
        remote: {
          configured: true,
          enabled: true,
          host: "api.example.com",
          model: "text-embedding-3-small",
          dim: 1024,
          confirmed_hosts: ["api.example.com"],
        },
      }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
    const clearButtons = await screen.findAllByRole("button", {
      name: t("embeddingSearch.remote.clear"),
    });
    fireEvent.click(clearButtons[0]);
    // Popconfirm 的确认按钮与触发器同名：取最后一个（弹层里那颗）。
    const allButtons = await screen.findAllByRole("button", {
      name: t("embeddingSearch.remote.clear"),
    });
    fireEvent.click(allButtons[allButtons.length - 1]);
    await waitFor(() => expect(apiMocks.clearEmbedding).toHaveBeenCalledTimes(1));
  });

  it("Intel Mac：切换本地只看到架构不支持说明，没有下载按钮", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({ local: { supported: false, platform: "macos-x64" } }),
    );
    renderCard();
    // 默认已切到远程（本地不可用），点本地选项才出现不可用说明。
    fireEvent.click(await screen.findByText(t("embeddingSearch.mode.local")));
    expect(await screen.findByText(t("embeddingSearch.state.unsupported"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("embeddingSearch.local.download") }),
    ).not.toBeInTheDocument();
  });
});
