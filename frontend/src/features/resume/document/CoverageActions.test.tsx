// SPDX-License-Identifier: Apache-2.0
/**
 * Coverage notes block: the three action branches of 3-A (append / AI revise / go to the
 * workbench) and the append request itself.
 *
 * 2026-11 行数预算拆分批：本文件从 `ResumeCoverageNotes.test.tsx`（prettier 重排后 527 行，
 * 越过测试文件 500 行预算）按自身职责拆出——「按钮出现哪一支」与「点下去发了什么请求」。
 * 折叠/展开、一条一行、原因汇总与分组聚合仍留在 `ResumeCoverageNotes.test.tsx`。
 * 夹具在 `coverageTestFixtures.ts`，两个文件共用一份。**纯搬迁**：用例数量、用例标题与
 * 每条断言均逐字不变。
 *
 * The append branch is asserted at the protocol level (stubbed `fetch`): the body must carry
 * `{section_key, entry_ids, base_revision}` and **no** `signal` field, because the backend
 * request model is `extra="forbid"` (a serialised AbortSignal -> 422).
 *
 * This file deliberately contains no CJK literals (the i18n ratchet forbids new ones):
 * expected copy is resolved through the same `t()` the component uses.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import {
  APPEND,
  GO_WORKBENCH,
  REVISE,
  expandBlock,
  note,
  renderNotes,
  resetCoverageTestEnv,
  stubAppendFetch,
} from "./coverageTestFixtures";

afterEach(resetCoverageTestEnv);

describe("action buttons (3-A decision table)", () => {
  it("offers the AI revise button for sections that already have writable fields", () => {
    const { onRevise } = renderNotes([
      note({ section: "skills", section_label: "SKILLS", names: ["Excel", "SQL"], total: 2 }),
    ]);
    expandBlock();

    fireEvent.click(screen.getByRole("button", { name: REVISE }));

    const instructions = onRevise.mock.calls[0][0] as string;
    // The instruction is a model prompt (Chinese by design); assert on the data it carries.
    // It uses the backend-provided `section_label` verbatim, not the localized one.
    expect(instructions).toContain("Excel");
    expect(instructions).toContain("SQL");
    expect(instructions).toContain("SKILLS");
    expect(screen.queryByRole("button", { name: APPEND })).toBeNull();
  });

  it("offers 'go to the workbench' for entry-level sections", () => {
    const { onOpenEditor } = renderNotes([note({ names: ["Alpha"], total: 1 })]);
    expandBlock();

    fireEvent.click(screen.getByRole("button", { name: GO_WORKBENCH }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: APPEND })).toBeNull();
    expect(screen.queryByRole("button", { name: REVISE })).toBeNull();
  });

  it("explains why AI cannot add an entry, on hover", async () => {
    renderNotes([note({ names: ["Alpha"], total: 1 })]);
    expandBlock();

    fireEvent.mouseEnter(screen.getByRole("button", { name: GO_WORKBENCH }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      t("resume.coverage.goWorkbenchHint"),
    );
  });

  it("offers 'add to resume' for a custom section whose entries can be located", () => {
    renderNotes(
      [
        note({
          section: "custom:abc",
          section_label: "MY SECTION",
          names: ["Alpha"],
          total: 1,
          entry_ids: ["e1"],
        }),
      ],
      { resumeId: 7, baseRevision: 3 },
    );
    expandBlock();

    expect(screen.getByRole("button", { name: APPEND })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REVISE })).toBeNull();
  });

  it("falls back to the workbench for a legacy custom section without entry_ids", () => {
    renderNotes(
      [note({ section: "custom:abc", section_label: "MY SECTION", names: ["Alpha"], total: 1 })],
      {
        resumeId: 7,
        baseRevision: 3,
      },
    );
    expandBlock();

    expect(screen.getByRole("button", { name: GO_WORKBENCH })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPEND })).toBeNull();
  });

  it("falls back to the workbench when the host cannot save", () => {
    renderNotes([
      note({
        section: "custom:abc",
        section_label: "MY SECTION",
        names: ["Alpha"],
        total: 1,
        entry_ids: ["e1"],
      }),
    ]);
    expandBlock();

    expect(screen.getByRole("button", { name: GO_WORKBENCH })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: APPEND })).toBeNull();
  });
});

describe("append request (3-A)", () => {
  it("posts section_key/entry_ids/base_revision and never puts signal in the body", async () => {
    const { calls } = stubAppendFetch(["Alpha"], ["Beta"]);
    const { onAppended } = renderNotes(
      [
        note({
          section: "custom:abc",
          section_label: "MY SECTION",
          names: ["Alpha", "Beta"],
          total: 2,
          entry_ids: ["e1", "e2"],
        }),
      ],
      { resumeId: 7, baseRevision: 3 },
    );
    expandBlock();

    fireEvent.click(screen.getByRole("button", { name: APPEND }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/resumes/7/append-profile-entries");
    expect(calls[0].init?.method).toBe("POST");

    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ section_key: "custom:abc", entry_ids: ["e1", "e2"], base_revision: 3 });
    // The 422 trap: a JSON-serialised AbortSignal would show up as `signal: {}` here.
    expect(Object.keys(body)).not.toContain("signal");
    // …it belongs to the fetch options only.
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);

    expect(
      await screen.findByText(t("resume.coverage.appended", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("resume.coverage.skipped", { count: 1 }))).toBeInTheDocument();
    // The refreshed resume goes back to the host, which re-reads `coverage_notes`.
    await waitFor(() =>
      expect(onAppended).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })),
    );
  });

  it("keeps the rows and shows the backend message when the append fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "entry deleted", code: "entry_missing" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const { onAppended } = renderNotes(
      [
        note({
          section: "custom:abc",
          section_label: "MY SECTION",
          names: ["Alpha"],
          total: 1,
          entry_ids: ["e1"],
        }),
      ],
      { resumeId: 7, baseRevision: 3 },
    );
    expandBlock();

    fireEvent.click(screen.getByRole("button", { name: APPEND }));

    expect(await screen.findByText("entry deleted")).toBeInTheDocument();
    expect(onAppended).not.toHaveBeenCalled();
  });
});
