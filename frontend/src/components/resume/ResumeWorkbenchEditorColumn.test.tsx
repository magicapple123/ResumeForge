// SPDX-License-Identifier: Apache-2.0
/**
 * 简历制作台 · **中栏内容编辑**：保存链路与三个出口的语义（P0-3 / P0-7）。
 *
 * 这一层的风险全在"看起来都对"的细节里：
 *
 * 1. **保存不等于关闭**：中栏点「保存内容」后制作台必须还开着（用户下一步往往是接着调
 *    参数看排版）。弹窗形态的 `onExit` 语义一旦漏到中栏，用户每次改一句措辞都会被踢出
 *    制作台——功能"能用"，闭环断在这一步；
 * 2. **脏值信号**：状态条与「保存内容」的高亮都挂在这个布尔值上，写错就会出现
 *    "改了但按钮不亮"或"存完了还一直提示没保存"；
 * 3. **放弃修改留在原地**，而**关闭制作台**才回调宿主——两个动作共用一套内联确认，
 *    但出口不同，混了就会"放弃修改把整屏关掉"。
 *
 * 中文只出现在注释里；断言文案一律走 `t()`（`cjkRatchet` 的 tests 口径）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import { t } from "../../i18n";
import { rt } from "../../features/resume-research/i18n";
import type { ResumeContent } from "../../types";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";

const CONTENT: ResumeContent = {
  photo: "data:image/png;base64,AAAA",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "后端开发",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

function renderColumn(props: Partial<ComponentProps<typeof ResumeWorkbenchEditorColumn>> = {}) {
  // `Mock` 断言只在这份文件里用：传进来的可能是裸函数，所以统一擦成 spy 的类型。
  const onSave = (props.onSave ?? vi.fn(async () => undefined)) as unknown as Mock;
  const onRequestClose = (props.onRequestClose ?? vi.fn()) as unknown as Mock;
  const utils = render(
    <AntdApp>
      <ResumeWorkbenchEditorColumn
        active
        content={CONTENT}
        resumeId={42}
        onSave={onSave}
        onRequestClose={onRequestClose}
        closeSignal={0}
        {...props}
      />
    </AntdApp>,
  );
  return { ...utils, onSave, onRequestClose };
}

/** 姓名输入框：antd 给 `Form.Item name="name"` 生成的 id 就是字段名。 */
function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

function typeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
}

/** 「保存内容」那颗按钮：带图标，所以可访问名是「icon label + 文案」，按子串匹配。 */
function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(t("workbench.action.save-content")) });
}

beforeEach(() => {
  // 草稿写 sessionStorage（scope 里带 #workbench）：用例之间必须互不可见。
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("中栏 · 保存链路", () => {
  it("改一条内容 → 保存 → 调用宿主 onSave，且**不关闭**制作台（P0-3 / P0-7）", async () => {
    const { onSave, onRequestClose } = renderColumn();

    typeName("李四");
    // 改动一发生就该亮出"没保存"：这一条与下面那条"存完就消失"是同一枚信号的两侧。
    expect(await screen.findByText(t("workbench.status.unsaved"))).toBeInTheDocument();
    expect(saveButton()).toHaveClass("ant-btn-primary");

    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as ResumeContent;
    expect(saved.name).toBe("李四");
    // 只带表单里的字段 + 原样保留照片：照片不在本次编辑表单里，不能被清空。
    expect(saved.photo).toBe(CONTENT.photo);
    expect(saved.job_intent).toBe(CONTENT.job_intent);

    // 关键点：保存成功**不关**制作台（宿主不收到关闭请求）。
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("保存成功后状态条消失、按钮退出高亮（脏值被清掉）", async () => {
    renderColumn();

    typeName("李四");
    expect(await screen.findByText(t("workbench.status.unsaved"))).toBeInTheDocument();

    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.queryByText(t("workbench.status.unsaved"))).not.toBeInTheDocument(),
    );
    expect(saveButton()).not.toHaveClass("ant-btn-primary");
  });

  it("保存失败时保留脏值与输入，不关闭制作台（P0-7）", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("network down");
    });
    const { onRequestClose } = renderColumn({ onSave });

    typeName("李四");
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // 输入不丢、脏值还在（否则用户会以为已经存上了）。
    expect(nameInput().value).toBe("李四");
    expect(await screen.findByText(t("workbench.status.unsaved"))).toBeInTheDocument();
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("重排中的状态条优先于「内容还没保存」", async () => {
    renderColumn({ relayouting: true });

    expect(await screen.findByText(t("workbench.status.relayouting"))).toBeInTheDocument();
  });
});

describe("中栏 · 放弃修改与关闭", () => {
  it("放弃修改：内联确认 → 「暂不保存」回填服务端内容，且**留在原地**", async () => {
    const { onRequestClose } = renderColumn();

    typeName("李四");
    fireEvent.click(screen.getByRole("button", { name: t("workbench.action.discard-edits") }));

    // 确认条是就地换态（不新开第二个弹层）。
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("common.action.discard") }));

    await waitFor(() => expect(nameInput().value).toBe(CONTENT.name));
    expect(screen.queryByText(t("workbench.status.unsaved"))).not.toBeInTheDocument();
    // 中栏的「放弃修改」不关闭制作台——那是「关闭」的出口。
    expect(onRequestClose).not.toHaveBeenCalled();
  });

  it("没有脏值时「放弃修改」不可点（避免一次什么都没发生的请求）", async () => {
    renderColumn();

    expect(
      screen.getByRole("button", { name: t("workbench.action.discard-edits") }),
    ).toBeDisabled();
  });

  it("外部请求关闭（有脏值）：亮出内联确认，「暂不保存」才回调宿主关闭", async () => {
    const { rerender, onRequestClose } = renderColumn();

    typeName("李四");
    expect(await screen.findByText(t("workbench.status.unsaved"))).toBeInTheDocument();

    // 弹窗那侧把"想关"变成一个自增的计数（只有一个 onCancel 入口）。
    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={CONTENT}
          resumeId={42}
          onSave={vi.fn(async () => undefined)}
          onRequestClose={onRequestClose}
          closeSignal={1}
        />
      </AntdApp>,
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    // 先确认、再关：没有确认就关掉等于静默丢稿。
    expect(onRequestClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("common.action.discard") }));
    await waitFor(() => expect(onRequestClose).toHaveBeenCalledTimes(1));
  });

  it("外部请求关闭时点「继续编辑」：确认条收起、内容保留", async () => {
    const { rerender, onRequestClose } = renderColumn();

    typeName("李四");
    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={CONTENT}
          resumeId={42}
          onSave={vi.fn(async () => undefined)}
          onRequestClose={onRequestClose}
          closeSignal={1}
        />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: t("common.action.keep-editing") }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(nameInput().value).toBe("李四");
    expect(onRequestClose).not.toHaveBeenCalled();
  });
});

describe("中栏 · 点纸面字段定位（草稿模式编辑）", () => {
  /** 当前可见的那张面板（antd 的 tabpanel id 带栏目 key）。 */
  function panelId(): string {
    return screen.getByRole("tabpanel").id;
  }

  function rerenderWith(pickTarget: { path: string; nonce: number } | null) {
    return renderColumn({ pickTarget });
  }

  it("收到 pickTarget：切到目标标签页（不是只在原地滚一下）", async () => {
    rerenderWith({ path: "education.0.school", nonce: 1 });

    await waitFor(() => expect(panelId()).toContain("education"));
  });

  it("把焦点放到该路径对应的输入框（`name` 走基本信息那一栏）", async () => {
    rerenderWith({ path: "name", nonce: 1 });

    await waitFor(() => expect(nameInput()).toHaveFocus());
    expect(panelId()).toContain("basic");
  });

  it("同一条路径连点两次（只有 nonce 变）也会重新定位", async () => {
    const { rerender } = renderColumn();
    const props = {
      active: true,
      content: CONTENT,
      resumeId: 42,
      onSave: vi.fn(async () => undefined),
      onRequestClose: vi.fn(),
      closeSignal: 0,
    } as const;

    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          {...props}
          pickTarget={{ path: "projects.0.name", nonce: 1 }}
        />
      </AntdApp>,
    );
    await waitFor(() => expect(panelId()).toContain("projects"));

    // 回到基本信息，再点同一条路径：只比路径的话这次点击会被"值没变"吞掉。
    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn {...props} pickTarget={{ path: "name", nonce: 2 }} />
      </AntdApp>,
    );
    await waitFor(() => expect(panelId()).toContain("basic"));

    // 先把焦点移走再点第二次：不移走的话"重新定位了"与"根本没重跑"在 DOM 上长得一模一样
    // （焦点本来就在 `name` 上），断言会退化成同义反复。
    nameInput().blur();
    expect(nameInput()).not.toHaveFocus();

    rerender(
      <AntdApp>
        <ResumeWorkbenchEditorColumn {...props} pickTarget={{ path: "name", nonce: 3 }} />
      </AntdApp>,
    );
    // nonce 变了 → 重新定位（这里用"焦点回到 `name`"表达，jsdom 里 `scrollToField` 是空转）。
    await waitFor(() => expect(nameInput()).toHaveFocus());
  });

  it("不传 pickTarget 时不改变栏目（既有行为）", () => {
    renderColumn();

    expect(panelId()).toContain("basic");
  });
});

describe("中栏 · 栏目条与溢出三角下拉（需求 4）", () => {
  /**
   * 测量打桩：jsdom 没有布局引擎，`clientWidth` / `offsetWidth` / `offsetLeft` 恒为 0，
   * 组件于是永远走"没有溢出"那条分支。要测到溢出，只能把三个量注入进来。
   *
   * 用 `Object.defineProperty` 而不是 `vi.spyOn`：`clientWidth` 是 `Element.prototype` 上的
   * 取值器、`offsetWidth` / `offsetLeft` 在 `HTMLElement.prototype` 上，`spyOn` 对"不在
   * 自身上的访问器"没有稳定的还原语义。这里记下原描述符，用例结束原样放回。
   */
  function stubLayout(trackWidth: number, tabWidth: number): () => void {
    const overrides: [object, string, PropertyDescriptor][] = [
      [
        Element.prototype,
        "clientWidth",
        {
          configurable: true,
          get(this: Element) {
            return this.classList.contains("resume-wb-tabstrip-track") ? trackWidth : 0;
          },
        },
      ],
      [
        HTMLElement.prototype,
        "offsetWidth",
        {
          configurable: true,
          get(this: HTMLElement) {
            return this.getAttribute("role") === "tab" ? tabWidth : 0;
          },
        },
      ],
      [
        HTMLElement.prototype,
        "offsetLeft",
        {
          configurable: true,
          get(this: HTMLElement) {
            if (this.getAttribute("role") !== "tab") return 0;
            // 同一轨道内按下标递增：只数自己条上的标签，antd 那套（已隐藏的）nav 不参与。
            const track = this.closest(".resume-wb-tabstrip-track");
            if (!track) return 0;
            const siblings = Array.from(track.querySelectorAll<HTMLElement>('[role="tab"]'));
            return siblings.indexOf(this) * tabWidth;
          },
        },
      ],
    ];

    const saved = overrides.map(
      ([target, name]) => [target, name, Object.getOwnPropertyDescriptor(target, name)] as const,
    );
    for (const [target, name, descriptor] of overrides) {
      Object.defineProperty(target, name, descriptor);
    }
    return () => {
      for (const [target, name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete (target as Record<string, unknown>)[name];
      }
    };
  }

  /** 自绘栏目条本身（用类名定位：antd 也有一份 `role="tablist"`，role 查询会撞上）。 */
  function strip(): HTMLElement {
    const node = document.querySelector<HTMLElement>(".resume-wb-tabstrip");
    expect(node).not.toBeNull();
    return node as HTMLElement;
  }

  /** 三角下拉按钮：纯图标，可访问名只有 `aria-label`。 */
  function moreButton(): HTMLElement | null {
    return screen.queryByRole("button", { name: t("workbench.tabs.more") });
  }

  it("栏目宽度足够时不显示三角下拉按钮，全部栏目露出", () => {
    renderColumn();

    expect(strip()).toHaveAttribute("role", "tablist");
    // 宽度量不到（= 没有溢出）时不该有这颗按钮：它只会点开一个空菜单。
    expect(moreButton()).toBeNull();

    const labels = within(strip())
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual([
      t("editor.tab.basic"),
      t("editor.tab.education"),
      t("editor.tab.experience"),
      t("editor.tab.campus"),
      t("editor.tab.projects"),
      t("editor.tab.skills"),
      // 2026-10：语言能力独立成栏（不再并入技能），栏目条多一个。
      t("editor.section.languages"),
      t("editor.tab.awards"),
      // W14 科研三页签（researchTabItems 装配）。
      rt("research.tab.publications"),
      rt("research.tab.projects"),
      rt("research.tab.patents"),
      // F2-C/F4-FE：证书资质成为可编辑栏目（CredentialsEditor），栏目条按全局顺序多一个。
      t("editor.tab.credentials"),
    ]);
    // 「写作增强」已搬到右键菜单（2026-10-24），不再是中栏的一个页签。
    expect(labels).not.toContain(t("editor.tab.writing"));
  });

  it("点某个栏目会切换内容面板", async () => {
    renderColumn();

    fireEvent.click(within(strip()).getByRole("tab", { name: t("editor.tab.education") }));

    // 真的切过去了：唯一可见的那张面板就是教育那一栏（面板 id 带栏目 key）。
    await waitFor(() => {
      expect(screen.getByRole("tabpanel").id).toContain("education");
    });
  });

  it("三角下拉只列没有显示出来的栏目（不是全部 11 个）", async () => {
    // 轨道 200px、每栏 60px、按钮预留 28px → 边界 172px：只有前两栏完整放得下。
    const restore = stubLayout(200, 60);
    try {
      renderColumn();

      const trigger = await screen.findByRole("button", { name: t("workbench.tabs.more") });
      fireEvent.click(trigger);

      const menuItems = await screen.findAllByRole("menuitem");
      // 只列没显示出来的：少于全部 11 个（2026-10 语言能力独立成栏后多一个），且不含第一个栏目。
      expect(menuItems.length).toBeLessThan(11);
      expect(menuItems.length).toBeGreaterThan(0);
      expect(menuItems.map((item) => item.textContent)).not.toContain(t("editor.tab.basic"));

      // 下拉里点一个也要真的切过去（走同一个 `onSelect`）。
      fireEvent.click(screen.getByRole("menuitem", { name: t("editor.tab.projects") }));
      await waitFor(() => {
        expect(screen.getByRole("tabpanel").id).toContain("projects");
      });
    } finally {
      restore();
    }
  });
});

describe("中栏 · 从我的资料追加一条", () => {
  const SOURCES: ProfileFillSources = {
    education: [],
    experience: [],
    campusExperience: [],
    projects: [],
    skills: [],
    awards: [],
    summary: "Backend engineer, five years.",
  };

  /** 资料里个人总结的「填入」按钮：图标类名定位（该按钮文案是存量硬编码，测试不许再添中文）。 */
  function fillSummaryButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>(".anticon-import")?.closest("button") ?? null;
  }

  it("传了 fillSources，中栏里就有「从我的资料填入」并真的写进表单", async () => {
    renderColumn({ fillSources: SOURCES });

    const button = fillSummaryButton();
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);

    const summary = document.getElementById("summary") as HTMLTextAreaElement;
    expect(summary.value).toBe(SOURCES.summary);
    // 填入的是"没保存的修改"：脏值必须亮出来（与弹窗同一套语义）。
    expect(await screen.findByText(t("workbench.status.unsaved"))).toBeInTheDocument();
  });

  it("没有候选（资料没取到）时这条入口完全不渲染，中栏照常可用", () => {
    renderColumn({ fillSources: null });

    expect(fillSummaryButton()).toBeNull();
    expect(nameInput()).not.toBeNull();
  });

  it("fillSources 带当前组参与清单时，中栏页签按同一规则过滤", () => {
    // 当前组只有基本信息 + 技能：实习/项目等空分区不该再占一栏（与弹窗同一条规则）。
    renderColumn({
      fillSources: {
        ...SOURCES,
        participatingKeys: ["basic_info", "skills"],
      },
    });

    // 自绘栏目条本身（antd 的隐藏导航里也有一份 role=tab，按 role 全局查会撞上）。
    const strip = document.querySelector<HTMLElement>(".resume-wb-tabstrip");
    expect(strip).not.toBeNull();
    const labels = within(strip as HTMLElement)
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual([t("editor.tab.basic"), t("editor.tab.skills")]);
  });
});
