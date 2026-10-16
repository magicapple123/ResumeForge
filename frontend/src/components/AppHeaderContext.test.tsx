/** 页头上下文：当前数据集名 + 头像（取自「我的资料」当前启用的照片）。 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import AppHeaderContext from "./AppHeaderContext";
import baseStyles from "../styles/base.css?inline";

const listDatasets = vi.fn();
const activateDataset = vi.fn();
const getProfile = vi.fn();

vi.mock("../api/settings", () => ({
  listDatasets: () => listDatasets(),
  activateDataset: (id: string) => activateDataset(id),
}));
vi.mock("../api/profile", () => ({
  getProfile: () => getProfile(),
}));
vi.mock("../utils/navigation", () => ({
  reloadPage: vi.fn(),
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <AppHeaderContext />
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  listDatasets.mockReset();
  activateDataset.mockReset();
  getProfile.mockReset();
  activateDataset.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("AppHeaderContext", () => {
  it("示例徽标在页头和下拉菜单中都满足小字 4.5:1 的对比度", async () => {
    listDatasets.mockResolvedValue([
      { id: "demo", name: "体验示例", source: "sample", is_active: true },
    ]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });
    const { container } = renderHeader();
    const stylesheet = document.createElement("style");
    stylesheet.textContent = baseStyles;
    container.appendChild(stylesheet);

    fireEvent.click(await screen.findByRole("button", { name: "当前数据集：体验示例" }));
    const badges = await screen.findAllByText("示例");
    expect(badges).toHaveLength(2);

    function luminance(color: string) {
      const channels = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    for (const badge of badges) {
      const style = getComputedStyle(badge);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      expect(
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
        `${style.color} on ${style.backgroundColor}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("显示当前数据集的名字，而不是列表里的第一个", async () => {
    listDatasets.mockResolvedValue([
      { id: "a", name: "工作数据", is_active: false },
      { id: "b", name: "个人数据", is_active: true },
    ]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    renderHeader();

    await waitFor(() => expect(screen.getByText("个人数据")).toBeInTheDocument());
    expect(screen.queryByText("工作数据")).not.toBeInTheDocument();
  });

  it("头像用资料里当前启用的那张照片", async () => {
    listDatasets.mockResolvedValue([{ id: "a", name: "默认", is_active: true }]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "data:image/png;base64,AAAA" });

    const { container } = renderHeader();

    await waitFor(() => {
      expect(container.querySelector(".app-user-avatar img")).not.toBeNull();
    });
    expect(container.querySelector(".app-user-avatar img")).toHaveAttribute(
      "src",
      "data:image/png;base64,AAAA",
    );
  });

  it("没有照片时退化成姓名首字，而不是空白圆圈", async () => {
    listDatasets.mockResolvedValue([{ id: "a", name: "默认", is_active: true }]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    renderHeader();

    await waitFor(() => expect(screen.getByText("张")).toBeInTheDocument());
  });

  it("接口读不到时安静退化：页头少一块，应用不报错", async () => {
    listDatasets.mockRejectedValue(new Error("boom"));
    getProfile.mockRejectedValue(new Error("boom"));

    const { container } = renderHeader();

    await waitFor(() => expect(container.querySelector(".ant-skeleton")).toBeNull());
    expect(container.querySelector(".app-dataset-chip")).toBeNull();
  });

  it("点击头像直接进入我的资料", async () => {
    listDatasets.mockResolvedValue([{ id: "a", name: "默认", is_active: true }]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    renderHeader();

    fireEvent.click(await screen.findByRole("button", { name: "进入我的资料" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/profile"));
  });

  it("点击数据集后直接调用切换接口", async () => {
    listDatasets.mockResolvedValue([
      { id: "a", name: "工作数据", is_active: false },
      { id: "b", name: "个人数据", is_active: true },
    ]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    renderHeader();

    fireEvent.click(await screen.findByRole("button", { name: "当前数据集：个人数据" }));
    fireEvent.click(await screen.findByText("工作数据"));

    await waitFor(() => expect(activateDataset).toHaveBeenCalledWith("a"));
  });

  it("当前是示例数据集：chip 与下拉条目显示「示例」徽标，并提供「回到我的数据」", async () => {
    listDatasets.mockResolvedValue([
      { id: "main", name: "我的数据", source: "本机", is_active: false },
      { id: "demo", name: "体验示例", source: "sample", is_active: true },
    ]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    renderHeader();

    // chip 上有示例徽标。
    await waitFor(() => expect(screen.getAllByText("示例").length).toBeGreaterThan(0));

    // 打开下拉：示例条目带徽标，「回到我的数据」在列。
    fireEvent.click(screen.getByRole("button", { name: "当前数据集：体验示例" }));
    expect(await screen.findByText("回到我的数据")).toBeInTheDocument();

    // 点击它走既有切换流程，目标是主数据。
    fireEvent.click(screen.getByText("回到我的数据"));
    await waitFor(() => expect(activateDataset).toHaveBeenCalledWith("main"));
  });

  it("当前不是示例数据集：不显示「示例」徽标，也没有「回到我的数据」", async () => {
    listDatasets.mockResolvedValue([
      { id: "main", name: "我的数据", source: "本机", is_active: true },
    ]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    renderHeader();

    await waitFor(() => expect(screen.getByText("我的数据")).toBeInTheDocument());
    expect(screen.queryByText("示例")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "当前数据集：我的数据" }));
    await waitFor(() => expect(screen.getByText("我的数据（当前）")).toBeInTheDocument());
    expect(screen.queryByText("回到我的数据")).toBeNull();
  });
});
