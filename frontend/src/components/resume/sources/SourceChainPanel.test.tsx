// SPDX-License-Identifier: Apache-2.0
/** 来源核对面板：未关联不猜、stale 给采纳入口、四态。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pt } from "../../../features/resume-provenance/i18n";
import type {
  BlockLinkOut,
  DocumentObjectOut,
  SourceChainOut,
  SourceOut,
} from "../../../features/resume-provenance/types";
import SourceChainPanel from "./SourceChainPanel";

afterEach(() => cleanup());

const OBJECT_UNLINKED: DocumentObjectOut = {
  path: "experience.0.description.0",
  field: "description",
  object_id: "exp_1",
  point_id: null,
  label: "Experience",
  link: null,
};

function link(status: BlockLinkOut["status"]): BlockLinkOut {
  return {
    link_id: 9,
    source_id: 2,
    object_id: "exp_1",
    point_id: null,
    path: "experience.0.description.0",
    field: "description",
    source_fingerprint: "aaa",
    status,
  };
}

const SOURCE_STALE: SourceOut = {
  id: 2,
  kind: "claim",
  external_ref: "claim_record:12",
  title: "Led checkout rewrite",
  current_fingerprint: "fff",
  latest_revision_no: 2,
  revisions: [{ revision_no: 2, fingerprint: "fff", summary: "new wording", captured_at: null }],
  blocks: [link("stale")],
};

const CHAIN: SourceChainOut = {
  resume_id: 3,
  object_id: "exp_1",
  point_id: null,
  path: "experience.0.description.0",
  sources: [SOURCE_STALE],
};

describe("SourceChainPanel", () => {
  it("未关联：明确说未关联，不显示任何来源", () => {
    render(
      <AntdApp>
        <SourceChainPanel objects={[OBJECT_UNLINKED]} chain={null} />
      </AntdApp>,
    );
    expect(screen.getByText(pt("provenance.unlinked"))).toBeTruthy();
    expect(screen.getByText(pt("provenance.unlinked.hint"))).toBeTruthy();
  });

  it("有 onLink 时提供关联入口，并把当前块回传", () => {
    const onLink = vi.fn();
    render(
      <AntdApp>
        <SourceChainPanel objects={[OBJECT_UNLINKED]} chain={null} onLink={onLink} />
      </AntdApp>,
    );
    fireEvent.click(screen.getByRole("button", { name: pt("provenance.chain.link") }));
    expect(onLink).toHaveBeenCalledWith(OBJECT_UNLINKED);
  });

  it("stale 来源显示「来源已更新」并可采纳最新", () => {
    const onRelink = vi.fn();
    render(
      <AntdApp>
        <SourceChainPanel
          objects={[{ ...OBJECT_UNLINKED, link: link("stale") }]}
          chain={CHAIN}
          onRelink={onRelink}
        />
      </AntdApp>,
    );
    expect(screen.getAllByText(pt("provenance.stale")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: pt("provenance.chain.relink") })[0]);
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it("错误态优先于内容", () => {
    render(
      <AntdApp>
        <SourceChainPanel objects={[OBJECT_UNLINKED]} chain={null} error="boom" onRetry={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(pt("provenance.unlinked"))).toBeNull();
  });
});
