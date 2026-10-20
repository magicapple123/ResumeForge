// SPDX-License-Identifier: Apache-2.0
/** 页头上下文：当前数据集名 + 头像（取自「我的资料」当前启用的照片）+ 新建数据集入口。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import AppHeaderContext from "./AppHeaderContext";
import { reloadPage } from "../utils/navigation";
import baseStyles from "../styles/base.css?inline";
import designTokens from "../theme/design-tokens.css?raw";

const listDatasets = vi.fn();
const activateDataset = vi.fn();
const createDataset = vi.fn();
const getProfile = vi.fn();
const saveActiveDatasetId = vi.fn();

vi.mock("../api/settings", () => ({
  listDatasets: () => listDatasets(),
  activateDataset: (id: string) => activateDataset(id),
  createDataset: (name: string) => createDataset(name),
}));
vi.mock("../api/profile", () => ({
  getProfile: () => getProfile(),
}));
vi.mock("../utils/navigation", () => ({
  reloadPage: vi.fn(),
}));
vi.mock("../utils/datasetScope", () => ({
  saveActiveDatasetId: (id: string | null | undefined) => saveActiveDatasetId(id),
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}</span>;
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <AppHeaderContext />
        <LocationProbe />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 打开数据集下拉并点「新建数据集…」，返回名称输入框。 */
async function openCreateModal() {
  fireEvent.click(await screen.findByRole("button", { name: "当前数据集：工作数据" }));
  fireEvent.click(await screen.findByText("新建数据集…"));
  return screen.findByLabelText("数据集名称");
}

beforeEach(() => {
  listDatasets.mockReset();
  activateDataset.mockReset();
  createDataset.mockReset();
  getProfile.mockReset();
  saveActiveDatasetId.mockReset();
  vi.mocked(reloadPage).mockReset();
  activateDataset.mockResolvedValue(undefined);
  window.localStorage.clear();
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

    /**
     * 色值从 **CSS 文本**里取，而不是 `getComputedStyle`。
     *
     * 原因：注入的是 `base.css?inline` 的原文，jsdom 不求值 custom property——`color` 会
     * 原样返回 `var(--rf-text-body)`，而 `background` 直接退化成 `rgba(0, 0, 0, 0)`
     * （声明被判为无效值）。R18 把 534 处色值全量 token 化之后，这条断言就是这么失效的：
     * 它开始测"透明底上的 var() 字符串"，对比度算出来是 NaN。
     * 现在改成"解析 token → 算真实对比度"，比原来更贴近要守的东西（徽标可读）。
     */
    function resolveToken(raw: string): string {
      const matched = /^var\((--rf-[a-z-]+)\)$/.exec(raw.trim());
      if (!matched) return raw.trim();
      const declared = new RegExp(`${matched[1]}\\s*:\\s*([^;]+);`).exec(designTokens);
      return declared ? declared[1].trim() : raw.trim();
    }

    function declared(selector: string, property: string): string {
      const rule = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(baseStyles);
      const body = rule?.[1] ?? "";
      const value = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`).exec(body);
      return resolveToken(value?.[1] ?? "");
    }

    /** 支持 `#rgb` / `#rrggbb` / `rgb(...)`：token 解析出来是十六进制，按 rgb 的算法算会得到 NaN。 */
    function luminance(color: string) {
      const raw = color.trim();
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
      let values: number[];
      if (hex) {
        const pairs =
          hex[1].length === 3
            ? hex[1].split("").map((char) => char + char)
            : (hex[1].match(/../g) ?? []);
        values = pairs.map((pair) => Number.parseInt(pair, 16));
      } else {
        values = (raw.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      }
      const channels = values.slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    }

    const foregroundColor = declared("\\.app-dataset-sample-tag", "color");
    const backgroundColor = declared("\\.app-dataset-sample-tag", "background");
    const foreground = luminance(foregroundColor);
    const background = luminance(backgroundColor);

    // 两个徽标都真的带着这条样式类（页头一个、下拉菜单一个）。
    expect(
      badges.filter((badge) => badge.classList.contains("app-dataset-sample-tag")),
    ).toHaveLength(2);
    expect(
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      `${foregroundColor} on ${backgroundColor}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("弹层宽度跟随触发框（与圆角框同宽）", async () => {
    // jsdom 里 offsetWidth 恒为 0；这里给原型装一个可配置的 getter，模拟真实布局下量到的宽度。
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 220,
    });
    listDatasets.mockResolvedValue([{ id: "a", name: "工作数据", is_active: true }]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });
    try {
      renderHeader();
      fireEvent.click(await screen.findByRole("button", { name: "当前数据集：工作数据" }));
      const dropdown = await waitFor(() => {
        const node = document.querySelector<HTMLElement>(".app-dataset-dropdown");
        expect(node).not.toBeNull();
        return node!;
      });
      expect(dropdown.style.width).toBe("220px");
      expect(dropdown.style.maxWidth).toBe("220px");
    } finally {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
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

  it("beforeAvatar 插槽渲染在头像左侧（项 1：「我的空间」搬家靠它）", async () => {
    listDatasets.mockResolvedValue([{ id: "a", name: "默认", is_active: true }]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });

    const { container } = render(
      <MemoryRouter>
        <AntdApp>
          <AppHeaderContext beforeAvatar={<span data-testid="avatar-slot">我的空间</span>} />
        </AntdApp>
      </MemoryRouter>,
    );

    await waitFor(() => expect(container.querySelector(".app-user-avatar-button")).not.toBeNull());

    // 紧邻：插槽就是头像的前一个兄弟节点——中间不再隔着别的容器（CSS `order` 跨容器排不了，
    // 所以顺序只能靠 DOM，见组件文件头的说明）。
    const slot = container.querySelector('[data-testid="avatar-slot"]');
    expect(slot).not.toBeNull();
    expect(container.querySelector(".app-user-avatar-button")!.previousElementSibling).toBe(slot);
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

describe("AppHeaderContext 新建数据集（R4）", () => {
  const CURRENT = { id: "a", name: "工作数据", is_active: true };
  const CREATED = { id: "b", name: "面试练习", source: "本机", is_active: false };

  beforeEach(() => {
    listDatasets.mockResolvedValue([CURRENT]);
    getProfile.mockResolvedValue({ name: "张示例", photo: "" });
  });

  it("下拉菜单末尾有「新建数据集…」，点击只开弹窗，不切换数据集", async () => {
    renderHeader();

    const nameInput = await openCreateModal();

    expect(nameInput).toBeInTheDocument();
    expect(activateDataset).not.toHaveBeenCalled();
  });

  it("创建成功后刷新列表，确认「立即切换」会 activate + 落盘 active id 并重载", async () => {
    listDatasets.mockResolvedValueOnce([CURRENT]).mockResolvedValue([CURRENT, CREATED]);
    createDataset.mockResolvedValue(CREATED);
    renderHeader();

    const nameInput = await openCreateModal();
    fireEvent.change(nameInput, { target: { value: " 面试练习 " } });
    fireEvent.click(screen.getByRole("button", { name: /新\s*建/ }));

    // 名称 trim 后再提交。
    await waitFor(() => expect(createDataset).toHaveBeenCalledWith("面试练习"));
    // antd 会把确认框标题渲染两份（.ant-modal-title 与 .ant-modal-confirm-title）。
    expect((await screen.findAllByText(/已新建「面试练习」/)).length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByRole("button", { name: /立即切换/ }));

    await waitFor(() => expect(activateDataset).toHaveBeenCalledWith("b"));
    expect(saveActiveDatasetId).toHaveBeenCalledWith("b");
    await waitFor(() => expect(reloadPage).toHaveBeenCalled());

    // 列表刷新后新数据集出现在下拉里。
    fireEvent.click(screen.getByRole("button", { name: "当前数据集：工作数据" }));
    expect(await screen.findByText("面试练习")).toBeInTheDocument();
  });

  it("取消「稍后」只关闭询问，不切换数据集", async () => {
    listDatasets.mockResolvedValueOnce([CURRENT]).mockResolvedValue([CURRENT, CREATED]);
    createDataset.mockResolvedValue(CREATED);
    renderHeader();

    const nameInput = await openCreateModal();
    fireEvent.change(nameInput, { target: { value: "面试练习" } });
    fireEvent.click(screen.getByRole("button", { name: /新\s*建/ }));

    fireEvent.click(await screen.findByRole("button", { name: /稍\s*后/ }));

    // 不打断言弹窗"消失"（jsdom 等不到 antd 的离场动画），只断行为：什么都没发生。
    await waitFor(() => expect(createDataset).toHaveBeenCalledWith("面试练习"));
    expect(activateDataset).not.toHaveBeenCalled();
    expect(saveActiveDatasetId).not.toHaveBeenCalledWith("b");
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it("名称为空时提示且不发请求", async () => {
    renderHeader();

    const nameInput = await openCreateModal();
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /新\s*建/ }));

    expect(await screen.findByText("请填写数据集名称")).toBeInTheDocument();
    expect(createDataset).not.toHaveBeenCalled();
  });

  it("重名时展示后端返回的原文", async () => {
    createDataset.mockRejectedValue(new Error("数据集名称已存在"));
    renderHeader();

    const nameInput = await openCreateModal();
    fireEvent.change(nameInput, { target: { value: "面试练习" } });
    fireEvent.click(screen.getByRole("button", { name: /新\s*建/ }));

    expect(await screen.findByText("数据集名称已存在")).toBeInTheDocument();
    // 失败后弹窗仍开着，用户可以改名重试。
    expect(screen.getByLabelText("数据集名称")).toBeInTheDocument();
  });
});
