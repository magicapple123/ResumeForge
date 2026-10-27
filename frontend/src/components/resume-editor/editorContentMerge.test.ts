// SPDX-License-Identifier: Apache-2.0
/** 保存链的合并口径（需求 #12 拆出的纯函数）：照片保留 + 三个空条目清理都在这一句里。 */
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types";
import { makeResumeContent } from "../ResumeEditorModal.testkit";
import { mergeEditorContent } from "./editorContentMerge";

describe("mergeEditorContent（表单值 → 完整正文）", () => {
  it("全空语言条目保存后不出现在 content（语言能力空条目清理接在保存链上）", () => {
    const content = makeResumeContent({
      languages: [{ name: "", level: "", certificate: "", score: "", obtained_at: "" }],
    } as Partial<ResumeContent>);
    const merged = mergeEditorContent(content, {});
    expect(merged).not.toBeNull();
    expect("languages" in (merged as ResumeContent)).toBe(false);
  });

  it("有值的语言条目原样保留", () => {
    const content = makeResumeContent({
      languages: [{ name: "英语", level: "CET-6" }],
    } as Partial<ResumeContent>);
    const merged = mergeEditorContent(content, {}) as ResumeContent;
    expect(merged.languages).toEqual([{ name: "英语", level: "CET-6" }]);
  });

  it("照片不在编辑表单里：永远保留服务端那一份", () => {
    const content = makeResumeContent({ photo: "data:image/png;base64,AAA" });
    const merged = mergeEditorContent(content, { photo: "" }) as ResumeContent;
    expect(merged.photo).toBe("data:image/png;base64,AAA");
  });

  it("表单值覆盖同名字段，其余字段来自服务端内容", () => {
    const content = makeResumeContent({ name: "张三", summary: "旧总结" });
    const merged = mergeEditorContent(content, { summary: "新总结" }) as ResumeContent;
    expect(merged.name).toBe("张三");
    expect(merged.summary).toBe("新总结");
  });

  it("自建板块里全空的条目同样在保存链上被剔除", () => {
    const content = makeResumeContent({
      custom_sections: [
        {
          key: "custom:x",
          title: "自建",
          entries: [
            { entry_id: "e1", text: "", lines: [] },
            { entry_id: "e2", text: "有内容", lines: [] },
          ],
        },
      ],
    });
    const merged = mergeEditorContent(content, {}) as ResumeContent;
    expect(merged.custom_sections?.[0].entries).toHaveLength(1);
    expect(merged.custom_sections?.[0].entries[0].entry_id).toBe("e2");
  });

  it("还没有服务端内容时返回 null（调用方决定怎么处理）", () => {
    expect(mergeEditorContent(null, { name: "x" })).toBeNull();
  });
});
