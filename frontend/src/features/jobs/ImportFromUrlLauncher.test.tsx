// SPDX-License-Identifier: Apache-2.0
/**
 * 「从链接导入」入口（#16C）与桌面菜单（#34B）的接线。
 *
 * #34B 的要求是"菜单调活**同一个** launcher/弹窗，不要重写第二套"。这里守的就是这条：
 *  - 页面按钮能打开弹窗（既有行为）；
 *  - 桌面标题栏发的窗口事件打开的也**是这一个**弹窗（不是标题栏自己挂的那个）；
 *  - 从别的页面跳到岗位广场时，菜单事件早于挂载，挂载后要消费"待打开"标记。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { OPEN_JOB_IMPORT_EVENT, requestJobUrlImport } from "../desktop/desktopJobImport";
import { ImportFromUrlLauncher } from "./ImportFromUrlLauncher";

afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }) {
  return <AntdApp>{children}</AntdApp>;
}

function renderLauncher() {
  return render(<ImportFromUrlLauncher onImported={vi.fn()} />, { wrapper: Wrapper });
}

describe("ImportFromUrlLauncher 的菜单入口（#34B）", () => {
  it("页面按钮打开弹窗（既有入口不变）", async () => {
    renderLauncher();
    // antd 按钮里带图标，按图标 + 文本取可访问名不稳定；点文本即可（点击会冒泡到按钮）。
    fireEvent.click(screen.getByText(t("jobsImport.launcher")));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("桌面菜单的窗口事件打开同一个弹窗（launcher 已挂载的情况）", async () => {
    renderLauncher();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => {
      requestJobUrlImport();
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // 事件名是跨模块契约（标题栏与这里必须逐字一致）。
    expect(OPEN_JOB_IMPORT_EVENT).toBe("resumeforge:open-job-import");
  });

  it("从别的页面跳过来：挂载时消费「待打开」标记，弹窗自动打开", async () => {
    act(() => {
      requestJobUrlImport();
    });
    renderLauncher();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
