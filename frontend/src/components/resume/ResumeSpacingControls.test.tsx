// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · 层次与间距组：四个键的**写入语义**。
 *
 * 守三件事（其余外观由 CSS 与主版式控件的既有用例覆盖）：
 * 1. 系数键只写自己那个 `format_config` 键，其余覆盖原样带过去；
 * 2. 拖动时只注入探针、不提交；静置后提交**一次**；
 * 3. 恢复默认 = **删键**（不是写回 1 或模板默认值）——否则以后模板基准调整时，
 *    这些简历不会跟着变。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径把"ByText 参数里的中文"算作存量，
 * 新增用例不该再往里加。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT, makePreviewRef } from "../ResumeLayoutControls.testkit";
import ResumeSpacingControls from "./ResumeSpacingControls";

const BASE: ResumeLayout = {
  ...DEFAULT_LAYOUT,
  format_config: { accent: "#123456" },
};

function renderGroup(
  props: Partial<ComponentProps<typeof ResumeSpacingControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ResumeSpacingControls
        layout={BASE}
        catalog={TEMPLATE_CATALOG}
        onChange={onChange}
        {...props}
      />
    </AntdApp>,
  );
  return onChange;
}

function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeSpacingControls · 系数", () => {
  it("条目间距：拖动只注探针，静置后只写 entry_gap", async () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderGroup({ previewRef: ref });
    const label = t("workbench.param.entry-gap");

    fireEvent.click(
      await screen.findByRole("button", { name: t("workbench.param.increaseAria", { label }) }),
    );

    // 拖动中：探针立刻生效，一次请求都不发。
    expect(setLiveProbe).toHaveBeenCalledWith(":root { --entry-gap: 1.05; }");
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config?.entry_gap).toBe(1.05);
    // 强调色是另一项覆盖，不被这次提交吃掉。
    expect(next.format_config?.accent).toBe("#123456");
  });

  it("双击标题恢复默认：删键，不是写回 1", async () => {
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { accent: "#123456", name_scale: 1.1 } },
    });

    fireEvent.doubleClick(await screen.findByText(t("workbench.param.name-scale")));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config).not.toHaveProperty("name_scale");
    expect(next.format_config).toEqual({ accent: "#123456" });
  });

  it("区块间距：默认取当前模板的基准，+ 一次写 0.1", async () => {
    const onChange = renderGroup();
    const label = t("workbench.param.section-gap");

    // classic 的基准 1.3 由目录下发，不是写死的数字。
    expect(await screen.findByText(`${Number(1.3).toFixed(1)}×`)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("workbench.param.increaseAria", { label }) }),
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange).format_config?.section_gap).toBe(1.4);
  });
});
