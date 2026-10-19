/**
 * `ResumeListSection` 的**条目级**填入——「从资料填入本条」（`fillEntry`）。
 *
 * 与 `ManualResumeModal.integration.test.tsx` 里的 R16 用例分工：那里走整条弹窗链路，
 * 验证的是"入口在、能追加"；这里直接挂 `Form + EducationEditor`，**只**盯 `fillEntry`
 * 的语义（只填空字段、不动别的条目、候选禁用规则、填完聚焦），因为这几条用整条弹窗
 * 很难摆出干净的初始状态（弹窗里预填的那条是资料来的，天然和候选同键）。
 *
 * 断言口径：
 * - 字段值一律从**输入框**读（`getByLabelText` + `toHaveValue`），而不是从表单实例读——
 *   用户在界面上看到的值才是产品行为；
 * - 表单实例只用来断言"整条逐字不变"这类结构化事实（`getFieldValue`），两者互补。
 */

import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { educationFillKey } from "../../features/profile/profileFillOptions";
import type {
  ProfileFillItem,
  ProfileFillSources,
} from "../../features/profile/profileFillOptions";
import type { ResumeEducation } from "../../types";
import { ProfileFillProvider } from "./profileFillContext";
import { EducationEditor } from "./ResumeSectionEditors";

/* ------------------------------------------------------------------ 文案锚点 */

/** 条目头部下拉的 `aria-label`（`ProfileFillBar` 的 entry 模式）。 */
const ENTRY_SELECT_LABEL = "从我的资料选择填入本条";
/** 条目头部按钮的 `aria-label`：`填入本条的{label}`，教育模块的 label 是「教育经历」。 */
const ENTRY_FILL_LABEL = "填入本条的教育经历";
/** 顶部追加入口的 `aria-label`：`从我的资料选择{label}`。 */
const TOP_SELECT_LABEL = "从我的资料选择教育经历";
/** 顶部追加按钮的 `aria-label`：`填入选中的{label}`。 */
const TOP_FILL_LABEL = "填入选中的教育经历";
/** 顶部入口的固定文案，用来确认"追加一条"没有被条目级入口取代。 */
const TOP_HINT_TEXT = "从我的资料追加一条";

/* ------------------------------------------------------------------ 夹具 */

const EDU_A: ResumeEducation = {
  school: "示例大学",
  major: "软件工程",
  degree: "本科",
  start_date: "2023.09",
  end_date: "2027.06",
  gpa: "3.8",
  courses: ["数据结构", "操作系统"],
  achievements: [],
};

const EDU_B: ResumeEducation = {
  school: "第二大学",
  major: "机械设计",
  degree: "硕士",
  start_date: "2021.09",
  end_date: "2023.06",
  gpa: "3.5",
  courses: [],
  achievements: ["校级一等奖"],
};

/** 与 `EducationEditor` 的 `emptyValue` 一致：新加的空条目长这样。 */
const BLANK_EDUCATION: ResumeEducation = {
  school: "",
  major: "",
  degree: "",
  start_date: "",
  end_date: "",
  gpa: "",
  courses: [],
  achievements: [],
};

/**
 * 造一条候选。**键用生产代码的 `educationFillKey` 算**，不手写字面量：
 * `key` 必须与表单条目算出来的键一致，"当前条目/已在其他条目"才有意义；手写一份
 * 就等于把这条隐式契约在测试里复制一遍，生产改了它也不会红。
 */
function itemOf(value: ResumeEducation, hint: string): ProfileFillItem {
  return { key: educationFillKey(value), label: value.school, hint, value };
}

const CANDIDATE_A = itemOf(EDU_A, "软件工程 · 本科 · 2023.09 ~ 2027.06");
const CANDIDATE_B = itemOf(EDU_B, "机械设计 · 硕士 · 2021.09 ~ 2023.06");

/** 下拉里那条的**可见文案**（`ProfileFillBar` 拼成 `标题（次要说明）`）。 */
const OPTION_A = `${CANDIDATE_A.label}（${CANDIDATE_A.hint}）`;
const OPTION_B = `${CANDIDATE_B.label}（${CANDIDATE_B.hint}）`;

/** 只有教育模块有候选；其余模块留空（它们各自有对应的编辑器，与本文件无关）。 */
function sourcesOf(education: ProfileFillItem[]): ProfileFillSources {
  return {
    education,
    experience: [],
    campusExperience: [],
    projects: [],
    skills: [],
    awards: [],
    summary: "",
  };
}

const noop = (): void => undefined;

/* ------------------------------------------------------------------ 渲染夹具 */

interface HarnessProps {
  education: ResumeEducation[];
  sources: ProfileFillSources;
  onFilled?: () => void;
  onFormReady?: (form: FormInstance) => void;
}

/**
 * 最小宿主：一个 `Form` + 真 `EducationEditor` + 真的 `ProfileFillProvider`。
 * 不套弹窗/Tabs，是为了让"列表里已有几条、每条写了什么"完全由用例决定。
 */
function EducationFillHarness({ education, sources, onFilled, onFormReady }: HarnessProps) {
  const [form] = Form.useForm();

  useEffect(() => {
    onFormReady?.(form);
  }, [form, onFormReady]);

  return (
    <AntdApp>
      <Form form={form} layout="vertical" initialValues={{ education }}>
        <ProfileFillProvider value={{ sources, onFilled: onFilled ?? noop, entryFill: true }}>
          <EducationEditor />
        </ProfileFillProvider>
      </Form>
    </AntdApp>
  );
}

/** 渲染并取回表单实例（回调里赋值，避免闭包读到渲染前的空值）。 */
function renderHarness(options: Omit<HarnessProps, "onFormReady">): { form: FormInstance } {
  const holder: { form?: FormInstance } = {};
  render(
    <EducationFillHarness
      {...options}
      onFormReady={(form) => {
        holder.form = form;
      }}
    />,
  );
  const form = holder.form;
  if (!form) throw new Error("表单实例没有就绪");
  return { form };
}

/* ------------------------------------------------------------------ 交互小工具 */

/**
 * 展开下拉，返回它的浮层。
 *
 * 每个用例最多只展开一个下拉（不同下拉的浮层都挂在 body 上，多开就分不清归属），
 * 拿"最后一个未隐藏的浮层"即可；`ant-select-dropdown-hidden` 是关闭态的类名。
 */
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

/** 第 index 个条目头部的下拉。DOM 顺序与条目顺序一致。 */
function entrySelect(index: number): HTMLElement {
  return screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL })[index];
}

/** 第 index 个条目头部的「填入」按钮。 */
function entryFillButton(index: number): HTMLElement {
  return screen.getAllByRole("button", { name: ENTRY_FILL_LABEL })[index];
}

/** 在浮层里按可见文案找到那条选项的根节点（`aria-disabled` / 禁用类都挂在它身上）。 */
function optionElement(dropdown: HTMLElement, text: string): HTMLElement {
  const label = within(dropdown).getByText(text, { exact: false });
  const option = label.closest<HTMLElement>(".ant-select-item-option");
  if (!option) throw new Error(`「${text}」不是一条下拉选项`);
  return option;
}

/** 展开某个下拉、选中一条、再点填入。 */
async function pickAndFill(
  select: HTMLElement,
  optionText: string,
  fillButton: HTMLElement,
): Promise<void> {
  const dropdown = await openDropdown(select);
  fireEvent.click(optionElement(dropdown, optionText));
  fireEvent.click(fillButton);
}

/* ------------------------------------------------------------------ 用例 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeListSection 条目级填入（fillEntry）", () => {
  it("空条目：一次补齐学校/专业/起止时间/绩点/课程，且不新增条目", async () => {
    const { form } = renderHarness({
      education: [{ ...BLANK_EDUCATION }],
      sources: sourcesOf([CANDIDATE_A]),
    });

    await pickAndFill(entrySelect(0), OPTION_A, entryFillButton(0));

    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue("示例大学"));
    expect(screen.getByLabelText("专业")).toHaveValue("软件工程");
    expect(screen.getByLabelText("学历")).toHaveValue("本科");
    expect(screen.getByLabelText("开始时间")).toHaveValue("2023.09");
    expect(screen.getByLabelText("结束时间")).toHaveValue("2027.06");
    expect(screen.getByLabelText("绩点/排名")).toHaveValue("3.8");
    // 多行字段按行渲染：数组在表单里就是 ["数据结构", "操作系统"]。
    expect(screen.getByLabelText("核心课程")).toHaveValue("数据结构\n操作系统");

    // 条目级入口是"填进这一条"，不是"再追加一条"：数组长度不变。
    expect(form.getFieldValue("education")).toHaveLength(1);
    expect(screen.getAllByLabelText("学校")).toHaveLength(1);
  });

  it("顶部「从我的资料追加一条」在条目级入口出现后仍然可用", async () => {
    renderHarness({
      education: [{ ...BLANK_EDUCATION }],
      sources: sourcesOf([CANDIDATE_A]),
    });

    expect(screen.getByText(TOP_HINT_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: TOP_SELECT_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TOP_FILL_LABEL })).toBeInTheDocument();
    // 两条入口并存：顶部一条（追加）+ 每个条目一条（填入）。
    expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL })).toHaveLength(1);
  });

  it("只填空字段：手写过的学校保持原值，其余空字段被补齐", async () => {
    const { form } = renderHarness({
      education: [{ ...BLANK_EDUCATION, school: "我手写的大学" }],
      sources: sourcesOf([CANDIDATE_A]),
    });

    await pickAndFill(entrySelect(0), OPTION_A, entryFillButton(0));

    await waitFor(() => expect(screen.getByLabelText("专业")).toHaveValue("软件工程"));
    // 用户写的比资料里那份更贴近目标岗位，绝不能覆盖。
    expect(screen.getByLabelText("学校")).toHaveValue("我手写的大学");
    expect(screen.getByLabelText("绩点/排名")).toHaveValue("3.8");
    expect(screen.getByLabelText("核心课程")).toHaveValue("数据结构\n操作系统");
    expect(form.getFieldValue("education")).toHaveLength(1);
  });

  it("空白（空串/空数组）算空，会被填上；已有内容不算空，保持原样", async () => {
    const { form } = renderHarness({
      education: [{ ...BLANK_EDUCATION, major: "   ", courses: ["我自己写的课程"] }],
      sources: sourcesOf([CANDIDATE_A]),
    });

    await pickAndFill(entrySelect(0), OPTION_A, entryFillButton(0));

    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue("示例大学"));
    // 纯空白串视同没写。
    expect(screen.getByLabelText("专业")).toHaveValue("软件工程");
    // 已有内容的多行字段不覆盖。
    expect(screen.getByLabelText("核心课程")).toHaveValue("我自己写的课程");
    expect(form.getFieldValue("education")).toHaveLength(1);
  });

  it("不影响其它条目：填第 2 条，第 1 条逐字不变", async () => {
    // 第 1 条带两项用户改动（绩点、在校成果），任何"整表覆盖"的实现都会立刻露馅。
    const first: ResumeEducation = { ...EDU_A, gpa: "4.0", achievements: ["国家奖学金"] };
    const { form } = renderHarness({
      education: [first, { ...BLANK_EDUCATION }],
      sources: sourcesOf([CANDIDATE_B]),
    });
    const before = form.getFieldValue("education")[0];

    await pickAndFill(entrySelect(1), OPTION_B, entryFillButton(1));

    await waitFor(() => expect(screen.getAllByLabelText("学校")[1]).toHaveValue("第二大学"));
    // 第 1 条的界面值。
    expect(screen.getAllByLabelText("学校")[0]).toHaveValue("示例大学");
    expect(screen.getAllByLabelText("专业")[0]).toHaveValue("软件工程");
    expect(screen.getAllByLabelText("绩点/排名")[0]).toHaveValue("4.0");
    expect(screen.getAllByLabelText("在校成果")[0]).toHaveValue("国家奖学金");
    // 第 1 条的表单值：整对象逐字相同，且还是同一个引用（没被"重建一份"顺手改掉字段）。
    const after = form.getFieldValue("education");
    expect(after).toHaveLength(2);
    expect(after[0]).toEqual(before);
    // 第 2 条拿到了资料里的内容。
    expect(screen.getAllByLabelText("学历")[1]).toHaveValue("硕士");
    expect(screen.getAllByLabelText("在校成果")[1]).toHaveValue("校级一等奖");
  });

  it("候选禁用语义：别人的条目显示「已在其他条目」，自己的显示「当前条目」", async () => {
    // 两条都已存在且与资料同键：第 1 条占用了候选 A，第 2 条自己就是候选 B。
    renderHarness({
      education: [{ ...EDU_A }, { ...EDU_B }],
      sources: sourcesOf([CANDIDATE_A, CANDIDATE_B]),
    });

    const dropdown = await openDropdown(entrySelect(1));

    const usedByOther = optionElement(dropdown, `${OPTION_A} 已在其他条目`);
    expect(usedByOther).toHaveAttribute("aria-disabled", "true");
    expect(usedByOther).toHaveClass("ant-select-item-option-disabled");

    const isCurrent = optionElement(dropdown, `${OPTION_B} 当前条目`);
    expect(isCurrent).toHaveAttribute("aria-disabled", "true");
    expect(isCurrent).toHaveClass("ant-select-item-option-disabled");

    // 没有可选项时按钮保持禁用（不会出现"点了没反应"）。
    expect(entryFillButton(0)).toBeDisabled();
    expect(entryFillButton(1)).toBeDisabled();
  });

  it("顶部追加回归：选一条 → 填入 → 列表 +1，新条目也有自己的条目级入口", async () => {
    const { form } = renderHarness({
      education: [{ ...EDU_A }],
      sources: sourcesOf([CANDIDATE_A, CANDIDATE_B]),
    });

    const dropdown = await openDropdown(screen.getByRole("combobox", { name: TOP_SELECT_LABEL }));
    // 已经在这份简历里的那条标「已加入」并禁用——追加不会造出重复项。
    const joined = optionElement(dropdown, `${OPTION_A} 已加入`);
    expect(joined).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(optionElement(dropdown, OPTION_B));
    fireEvent.click(screen.getByRole("button", { name: TOP_FILL_LABEL }));

    await waitFor(() => expect(screen.getAllByLabelText("学校")).toHaveLength(2));
    expect(form.getFieldValue("education")).toHaveLength(2);
    expect(screen.getAllByLabelText("学校")[1]).toHaveValue("第二大学");
    expect(screen.getAllByLabelText("专业")[1]).toHaveValue("机械设计");
    // 加进来的条目同样可以继续"填入本条"（它当前的键就是候选 B）。
    expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL })).toHaveLength(2);
  });

  it("填入后焦点进入被填的那一条（不留在下拉里）", async () => {
    renderHarness({
      education: [{ ...EDU_A }, { ...BLANK_EDUCATION }],
      sources: sourcesOf([CANDIDATE_B]),
    });

    await pickAndFill(entrySelect(1), OPTION_B, entryFillButton(1));

    await waitFor(() => expect(screen.getAllByLabelText("学校")[1]).toHaveValue("第二大学"));
    // 焦点必须落在**这条的字段**上，而不是条目头部那个"从资料填入本条"的搜索框：
    // 后者是工具条，回去等于让用户重新选一遍（antd Select 聚焦即展开候选，还会盖住
    // 刚填好的字段）。`fillEntry` 用 requestAnimationFrame 聚焦，所以只等"最终落点"。
    await waitFor(() => expect(screen.getAllByLabelText("学校")[1]).toHaveFocus());
  });

  it("填入会通知宿主「有未保存的修改」", async () => {
    const onFilled = vi.fn();
    renderHarness({
      education: [{ ...BLANK_EDUCATION }],
      sources: sourcesOf([CANDIDATE_A]),
      onFilled,
    });

    await pickAndFill(entrySelect(0), OPTION_A, entryFillButton(0));

    await waitFor(() => expect(onFilled).toHaveBeenCalled());
    // 只通知一次：填入是一次编辑动作，不是逐字段各通知一遍。
    expect(onFilled).toHaveBeenCalledTimes(1);
  });
});
