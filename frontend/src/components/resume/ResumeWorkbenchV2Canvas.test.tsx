// SPDX-License-Identifier: Apache-2.0
/**
 * Q05: the workbench canvas must follow the UNSAVED document.
 *
 * The bug: `ResumeWorkbenchV2` handed the canvas the host's saved document
 * (`safeDocument`), so paper and exact preview kept showing the saved version until
 * the user pressed Save. Here we pin the two halves of the fix:
 *
 * 1. the live re-render request receives the edited (unsaved) document;
 * 2. the exact-preview context carries the same document, merged through a 600ms
 *    window so a typist does not trigger one server PDF per keystroke.
 *
 * Assertions avoid CJK copy: this is a new file, so the i18n ratchet baseline for it
 * is zero (fixtures come from the shared harness and are not counted here).
 */
import { act, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDocument, ResumeLayout } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import { makeResumeDocument } from "../../test/documentHarness";
import ResumeWorkbenchV2Canvas from "./ResumeWorkbenchV2Canvas";

interface CanvasStubProps {
  exactPreview?: { content?: ResumeDocument; contentSignature?: string };
}

const mocks = vi.hoisted(() => ({
  renderResume: vi.fn(),
  canvasProps: [] as unknown[],
}));

vi.mock("../../api/resumeLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumeLayout")>()),
  renderResume: mocks.renderResume,
}));

vi.mock("./ResumeWorkbenchCanvas", () => ({
  default: (props: CanvasStubProps) => {
    mocks.canvasProps.push(props);
    return <div data-testid="canvas-stub" />;
  },
}));

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

/** Identify one version of the document by the text of its summary paragraph. */
function makeContent(summary: string): ResumeDocument {
  const document = makeResumeDocument();
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.key === "summary"
        ? {
            ...section,
            entries: section.entries.map((entry) => ({
              ...entry,
              items: [
                {
                  kind: "text" as const,
                  id: "q05_summary",
                  style: "paragraph" as const,
                  text: summary,
                  hidden: false,
                },
              ],
            })),
          }
        : section,
    ),
  };
}

function summaryOf(document: ResumeDocument | undefined): string {
  const item = document?.sections.find((section) => section.key === "summary")?.entries[0]
    ?.items[0];
  return item?.kind === "text" ? item.text : "";
}

const SAVED = makeContent("saved");
const EDITED = makeContent("edited");

const EXACT_CONTEXT = {
  resumeId: 7,
  template: "classic",
  formatName: "standard",
  fontScale: "standard",
  language: "zh-CN",
  formatConfig: {},
  contentSignature: "saved",
};

function lastCanvasProps(): CanvasStubProps {
  return (mocks.canvasProps[mocks.canvasProps.length - 1] ?? {}) as CanvasStubProps;
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

function mount(document: ResumeDocument | null, exactPreview: Record<string, unknown>) {
  const previewRef = createRef<ResumePreviewHandle>();
  const tree = (doc: ResumeDocument | null) => (
    <ResumeWorkbenchV2Canvas
      html="<html><body>preview</body></html>"
      warnings={[]}
      pages={1}
      previewRef={previewRef}
      exactPreview={exactPreview as never}
      document={doc}
      layout={LAYOUT}
    />
  );
  const view = render(tree(document));
  return { view, rerender: (doc: ResumeDocument | null) => view.rerender(tree(doc)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.renderResume.mockReset().mockResolvedValue("<html><body>rendered</body></html>");
  mocks.canvasProps.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("workbench canvas follows the unsaved document", () => {
  it("re-renders with the edited document after the debounce window", async () => {
    const { rerender } = mount(SAVED, EXACT_CONTEXT);
    // First frame is only a baseline: the host has just rendered this very document.
    await advance(700);
    expect(mocks.renderResume).not.toHaveBeenCalled();

    rerender(EDITED);
    await advance(700);

    expect(mocks.renderResume).toHaveBeenCalledTimes(1);
    const [content] = mocks.renderResume.mock.calls[0] as [ResumeDocument];
    expect(summaryOf(content)).toBe("edited");
  });

  it("passes the same unsaved document to the exact preview, merged by 600ms", async () => {
    const { rerender } = mount(SAVED, EXACT_CONTEXT);
    await advance(700);
    expect(summaryOf(lastCanvasProps().exactPreview?.content)).toBe("saved");

    rerender(EDITED);
    await advance(100);
    // Still inside the merge window: exact preview must not run a server PDF per key.
    expect(summaryOf(lastCanvasProps().exactPreview?.content)).toBe("saved");

    await advance(700);
    expect(summaryOf(lastCanvasProps().exactPreview?.content)).toBe("edited");
    expect(lastCanvasProps().exactPreview?.contentSignature).not.toBe("saved");
  });

  it("starts no live render for a read-only host (no document)", async () => {
    mount(null, EXACT_CONTEXT);
    await advance(1500);
    expect(mocks.renderResume).not.toHaveBeenCalled();
    expect(lastCanvasProps().exactPreview?.content).toBeUndefined();
  });
});
