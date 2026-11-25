// SPDX-License-Identifier: Apache-2.0
/**
 * 来源卡片网格的独立用例（CR-04 / CR-09）。
 *
 * 从 `SearchCard.test.tsx` 拆出来：那边已经是 450+ 行，且这两项测的是**卡片网格**的
 * 局部行为（测试按钮、自定义表单），与整卡取数/自动保存无关。渲染 `SearchSourceTiles`
 * 本身也比通过整卡间接驱动更稳定。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchSourceTiles from "./SearchSourceTiles";
import type { SearchConfig } from "../../types";
import { t } from "../../i18n";

const apiMocks = vi.hoisted(() => ({
  testSearchKey: vi.fn(),
}));

vi.mock("../../api/settings", () => apiMocks);

const BASE: SearchConfig = {
  sources: ["bing", "duckduckgo"],
  searxng_url: "",
  depth: "standard",
  max_results: 8,
  deepseek_api_key: "",
  tavily_api_key: "",
  jina_api_key: "",
  custom_template: "moonshot",
  custom_name: "",
  custom_base_url: "",
  custom_search_path: "",
  custom_fetch_path: "",
  custom_results_field: "",
  custom_include_content: true,
  custom_api_key: "",
};

function renderTiles(config: Partial<SearchConfig> = {}) {
  const onChange = vi.fn();
  render(
    <AntdApp>
      <SearchSourceTiles config={{ ...BASE, ...config }} onChange={onChange} />
    </AntdApp>,
  );
  return onChange;
}

/** 受控组件要配一份本地状态才能看到"切模板后表单长出来"这类变化。 */
function StatefulTiles({ initial }: { initial: Partial<SearchConfig> }) {
  const [config, setConfig] = useState<SearchConfig>({ ...BASE, ...initial });
  return (
    <SearchSourceTiles
      config={config}
      onChange={(changes) => setConfig((c) => ({ ...c, ...changes }))}
    />
  );
}

beforeEach(() => {
  apiMocks.testSearchKey.mockResolvedValue({ ok: true, reason: "", latency_ms: 12, message: "" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SearchSourceTiles", () => {
  it("tests the typed DeepSeek key and shows the latency (CR-04)", async () => {
    renderTiles({ sources: ["bing", "deepseek"], deepseek_api_key: "sk-live-abcdef" });

    fireEvent.click(screen.getByRole("button", { name: t("searchCard.deepseek.test") }));

    await waitFor(() => expect(apiMocks.testSearchKey).toHaveBeenCalledWith("sk-live-abcdef"));
    expect(await screen.findByText(/12 ms/)).toBeInTheDocument();
    expect(apiMocks.testSearchKey).toHaveBeenCalledTimes(1);
  });

  it("tests the saved key when the field shows a mask, and shows the failure text (CR-04)", async () => {
    apiMocks.testSearchKey.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
      latency_ms: 8,
      message: "invalid key or no permission",
    });

    renderTiles({ sources: ["bing", "deepseek"], deepseek_api_key: "********" });
    fireEvent.click(screen.getByRole("button", { name: t("searchCard.deepseek.test") }));

    // 掩码不能被当成 Key 发出去：测的是"已保存的那把"。
    await waitFor(() => expect(apiMocks.testSearchKey).toHaveBeenCalledWith(""));
    expect(await screen.findByText(/invalid key or no permission/)).toBeInTheDocument();
  });

  it("offers a custom source whose form follows the template (CR-09)", async () => {
    const onChange = renderTiles();

    expect(screen.queryByLabelText(t("searchCard.custom.baseUrlAria"))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: t("searchCard.source.custom") }));
    expect(onChange).toHaveBeenCalledWith({ sources: ["bing", "duckduckgo", "custom"] });

    cleanup();
    // 已勾选状态：moonshot 模板不显示端点字段，切到通用模板才出现。
    render(
      <AntdApp>
        <StatefulTiles initial={{ sources: ["bing", "custom"] }} />
      </AntdApp>,
    );
    expect(screen.getByLabelText(t("searchCard.custom.baseUrlAria"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("searchCard.custom.searchPathAria"))).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(t("searchCard.custom.templateGeneric")));
    expect(screen.getByLabelText(t("searchCard.custom.searchPathAria"))).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(t("searchCard.custom.baseUrlAria")), {
      target: { value: "https://search.example.com" },
    });
    expect(screen.getByLabelText(t("searchCard.custom.baseUrlAria"))).toHaveValue(
      "https://search.example.com",
    );
  });
});
