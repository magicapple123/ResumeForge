/** 页头上下文：当前数据集名 + 头像（取自「我的资料」当前启用的照片）。 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import AppHeaderContext from "./AppHeaderContext";

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
});
