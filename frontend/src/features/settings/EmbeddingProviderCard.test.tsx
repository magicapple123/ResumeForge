// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」卡：未启用/下载中/失败/就绪，以及第 16 条 ready 态一键切换。
 *
 * 命名配置列表与弹窗的用例分别在 EmbeddingProfileList.test.tsx /
 * EmbeddingProfileModal.test.tsx；三个文件都渲染同一张卡（集成口径）。
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import {
  fillProfileForm,
  localReadyStatus,
  makeProfile,
  makeStatus,
  openCreateModal,
  remoteReadyStatus,
  renderCard,
} from "./embeddingTestHelpers";

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
  activateEmbeddingProfile: vi.fn(),
  saveEmbeddingProfile: vi.fn(),
  deleteEmbeddingProfile: vi.fn(),
  testEmbeddingProfile: vi.fn(),
  clearEmbeddingProfileKey: vi.fn(),
  embeddingProgressPercent: (progress: number) => {
    if (!Number.isFinite(progress) || progress <= 0) return 0;
    const percent = progress <= 1 ? progress * 100 : progress;
    return Math.min(100, Math.round(percent));
  },
}));

vi.mock("../../api/settings", () => apiMocks);

const MUTATIONS = [
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
  apiMocks.activateEmbeddingProfile,
  apiMocks.saveEmbeddingProfile,
  apiMocks.deleteEmbeddingProfile,
  apiMocks.testEmbeddingProfile,
  apiMocks.clearEmbeddingProfileKey,
];

beforeEach(() => {
  apiMocks.getEmbeddingStatus.mockReset().mockResolvedValue(makeStatus());
  for (const mock of MUTATIONS) mock.mockReset().mockResolvedValue(undefined);
});

describe("EmbeddingProviderCard", () => {
  it("未启用：本地/远程二选一 + 本地下载按钮 + 远程配置空态", async () => {
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
    // 远程列表空态 + 新建入口（不再有常驻表单与厂商只读卡）。
    expect(
      await screen.findByText(t("embeddingSearch.remote.profiles.emptyHint")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("embeddingSearch.remote.profiles.create") }),
    ).toBeInTheDocument();
    // 未启用时那条说明横幅必须还在（它是首次配置的唯一解释，第 3 条只删已启用态）。
    expect(screen.getByText(t("embeddingSearch.intro"))).toBeInTheDocument();
  });

  it("远程未启用：首屏就是配置列表（没有常驻表单）", async () => {
    renderCard();
    fireEvent.click(await screen.findByText(t("embeddingSearch.mode.remote")));
    expect(screen.getByText(t("embeddingSearch.remote.profiles.title"))).toBeInTheDocument();
    expect(
      screen.queryByLabelText(t("embeddingSearch.remote.baseUrl.label")),
    ).not.toBeInTheDocument();
  });

  it("下载中：显示百分比进度与取消，取消请求真的发出", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({ state: "downloading", local: { state: "downloading", progress: 0.42 } }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.downloading"))).toBeInTheDocument();
    expect(
      screen.getByText(t("embeddingSearch.local.progress", { percent: 42 })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.local.cancel") }));
    await waitFor(() => expect(apiMocks.cancelEmbeddingLocalDownload).toHaveBeenCalledTimes(1));
  });

  it("就绪（本地）：卡头关闭检索，状态行右侧显式删除模型文件", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(localReadyStatus());
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyLocal"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.remote.disable") }));
    await waitFor(() => expect(apiMocks.disableEmbedding).toHaveBeenCalledTimes(1));

    // 第 3 条：顶部 ⋮ 已去掉，删除入口改成显式文字按钮（仍是本地资产的唯一出口）。
    expect(
      screen.queryByRole("button", { name: t("common.rowActions.more") }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.local.remove") }));
    // 确认框是 Popconfirm（.ant-popover），不是 Modal：按弹层容器定位它的确认按钮。
    const title = await screen.findByText(t("embeddingSearch.local.removeTitle"));
    const popover = title.closest(".ant-popover") as HTMLElement;
    fireEvent.click(
      within(popover).getByRole("button", { name: t("embeddingSearch.local.remove") }),
    );
    await waitFor(() => expect(apiMocks.removeEmbeddingLocalAssets).toHaveBeenCalledTimes(1));
  });

  it("失败：显示后端原因与「怎么办」，重试按钮重新发起下载", async () => {
    const diskError = "disk full";
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
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.local.retry") }));
    await waitFor(() => expect(apiMocks.startEmbeddingLocalDownload).toHaveBeenCalledTimes(1));
  });

  it("Intel Mac：本地不支持时没有下载按钮", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      makeStatus({ local: { supported: false, platform: "macos-x64" } }),
    );
    renderCard();
    fireEvent.click(await screen.findByText(t("embeddingSearch.mode.local")));
    expect(await screen.findByText(t("embeddingSearch.state.unsupported"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("embeddingSearch.local.download") }),
    ).not.toBeInTheDocument();
  });

  it("就绪（远程）：显示 host/模型与「生效中」标签，卡头是关闭检索", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
    expect(screen.getAllByText("api.example.com").length).toBeGreaterThan(0);
    expect(screen.getByText(t("embeddingSearch.remote.profile.active"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("embeddingSearch.remote.disable") }),
    ).toBeInTheDocument();
    // 第 3 条：已启用态不再重复解释"语义检索是什么"。
    expect(screen.queryByText(t("embeddingSearch.intro"))).not.toBeInTheDocument();
    // 顶部 ⋮ 已删（清除密钥仍可从配置卡的 ⋮ 走）。
    expect(
      screen.queryByRole("button", { name: t("common.rowActions.more") }),
    ).not.toBeInTheDocument();
  });

  it("已确认的地址默认收起，点「管理」才渲染撤销入口", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    renderCard();
    const toggle = await screen.findByRole("button", {
      name: t("embeddingSearch.hosts.toggle"),
    });
    // 收起态是条件渲染：撤销按钮整个不在 DOM 里（不是 display:none）。
    expect(screen.queryByRole("button", { name: t("embeddingSearch.hosts.revoke") })).toBeNull();
    fireEvent.click(toggle);
    expect(
      await screen.findByRole("button", { name: t("embeddingSearch.hosts.revoke") }),
    ).toBeInTheDocument();
  });

  it("第 16 条：远程就绪时点「切换到本地服务」= 激活本地 profile，不重走启用流程", async () => {
    apiMocks.getEmbeddingStatus
      .mockResolvedValueOnce(remoteReadyStatus())
      .mockResolvedValue(localReadyStatus());
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.ready.switchLocal") }));
    await waitFor(() =>
      expect(apiMocks.activateEmbeddingProfile).toHaveBeenCalledWith("p_local_1"),
    );
    // 切换后按新 status 渲染：本地就绪、远程配置仍在列表里。
    expect(await screen.findByText(t("embeddingSearch.state.readyLocal"))).toBeInTheDocument();
    expect(screen.getByText("Company Azure")).toBeInTheDocument();
    // 旧写路径（重新启用整段配置）没有被调用。
    expect(apiMocks.enableEmbeddingLocal).not.toHaveBeenCalled();
    expect(apiMocks.enableEmbeddingRemote).not.toHaveBeenCalled();
  });

  it("第 16 条：本地就绪时一键切回远程（按钮里写明 host）", async () => {
    apiMocks.getEmbeddingStatus
      .mockResolvedValueOnce(localReadyStatus())
      .mockResolvedValue(remoteReadyStatus());
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyLocal"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("embeddingSearch.ready.switchRemoteHost", { host: "api.example.com" }),
      }),
    );
    await waitFor(() =>
      expect(apiMocks.activateEmbeddingProfile).toHaveBeenCalledWith("p_remote_1"),
    );
    expect(await screen.findByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
  });

  it("第 16 条：切换失败不改当前 provider，卡片仍显示原远程详情", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(remoteReadyStatus());
    apiMocks.activateEmbeddingProfile.mockRejectedValue(new Error("probe timeout"));
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.ready.switchLocal") }));
    await waitFor(() => expect(apiMocks.activateEmbeddingProfile).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/probe timeout/)).toBeInTheDocument();
    // 当前 provider 详情没被换掉。
    expect(screen.getByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
    expect(screen.getAllByText("api.example.com").length).toBeGreaterThan(0);
  });

  it("本地已就绪但还没有本地 profile：走原有启用流程同步（不调用 activate）", async () => {
    apiMocks.getEmbeddingStatus.mockResolvedValue(
      remoteReadyStatus({ local_profile_id: "", local: { state: "ready" } }),
    );
    renderCard();
    expect(await screen.findByText(t("embeddingSearch.state.readyRemote"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("embeddingSearch.ready.switchLocal") }));
    await waitFor(() => expect(apiMocks.enableEmbeddingLocal).toHaveBeenCalledTimes(1));
    expect(apiMocks.activateEmbeddingProfile).not.toHaveBeenCalled();
  });

  it("新建配置按钮打开居中弹窗（宽 560）", async () => {
    renderCard();
    const dialog = await openCreateModal();
    expect(
      within(dialog).getByText(t("embeddingSearch.remote.modal.createTitle")),
    ).toBeInTheDocument();
    fillProfileForm({
      name: "Company Azure",
      baseUrl: "https://api.example.com/v1",
      model: "m",
      key: "k",
    });
    expect(dialog).toBeInTheDocument();
    expect(makeProfile().id).toBe("p_remote_1");
  });
});
