// SPDX-License-Identifier: Apache-2.0
/**
 * T11：投投浮窗的「弹层焦点豁免」信号（jsdom 能测的部分）。
 *
 * 这里只守两件事：
 * 1. Provider 的默认值是 `false`（页面里的 composer 不该被豁免）；
 * 2. `AddMenu` 只在收到信号时给浮层挂 `tt-popup-exempt`（面板 + 两个 `Select` 的下拉）。
 *
 * **真实缺陷（弹窗开着时焦点被抢回 `.ant-modal-close`）测不了**：antd 的焦点陷阱
 * 要求 `display: flex` + 定位，jsdom 算不出 `isFixedPos`，陷阱根本不启用 —— 在
 * 这里写"绿"的用例只会掩盖真实问题。真机判据在
 * `frontend/tests/smoke/tou-tou-focus.spec.ts` 的两条 T11 用例里。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
const resumeMocks = vi.hoisted(() => ({ listResumes: vi.fn(), getResume: vi.fn() }));

vi.mock("../../api/jobs", () => jobMocks);
vi.mock("../../api/resumes", () => resumeMocks);

import AddMenu from "../assistant/components/composer/AddMenu";
import type { AddMenuProps } from "../assistant/components/composer/AddMenu";
import { t } from "../../i18n";
import { TOU_TOU_POPUP_EXEMPT_CLASS } from "./touTouCardGuards";
import { TouTouPopupExemptionProvider } from "./TouTouPopupExemptionProvider";
import { useTouTouPopupExemption } from "./touTouPopupExemption";

/** 读出 context 内容的探针组件。 */
function Probe() {
  const exempt = useTouTouPopupExemption();
  return <span data-testid="probe">{exempt ? "exempt" : "plain"}</span>;
}

function menuProps(overrides: Partial<AddMenuProps> = {}): AddMenuProps {
  return {
    compact: true,
    sending: false,
    attachmentReads: 0,
    attachmentsCount: 0,
    jobId: undefined,
    resumeId: undefined,
    skillCatalog: [],
    selectedSkills: [],
    skillBudget: null,
    skillsLoaded: true,
    togglingSkillId: null,
    onJobChange: vi.fn(),
    onResumeChange: vi.fn(),
    onToggleSkill: vi.fn(),
    onManageSkills: vi.fn(),
    onAddAttachment: vi.fn(),
    ...overrides,
  };
}

/** 打开 `+` 面板，返回面板根节点（`Dropdown` 浮层，portal 到 body）。 */
async function openPanel(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }));
  const panel = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(".composer-add-panel");
    if (!found) throw new Error("面板还没展开");
    return found;
  });
  return panel;
}

beforeEach(() => {
  jobMocks.listJobs.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 });
  jobMocks.getJob.mockResolvedValue(null);
  resumeMocks.listResumes.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 50 });
  resumeMocks.getResume.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("Provider 默认值", () => {
  it("没有 Provider 时是 false（页面里的 composer 照旧被焦点陷阱接管）", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("plain");
  });

  it("Provider 内是 true，显式 enabled={false} 时回落 false", () => {
    const { unmount } = render(
      <TouTouPopupExemptionProvider>
        <Probe />
      </TouTouPopupExemptionProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("exempt");
    unmount();

    render(
      <TouTouPopupExemptionProvider enabled={false}>
        <Probe />
      </TouTouPopupExemptionProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("plain");
  });
});

describe("AddMenu 只在收到信号时挂标记", () => {
  it("Provider 内：面板带 tt-popup-exempt，两个 Select 的下拉也带", async () => {
    render(
      <AntdApp>
        <TouTouPopupExemptionProvider>
          <AddMenu {...menuProps()} />
        </TouTouPopupExemptionProvider>
      </AntdApp>,
    );
    const panel = await openPanel();
    expect(panel.className).toContain(TOU_TOU_POPUP_EXEMPT_CLASS);

    // 下拉是另一棵 body 浮层：打开岗位下拉验证它也被标上（antd 6 用
    // `classNames.popup.root`，改动属性名必须同步这里）。
    const selects = panel.querySelectorAll<HTMLElement>(".composer-add-select");
    expect(selects.length).toBe(2);
    fireEvent.mouseDown(selects[0].querySelector(".ant-select-selector") ?? selects[0]);
    const dropdown = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(".ant-select-dropdown");
      if (!found) throw new Error("下拉还没展开");
      return found;
    });
    expect(dropdown.className).toContain(TOU_TOU_POPUP_EXEMPT_CLASS);
  });

  it("没有 Provider（页面形态）：面板与下拉都不带标记", async () => {
    render(
      <AntdApp>
        <AddMenu {...menuProps({ compact: false })} />
      </AntdApp>,
    );
    const panel = await openPanel();
    expect(panel.className).not.toContain(TOU_TOU_POPUP_EXEMPT_CLASS);
    expect(document.querySelector(".ant-select-dropdown")).toBeNull();
  });
});
