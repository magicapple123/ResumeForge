// SPDX-License-Identifier: Apache-2.0
/**
 * #29D：面试页「这家公司面经 N 条」的渲染契约。
 *
 * 三种状态都要覆盖：有 N 条（计数 + 标题 + 点击跳知识库公司筛选）、0 条（整块不渲染）、
 * 接口失败（一行灰字 + 重试，不弹 toast 打断面试）。N 取后端 total，不是 items.length。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({ related: vi.fn() }));

vi.mock("./companyKnowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./companyKnowledge")>();
  return { ...actual, getCompanyKnowledgeRelated: apiMocks.related };
});

import { CompanyKnowledgeSection } from "./CompanyKnowledgeSection";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderSection(company = "字节跳动") {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/interview"]}>
        <CompanyKnowledgeSection company={company} />
        <LocationProbe />
      </MemoryRouter>
    </AntdApp>,
  );
}

const ITEMS = [
  { id: 1, title: "字节一面面经" },
  { id: 2, title: "二面复盘" },
  { id: 3, title: "HR 面问题清单" },
  { id: 4, title: "不该出现的第四条" },
];

beforeEach(() => {
  apiMocks.related.mockReset();
});

describe("#29D 面试页「这家公司面经 N 条」", () => {
  it("有 N 条：显示计数与标题，点击跳知识库并按公司筛选", async () => {
    apiMocks.related.mockResolvedValue({ total: 4, items: ITEMS });
    const { container } = renderSection("字节跳动");

    expect(
      await screen.findByText(t("interviewKnowledge.title", { count: 4 })),
    ).toBeInTheDocument();
    // 后端 total 是精确匹配后的全量，标题只摆前 3 条（标题按钮的无障碍名是 aria-label）。
    const titleName = (title: string) => t("interviewKnowledge.openItem", { title });
    expect(screen.getByRole("button", { name: titleName(ITEMS[0].title) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: titleName(ITEMS[2].title) })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: titleName(ITEMS[3].title) })).toBeNull();
    expect(container.querySelectorAll(".interview-company-knowledge__title")).toHaveLength(3);

    fireEvent.click(screen.getByText(t("interviewKnowledge.title", { count: 4 })));
    expect(screen.getByTestId("location").textContent).toBe(
      `/knowledge?company=${encodeURIComponent("字节跳动")}`,
    );
  });

  it("0 条：整块不渲染（面试进行中不拿空态占位）", async () => {
    apiMocks.related.mockResolvedValue({ total: 0, items: [] });
    const { container } = renderSection();
    await waitFor(() => expect(apiMocks.related).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector(".interview-company-knowledge")).toBeNull());
  });

  it("接口失败：一行灰字 + 重试，点重试恢复显示（不弹 toast）", async () => {
    apiMocks.related.mockRejectedValueOnce(new Error("boom"));
    apiMocks.related.mockResolvedValueOnce({ total: 1, items: [{ id: 9, title: "面经一条" }] });
    renderSection();

    expect(await screen.findByText(t("interviewKnowledge.error"))).toBeInTheDocument();
    // 图标按钮的无障碍名里会带上图标名（reload 重试），所以这里用包含匹配。
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewKnowledge.retry")) }),
    );
    expect(
      await screen.findByText(t("interviewKnowledge.title", { count: 1 })),
    ).toBeInTheDocument();
    expect(apiMocks.related).toHaveBeenCalledTimes(2);
  });

  it("没有公司名（材料导入式面试）：不发请求、不渲染", async () => {
    const { container } = renderSection("   ");
    expect(apiMocks.related).not.toHaveBeenCalled();
    expect(container.querySelector(".interview-company-knowledge")).toBeNull();
  });
});
