// SPDX-License-Identifier: Apache-2.0
/**
 * W07 格式刷 / 多选批量调整的**宿主集成契约**（跨域挂载规格的可执行版本）：
 * 外壳按这里的方式持有 layout 状态并把它交给两个组件；每次动作只产生**一次** onCommit
 * （= 宿主历史栈的一步），规则层分别走 painterPatch/applyPainterPatch。Q14 起「固定当前
 * 样式」在条目排版面板底部（按作用范围执行），不再属于格式刷。
 *
 * 这个文件同时是给 fe-shell 的挂载样板：WorkbenchParamsColumn 只需把本文件里的
 * HostHarness 逻辑搬进 shell（多选来源 = 大纲 multiSelectedEntries）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import {
  readStyleDomains,
  type ResumeRoleStyle,
} from "../../../features/resume-layout/styleOverrides";
import { applyPainterPatch, painterPatch } from "../../../features/resume-layout/stylePainter";
import FormatPainterButton from "./FormatPainterButton";
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

/** 模拟 WorkbenchParamsColumn 的宿主：layout 状态 + 多选 + 格式刷状态机。 */
function HostHarness({ onCommitSpy }: HarnessProps) {
  const [layout, setLayout] = useState<ResumeLayout>(baseLayout);
  const [armed, setArmed] = useState<ResumeRoleStyle | null>(null);
  const [commits, setCommits] = useState(0);
  const domains = readStyleDomains(layout.format_config);
  const patch = painterPatch(domains, SOURCE);
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
      <FormatPainterButton
        sourceName="甲公司"
        hasSource
        hasDiff={patch !== null}
        armed={armed !== null}
        targetCount={TARGETS.length}
        onArm={() => setArmed(patch)}
        onCancel={() => setArmed(null)}
        onApply={() => {
          commit({
            ...layout,
            format_config: applyPainterPatch(layout.format_config, [TARGETS[0].id], armed),
          });
          setArmed(null);
        }}
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

describe("格式刷 / 多选宿主集成", () => {
  it("复制源差异 → 应用到目标：一次提交，目标自己的覆盖保留", () => {
    const onCommit = vi.fn();
    render(<HostHarness onCommitSpy={onCommit} />);
    const copyLabel = t("typography.painter.copy", { name: "甲公司" });
    fireEvent.click(screen.getByRole("button", { name: copyLabel }));
    expect(screen.getByText(t("typography.painter.armed"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("typography.painter.apply", { count: 1 }) }),
    );
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("commits").textContent).toBe("1");
    expect(objectsOf().exp_target01).toEqual({ line_height: 1.5, space_after: 0.4 });
    // 源对象不被写坏。
    expect(objectsOf()[SOURCE]).toEqual({ space_after: 0.4 });
  });

  it("多选批量调整与格式刷共用同一份宿主 layout：每次动作各一次提交", () => {
    const onCommit = vi.fn();
    render(<HostHarness onCommitSpy={onCommit} />);
    const input = screen.getByRole("spinbutton", { name: t("typography.prop.line_height") });
    fireEvent.change(input, { target: { value: "1.6" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: t("typography.multi.apply") }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(objectsOf().exp_target01).toMatchObject({ line_height: 1.6 });
    // 再复制一条源对象的差异应用到同一目标：第二次提交只补格式刷的键。
    fireEvent.click(
      screen.getByRole("button", { name: t("typography.painter.copy", { name: "甲公司" }) }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: t("typography.painter.apply", { count: 1 }) }),
    );
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(objectsOf().exp_target01).toEqual({ line_height: 1.6, space_after: 0.4 });
  });
});
