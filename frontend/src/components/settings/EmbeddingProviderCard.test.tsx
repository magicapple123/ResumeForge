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

  it("本地下载源 404：引导语是「下载源」而不是「该服务商不提供 embeddings 接口」", async () => {
    // 真实现场：Release 里的资产从没发布过，后端原因含「下载源」，前端不能归类成远程厂商问题。
    const sourceError = "本地模型资产下载源不可用（资源未发布或地址失效，HTTP 404）";
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "failed",
        last_error: sourceError,
        local: { state: "failed", error: sourceError },
      }),
    );
    renderCard();
    expect(await screen.findByText(sourceError)).toBeInTheDocument();
    expect(screen.getByText(t("embeddingSearch.guidance.source"))).toBeInTheDocument();
    expect(screen.queryByText(t("embeddingSearch.guidance.endpoint"))).not.toBeInTheDocument();
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

  it("就绪（远程）清除密钥收进「···」：二次确认后才调用 clear", async () => {
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

    // 条目 08：不许再有裸露的红色「清除密钥」按钮。
    expect(screen.queryByRole("button", { name: t("embeddingSearch.remote.clear") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("embeddingSearch.remote.clear") }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("embeddingSearch.remote.clear") }),
    );
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

  it("远程未填配置时，卡头「启用」是禁用的；填好后可点", async () => {
    renderCard();
    await switchToRemote();

    const enableButton = screen.getByRole("button", { name: t("embeddingSearch.remote.enable") });
    expect(enableButton).toBeDisabled();
    // 禁用原因必须能读到（Tooltip 的说明），否则用户只看到一个灰按钮。
    fireEvent.mouseEnter(enableButton.parentElement ?? enableButton);
    expect(
      await screen.findByText(t("embeddingSearch.card.enableHint.remote")),
    ).toBeInTheDocument();

    fillRemoteForm();
    expect(screen.getByRole("button", { name: t("embeddingSearch.remote.enable") })).toBeEnabled();
  });

  it("厂商卡片网格：点一张卡就填好地址与候选模型，换取厂商会跟着换", async () => {
    renderCard();
    await switchToRemote();

    const grid = screen.getByRole("radiogroup", { name: t("embeddingSearch.remote.preset.aria") });
    fireEvent.click(
      within(grid).getByRole("radio", { name: t("embeddingSearch.remote.preset.openai") }),
    );
    expect(screen.getByLabelText(t("embeddingSearch.remote.baseUrl.label"))).toHaveValue(
      "https://api.openai.com/v1",
    );
    expect(screen.getByLabelText(t("embeddingSearch.remote.model.label"))).toHaveValue(
      "text-embedding-3-small",
    );
    expect(
      within(grid)
        .getByRole("radio", { name: t("embeddingSearch.remote.preset.openai") })
        .getAttribute("aria-checked"),
    ).toBe("true");

    fireEvent.click(
      within(grid).getByRole("radio", { name: t("embeddingSearch.remote.preset.zhipu") }),
    );
    expect(screen.getByLabelText(t("embeddingSearch.remote.baseUrl.label"))).toHaveValue(
      "https://open.bigmodel.cn/api/paas/v4",
    );
    // 选中态只该有一张卡（切换而不是叠加）。
    const checked = within(grid)
      .getAllByRole("radio")
      .filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
  });

  it("厂商卡片显示 host 与状态（已配置 / 未配置）", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "disabled",
        provider: "openai-http",
        remote: {
          configured: true,
          enabled: false,
          host: "api.openai.com",
          model: "text-embedding-3-small",
        },
      }),
    );
    renderCard();
    await switchToRemote();

    expect(screen.getByText("api.openai.com")).toBeInTheDocument();
    expect(
      screen.getByText(t("embeddingSearch.remote.preset.state.configured")),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(t("embeddingSearch.remote.preset.state.empty")).length,
    ).toBeGreaterThan(0);
  });

  it("paints the selected provider card with the theme-aware brand tint and 1.5px border", async () => {
    renderCard();
    await switchToRemote();

    const grid = screen.getByRole("radiogroup", { name: t("embeddingSearch.remote.preset.aria") });
    fireEvent.click(
      within(grid).getByRole("radio", { name: t("embeddingSearch.remote.preset.openai") }),
    );

    // 回归点：colorPrimaryBg 是灰的；换成浅色专用 palette.brandTint 后深色主题白底白字。
    // 所以必须引用 CSS 变量（浅/深两套 token 各自给值）。
    const selected = within(grid).getByRole("radio", {
      name: t("embeddingSearch.remote.preset.openai"),
    });
    const selectedStyle = selected.getAttribute("style") ?? "";
    expect(selectedStyle).toContain("var(--rf-brand-tint)");
    expect(selectedStyle).toContain("var(--rf-brand)");
    expect(selectedStyle).not.toMatch(/#eaf1f8|rgb\(234, 241, 248\)/i);
    expect(getComputedStyle(selected).borderTopWidth).toBe("1.5px");

    const other = within(grid).getByRole("radio", {
      name: t("embeddingSearch.remote.preset.zhipu"),
    });
    expect(other.getAttribute("style") ?? "").toContain("var(--rf-border)");
    expect(getComputedStyle(other).borderTopWidth).toBe("1px");
  });

  it("就绪（本地）删除模型文件收进「···」：确认后调用 remove", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({
        state: "ready",
        provider: "local-onnx",
        local: { state: "ready" },
      }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyLocal"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("embeddingSearch.local.remove") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("common.rowActions.more") }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: t("embeddingSearch.local.remove") }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: t("embeddingSearch.local.remove") }),
    );
    await waitFor(() => expect(apiMocks.removeEmbeddingLocalAssets).toHaveBeenCalledTimes(1));
  });

  it("动作进行中时「···」禁用，避免并发改配置", async () => {
    apiMocks.disableEmbedding.mockImplementation(() => new Promise(() => {}));
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
        },
      }),
    );
    renderCard();
    await screen.findByText(t("embeddingSearch.state.readyRemote"));
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.disable") }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: t("common.rowActions.more") })).toBeDisabled(),
    );
  });
});
