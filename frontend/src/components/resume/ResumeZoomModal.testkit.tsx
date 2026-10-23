// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」用例的共用夹具（2026-10-23 拆出）。
 *
 * 为什么要有这个文件：外壳用例超过 500 行预算，而三栏结构、窄档抽屉、动作条三组用例
 * 需要**完全相同**的 CONTENT / LAYOUT 与渲染包装。复制一份夹具比拆用例更快腐烂——
 * 改一处夹具就要记得改两处，漏了就是"一个用例过、另一个莫名失败"。
 *
 * 注意：`vi.mock` 不能放在这里。它是按**模块**提升的，只有在测试文件里调用才会作用于
 * 该文件的模块图——两个消费方各自写一遍那三条 mock。
 */
import { App as AntdApp } from "antd";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, vi } from "vitest";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import { readWorkbenchCss } from "../../test/workbenchStyles";
import type { ResumeContent, ResumeLayout } from "../../types";
import ResumeZoomModal from "./ResumeZoomModal";

export const CONTENT: ResumeContent = {
  photo: "",
  name: "Test User",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

export const LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

export function renderModal(props: Partial<ComponentProps<typeof ResumeZoomModal>> = {}) {
  return render(
    <AntdApp>
      <ResumeZoomModal
        open
        html="<html></html>"
        warnings={[]}
        pages={1}
        onClose={vi.fn()}
        layout={LAYOUT}
        resumeId={42}
        content={CONTENT}
        onApplyLayout={vi.fn()}
        onSaveContent={vi.fn(async () => undefined)}
        {...props}
      />
    </AntdApp>,
  );
}

export function body(): HTMLElement {
  const node = document.querySelector<HTMLElement>(".resume-wb-body");
  expect(node).not.toBeNull();
  return node as HTMLElement;
}

/** 1000px 那一档的正文（含紧随其后的 `@supports` 容器查询块），用于逐条断言窄档规则。 */
export function narrowScreenBlock(): string {
  const css = readWorkbenchCss();
  const start = css.indexOf("@media (max-width: 1000px)");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
}
