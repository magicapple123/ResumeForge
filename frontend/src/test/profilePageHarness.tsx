// SPDX-License-Identifier: Apache-2.0
/**
 * ProfilePage 测试共用的渲染与 mock 重置脚手架。
 *
 * 2026-10-13（PR-18）：ProfilePage.test.tsx 按自身豁免的触发条件（>800 行）拆分为
 * 「通用页面行为」（ProfilePage.test.tsx）与「网申资料域」（ProfilePage.webform.test.tsx）
 * 两个文件。vi.mock 声明必须留在各测试文件内（vitest 的 mock 注册是文件级的），
 * 但 PROFILE 夹具、渲染辅助与 mock 重置逻辑只有一份实现——就是本文件。
 *
 * 命名遵循 src/test/ 下既有共享测试基建的约定（assistantPageHarness.tsx 同款），
 * 不带 `.test.` 后缀（不会被 vitest 收集、也不会被行数预算当成生产代码误判——
 * 它本来就是测试脚手架，与 resumeFixtures.ts 同类）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { Mock } from "vitest";
import { expect } from "vitest";
import {
  setProfileEditControl,
  setProfileSaveControl,
} from "../features/tou-tou/profileSaveBridge";
import type { Profile } from "../types";
import ProfilePage from "../pages/ProfilePage";
import { t } from "../i18n";

/** ProfilePage 测试文件里 `vi.hoisted` 创建的那组 API mock 的形状。 */
export interface ProfileApiMocks {
  getProfile: Mock;
  saveProfile: Mock;
  listResumes: Mock;
  getWebFormExtraProfile: Mock;
  updateWebFormExtraProfile: Mock;
}

/** 空资料的默认夹具：分区全空、没有通用简历。 */
export const DEFAULT_PROFILE: Profile = {
  id: 1,
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  target_city: "",
  job_intent: "后端开发",
  personal_website: "",
  github: "",
  summary: "",
  wechat: "",
  birth_date: "",
  id_type: "",
  id_number: "",
  country_region: "",
  native_place: "",
  political_status: "",
  phone_country_code: "+86",
  family_info: "",
  expected_salary: "",
  qq: "",
  advisor: "",
  research_direction: "",
  preferred_industry: "",
  section_order: [],
  educations: [],
  experiences: [],
  campus_experiences: [],
  projects: [],
  skills: [],
  awards: [],
};

/** 渲染整页：ProfilePage 的离开守卫用 useBlocker，必须是 data router。 */
export function renderProfilePage() {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <AntdApp>
          <ProfilePage />
        </AntdApp>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

/**
 * 页头那只「编辑资料」按钮所在的容器。
 *
 * 「网申资料」空态（`WebFormProfileEmpty`）里也有一颗 CTA，此前与页头共用同一个词表 key，
 * 于是 `getByRole("button", { name: /编辑资料/ })` 会命中两个；空态改用自己的
 * `profileLibrary.action.fillWebForm` 后名字已不再撞，这里仍收窄到页头，
 * 语义是「点页面右上角那只」——不是「随便哪只都行」。
 */
export function headerRegion(): HTMLElement {
  const header = document.querySelector<HTMLElement>(".profile-page-header");
  if (!header) throw new Error("页头容器 .profile-page-header 未找到");
  return header;
}

/**
 * 页头那只「编辑资料」按钮（同步取，用于 fireEvent.click）。
 *
 * 名字用正则而不是全等：按钮带图标，antd 的图标有 `aria-label="edit"`，所以可访问名
 * 是「edit 编辑资料」而非「编辑资料」；这里只要求包含词表里的那个名字，同时靠
 * `within(页头)` 把页面其他位置的按钮排除掉。
 */
export function headerEditButton(): HTMLElement {
  return within(headerRegion()).getByRole("button", { name: editNamePattern() });
}

function editNamePattern(): RegExp {
  return new RegExp(t("profileLibrary.action.edit"));
}

/**
 * antd 会在两个中文字之间插一个空格（按钮「两字间距」），可访问名因此是「删 除」而不是
 * 「删除」。断言按钮名时用这个把词表值转成正则，逐字之间允许空白；英文名不受影响
 * （`\s*` 允许零个空白）。
 */
export function looseButtonName(text: string): RegExp {
  return new RegExp(Array.from(text).join("\\s*"));
}

/**
 * 页头那只「编辑资料」按钮（等待它出现）。
 *
 * 不能用 `headerRegion()` + `findByRole`：页头在加载态里整个不渲染（只剩骨架屏），
 * 容器会先短暂不存在。这里用 `waitFor` 同时等「容器出现」与「按钮出现」。
 */
export async function findHeaderEditButton(): Promise<HTMLElement> {
  return waitFor(() => {
    const header = document.querySelector<HTMLElement>(".profile-page-header");
    if (!header) throw new Error("页头容器 .profile-page-header 未找到");
    return within(header).getByRole("button", { name: editNamePattern() });
  });
}

/** 打开「网申资料」分页，并等它的说明文案出现（面板内容加载完成的信号）。 */
export async function openWebFormTab() {
  const tab = await screen.findByRole("tab", { name: "网申资料" });
  fireEvent.click(tab);
  await waitFor(() => {
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getAllByText(t("profileLibrary.webform.sectionAlertTitle")).length,
    ).toBeGreaterThan(0);
  });
}

/**
 * 每条用例前的 mock 复位 + 默认返回值。apiMocks 是各测试文件用 `vi.hoisted`
 * 自建的对象（vi.mock 工厂只能引用同文件的 hoisted 值），这里接收进来统一复位。
 */
export function resetProfileApiMocks(mocks: ProfileApiMocks): void {
  mocks.getProfile.mockReset().mockResolvedValue(DEFAULT_PROFILE);
  mocks.saveProfile.mockReset().mockResolvedValue(DEFAULT_PROFILE);
  mocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  mocks.getWebFormExtraProfile.mockReset().mockResolvedValue({
    fields: [
      {
        key: "cet6_score",
        label: "英语六级分数",
        group: "语言与证书",
        kind: "text",
        sensitive: false,
      },
      { key: "height", label: "身高(cm)", group: "身体情况", kind: "text", sensitive: true },
    ],
    groups: ["语言与证书", "身体情况"],
    values: {},
  });
  mocks.updateWebFormExtraProfile.mockReset().mockResolvedValue({
    fields: [],
    groups: [],
    values: {},
  });
}

/** 每条用例后的清理：卸载 + 清 DOM + 悬浮球桥双槽兜底置空。 */
export function cleanupProfilePage(): void {
  cleanup();
  document.body.innerHTML = "";
  // 桥的两个槽都是模块级单例：正常路径下卸载即置 null，这里再兜一道，避免脏态串进下一条用例。
  setProfileSaveControl(null);
  setProfileEditControl(null);
}
