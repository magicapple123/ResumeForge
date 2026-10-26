// SPDX-License-Identifier: Apache-2.0
/**
 * F10：保存前清理自建板块的空条目（方案里的空板块骨架点「添加条目」后不填就保存的路径）。
 *
 * 后端 ResumeCustomEntry.text_or_lines_required 会拒绝"既无正文也无标签行"的条目；
 * 前端必须在提交前剔除，否则保存必然 422。
 */
import { describe, expect, it } from "vitest";
import type { ResumeCustomSection } from "../types";
import { makeResumeContent } from "../components/ResumeEditorModal.testkit";
import { stripEmptyCustomSections } from "./stripEmptyCustomSections";

function section(entries: ResumeCustomSection["entries"]): ResumeCustomSection {
  return { key: "custom:22333", title: "22333", entries };
}

describe("stripEmptyCustomSections", () => {
  it("剔除空条目与只剩空条目的板块，有内容的条目原样保留", () => {
    const content = makeResumeContent({
      custom_sections: [
        section([
          { entry_id: "", text: "", lines: [] },
          { entry_id: "e1", text: "kept", lines: [] },
        ]),
        section([{ entry_id: "", text: "  ", lines: [] }]),
      ],
    });
    expect(stripEmptyCustomSections(content).custom_sections).toEqual([
      section([{ entry_id: "e1", text: "kept", lines: [] }]),
    ]);
  });

  it("没有可清理内容时返回同一引用（不制造无谓的重渲染）", () => {
    const content = makeResumeContent({
      custom_sections: [section([{ entry_id: "e1", text: "kept", lines: [] }])],
    });
    expect(stripEmptyCustomSections(content)).toBe(content);
  });

  it("最后一条被清空时删掉 custom_sections 键（空列表不序列化）", () => {
    const content = makeResumeContent({
      custom_sections: [section([{ entry_id: "", text: "", lines: [] }])],
    });
    expect("custom_sections" in stripEmptyCustomSections(content)).toBe(false);
  });

  it("标签为空的行剔除；只剩空标签行的条目一并剔除", () => {
    const content = makeResumeContent({
      custom_sections: [
        section([
          { entry_id: "e1", text: "kept", lines: [{ label: "", value: "x" }] },
          { entry_id: "e2", text: "", lines: [{ label: "  ", value: "" }] },
        ]),
      ],
    });
    expect(stripEmptyCustomSections(content).custom_sections).toEqual([
      section([{ entry_id: "e1", text: "kept", lines: [] }]),
    ]);
  });
});
