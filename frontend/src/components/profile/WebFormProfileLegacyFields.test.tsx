import { App as AntdApp, Form } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WebFormProfileLegacyFields from "./WebFormProfileLegacyFields";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSection() {
  return render(
    <AntdApp>
      <Form>
        <WebFormProfileLegacyFields />
      </Form>
    </AntdApp>,
  );
}

function cardOwning(labelText: string): string {
  const label = Array.from(document.querySelectorAll("label")).find(
    (item) => (item.textContent ?? "").trim() === labelText,
  );
  if (!label) return "NOT FOUND";
  let node: HTMLElement | null = label;
  while (node && node !== document.body) {
    if (node.classList?.contains("ant-card")) {
      const title = node.querySelector(".ant-card-head-title");
      return title ? (title.textContent ?? "").trim() : "(未命名卡片)";
    }
    node = node.parentElement;
  }
  return "NOT IN A CARD";
}

describe("WebFormProfileLegacyFields", () => {
  it("保留的旧字段兼容组件使用统一的网申资料名称", () => {
    renderSection();

    expect(screen.getByText("网申资料")).toBeInTheDocument();
    expect(cardOwning("证件号码")).toBe("网申资料");
    expect(cardOwning("家庭信息")).toBe("网申资料");
  });

  it("保留原有字段，不新增或删减", () => {
    renderSection();

    for (const label of [
      "国家和地区",
      "籍贯",
      "政治面貌",
      "证件类型",
      "证件号码",
      "出生日期",
      "手机区号",
      "期望薪资",
      "意向行业",
      "导师",
      "研究方向",
      "家庭信息",
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});
