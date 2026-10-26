// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { scanProductCopy } from "./productCopyAst";

const scan = (source: string) => scanProductCopy(source).map((finding) => finding.text);

describe("product copy is determined by syntax, not language", () => {
  it("detects English and escaped CJK in JSX output and accessible names", () => {
    expect(scan('<Button aria-label="Save resume">Save</Button>')).toEqual(["Save", "Save resume"]);
    expect(scan('<Button>{"\\u4fdd\\u5b58"}</Button>')).toEqual(["\u4fdd\u5b58"]);
  });

  it("detects option labels, table headings and notification bodies", () => {
    expect(scan('const options = [{ value: "save", label: "Save" }];')).toEqual(["Save"]);
    expect(scan('const columns = [{ key: "name", title: "Name" }];')).toEqual(["Name"]);
    expect(scan('message.success("Saved resume");')).toEqual(["Saved resume"]);
    expect(scan('notification.open({ title: "Saved", description: "Ready to export" });')).toEqual([
      "Ready to export",
      "Saved",
    ]);
    expect(scan('modal.confirm({ title: "Delete resume?", okText: "Delete" });')).toEqual([
      "Delete",
      "Delete resume?",
    ]);
    expect(scan('throw new Error("Resume is unavailable");')).toEqual(["Resume is unavailable"]);
  });

  it("follows local constants, aliases and object properties", () => {
    const source = [
      'const caption = "Save";',
      "const alias = caption;",
      'const COPY = { done: "Saved resume" };',
      "<><Button>{alias}</Button><span>{COPY.done}</span></>;",
    ].join("\n");
    expect(scan(source)).toEqual(["Save", "Saved resume"]);
  });

  it.each([
    '<Button children="Save changes" />;',
    'function getLabel() { return "Save changes"; } <Button>{getLabel()}</Button>;',
    'const getLabel = () => "Save changes"; <Button>{getLabel()}</Button>;',
    'const labels = { save: "Save changes" }; const { save } = labels; <Button>{save}</Button>;',
    'const labels = { save: "Save changes" }; const { save: action } = labels; <Button>{action}</Button>;',
    'const View = ({ label = "Save changes" }) => <Button>{label}</Button>;',
    'const styles = "Save changes"; <Button>{styles}</Button>;',
    'const styles = { content: "Save changes" }; <Button>{styles.content}</Button>;',
  ])("follows the actual output sink in %s", (source) => {
    expect(scan(source)).toEqual(["Save changes"]);
  });

  it("follows nested and array destructuring without evaluating application code", () => {
    expect(
      scan(
        [
          'const labels = { nested: { save: "Save changes" } };',
          "const { nested: { save } } = labels;",
          "<Button>{save}</Button>;",
        ].join("\n"),
      ),
    ).toEqual(["Save changes"]);
    expect(
      scan('const labels = ["Save changes"]; const [save] = labels; <Button>{save}</Button>;'),
    ).toEqual(["Save changes"]);
  });

  it("does not leak a shadowed function or follow recursive functions forever", () => {
    expect(
      scan(
        [
          'function getLabel() { return "Outer label"; }',
          "function View(getLabel: () => string) { return <Button>{getLabel()}</Button>; }",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      scan("function getLabel() { return getLabel(); } <Button>{getLabel()}</Button>;"),
    ).toEqual([]);
  });

  it("honors lexical shadowing instead of using an unrelated outer declaration", () => {
    const source = [
      'const label = "Outer label";',
      "function View(label: string) { return <Button>{label}</Button>; }",
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("does not count one local string twice when several output positions use it", () => {
    expect(scan('const label = "Save"; <Button title={label}>{label}</Button>;')).toEqual(["Save"]);
  });

  it("handles nested template interpolation and only follows conditional outputs", () => {
    const source = '<span>{`Saved ${ok ? `resume ${count}` : "draft"}`}</span>';
    expect(scan(source)).toEqual(["draft", "resume {}", "Saved {}"]);
    expect(scan('<span>{kind === "saved" ? "Saved" : "Draft"}</span>')).toEqual(["Draft", "Saved"]);
  });

  it("follows labels produced by an inline render callback", () => {
    expect(scan('<span>{items.map(() => "Saved")}</span>')).toEqual(["Saved"]);
  });

  it("detects strings in computed UI keys and dangerous HTML", () => {
    expect(scan('const props = { ["aria-label"]: "Save resume" };')).toEqual(["Save resume"]);
    expect(scan('<div dangerouslySetInnerHTML={{ __html: "<b>Save</b>" }} />')).toEqual([
      "<b>Save</b>",
    ]);
  });
});

describe("technical syntax is not a translation task", () => {
  it("ignores imports, route paths, API fields, enum values and CSS classes", () => {
    const source = [
      'import View from "./View";',
      'fetch("/api/resumes");',
      'const route = { path: "/resume", key: "resume", type: "button" };',
      '<Button className="save-action" data-testid="save" name="resume" />;',
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("ignores translation keys and parameters", () => {
    const source = [
      '<Button title={t("resume.save", { name: "demo" })}>',
      '  {translate("zh-CN", "resume.save")}',
      '  {t("resume.save", { title: "demo", label: "example" })}',
      "</Button>",
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("recognizes namespace translation wrappers while preserving literal copy checks", () => {
    expect(scan('<Button>{at("assets.editor.save")}</Button>')).toEqual([]);
    expect(scan('<Button>{rt("research.tab.patents")}</Button>')).toEqual([]);
    expect(scan('<Button>{at("assets.editor.save") || "Save"}</Button>')).toEqual(["Save"]);
  });

  it("ignores string operands used only to compute boolean output", () => {
    expect(scan('<span>{state === "ready"}</span>')).toEqual([]);
    expect(scan('<span>{state !== "ready"}</span>')).toEqual([]);
    expect(scan('<span>{ready && "Ready"}</span>')).toEqual(["Ready"]);
  });

  it("ignores comments, regexes, CSS and console payloads", () => {
    const source = [
      '// label: "Not a UI label"',
      "const pattern = /Save|Draft/;",
      'console.info({ title: "Internal state" });',
      'const style = { content: "counter(page)" };',
      '<style>{"body { color: red }"}</style>;',
      '<div style={{ content: "counter(page)" }} />;',
    ].join("\n");
    expect(scan(source)).toEqual([]);
  });

  it("does not treat a fake exemption string or comment as permission for product copy", () => {
    expect(scan('<Button>{"i18n-ok: fake"}</Button>')).toEqual(["i18n-ok: fake"]);
    expect(scan("// i18n-ok: legacy\n<Button>Save</Button>")).toEqual(["Save"]);
  });

  it("ignores empty output and decoration while preserving visible numeric labels", () => {
    expect(scan("<span>  · → </span>")).toEqual([]);
    expect(scan("<span>100%</span>")).toEqual(["100%"]);
  });
});

describe("guard integrity", () => {
  it("rejects malformed source instead of returning an empty successful scan", () => {
    expect(() => scanProductCopy('<Button title="Save"')).toThrow(/Cannot parse/);
    expect(() => scanProductCopy('const x = "unterminated')).toThrow(/Cannot parse/);
  });

  it("reports source locations and fingerprints independent of blank-line movement", () => {
    const source = "function View() { return <Button>Save</Button>; }";
    const first = scanProductCopy(source);
    const shifted = scanProductCopy(`// A comment\n\n${source}`);
    expect(first).toHaveLength(1);
    expect(first[0].line).toBe(1);
    expect(shifted[0].line).toBe(3);
    expect(shifted[0].fingerprint).toBe(first[0].fingerprint);
    expect(scanProductCopy(source.replace("Save", "Delete"))[0].fingerprint).not.toBe(
      first[0].fingerprint,
    );
  });

  it("keeps duplicate findings as a multiset so a second literal cannot reuse old credit", () => {
    const source = "<><Button>Save</Button><Button>Save</Button></>";
    const findings = scanProductCopy(source);
    expect(findings).toHaveLength(2);
    expect(findings[0].fingerprint).toBe(findings[1].fingerprint);
  });
});
