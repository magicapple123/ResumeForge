// SPDX-License-Identifier: Apache-2.0
/**
 * #14D 招呼语模板渲染的单测：前端预览必须与后端 `render_greeting_template` 同语义。
 *
 * 判据里有两条是硬要求：
 * 1. 缺键**回落空串、不抛**（`format_map` 裸用会 KeyError，等于预览直接白屏）；
 * 2. 不认识的 `{花括号}` 原样保留——用户的正文里完全可能出现 `{Python}`。
 */
import { describe, expect, it } from "vitest";
import type { ApplyQueueItem } from "../../../types";
import {
  GREETING_TEMPLATE_VARIABLES,
  greetingValuesOf,
  renderGreetingTemplate,
} from "./greetingTemplate";

describe("renderGreetingTemplate：三个已知变量", () => {
  it("三个变量都能替换成实际值", () => {
    const text = renderGreetingTemplate("您好，我是{name}，看到{company}的{job_title}岗位。", {
      company: "A公司",
      job_title: "后端开发",
      name: "张三",
    });

    expect(text).toBe("您好，我是张三，看到A公司的后端开发岗位。");
  });

  it("同一个变量出现多次都会替换", () => {
    expect(renderGreetingTemplate("{company}好，{company}是家好公司", { company: "A公司" })).toBe(
      "A公司好，A公司是家好公司",
    );
  });

  it("缺键回落空串而不是抛错", () => {
    expect(() => renderGreetingTemplate("{company} 的 {job_title}", {})).not.toThrow();
    expect(renderGreetingTemplate("{company} 的 {job_title}", {})).toBe(" 的 ");
  });

  it("变量值为 undefined / null 时按空串处理", () => {
    expect(renderGreetingTemplate("A{company}B", { company: undefined })).toBe("AB");
    expect(renderGreetingTemplate("A{company}B", { company: null as unknown as string })).toBe(
      "AB",
    );
  });
});

describe("renderGreetingTemplate：非变量花括号", () => {
  it("不认识的花括号原样保留（不能悄悄删掉用户写的字）", () => {
    expect(renderGreetingTemplate("熟悉 {Python} 与 {C++}", { company: "A公司" })).toBe(
      "熟悉 {Python} 与 {C++}",
    );
  });

  it("正文为空时返回空串，不抛", () => {
    expect(renderGreetingTemplate("", { company: "A公司" })).toBe("");
  });
});

describe("greetingValuesOf：从队列条目取变量", () => {
  it("取公司名与岗位名，姓名一律空串（不猜）", () => {
    const item = {
      company: "A公司",
      job_title: "后端开发",
    } as ApplyQueueItem;

    expect(greetingValuesOf(item)).toEqual({
      company: "A公司",
      job_title: "后端开发",
      name: "",
    });
  });

  it("条目为空时全部空串", () => {
    expect(greetingValuesOf(null)).toEqual({ company: "", job_title: "", name: "" });
  });

  it("协议变量清单就是三个（新增变量必须同批改后端安全字典）", () => {
    expect([...GREETING_TEMPLATE_VARIABLES]).toEqual(["company", "job_title", "name"]);
  });
});
