// SPDX-License-Identifier: Apache-2.0
/**
 * 「粘贴文本识别」的两阶段行为（项 13 / D23 / D25）。
 *
 * 从 `ProfilePage.test.tsx` 拆出：那边守通用页面行为，这边只守识别这一条链路的**契约**：
 * 识别成功**不直接写表单**（先列清单），用户确认后才写，取消则一个字都不动。
 *
 * 为什么这条契约值得单独一个文件：旧实现"识别即回填"，用户没有插话的机会——识别猜错的
 * 时候，错误值已经进了表单，而用户既不知道哪里被改了、也分不清"识别填的"与"我原来填的"。
 */

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getProfileSaveControl } from "../features/tou-tou/profileSaveBridge";
import {
  cleanupProfilePage,
  openWebFormTab,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  parseProfileText: vi.fn(),
  parseWebFormExtraProfileText: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

vi.mock("../api/profile", () => ({
  getProfile: apiMocks.getProfile,
  saveProfile: apiMocks.saveProfile,
  parseProfileText: apiMocks.parseProfileText,
}));
vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: apiMocks.updateWebFormExtraProfile,
  parseWebFormExtraProfileText: apiMocks.parseWebFormExtraProfileText,
}));
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  listResumes: apiMocks.listResumes,
  deleteResume: vi.fn(),
  renameResume: vi.fn(),
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  generateResume: vi.fn(),
  createManualResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue({ templates: [] }),
}));
vi.mock("../api/settings", () => ({ getLLMConfig: vi.fn().mockResolvedValue({}) }));

/** 一份"只有姓名"的识别结果：`job_intent` 为空，用来验证空值不覆盖已有填写。 */
const PARSED = {
  name: "李四",
  job_intent: "",
  warnings: [] as string[],
  parse_engine: "local" as const,
  recognized_text: "姓名：李四",
};

async function openAndParse() {
  fireEvent.click(await screen.findByRole("button", { name: /编辑资料/ }));
  fireEvent.click(await screen.findByRole("button", { name: /粘贴文本识别/ }));
  fireEvent.change(await screen.findByLabelText("个人资料文本"), {
    target: { value: "姓名：李四" },
  });
  fireEvent.click(screen.getByRole("button", { name: /识别并填入/ }));
}

/**
 * 网申侧的识别结果：一个目录外的新字段。
 *
 * `values` 刻意为空——这一条只验证"新栏目怎么进目录"，不掺目录内回填（那条由
 * `WebFormProfileSection.parse.test.tsx` 直测句柄）。
 */
const WEBFORM_PARSED = {
  values: {},
  custom: [{ key: "CUSTOM_是否有驾照", label: "是否有驾照", value: "C1" }],
  warnings: [] as string[],
  parse_engine: "local" as const,
  recognized_text: "是否有驾照：C1",
};

/** 打开「网申资料」分页 → 进入编辑态 → 粘贴文本识别 → 识别（停在阶段二：校对清单）。 */
async function openWebFormAndParse() {
  await openWebFormTab();
  fireEvent.click(await screen.findByRole("button", { name: /编辑资料/ }));
  fireEvent.click(await screen.findByRole("button", { name: /粘贴文本识别/ }));
  fireEvent.change(await screen.findByLabelText("个人资料文本"), {
    target: { value: "是否有驾照：C1" },
  });
  fireEvent.click(screen.getByRole("button", { name: /识别并填入/ }));
  await waitFor(() =>
    expect(document.querySelector('[data-row-id="CUSTOM_是否有驾照"]')).not.toBeNull(),
  );
}

/** 「网申资料」分页正文：弹窗走 portal 挂在 body 上，限定在这里才不会串到校对清单。 */
function webFormPanel(): HTMLElement {
  return screen.getByRole("tabpanel");
}

/**
 * 页面根部（不含弹窗）：antd 的 Modal 走 portal 挂在 body 上，所以这里查不到它。
 * 校对清单与资料表单会有同名的「姓名」输入框，取表单值必须限定在页面内。
 */
function page(): HTMLElement {
  const root = document.querySelector<HTMLElement>(".profile-page");
  if (!root) throw new Error("资料页还没渲染");
  return root;
}

/** 弹窗页脚：antd 会在两个汉字之间插空格（「取 消」），按名字查会受它影响。 */
function modalFooter(): HTMLElement {
  const footer = document.querySelector<HTMLElement>(".ant-modal-footer");
  if (!footer) throw new Error("弹窗页脚不存在");
  return footer;
}

/** 按 `data-row-id` 取一行（同名列会重复，按可访问名定位会二义）。 */
function row(id: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-row-id="${id}"]`);
  if (!element) throw new Error(`校对清单里没有 ${id} 这一行`);
  return element;
}

beforeEach(() => {
  resetProfileApiMocks(apiMocks);
  apiMocks.parseProfileText.mockResolvedValue(PARSED);
  // 网申侧的识别：默认返回"一个目录外的新字段"，各用例按需覆盖。
  apiMocks.parseWebFormExtraProfileText.mockReset().mockResolvedValue(WEBFORM_PARSED);
});

afterEach(() => {
  cleanupProfilePage();
});

describe("ProfilePage 粘贴识别 · 两阶段", () => {
  it("识别成功不直接改表单：弹窗留着，结果先列成可编辑的校对清单", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openAndParse();

    // 校对清单出现（这是"阶段二"的唯一标志）。
    await waitFor(() => expect(document.querySelector('[data-row-id="name"]')).not.toBeNull());
    // 弹窗**没有**关掉：用户要先核对。
    expect(screen.getByText(/识别到 1 项/)).toBeInTheDocument();
    // 表单也**没有**被改：姓名仍是资料里原来的值。
    expect(within(page()).getByLabelText("姓名")).toHaveValue("张三");
    // 还没置脏（什么都还没写）。
    expect(getProfileSaveControl()).toBeNull();
  });

  it("改一行再确认：只写这一行，空值字段不会被清空", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openAndParse();

    await waitFor(() => expect(document.querySelector('[data-row-id="name"]')).not.toBeNull());
    // 在清单里把"李四"改成"王五"（限定在那一行内取输入框：表单里也有一个「姓名」）。
    fireEvent.change(within(row("name")).getByLabelText("姓名"), { target: { value: "王五" } });
    fireEvent.click(screen.getByRole("button", { name: /确认填入 1 项/ }));

    await waitFor(() => expect(within(page()).getByLabelText("姓名")).toHaveValue("王五"));
    // 识别结果里 `job_intent` 是空串：不能因为"识别没提到"就把用户原来的意向清空。
    expect(within(page()).getByLabelText("求职意向")).toHaveValue("后端开发");
    // 确认填入后弹窗关闭，并且置脏（未保存警示要生效）。
    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());
  });

  it("点「取消」：弹窗关闭、表单一个字都不动", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openAndParse();

    await waitFor(() => expect(document.querySelector('[data-row-id="name"]')).not.toBeNull());
    fireEvent.click(within(modalFooter()).getByRole("button", { name: /取\s*消/ }));

    // 姓名仍是原来的值；也没有被置脏（不能留下"看起来改过"的状态）。
    expect(within(page()).getByLabelText("姓名")).toHaveValue("张三");
    expect(getProfileSaveControl()).toBeNull();
  });

  it("识别中点「取消识别」：不弹错误、回到输入态、可以再识别一次", async () => {
    // 一个"永不返回"的识别：只有点了取消才会通过 abort 结束。
    apiMocks.parseProfileText.mockImplementationOnce(
      (_payload, _onProgress, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new ApiError("已取消", undefined, { code: "cancelled" })),
          );
        }),
    );
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openAndParse();

    // 识别中主按钮变成「取消识别」（不是一直转圈的 loading 按钮）。
    const cancelButton = await screen.findByRole("button", { name: "取消识别" });
    fireEvent.click(cancelButton);

    // 取消不是失败：不弹错误提示，回到输入态。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /识别并填入/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText("已取消")).toBeNull();
    expect(screen.queryByText(/识别个人资料失败/)).toBeNull();
    // 原文还在，用户可以直接重来。
    expect(screen.getByLabelText("个人资料文本")).toHaveValue("姓名：李四");

    fireEvent.click(screen.getByRole("button", { name: /识别并填入/ }));
    await waitFor(() => expect(apiMocks.parseProfileText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('[data-row-id="name"]')).not.toBeNull());
  });
});

/**
 * 网申侧的两阶段（项 12 / D21）：目录内的栏目直接归位，**目录外的新栏目默认不勾**。
 *
 * 这一条比资料侧更要紧：写进去的结果不只是改一个值，而是往字段目录里**新增一个字段**。
 * 猜错一个值，用户改回来即可；凭空多出一个字段，用户要先发现它、再删掉它。
 */
describe("ProfilePage 粘贴识别 · 网申资料", () => {
  it("目录外的字段列成待确认项：标「新增字段」，且勾选框默认不选", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openWebFormAndParse();

    const newRow = row("CUSTOM_是否有驾照");
    // 用户得先看出"这不是我已有的栏目"。
    expect(within(newRow).getByText("新增字段")).toBeInTheDocument();
    // 默认不勾：新增字段是用户的选择，不是识别的决定（D21）。
    expect(within(newRow).getByRole("checkbox")).not.toBeChecked();
    // 一项都不勾 = 零项会写入，所以"确认填入"此刻是禁用的（⑦ 的同一件事的两面）。
    expect(within(modalFooter()).getByRole("button", { name: /确认填入\s*0\s*项/ })).toBeDisabled();
    // 草稿一个字都没动。
    expect(within(webFormPanel()).queryByLabelText("是否有驾照")).toBeNull();
    expect(getProfileSaveControl()).toBeNull();
  });

  it("勾选后确认填入：字段进目录、值进草稿，保存时按后端给的 key 提交", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openWebFormAndParse();

    fireEvent.click(within(row("CUSTOM_是否有驾照")).getByRole("checkbox"));
    const applyButton = await within(modalFooter()).findByRole("button", {
      name: /确认填入\s*1\s*项/,
    });
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    // 草稿里出现了这一栏：显示名是「是否有驾照」，值是识别到的 C1。
    const valueInput = await within(webFormPanel()).findByLabelText("是否有驾照");
    expect(valueInput).toHaveValue("C1");
    // 字段目录里也多出了它所在的「自定义」组（同名 Tag 与组标题都在，所以用 getAll）。
    expect(within(webFormPanel()).getAllByText("自定义").length).toBeGreaterThan(0);
    // 确认填入后置脏（未保存警示要生效）。
    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());

    // 真正落库时用的是**后端给的 key**（`CUSTOM_` 前缀由后端定，前端只沿用）。
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));
    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        expect.objectContaining({ CUSTOM_是否有驾照: "C1" }),
        expect.anything(),
        expect.anything(),
      ),
    );
  });

  it("一个都不勾时「确认填入」按钮禁用：不能靠点它把零项当成确认", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openWebFormAndParse();

    const applyButton = within(modalFooter()).getByRole("button", { name: /确认填入\s*0\s*项/ });
    expect(applyButton).toBeDisabled();

    // 勾上再取消勾选：数字回到 0，按钮重新禁用（不是一次性锁死）。
    const checkbox = within(row("CUSTOM_是否有驾照")).getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(
      await within(modalFooter()).findByRole("button", { name: /确认填入\s*1\s*项/ }),
    ).toBeEnabled();
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(
        within(modalFooter()).getByRole("button", { name: /确认填入\s*0\s*项/ }),
      ).toBeDisabled(),
    );
  });

  it("点「取消」：草稿与字段目录零变化，也不置脏", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
    await openWebFormAndParse();

    fireEvent.click(within(modalFooter()).getByRole("button", { name: /取\s*消/ }));

    // 两个副作用回调（写入值 / 新增字段名）都体现在这两处，所以直接断言它们的可见结果：
    // 草稿里没有这一栏；目录里也没有多出「自定义」这一组（新增字段一定落在那儿）。
    expect(within(webFormPanel()).queryByLabelText("是否有驾照")).toBeNull();
    expect(within(webFormPanel()).queryByText("自定义")).toBeNull();
    expect(getProfileSaveControl()).toBeNull();
    expect(apiMocks.updateWebFormExtraProfile).not.toHaveBeenCalled();

    // 再打开一次：必须是干净的输入态。`rows` 没清空的话这里会直接回到校对清单——
    // 而"取消"的全部承诺就是那次结果不再存在（antd 的 Modal 关闭期间会缓存子节点，
    // 所以只能靠"重新打开"来读这份状态，不能靠等 DOM 消失）。
    fireEvent.click(screen.getByRole("button", { name: /粘贴文本识别/ }));
    expect(await screen.findByRole("button", { name: /识别并填入/ })).toBeInTheDocument();
    expect(screen.getByLabelText("个人资料文本")).toHaveValue("");
    expect(document.querySelector('[data-row-id="CUSTOM_是否有驾照"]')).toBeNull();
  });
});
