// SPDX-License-Identifier: Apache-2.0
/**
 * 导出文件名命名规则测试（契约 §6.4）：token 渲染、未知 token fail-soft、消毒、截断。
 * 前端预览必须与真实导出**同一套规则**，否则用户看到的名字与下载文件对不上。
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAMING,
  MAX_FILENAME_STEM,
  analyzeNamingPattern,
  renderFilenamePreview,
  sanitizeFilenameStem,
  validateNamingPattern,
} from "./naming";

const CONTEXT = {
  name: "张三",
  company: "甲公司",
  job_title: "后端工程师",
  template: "classic",
  date: "20261024",
  revision: 7,
  language: "zh-CN",
};

describe("renderFilenamePreview", () => {
  it("默认模板渲染成 姓名-岗位-日期.pdf（无岗位时只剩姓名-日期）", () => {
    expect(renderFilenamePreview(DEFAULT_NAMING, CONTEXT, "pdf")).toBe(
      "张三-后端工程师-20261024.pdf",
    );
    expect(renderFilenamePreview("", { ...CONTEXT, job_title: "" }, "pdf")).toBe(
      "张三-20261024.pdf",
    );
  });

  it("全部 token 都能渲染；扩展名由格式决定", () => {
    const pattern = "{name}-{company}-{job_title}-{template}-{date}-{revision}-{language}";
    expect(renderFilenamePreview(pattern, CONTEXT, "docx")).toBe(
      "张三-甲公司-后端工程师-classic-20261024-7-zh-CN.docx",
    );
    expect(renderFilenamePreview(pattern, CONTEXT, "json")).toMatch(/\.json$/);
  });

  it("未知 token 原样保留花括号（导出不因命名挂掉），但保存校验会拒绝", () => {
    expect(renderFilenamePreview("{name}-{unknown}", CONTEXT, "pdf")).toBe("张三-{unknown}.pdf");
    expect(validateNamingPattern("{name}-{unknown}")).toEqual({ ok: false, unknown: ["unknown"] });
    expect(validateNamingPattern("{name}-{date}")).toEqual({ ok: true });
  });

  it("非法字符替换成 '-'、空白折叠、超长截断到 120", () => {
    expect(sanitizeFilenameStem('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
    const long = "名".repeat(300);
    expect(renderFilenamePreview(long, CONTEXT, "pdf").length).toBeLessThanOrEqual(
      MAX_FILENAME_STEM + ".pdf".length,
    );
  });

  it("中文与空格安全（不引入路径分隔符）", () => {
    const name = renderFilenamePreview("{name} 简历", { ...CONTEXT, name: "李 四" }, "md");
    expect(name).not.toContain("/");
    expect(name).toContain("李 四");
  });
});

describe("analyzeNamingPattern", () => {
  it("抽出已知 token 列表并按出现顺序返回未知 token", () => {
    expect(analyzeNamingPattern("{name}-{job_title}-{date}")).toEqual({
      tokens: ["name", "job_title", "date"],
      unknown: [],
    });
    expect(analyzeNamingPattern("{name}-{foo}-{bar}")).toEqual({
      tokens: ["name"],
      unknown: ["foo", "bar"],
    });
  });
});
