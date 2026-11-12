// SPDX-License-Identifier: Apache-2.0
/**
 * W07 多选批量调整的**宿主集成契约**（跨域挂载规格的可执行版本）：
 * 外壳按这里的方式持有 layout 状态并把它交给 MultiStyleBar；每次动作只产生**一次**
 * onCommit（= 宿主历史栈的一步）。
 *
 * R-19：格式刷已删除，本文件只保留「多选批量调整」的宿主口径。「固定这条的当前样式」
 * 走 `features/resume/layout/styleFreeze`，它的宿主接线不再是这里的职责。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import MultiStyleBar from "./MultiStyleBar";

const SOURCE = "exp_source01";
const TARGETS = [{ id: "exp_target01", label: "乙公司", meta: "2021" }];

function baseLayout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    format_config: {
      objects: {
        version: 1,
        [SOURCE]: { space_after: 0.4 },
        exp_target01: { line_height: 1.5 },
      },
    } as unknown as ResumeLayout["format_config"],
  };
}

interface HarnessProps {
  onCommitSpy?: (next: ResumeLayout) => void;
}

/** 模拟 WorkbenchParamsColumn 的宿主：layout 状态 + 多选。 */
function HostHarness({ onCommitSpy }: HarnessProps) {
  const [layout, setLayout] = useState<ResumeLayout>(baseLayout);
  const [commits, setCommits] = useState(0);
  const commit = (next: ResumeLayout) => {
    setCommits((count) => count + 1);
    onCommitSpy?.(next);
    setLayout(next);
  };
  return (
    <div>
      <output data-testid="commits">{commits}</output>
      <output data-testid="layout">{JSON.stringify(layout.format_config)}</output>
      <MultiStyleBar
        layout={layout}
        selected={TARGETS}
        onChange={commit}
        onClearSelection={() => undefined}
      />
    </div>
  );
}

function objectsOf(): Record<string, Record<string, unknown>> {
  const raw = screen.getByTestId("layout").textContent ?? "{}";
  const config = JSON.parse(raw) as { objects?: Record<string, Record<string, unknown>> };
  return config.objects ?? {};
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("多选宿主集成", () => {
  it("多选批量调整只产生一次宿主提交", () => {
    const onCommit = vi.fn();
    render(<HostHarness onCommitSpy={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: t("typography.prop.line_height") });
    fireEvent.change(input, { target: { value: "1.6" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: t("typography.multi.apply") }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(objectsOf().exp_target01).toMatchObject({ line_height: 1.6 });
    expect(screen.getByTestId("commits").textContent).toBe("1");
  });
});
