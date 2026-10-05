/**
 * 智能逐项填表卡的结束态渲染测试。
 *
 * 重点盯住「浏览器被关掉后自动结束」的呈现：这是正常流程而不是故障，
 * 界面必须给一条中性说明（沿用结束态的展示路径，不弹错误样式），
 * 普通的未开启状态则保持原样。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebFormLive } from "../../types";
import { LiveModeCard } from "./LiveModeCard";

function liveState(overrides: Partial<WebFormLive> = {}): WebFormLive {
  return {
    running: false,
    enabled: true,
    field_label: "",
    value: "",
    status: "",
    note: "",
    source: "",
    alternatives: [],
    filled: 0,
    remember_pending: null,
    ...overrides,
  };
}

function renderCard(live: WebFormLive | null) {
  return render(
    <LiveModeCard
      live={live}
      liveEnabled={false}
      running={false}
      busy={null}
      rememberPending={null}
      alternatives={[]}
      onToggle={vi.fn()}
      onRequestMemoryDialog={vi.fn()}
    />,
  );
}

// 项目未开启 vitest globals，自动清理不会生效，必须显式注册。
afterEach(cleanup);

describe("LiveModeCard", () => {
  it("浏览器被关掉后自动结束时，给一条中性说明而不是报错", () => {
    renderCard(liveState({ stop_reason: "browser_closed" }));

    expect(screen.getByText(/浏览器已关闭，本次填写已自动结束/)).toBeInTheDocument();
    // 中性提示不使用错误样式（type="error" / warning 都不该出现）。
    expect(screen.queryByText(/失败|错误|异常/)).not.toBeInTheDocument();
  });

  it("普通的未开启状态保持原样，不显示自动结束说明", () => {
    renderCard(liveState());

    expect(screen.getByText("未开启")).toBeInTheDocument();
    expect(screen.queryByText(/浏览器已关闭/)).not.toBeInTheDocument();
  });

  it("会话运行中时照常显示状态标签，不受结束态影响", () => {
    render(
      <LiveModeCard
        live={liveState({
          running: true,
          enabled: true,
          status: "matched",
          field_label: "姓名",
          value: "张三",
        })}
        liveEnabled
        running
        busy={null}
        rememberPending={null}
        alternatives={[]}
        onToggle={vi.fn()}
        onRequestMemoryDialog={vi.fn()}
      />,
    );

    expect(screen.getByText("已给出建议")).toBeInTheDocument();
    expect(screen.queryByText(/浏览器已关闭/)).not.toBeInTheDocument();
  });
});
