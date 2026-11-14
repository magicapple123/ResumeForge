// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { ImportFromUrlPreviewTable, type EditableRow } from "./ImportFromUrlPreviewTable";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const row: EditableRow = {
  key: 1,
  data: { title: "Agent PM", source_url: "https://example.com/position/1" },
  detail_url: "https://example.com/position/1",
  summary: "Agent PM",
  evidence: {},
  field_states: {
    title: "filled",
    company: "not_on_page",
    location: "not_fetched",
    salary: "fetch_failed",
  },
  detail_error: "timeout",
  posted_at_raw: "",
  posted_at_inferred: false,
  job_type_inferred: false,
  jd_split: false,
  existing_job_id: null,
};

it("uses the column width sum including selection and fixes the 190px title at the left", () => {
  // jsdom has no layout; let antd's measuring cells read their actual colgroup widths.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!(this instanceof HTMLTableCellElement)) return 0;
    const columns = this.closest("table")?.querySelectorAll<HTMLTableColElement>("col");
    return Number.parseFloat(columns?.[this.cellIndex]?.style.width || "0");
  });
  const { container } = render(
    <ImportFromUrlPreviewTable
      rows={[row]}
      selectedKeys={[1]}
      onSelectedChange={vi.fn()}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
  const table = container.querySelector<HTMLTableElement>(".ant-table-body table");
  expect(table?.style.width).toBe("1452px");
  const columns = table?.querySelectorAll<HTMLTableColElement>("col");
  expect(columns?.[0].style.width).toBe("32px");
  expect(columns?.[1].style.width).toBe("190px");
  expect(screen.getByDisplayValue("Agent PM").closest("td")).toHaveStyle({
    position: "sticky",
    insetInlineStart: "32px",
  });
});

it("shows compact empty states until clicked and preserves edit/select/remove actions", () => {
  const edit = vi.fn(),
    select = vi.fn(),
    remove = vi.fn();
  render(
    <ImportFromUrlPreviewTable
      rows={[row]}
      selectedKeys={[1]}
      onSelectedChange={select}
      onEdit={edit}
      onRemove={remove}
    />,
  );
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  const emptyButtons = screen.getAllByRole("button", { name: t("jobsImport.action.editField") });
  fireEvent.click(emptyButtons[0]);
  const fields = screen.getAllByRole("textbox");
  expect(fields).toHaveLength(2);
  fireEvent.change(fields[1], { target: { value: "Example Inc" } });
  expect(edit).toHaveBeenCalledWith(1, "company", "Example Inc");
  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  expect(select).toHaveBeenCalledWith([]);
  fireEvent.click(screen.getByRole("button", { name: t("jobsImport.action.remove") }));
  expect(remove).toHaveBeenCalledWith(1);
});
