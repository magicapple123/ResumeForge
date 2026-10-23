// SPDX-License-Identifier: Apache-2.0
/**
 * 加粗 overlay：读、写、合并、失效。
 *
 * 这一层只要错一条，"用户点过加粗的那句话"和"保存下去的那句话"就会分家：
 *
 * 1. **过期 overlay 还生效**：用户在中栏把这句话改写过了，纸面上却还是加粗版的旧文案；
 * 2. **合并把字段搞丢**：路径写错时把 `photo` / 整段数组替成空对象；
 * 3. **就地改对象**：宿主按引用判断"内容换没换"，引用不动等于什么都没告诉它。
 *
 * 断言里不出现中文：`cjkRatchet` 的 tests 口径按文件卡中文 `*ByText`，新文件基线为 0。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResumeContent } from "../../types";
import {
  getByPath,
  mergeOverlays,
  readOverlay,
  readStringAt,
  setByPath,
  useRichTextOverrides,
} from "./useRichTextOverrides";

function makeContent(): ResumeContent {
  return {
    photo: "data:image/png;base64,AAAA",
    name: "AL",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "plain summary",
    education: [],
    experience: [
      {
        company: "ACME",
        role: "Dev",
        start_date: "2020",
        end_date: "2022",
        description: ["first line", "second line"],
      },
    ],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  };
}

describe("路径读写", () => {
  it("支持数组下标（experience.0.description.1）", () => {
    const content = makeContent();
    expect(readStringAt(content, "experience.0.description.1")).toBe("second line");
    expect(readStringAt(content, "summary")).toBe("plain summary");
    // 指向对象 / 不存在的路径都不是"字符串叶子"。
    expect(readStringAt(content, "experience.0")).toBeNull();
    expect(readStringAt(content, "experience.9.description.0")).toBeNull();
    expect(getByPath(content, "nope.deep")).toBeUndefined();
  });

  it("写入是不可变的：只换沿路径的那几层，兄弟节点保持同一引用", () => {
    const content = makeContent();
    const next = setByPath(content, "experience.0.description.1", "**second** line");
    expect(readStringAt(next, "experience.0.description.1")).toBe("**second** line");
    expect(next).not.toBe(content);
    // 没被写到的分支还是同一个对象（省一次整份深拷贝，也让"哪一半变了"一目了然）。
    expect(next.education).toBe(content.education);
    expect(next.photo).toBe(content.photo);
    expect(readStringAt(content, "experience.0.description.1")).toBe("second line");
  });
});

describe("合并与失效", () => {
  it("base 对得上才生效；对不上说明用户已经改过这一栏", () => {
    const content = makeContent();
    const overlays = { summary: { raw: "**plain** summary", base: "plain summary" } };
    expect(readStringAt(mergeOverlays(content, overlays), "summary")).toBe("**plain** summary");
    expect(readOverlay(content, overlays, "summary")).toBe("**plain** summary");

    const edited = setByPath(content, "summary", "rewritten by hand");
    expect(readStringAt(mergeOverlays(edited, overlays), "summary")).toBe("rewritten by hand");
    expect(readOverlay(edited, overlays, "summary")).toBe("rewritten by hand");
  });

  it("没有 overlay 时合并结果就是入参本身（同一引用）", () => {
    const content = makeContent();
    expect(mergeOverlays(content, {})).toBe(content);
    expect(mergeOverlays(null, {})).toBeNull();
  });

  it("只碰字符串叶子：photo 与数组结构原样保留", () => {
    const content = makeContent();
    const merged = mergeOverlays(content, {
      "experience.0.description.0": { raw: "**first** line", base: "first line" },
    });
    expect(merged?.photo).toBe(content.photo);
    expect(merged?.experience[0].description).toEqual(["**first** line", "second line"]);
    expect(merged?.experience[0].company).toBe("ACME");
  });
});

describe("useRichTextOverrides", () => {
  it("dirty 跟着 overlay 走：apply 之后为 true，clear 之后回到 false", () => {
    const content = makeContent();
    const { result } = renderHook(() => useRichTextOverrides(content));

    // 干净时没有"还没保存的加粗"：制作台的脏值不能被它凭空点亮。
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.apply("summary", "**plain** summary", "plain summary");
    });
    // 它必须参与脏值：overlay 不在 content 里，编辑器看不见它（否则关窗即丢）。
    expect(result.current.dirty).toBe(true);

    act(() => result.current.clear());
    expect(result.current.dirty).toBe(false);
  });

  it("apply 返回合并后的内容，read 立刻给加粗版", () => {
    const content = makeContent();
    const { result } = renderHook(() => useRichTextOverrides(content));

    let merged: ResumeContent | null = null;
    act(() => {
      merged = result.current.apply("summary", "**plain** summary", "plain summary");
    });
    expect(merged).not.toBeNull();
    expect((merged as unknown as ResumeContent).summary).toBe("**plain** summary");
    expect(result.current.read("summary")).toBe("**plain** summary");
    expect(result.current.merged?.summary).toBe("**plain** summary");
  });

  it("读到一个过期 overlay 时返回内容值（并顺手丢掉它）", () => {
    const content = makeContent();
    const { result, rerender } = renderHook(({ value }) => useRichTextOverrides(value), {
      initialProps: { value: content },
    });
    act(() => {
      result.current.apply("summary", "**plain** summary", "plain summary");
    });

    const edited = setByPath(content, "summary", "changed");
    rerender({ value: edited });
    expect(result.current.read("summary")).toBe("changed");
    // 过期条目已经被丢掉：再合并一次什么都不会发生。
    expect(result.current.merged?.summary).toBe("changed");
  });

  it("clear 之后回到原内容", () => {
    const content = makeContent();
    const { result } = renderHook(() => useRichTextOverrides(content));
    act(() => {
      result.current.apply("summary", "**plain** summary", "plain summary");
    });
    act(() => result.current.clear());
    expect(result.current.merged).toBe(content);
    expect(result.current.read("summary")).toBe("plain summary");
  });

  it("dropStale 只保留 base 还对得上的条目", () => {
    const content = makeContent();
    const { result, rerender } = renderHook(({ value }) => useRichTextOverrides(value), {
      initialProps: { value: content },
    });
    act(() => {
      result.current.apply("summary", "**plain** summary", "plain summary");
    });
    const edited = setByPath(content, "summary", "changed");
    rerender({ value: edited });
    act(() => result.current.dropStale(edited));
    expect(result.current.read("summary")).toBe("changed");
  });
});
