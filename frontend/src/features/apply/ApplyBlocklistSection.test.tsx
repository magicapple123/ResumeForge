// SPDX-License-Identifier: Apache-2.0
/**
 * #14E 屏蔽清单设置区块的单测：标签模式、批量编辑模式与无效项显形。
 *
 * 关键判据是"保存的内容"而不是"有没有按钮"：
 * - 两个模式共用同一份内容，来回切换不丢已输入的字（包括还没回车的草稿）；
 * - 无效关键词（后端 `inactive_keywords`）必须在界面上显形，而不是静默丢弃；
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

const BLOCKLIST = {
  companies: ["某外包公司"],
  keywords: ["外包派遣", "北京"],
  inactive_keywords: ["北京"],
};

/** 测试里在批量编辑框里敲进去的两家公司名（当数据用，不作文案断言）。 */
const ADDED = ["A公司", "B公司"];
/** 标签模式里回车添加的一家新公司。 */
const NEW_COMPANY = "新公司";

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getApplyBlocklist.mockResolvedValue(BLOCKLIST);
  apiMocks.saveApplyBlocklist.mockImplementation((payload) =>
    Promise.resolve({
      ...payload,
      inactive_keywords: payload.keywords.filter((word: string) => word === "北京"),
    }),
  );
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

function bulkEdit() {
  fireEvent.click(screen.getByRole("button", { name: t("applySettings.blocklist.batchEdit") }));
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
  it("默认标签模式：已保存的项一条一个标签", async () => {
    renderSection();

    expect(await screen.findByText(BLOCKLIST.companies[0])).toBeInTheDocument();
    expect(screen.getByText(BLOCKLIST.keywords[0])).toBeInTheDocument();
    // 标签模式不渲染 textarea：一屏就能数清屏蔽了哪些项。
    expect(screen.queryByLabelText(t("applySettings.blocklist.companies"))).toBeNull();
  });

  it("切到批量编辑后回填 textarea，保留已输入内容", async () => {
    renderSection();
    await screen.findByText(BLOCKLIST.companies[0]);

    bulkEdit();

    const companies = (await screen.findByLabelText(
      t("applySettings.blocklist.companies"),
    )) as HTMLTextAreaElement;
    const keywords = screen.getByLabelText(
      t("applySettings.blocklist.keywords"),
    ) as HTMLTextAreaElement;
    expect(companies.value).toBe("某外包公司");
    expect(keywords.value.split(String.fromCharCode(10))).toEqual(["外包派遣", "北京"]);

    fireEvent.change(companies, { target: { value: "A公司\nB公司" } });
    // 切回标签模式：textarea 里的两行变成两个标签，一个字都不丢。
    fireEvent.click(screen.getByRole("button", { name: t("applySettings.blocklist.backToTags") }));
    expect(await screen.findByText(ADDED[0])).toBeInTheDocument();
    expect(screen.getByText(ADDED[1])).toBeInTheDocument();
    expect(screen.queryByText(BLOCKLIST.companies[0])).toBeNull();
  });

  it("回车添加一项；未回车的草稿在切换模式时也会保留", async () => {
    renderSection();
    await screen.findByText(BLOCKLIST.companies[0]);

    const add = screen.getByLabelText(t("applySettings.blocklist.companyAddAria"));
    fireEvent.change(add, { target: { value: "新公司" } });
    fireEvent.keyDown(add, { key: "Enter", keyCode: 13 });

    expect(await screen.findByText(NEW_COMPANY)).toBeInTheDocument();

    // 输入到一半直接切模式：草稿也算已输入，切回来还在。
    const keywordAdd = screen.getByLabelText(t("applySettings.blocklist.keywordAddAria"));
    fireEvent.change(keywordAdd, { target: { value: "驻场" } });
    bulkEdit();
    const keywords = (await screen.findByLabelText(
      t("applySettings.blocklist.keywords"),
    )) as HTMLTextAreaElement;
    expect(keywords.value).toContain("驻场");
  });

  it("无效关键词渲染成灰标签，并说明「太宽泛，不会生效」", async () => {
    renderSection();

    const tag = await screen.findByText(BLOCKLIST.keywords[1]);
    fireEvent.mouseEnter(tag);

    expect(await screen.findByText(t("applySettings.blocklist.inactive"))).toBeInTheDocument();
  });

  it("保存时只提交两列，且只调屏蔽清单自己的端点", async () => {
    renderSection();
    await screen.findByText(BLOCKLIST.companies[0]);

    bulkEdit();
    const companies = (await screen.findByLabelText(
      t("applySettings.blocklist.companies"),
    )) as HTMLTextAreaElement;
    fireEvent.change(companies, { target: { value: "A公司\nB公司\n" } });
    const keywords = screen.getByLabelText(
      t("applySettings.blocklist.keywords"),
    ) as HTMLTextAreaElement;
    fireEvent.change(keywords, { target: { value: "外包\n" } });

    fireEvent.click(screen.getByRole("button", { name: t("applySettings.blocklist.save") }));

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
    await screen.findByText(BLOCKLIST.companies[0]);

    fireEvent.click(screen.getByRole("button", { name: t("applySettings.blocklist.save") }));

    expect(await screen.findByText(SERVER_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(t("applySettings.blocklist.saved"))).not.toBeInTheDocument();
  });
});
