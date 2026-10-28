// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块条目级「从资料填入本条」（2026-10-28）。
 *
 * 用户口径：自建板块（`custom:*`）与系统板块用同一种交互——每个条目卡都有「从资料填入
 * 本条」，只补空字段。自建条目形状是 `{text, lines}`，所以合并规则与系统板块不同：
 *
 * 1. `text` 空才填（用户手写的一个字都不覆盖）；
 * 2. `lines` 按 label 合并：同 label 已有非空值不覆盖、空值补上、缺失 label 追加到末尾，
 *    已有行顺序不变；
 * 3. **不复制 `entry_id`**（候选的稳定身份不能写进当前条目）；
 * 4. 同一板块内互相识别"当前条目 / 已在其他条目"并禁用，避免同一份资料填两遍。
 *
 * 夹具与断言口径：候选 label/lines 用 ASCII；定位用 role/aria-label 与 `t()`，
 * 不用中文 `*ByText`（cjkRatchet 的 tests 棘轮按逐文件基线比较）。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customEntryFillKey,
  type ProfileFillItem,
  type ProfileFillSources,
} from "../../features/profile/profileFillOptions";
import type { ResumeCustomEntry, ResumeCustomSection } from "../../types";
import { t } from "../../i18n";
import CustomSectionsEditor from "./CustomSectionsEditor";
import { ProfileFillProvider } from "./profileFillContext";
import { fillCustomEntryFromSource } from "./profileEntryFill";

const OSS_KEY = "custom:oss";
const SECTION_TITLE = "OSS";

/** 条目卡入口的 aria-label（`ProfileFillBar` 的 entry 模式）。 */
const ENTRY_SELECT = t("editor.profileFill.aria.entry");
const ENTRY_FILL = t("editor.profileFill.fillEntryAria", { label: SECTION_TITLE });
const SUFFIX_CURRENT = t("editor.profileFill.suffix.current");
const SUFFIX_OTHER = t("editor.profileFill.suffix.other");

function entry(
  id: string,
  text: string,
  lines: ResumeCustomEntry["lines"] = [],
): ResumeCustomEntry {
  return { entry_id: id, text, lines };
}

function sections(entries: ResumeCustomEntry[], title = SECTION_TITLE): ResumeCustomSection[] {
  return [{ key: OSS_KEY, title, entries }];
}

/** 造一条候选；matchKey 用生产代码的形状键算，不手写（否则去重语义会在测试里另说一套）。 */
function itemOf(source: ResumeCustomEntry, label: string): ProfileFillItem {
  return {
    key: `candidate-${label}`,
    label,
    hint: SECTION_TITLE,
    value: source,
    matchKey: customEntryFillKey(source),
  };
}

function sourcesWith(items?: ProfileFillItem[]): ProfileFillSources {
  return {
    education: [],
    experience: [],
    campusExperience: [],
    projects: [],
    skills: [],
    awards: [],
    summary: "",
    ...(items ? { customSections: { [OSS_KEY]: items } } : {}),
  };
}

interface HarnessProps {
  initial: ResumeCustomSection[];
  sources: ProfileFillSources;
  onFilled?: () => void;
  onFormReady?: (form: FormInstance) => void;
}

/** 最小宿主：Form + 真 `CustomSectionsEditor` + 真 `ProfileFillProvider`，不套弹窗/Tabs。 */
function Harness({ initial, sources, onFilled, onFormReady }: HarnessProps) {
  const [form] = Form.useForm();
  useEffect(() => {
    onFormReady?.(form);
  }, [form, onFormReady]);
  return (
    <AntdApp>
      <Form form={form} layout="vertical" initialValues={{ custom_sections: initial }}>
        <ProfileFillProvider value={{ sources, onFilled: onFilled ?? (() => undefined) }}>
          <CustomSectionsEditor />
        </ProfileFillProvider>
      </Form>
    </AntdApp>
  );
}

function renderHarness(options: Omit<HarnessProps, "onFormReady">): { form: FormInstance } {
  const holder: { form?: FormInstance } = {};
  render(
    <Harness
      {...options}
      onFormReady={(form) => {
        holder.form = form;
      }}
    />,
  );
  if (!holder.form) throw new Error("form not ready");
  return { form: holder.form };
}

/* ------------------------------------------------------------------ 交互小工具 */

const selects = (): HTMLElement[] => screen.getAllByRole("combobox", { name: ENTRY_SELECT });
const fillButtons = (): HTMLElement[] => screen.getAllByRole("button", { name: ENTRY_FILL });

/** 展开下拉，返回最后一个未隐藏的浮层（同一时刻只展开一个）。 */
async function openDropdown(select: HTMLElement): Promise<HTMLElement> {
  fireEvent.mouseDown(select);
  fireEvent.click(select);
  return waitFor(() => {
    const dropdowns = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-select-dropdown"),
    ).filter((node) => !node.classList.contains("ant-select-dropdown-hidden"));
    expect(dropdowns.length).toBeGreaterThan(0);
    return dropdowns[dropdowns.length - 1];
  });
}

/** 浮层里按可见文案找到选项根节点（aria-disabled / 禁用类都挂在它身上）。 */
function optionElement(dropdown: HTMLElement, text: string): HTMLElement {
  const label = within(dropdown).getByText(text, { exact: false });
  const option = label.closest<HTMLElement>(".ant-select-item-option");
  if (!option) throw new Error("option not found");
  return option;
}

/** `ProfileFillBar` 拼出来的可见文案：`标题（次要说明）` + 可选后缀。 */
function optionText(label: string, suffix = ""): string {
  return `${label}（${SECTION_TITLE}）${suffix ? ` ${suffix}` : ""}`;
}

/** 展开第 index 条的下拉、选中一条、再点填入。 */
async function pickAndFill(index: number, text: string): Promise<void> {
  const dropdown = await openDropdown(selects()[index]);
  fireEvent.click(optionElement(dropdown, text));
  fireEvent.click(fillButtons()[index]);
}

function entryAt(form: FormInstance, index: number): ResumeCustomEntry {
  return form.getFieldValue(["custom_sections", 0, "entries", index]) as ResumeCustomEntry;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/* ------------------------------------------------------------------ 渲染 */

describe("CustomSectionsEditor · 条目级入口渲染", () => {
  it("有候选时每条条目卡都有一个入口", () => {
    renderHarness({
      initial: sections([entry("e1", "Alpha"), entry("e2", "Beta")]),
      sources: sourcesWith([itemOf(entry("c1", "Profile"), "Profile entry")]),
    });

    expect(selects()).toHaveLength(2);
    expect(fillButtons()).toHaveLength(2);
    expect(document.querySelectorAll("[data-fill-variant='entry']")).toHaveLength(2);
  });

  it("没有候选时完全不渲染入口（一个永远没有选项的下拉比没有更让人困惑）", () => {
    renderHarness({
      initial: sections([entry("e1", "Alpha")]),
      sources: sourcesWith(),
    });

    expect(screen.queryAllByRole("combobox", { name: ENTRY_SELECT })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: ENTRY_FILL })).toHaveLength(0);
    expect(document.querySelectorAll("[data-fill-variant='entry']")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ 合并语义 */

describe("CustomSectionsEditor · 从资料填入本条只补空值", () => {
  it("text 不覆盖手写内容；lines 按 label 合并且保留已有顺序", async () => {
    const onFilled = vi.fn();
    const { form } = renderHarness({
      initial: sections([
        entry("e1", "Handwritten text", [
          { label: "Role", value: "maintainer" },
          { label: "Link", value: "   " },
        ]),
      ]),
      sources: sourcesWith([
        itemOf(
          entry("profile-1", "Profile text", [
            { label: "Role", value: "from profile" },
            { label: "Link", value: "https://profile.dev" },
            { label: "Extra", value: "appended" },
          ]),
          "Profile entry",
        ),
      ]),
      onFilled,
    });

    await pickAndFill(0, optionText("Profile entry"));

    await waitFor(() =>
      expect(entryAt(form, 0)).toEqual({
        entry_id: "e1",
        text: "Handwritten text",
        lines: [
          { label: "Role", value: "maintainer" },
          { label: "Link", value: "https://profile.dev" },
          { label: "Extra", value: "appended" },
        ],
      }),
    );
    // 界面上也要真的看得到：正文框保持手写值，标签行的值与顺序按合并结果。
    expect(screen.getByLabelText(t("editor.custom-sections.content"))).toHaveValue(
      "Handwritten text",
    );
    const values = screen.getAllByLabelText(t("editor.custom-sections.value"));
    expect(values.map((node) => (node as HTMLInputElement).value)).toEqual([
      "maintainer",
      "https://profile.dev",
      "appended",
    ]);
    const labels = screen.getAllByLabelText(t("editor.custom-sections.label"));
    expect(labels.map((node) => (node as HTMLInputElement).value)).toEqual([
      "Role",
      "Link",
      "Extra",
    ]);
    // 填入只通知一次"有未保存的修改"。
    expect(onFilled).toHaveBeenCalledTimes(1);
  });

  it("空条目一次补齐；不复制候选的 entry_id", async () => {
    const { form } = renderHarness({
      initial: sections([entry("", "")]),
      sources: sourcesWith([
        itemOf(
          entry("profile-1", "Profile text", [{ label: "Role", value: "maintainer" }]),
          "Profile entry",
        ),
      ]),
    });

    await pickAndFill(0, optionText("Profile entry"));

    await waitFor(() =>
      expect(entryAt(form, 0)).toEqual({
        entry_id: "",
        text: "Profile text",
        lines: [{ label: "Role", value: "maintainer" }],
      }),
    );
  });

  it("候选与当前条目内容相同时不写表单（不凭空多一条脏值）", async () => {
    const target = entry("e1", "Alpha", [{ label: "Role", value: "maintainer" }]);
    const onFilled = vi.fn();
    const { form } = renderHarness({
      initial: sections([target]),
      // 换个行顺序的同一份内容：形状键相同 → 候选标"当前条目"并禁用，点不动。
      sources: sourcesWith([
        itemOf(
          entry("profile-1", "Alpha", [{ label: "Role", value: "maintainer" }]),
          "Profile entry",
        ),
      ]),
      onFilled,
    });

    const dropdown = await openDropdown(selects()[0]);
    expect(optionElement(dropdown, optionText("Profile entry", SUFFIX_CURRENT))).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(fillButtons()[0]).toBeDisabled();
    expect(onFilled).not.toHaveBeenCalled();
    expect(entryAt(form, 0)).toEqual(target);
  });
});

/* ------------------------------------------------------------------ 去重 */

describe("CustomSectionsEditor · 同一板块内的候选去重", () => {
  it("其它条目用过的标「已在其他条目」、当前条目标「当前条目」，都禁用", async () => {
    const alpha = entry("e1", "Alpha", [{ label: "Role", value: "maintainer" }]);
    const beta = entry("e2", "Beta", [
      { label: "Role", value: "author" },
      { label: "Link", value: "https://beta.dev" },
    ]);
    renderHarness({
      initial: sections([alpha, beta]),
      sources: sourcesWith([
        itemOf(alpha, "Alpha item"),
        // 行顺序与表单里相反：形状键忽略顺序，仍应识别为"当前条目"。
        itemOf(
          entry("c2", "Beta", [
            { label: "Link", value: "https://beta.dev" },
            { label: "Role", value: "author" },
          ]),
          "Beta item",
        ),
      ]),
    });

    const firstDropdown = await openDropdown(selects()[0]);
    expect(optionElement(firstDropdown, optionText("Alpha item", SUFFIX_CURRENT))).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(optionElement(firstDropdown, optionText("Beta item", SUFFIX_OTHER))).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const secondDropdown = await openDropdown(selects()[1]);
    expect(optionElement(secondDropdown, optionText("Beta item", SUFFIX_CURRENT))).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(optionElement(secondDropdown, optionText("Alpha item", SUFFIX_OTHER))).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    // 全部候选都已在表单里：两条的填入按钮都禁用（不会"点了没反应"）。
    expect(fillButtons()[0]).toBeDisabled();
    expect(fillButtons()[1]).toBeDisabled();
  });
});

/* ------------------------------------------------------------------ 纯函数 */

describe("fillCustomEntryFromSource", () => {
  it("只补空值、保留 entry_id，不改动候选对象", () => {
    const source = entry("profile-1", "Profile text", [{ label: "Role", value: "maintainer" }]);
    const result = fillCustomEntryFromSource(
      entry("e1", "  ", [
        { label: "Role", value: "" },
        { label: "Link", value: "kept" },
      ]),
      source,
    );

    expect(result.changed).toBe(true);
    expect(result.entry).toEqual({
      entry_id: "e1",
      text: "Profile text",
      lines: [
        { label: "Role", value: "maintainer" },
        { label: "Link", value: "kept" },
      ],
    });
    // 候选是投影缓存，不能被填入流程改掉。
    expect(source).toEqual(
      entry("profile-1", "Profile text", [{ label: "Role", value: "maintainer" }]),
    );
  });

  it("缺失 label 追加到末尾，已有行顺序不变", () => {
    const result = fillCustomEntryFromSource(
      entry("e1", "kept", [
        { label: "Link", value: "https://x.dev" },
        { label: "Role", value: "maintainer" },
      ]),
      entry("p", "from profile", [
        { label: "Role", value: "author" },
        { label: "Extra", value: "e" },
      ]),
    );

    expect(result.changed).toBe(true);
    expect(result.entry.lines).toEqual([
      { label: "Link", value: "https://x.dev" },
      { label: "Role", value: "maintainer" },
      { label: "Extra", value: "e" },
    ]);
  });

  it("没有可补的空值时 changed=false；空 source 安全降级", () => {
    const complete = fillCustomEntryFromSource(
      entry("e1", "Alpha", [{ label: "Role", value: "maintainer" }]),
      entry("p", "Alpha", [{ label: "Role", value: "maintainer" }]),
    );
    expect(complete.changed).toBe(false);

    const empty = fillCustomEntryFromSource(entry("e1", "", []), null);
    expect(empty.changed).toBe(false);
    expect(empty.entry).toEqual(entry("e1", "", []));
  });
});
