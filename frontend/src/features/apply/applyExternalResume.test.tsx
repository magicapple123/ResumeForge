// SPDX-License-Identifier: Apache-2.0
/**
 * T30: applying with an **external resume**.
 *
 * Three things are pinned here:
 *
 * 1. one shared label formatter (`applyResumeLabel`) so the queue row, the queue detail
 *    drawer and the records column cannot drift apart: external rows read
 *    `<external tag> · <file name>`, internal rows read the snapshot title, and only when
 *    both are empty does the caller's fallback show;
 * 2. the queue row renders that label instead of the bare snapshot;
 * 3. the editor's resume select is a `ResumeRef` select (one dropdown, two groups): picking
 *    an external item must submit `external_resume_id` **and** `resume_id: null` — sending
 *    only one side would leave the other stored value in place and the backend rejects
 *    "both linked" with 422.
 *
 * The selector hook itself is stubbed (its own two-endpoint merging is covered by
 * `hooks/useResumeRefSelect.test.tsx`); this file only guards the wiring.
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuHost } from "../context-menu/ContextMenuHost";
import { t } from "../../i18n";
import type { ApplyQueueItem } from "../../types";
import { applyResumeLabel } from "./resumeLinkLabel";
import { QueueTable } from "./queue/QueueTable";
import { QueueItemEditor } from "./queue/QueueItemEditor";

const EXTERNAL_NAME = "resume-v3.pdf";
const INTERNAL_TITLE = "Backend resume v2";
const FALLBACK = "-";

const apiMocks = vi.hoisted(() => ({
  updateQueueItem: vi.fn(),
  previewGreeting: vi.fn(),
  getApplyGreetingImage: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  updateQueueItem: apiMocks.updateQueueItem,
  previewGreeting: apiMocks.previewGreeting,
}));

vi.mock("../../api/applyExtras", () => ({
  getApplyGreetingImage: apiMocks.getApplyGreetingImage,
  getGreetingTemplates: vi.fn().mockResolvedValue({ templates: [] }),
  markGreetingTemplateUsed: vi.fn(),
  uploadGreetingImage: vi.fn(),
  deleteGreetingImage: vi.fn(),
}));

// The selector hook: one external option is enough to exercise the wiring.
vi.mock("../../hooks/useResumeRefSelect", () => ({
  useResumeRefSelect: () => ({
    selectProps: {
      showSearch: true,
      filterOption: false,
      onSearch: vi.fn(),
      loading: false,
      options: [
        {
          label: t("trackerForm.resume.group.external"),
          options: [{ value: "external:7", label: "resume-v3.pdf" }],
        },
      ],
      notFoundContent: null,
    },
    groups: [],
    ensure: vi.fn().mockResolvedValue(null),
    reload: vi.fn(),
    refOf: vi.fn(),
    textOfRef: vi.fn(),
  }),
}));

// Unrelated to this task: the recommendation hint has its own endpoint, the greeting
// template picker its own list.
vi.mock("./insights/ResumeFitHint", () => ({ default: () => null }));
vi.mock("./queue/GreetingTemplatePicker", () => ({ GreetingTemplatePicker: () => null }));
vi.mock("./GreetingImagePicker", () => ({ default: () => null }));

function item(overrides: Partial<ApplyQueueItem> = {}): ApplyQueueItem {
  return {
    id: 1,
    job_id: 11,
    job_title: "Backend engineer",
    company: "Acme",
    resume_id: null,
    resume_title: "",
    greeting: "hello from a candidate",
    image_ids: [],
    sort_order: 0,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
    ...overrides,
  };
}

beforeEach(() => {
  apiMocks.updateQueueItem.mockReset().mockResolvedValue({});
  apiMocks.previewGreeting.mockReset();
  apiMocks.getApplyGreetingImage.mockReset().mockResolvedValue({
    enabled: false,
    image_id: null,
    max_count: 4,
    max_image_bytes: 1024,
    max_total_bytes: 4096,
    options: [],
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("applyResumeLabel", () => {
  it("prefixes an external resume with the shared external tag", () => {
    expect(applyResumeLabel({ external_resume_id: 7, resume_title: EXTERNAL_NAME }, FALLBACK)).toBe(
      `${t("applyUi.resume.externalTag")} · ${EXTERNAL_NAME}`,
    );
  });

  it("keeps an internal resume as its snapshot title", () => {
    expect(applyResumeLabel({ resume_title: INTERNAL_TITLE }, FALLBACK)).toBe(INTERNAL_TITLE);
  });

  it("falls back only when neither side has a title", () => {
    expect(applyResumeLabel({}, FALLBACK)).toBe(FALLBACK);
    expect(applyResumeLabel({ external_resume_id: 7, resume_title: "" }, FALLBACK)).toBe(
      `${t("applyUi.resume.externalTag")} · #7`,
    );
  });
});

describe("QueueTable resume cell", () => {
  it("shows the external file name behind the external tag", () => {
    render(
      <AntdApp>
        <ContextMenuHost>
          <QueueTable
            items={[item({ external_resume_id: 7, resume_title: EXTERNAL_NAME })]}
            busy={false}
            selectedIds={[]}
            setSelectedIds={vi.fn()}
            setDetail={vi.fn()}
            rowMenuItems={() => [{ key: "x", label: "x" }]}
            onInspect={vi.fn()}
          />
        </ContextMenuHost>
      </AntdApp>,
    );

    expect(screen.getByText(`${t("applyUi.resume.externalTag")} · ${EXTERNAL_NAME}`)).toBeTruthy();
  });
});

describe("QueueItemEditor resume select", () => {
  /**
   * antd inserts a space between two CJK characters ("保 存"), so the accessible name of the
   * save button is not byte-identical to the label. Compare with whitespace stripped instead
   * of hard-coding either spelling.
   */
  function clickSave() {
    const wanted = t("common.action.save").replace(/\s+/g, "");
    fireEvent.click(
      screen.getByRole("button", {
        name: (accessibleName: string) => accessibleName.replace(/\s+/g, "") === wanted,
      }),
    );
  }

  it("submits external_resume_id and clears resume_id when an external resume is picked", async () => {
    render(
      <AntdApp>
        <QueueItemEditor item={item()} onSaved={vi.fn()} onClose={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByTitle(EXTERNAL_NAME));
    clickSave();

    await waitFor(() =>
      expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(1, {
        greeting: "hello from a candidate",
        resume_id: null,
        external_resume_id: 7,
        image_ids: [],
      }),
    );
  });

  it("keeps the stored external resume when nothing is changed", async () => {
    render(
      <AntdApp>
        <QueueItemEditor
          item={item({ external_resume_id: 7, resume_title: EXTERNAL_NAME })}
          onSaved={vi.fn()}
          onClose={vi.fn()}
        />
      </AntdApp>,
    );

    clickSave();

    await waitFor(() =>
      expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(1, {
        greeting: "hello from a candidate",
        resume_id: null,
        external_resume_id: 7,
        image_ids: [],
      }),
    );
  });
});
