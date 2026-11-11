// SPDX-License-Identifier: Apache-2.0
/**
 * #14E 屏蔽清单设置区块的单测：两个 textarea、一行一项、保存走独立端点。
 *
 * 关键判据是"保存的内容"而不是"有没有按钮"：
 * - 按行拆分、去空白、丢掉空行（用户从表格里复制一列公司名时，尾部常带空行）；
 * - 屏蔽清单单独保存，**不能**混进「保存设置」那个提交 `/apply/config` 的按钮。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getApplyBlocklist: vi.fn(),
  saveApplyBlocklist: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  getApplyBlocklist: apiMocks.getApplyBlocklist,
  saveApplyBlocklist: apiMocks.saveApplyBlocklist,
}));

import { t } from "../../i18n";
import ApplyBlocklistSection, { splitBlocklistText } from "./ApplyBlocklistSection";

/** 后端 500 时弹给用户的文案由接口错误决定，这里当作数据而不是界面文案。 */
const SERVER_ERROR = "后端 500";

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getApplyBlocklist.mockResolvedValue({
    companies: ["某外包公司"],
    keywords: ["外包派遣"],
  });
  apiMocks.saveApplyBlocklist.mockImplementation((payload) => Promise.resolve(payload));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSection() {
  return render(
    <AntdApp>
      <ApplyBlocklistSection />
    </AntdApp>,
  );
}

describe("splitBlocklistText：一行一项", () => {
  it("按行拆分、去首尾空白", () => {
    expect(splitBlocklistText("  A公司  \nB公司")).toEqual(["A公司", "B公司"]);
  });

  it("丢掉空行与只有空白的行（复制进来时最常见的尾巴）", () => {
    expect(splitBlocklistText("A公司\n\n   \nB公司\n")).toEqual(["A公司", "B公司"]);
  });

  it("兼容 CRLF 换行", () => {
    expect(splitBlocklistText("A公司\r\nB公司")).toEqual(["A公司", "B公司"]);
  });

  it("空文本得到空数组", () => {
    expect(splitBlocklistText("")).toEqual([]);
  });
});

describe("ApplyBlocklistSection", () => {
  it("把已保存的清单回填到两个 textarea（一行一项）", async () => {
    renderSection();

    const companies = await screen.findByLabelText("屏蔽公司");
    const keywords = screen.getByLabelText("屏蔽关键词");
    await waitFor(() => expect(companies).toHaveValue("某外包公司"));
    expect(keywords).toHaveValue("外包派遣");
  });

  it("保存时按行提交，且只调屏蔽清单自己的端点", async () => {
    renderSection();

    const companies = (await screen.findByLabelText("屏蔽公司")) as HTMLTextAreaElement;
    fireEvent.change(companies, { target: { value: "A公司\nB公司\n" } });
    const keywords = screen.getByLabelText("屏蔽关键词") as HTMLTextAreaElement;
    fireEvent.change(keywords, { target: { value: "外包\n" } });

    fireEvent.click(screen.getByRole("button", { name: "保存屏蔽清单" }));

    await waitFor(() =>
      expect(apiMocks.saveApplyBlocklist).toHaveBeenCalledWith({
        companies: ["A公司", "B公司"],
        keywords: ["外包"],
      }),
    );
    expect(await screen.findByText(t("applySettings.blocklist.saved"))).toBeInTheDocument();
  });

  it("保存失败时给出错误提示（不假装成功）", async () => {
    apiMocks.saveApplyBlocklist.mockRejectedValue(new Error(SERVER_ERROR));

    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "保存屏蔽清单" }));

    expect(await screen.findByText(SERVER_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(t("applySettings.blocklist.saved"))).not.toBeInTheDocument();
  });
});
