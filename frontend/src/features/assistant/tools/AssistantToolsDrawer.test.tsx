// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAssistantTools } from "../../../api/assistant";
import { t } from "../../../i18n";
import AssistantToolsCard from "./AssistantToolsCard";
import AssistantToolsDrawer from "./AssistantToolsDrawer";
import AssistantToolsEntryRow from "./AssistantToolsEntryRow";

vi.mock("../../../api/assistant", () => ({ listAssistantTools: vi.fn() }));
const inventory = {
  count: 3,
  items: [
    {
      name: "shared_read",
      category: "core",
      description: "Shared read description",
      writes: false,
      parameters: { probe_parameter: "read" },
    },
    {
      name: "shared_write",
      category: "document",
      description: "Shared write description",
      writes: true,
      parameters: { probe_parameter: "write" },
    },
    {
      name: "future_tool",
      category: "future_domain",
      description: "Future description",
      writes: true,
      parameters: {},
    },
  ],
};
beforeEach(() => vi.mocked(listAssistantTools).mockResolvedValue(inventory));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("assistant tool inventory", () => {
  it("renders server groups including an unknown future group and expands parameters", async () => {
    render(
      <AntdApp>
        <AssistantToolsDrawer open onClose={vi.fn()} />
      </AntdApp>,
    );
    await screen.findByText("shared_read");
    expect(document.querySelectorAll("[data-tool-name]")).toHaveLength(3);
    expect(document.querySelector('[data-tool-category="future_domain"]')?.textContent).toContain(
      "future_tool",
    );
    fireEvent.click(screen.getAllByText(t("assistantTools.parameters"))[0]);
    expect(await screen.findByText(/"probe_parameter": "read"/)).toBeInTheDocument();
    expect(screen.getAllByText(t("assistantTools.writable"))).toHaveLength(2);
  });

  it("combines name or description search with the writable filter using AND", async () => {
    render(
      <AntdApp>
        <AssistantToolsDrawer open onClose={vi.fn()} />
      </AntdApp>,
    );
    await screen.findByText("shared_read");
    fireEvent.change(screen.getByRole("textbox", { name: t("assistantTools.search") }), {
      target: { value: "SHARED" },
    });
    expect(document.querySelectorAll("[data-tool-name]")).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox", { name: t("assistantTools.writableOnly") }));
    expect(document.querySelectorAll("[data-tool-name]")).toHaveLength(1);
    expect(screen.getByText("shared_write")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "no match" } });
    expect(screen.getByText(t("assistantTools.noMatch"))).toBeInTheDocument();
  });

  it("uses the server count in settings and opens the same inventory drawer", async () => {
    render(
      <AntdApp>
        <AssistantToolsCard />
      </AntdApp>,
    );
    expect(await screen.findByTestId("assistant-tools-summary")).toHaveTextContent(
      t("assistantTools.summary", { count: 3 }),
    );
    fireEvent.click(screen.getByRole("button", { name: t("assistantTools.viewAll") }));
    await screen.findByText("shared_read");
    expect(document.querySelectorAll(".assistant-tools-drawer")).toHaveLength(1);
  });

  it("shows an actionable load error and retries the endpoint", async () => {
    vi.mocked(listAssistantTools).mockRejectedValueOnce(new Error("network fixture"));
    render(
      <AntdApp>
        <AssistantToolsDrawer open onClose={vi.fn()} />
      </AntdApp>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("network fixture");
    fireEvent.click(screen.getByRole("button", { name: t("assistantTools.retry") }));
    await screen.findByText("shared_read");
    await waitFor(() => expect(listAssistantTools).toHaveBeenCalledTimes(2));
  });

  it("keeps the composer entry keyboard accessible", () => {
    const open = vi.fn();
    render(
      <AntdApp>
        <AssistantToolsEntryRow onOpen={open} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: t("assistantTools.entry") }));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
