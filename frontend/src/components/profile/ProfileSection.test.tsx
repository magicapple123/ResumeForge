// SPDX-License-Identifier: Apache-2.0
/**
 * 资料分区里的小条目（多条记录）拖拽排序：用户实测"小条目拖不动"的回归守卫。
 *
 * 旧实现在 pointerdown 时立即把全部条目折叠成摘要条，布局塌缩后 elementFromPoint
 * 命中错误条目或空白，松手时 Form.List move 用错索引甚至不触发。新实现按下不改
 * 布局、越过阈值后用缓存的邻卡边缘（下一张的底边 / 上一张的顶边）算目标位、
 * 零 elementFromPoint；这里全部用 jsdom
 * 桩出条目几何后做真实的指针事件序列，断言 Form.List 的值顺序。
 *
 * 「多列表共存」一组单独守着另一个真实缺陷：资料页同时挂载 6 个分区列表，而每行的
 * `data-profile-list-item-index` 在各列表之间是重复的，几何采集一旦跨列表查询，
 * 同号下标就会互相顶替、gap 被算成几百像素——用户实测的"条目乱跳、拖不到位"。
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form, Input } from "antd";
import type { FormInstance, FormListFieldData, FormListOperation } from "antd";

import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileSection from "./ProfileSection";

const ITEM_HEIGHT = 60;
const ITEM_GAP = 10;
const LIST_TOP = 100;

/** 条目几何桩：第 i 条固定在 LIST_TOP + i*(HEIGHT+GAP)，其余元素零矩形。 */
function stubItemRects(
  itemCount: number,
  layout: { top?: number; height?: number; gap?: number } = {},
) {
  const top0 = layout.top ?? LIST_TOP;
  const height0 = layout.height ?? ITEM_HEIGHT;
  const gap0 = layout.gap ?? ITEM_GAP;
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const raw = (this as HTMLElement).dataset?.profileListItemIndex;
    const index = raw === undefined ? -1 : Number(raw);
    const top = index >= 0 && index < itemCount ? top0 + index * (height0 + gap0) : 0;
    const height = index >= 0 && index < itemCount ? height0 : 0;
    return {
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

let formRef: FormInstance | null = null;

function Harness({ editing = true }: { editing?: boolean }) {
  const [form] = Form.useForm();
  // 把表单实例交给断言辅助（currentCompanies）：在 effect 里赋值，渲染期保持纯净。
  useEffect(() => {
    formRef = form;
  }, [form]);
  const renderRow = (field: FormListFieldData, remove: FormListOperation["remove"]) => (
    <div className="profile-list-item-content-inner">
      <Form.Item name={[field.name, "company"]} noStyle>
        <Input aria-label={`公司-${field.name}`} />
      </Form.Item>
      <button type="button" onClick={() => remove(field.name)}>
        删除-{field.name}
      </button>
    </div>
  );
  return (
    <Form
      form={form}
      initialValues={{
        experiences: [{ company: "A 公司" }, { company: "B 公司" }, { company: "C 公司" }],
      }}
    >
      <ProfileSection
        fieldName="experiences"
        editable={editing}
        emptyValue={{ company: "" }}
        renderRow={renderRow}
        itemLabel={(item, index) => String(item.company ?? `第 ${index + 1} 项`)}
      />
    </Form>
  );
}

/** 当前表单里 experiences 的公司顺序。 */
function currentCompanies(): string[] {
  const values = formRef?.getFieldValue("experiences") as Array<{ company: string }> | undefined;
  return (values ?? []).map((item) => item.company);
}

function dragHandle(itemLabel: string, fromY: number, toY: number) {
  fireEvent.pointerDown(screen.getByLabelText(`拖动调整${itemLabel}顺序`), {
    clientX: 10,
    clientY: fromY,
    pointerId: 1,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: toY, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  formRef = null;
  vi.restoreAllMocks();
});

describe("ProfileSection 小条目拖拽排序", () => {
  it("按下不改布局：条目保持展开、「添加一条」仍在、顺序不变", () => {
    stubItemRects(3);
    render(<Harness />);

    fireEvent.pointerDown(screen.getByLabelText("拖动调整B 公司顺序"), {
      clientX: 10,
      clientY: LIST_TOP + ITEM_HEIGHT + ITEM_GAP / 2,
      pointerId: 1,
    });
    // 旧实现按下即把条目折叠成摘要条（塌缩是排序失效的根因）；新实现布局不动。
    expect(document.querySelector(".profile-list-item-summary")).toBeNull();
    expect(screen.getByRole("button", { name: /添加一条/ })).toBeInTheDocument();
    expect(screen.getByLabelText("公司-0")).toBeInTheDocument();
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
  });

  it("越过阈值拖动：条目不折叠，实时重排且表单值顺序跟着变", () => {
    stubItemRects(3);
    render(<Harness />);

    // 第 2 条（B，170-230）拖到 y=300 —— 边缘判定要**下一张卡片（C，240-300）的底边**：
    // 指针停在 C 的中间（270）不换，压到 C 的下缘（300）才换到第 3 位。
    dragHandle("B 公司", 200, 300);

    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    // 被拖条目保持完整展开（内容不塌缩），并有抬起视觉。
    const dragged = document.querySelector<HTMLElement>(
      '.profile-list-item.is-dragging [aria-label^="公司-"]',
    );
    expect(dragged).not.toBeNull();
    expect(dragged).toHaveValue("B 公司");
    // 跟手：grabOffset = 200-170 = 30 → desiredTop = 300-30 = 270，被钳到栈底允许的
    // 240（3×60 + 2×10 = 200 的栈高）；重排后 B 在第 3 位，布局上缘 240 →
    // transform = 240-240 = 0（视觉位置已贴栈底，钳住不再跟手）。
    const draggedItem = dragged?.closest<HTMLElement>(".profile-list-item");
    expect(draggedItem?.style.transform).toBe("translateY(0px)");

    // 松手：顺序保留，抬起态清理干净。
    fireEvent.pointerUp(document, { clientX: 10, clientY: 300, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    expect(document.querySelector(".profile-list-item.is-dragging")).toBeNull();
    expect(draggedItem?.style.transform).toBe("");
  });

  it("未越过阈值（6px 内）不触发移动", () => {
    stubItemRects(3);
    render(<Harness />);

    dragHandle("B 公司", 200, 204);
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
  });

  it("交换帧一致：move 返回时 DOM 顺序与被拖条目 transform 同步落定（flushSync 契约）", () => {
    stubItemRects(3);
    render(<Harness />);

    fireEvent.pointerDown(screen.getByLabelText("拖动调整B 公司顺序"), {
      clientX: 10,
      clientY: LIST_TOP + ITEM_HEIGHT + ITEM_GAP / 2,
      pointerId: 1,
    });

    // 用原生 dispatchEvent 而不是 fireEvent：fireEvent 结束时会兜底 flush React
    // 更新，错帧窗口就被掩盖了。这里在「分派同步返回后、React 兜底提交之前」的
    // 窗口内断言——修复前 DOM 还是旧序而 transform 已是新布局值，本用例必挂；
    // 修复后（flushSync 包住 onMove）DOM 提交与 transform 同帧生效。
    act(() => {
      document.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 300 }),
      );

      // 按值识别条目（值稳定；aria-label 里的下标会随 move 变化）。
      const items = Array.from(document.querySelectorAll<HTMLElement>(".profile-list-item"));
      const values = items.map((item) => item.querySelector<HTMLInputElement>("input")?.value);
      // DOM 顺序已经是新序：A、C、B（B 在末位）。
      expect(values).toEqual(["A 公司", "C 公司", "B 公司"]);

      // 被拖条目挂着抬起类、在 DOM 末位，transform 是新布局下的跟手值：
      // 指针 300 恰好压在「下一张卡片的底边」→ 换到末位；desiredTop 钳到 240，
      // B 在第 3 位布局上缘 240 → translateY(0px)。
      const dragged = document.querySelector<HTMLElement>(".profile-list-item.is-dragging");
      expect(dragged).not.toBeNull();
      expect(dragged?.querySelector<HTMLInputElement>("input")?.value).toBe("B 公司");
      expect(dragged?.style.transform).toBe("translateY(0px)");
      expect(items.indexOf(dragged as HTMLElement)).toBe(2);
    });

    fireEvent.pointerUp(document, { clientX: 10, clientY: 300, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
  });

  it("pointercancel 复位：抬起态清理，顺序不再变化", () => {
    stubItemRects(3);
    render(<Harness />);

    dragHandle("B 公司", 200, 300);
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);

    fireEvent.pointerCancel(document, { clientX: 10, clientY: 300, pointerId: 1 });
    expect(document.querySelector(".profile-list-item.is-dragging")).toBeNull();
    // 取消后指针再动：没有激活的拖拽，顺序冻结。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 130, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
  });

  it("键盘排序（ArrowUp/ArrowDown）保持可用，删除按钮不受拖拽影响", () => {
    stubItemRects(3);
    render(<Harness />);

    const handle = screen.getByLabelText("拖动调整B 公司顺序");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(currentCompanies()).toEqual(["B 公司", "A 公司", "C 公司"]);

    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);

    // 与拖拽无关的按键不移动条目。
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
  });

  it("非编辑态：没有拖拽把手，列表锁定", () => {
    stubItemRects(3);
    render(<Harness editing={false} />);

    expect(screen.queryByLabelText("拖动调整B 公司顺序")).toBeNull();
    expect(screen.getByRole("button", { name: /添加一条/ })).toBeDisabled();
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
  });
});

describe("多列表共存（资料页同时挂载 6 个分区列表）", () => {
  // 两个列表刻意做成**高度与间距都不同**：几何查询一旦跨列表，heights/gap/stackTop
  // 必然错位（等高同距的两个列表会让插入位凑巧算对，把回归掩盖过去）。
  const LIST_LAYOUTS = [
    { top: 100, height: 60, gap: 10 }, // experiences：100/170/240/310，中心 130/200/270/340
    { top: 520, height: 90, gap: 20 }, // projects：520/630/740/850/960/1070，中心 565/675/…
  ] as const;
  const EXPERIENCES = ["实习A", "实习B", "实习C", "实习D"];
  const PROJECTS = ["项目A", "项目B", "项目C", "项目D", "项目E", "项目F"];

  function zeroRect(): DOMRect {
    return {
      top: 0,
      bottom: 0,
      height: 0,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }

  /**
   * 按**所属列表容器**取独立几何：两个列表在屏幕上隔得很远（真实页面里 6 个分区
   * 列表之间还夹着别的表单），一旦几何查询跨列表，gap 会被算成几百像素、同号下标
   * 互相顶替——这正是"条目乱跳、拖不到位"的现场。
   */
  function stubPerListRects() {
    return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const element = this as HTMLElement;
      const raw = element.dataset?.profileListItemIndex;
      if (raw === undefined) return zeroRect();
      const list = element.closest(".profile-list-items");
      const listIndex = list
        ? Array.from(document.querySelectorAll(".profile-list-items")).indexOf(list)
        : -1;
      const layout = listIndex === 0 ? LIST_LAYOUTS[0] : listIndex === 1 ? LIST_LAYOUTS[1] : null;
      if (!layout) return zeroRect();
      const top = layout.top + Number(raw) * (layout.height + layout.gap);
      return {
        top,
        bottom: top + layout.height,
        height: layout.height,
        left: 0,
        right: 300,
        width: 300,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect;
    });
  }

  /** 同一个 Form 里挂两个 ProfileSection（不同 fieldName，条数也不同）。 */
  function TwoListHarness() {
    const [form] = Form.useForm();
    useEffect(() => {
      formRef = form;
    }, [form]);
    // 行内控件带 fieldName 前缀，断言时才能区分"哪一行是哪一行的同号条目"。
    const renderRowFor =
      (listName: string) => (field: FormListFieldData, remove: FormListOperation["remove"]) => (
        <div className="profile-list-item-content-inner">
          <Form.Item name={[field.name, "company"]} noStyle>
            <Input aria-label={`${listName}-${field.name}`} />
          </Form.Item>
          <button type="button" onClick={() => remove(field.name)}>
            删除-{listName}-{field.name}
          </button>
        </div>
      );
    const labelFor = (fallbackPrefix: string) => (item: Record<string, unknown>, index: number) =>
      String(item.company ?? `${fallbackPrefix} ${index + 1} 项`);
    return (
      <Form
        form={form}
        initialValues={{
          experiences: EXPERIENCES.map((company) => ({ company })),
          projects: PROJECTS.map((company) => ({ company })),
        }}
      >
        <ProfileSection
          fieldName="experiences"
          emptyValue={{ company: "" }}
          renderRow={renderRowFor("experiences")}
          itemLabel={labelFor("实习")}
        />
        <ProfileSection
          fieldName="projects"
          emptyValue={{ company: "" }}
          renderRow={renderRowFor("projects")}
          itemLabel={labelFor("项目")}
        />
      </Form>
    );
  }

  /** 某个列表字段当前的条目顺序（按 company 值）。 */
  function fieldValues(fieldName: string): string[] {
    const values = formRef?.getFieldValue(fieldName) as Array<{ company: string }> | undefined;
    return (values ?? []).map((item) => item.company);
  }

  it("拖第二个列表的条目：只有该列表顺序变化，抬起态落在正确的条目上", () => {
    stubPerListRects();
    const { container } = render(<TwoListHarness />);
    const lists = container.querySelectorAll(".profile-list-items");
    expect(lists).toHaveLength(2);

    // 第二个列表条目 top = 520/630/740/850/960/1070（高 90、gap 20）；
    // 项目B 在 630-720，按在中心 675；下一张（项目C，740-830）的底边 = 830，
    // 指针拖到 830 才换到第 3 位（停在 C 的中间 785 不换）。
    fireEvent.pointerDown(screen.getByLabelText("拖动调整项目B顺序"), {
      clientX: 10,
      clientY: 675,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 830, pointerId: 1 });

    expect(fieldValues("projects")).toEqual(["项目A", "项目C", "项目B", "项目D", "项目E", "项目F"]);
    // 第一个列表必须完全不受影响（全局查询下这里会被同号下标带乱）。
    expect(fieldValues("experiences")).toEqual(EXPERIENCES);

    const draggingItems = document.querySelectorAll<HTMLElement>(".profile-list-item.is-dragging");
    expect(draggingItems).toHaveLength(1);
    expect(draggingItems[0]?.closest(".profile-list-items")).toBe(lists[1]);
    expect(
      draggingItems[0]?.querySelector<HTMLInputElement>('[aria-label^="projects-"]')?.value,
    ).toBe("项目B");
    // 跟手 transform：desiredTop = 830-45 = 785，第 3 位布局上缘 740 → 785-740 = 45。
    expect(draggingItems[0]?.style.transform).toBe("translateY(45px)");

    // 第一个列表的条目一根手指都没碰过。
    lists[0]?.querySelectorAll<HTMLElement>(".profile-list-item").forEach((item) => {
      expect(item.style.transform).toBe("");
      expect(item.classList.contains("is-dragging")).toBe(false);
    });
  });

  it("拖第一个列表的条目：第二个列表完全不受影响，松手清理干净", () => {
    stubPerListRects();
    const { container } = render(<TwoListHarness />);
    const lists = container.querySelectorAll(".profile-list-items");
    expect(lists).toHaveLength(2);

    // 第一个列表条目 top = 100/170/240/310（高 60、gap 10）；实习B 在 170-230，
    // 下一张（实习C，240-300）的底边 = 300，指针拖到 300 才换到第 3 位（中间 270 不换）。
    // （第二个列表高 90、gap 20：几何查询一旦跨列表，heights 全是 90、边缘会被算到
    //   别的坐标上，本条立刻失败——这是对"改回全局查询"的变异守卫。）
    fireEvent.pointerDown(screen.getByLabelText("拖动调整实习B顺序"), {
      clientX: 10,
      clientY: 200,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 300, pointerId: 1 });

    expect(fieldValues("experiences")).toEqual(["实习A", "实习C", "实习B", "实习D"]);
    expect(fieldValues("projects")).toEqual(PROJECTS);

    const draggingItems = document.querySelectorAll<HTMLElement>(".profile-list-item.is-dragging");
    expect(draggingItems).toHaveLength(1);
    expect(draggingItems[0]?.closest(".profile-list-items")).toBe(lists[0]);
    expect(
      draggingItems[0]?.querySelector<HTMLInputElement>('[aria-label^="experiences-"]')?.value,
    ).toBe("实习B");
    // 跟手 transform：desiredTop = 300-30 = 270，第 3 位布局上缘 240 → 270-240 = 30。
    expect(draggingItems[0]?.style.transform).toBe("translateY(30px)");

    lists[1]?.querySelectorAll<HTMLElement>(".profile-list-item").forEach((item) => {
      expect(item.style.transform).toBe("");
      expect(item.classList.contains("is-dragging")).toBe(false);
    });

    fireEvent.pointerUp(document, { clientX: 10, clientY: 300, pointerId: 1 });
    expect(document.querySelector(".profile-list-item.is-dragging")).toBeNull();
    expect(fieldValues("experiences")).toEqual(["实习A", "实习C", "实习B", "实习D"]);
  });
});

describe("条目边缘换位（真实数据回归：拖过一整张卡才换）", () => {
  // 真机实测的 projects 几何：3 条 379 高、gap 12、栈顶 68，栈底 = 68+3×379+2×12 = 1229。
  const TALL = { top: 68, height: 379, gap: 12 };

  it("指针在下一张卡片中间不换位，压到下一张的底边才换一位", () => {
    stubItemRects(3, TALL);
    render(<Harness />);

    // 条目上缘 68/459/850、下缘 447/838/1229。拖第 2 条（B，459-838），按在中心 649
    //（grabOffset = 190）。
    fireEvent.pointerDown(screen.getByLabelText("拖动调整B 公司顺序"), {
      clientX: 10,
      clientY: 649,
      pointerId: 1,
    });
    // 指针 838 还压在 B 自己的下缘上（下一张 C 的上缘 850 之下）→ 不换；旧行程制
    // （48px/槽）在这里早就翻了一位——这正是用户抱怨的「太敏感」。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 838, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
    // 指针进到 C 的中间（1040）也不换：判定只看边缘，不看指针在邻卡里走了多远。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 1040, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
    // 还差 1px 才进入「接近 C 底边」的 24px 预判带（1229-24=1205）→ 仍不换。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 1204, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
    // 进入预判带（1205）→ 换到末位，不必精确压到 1229。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 1205, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    fireEvent.pointerUp(document, { clientX: 10, clientY: 1205, pointerId: 1 });
    expect(document.querySelector(".profile-list-item.is-dragging")).toBeNull();
  });

  it("条目末位可达（真机行为）：拖到 clamp 上限即换到最后一位", () => {
    stubItemRects(3, TALL);
    render(<Harness />);

    // 按在第 2 条中心附近（459+190=649），先动 7px 激活，再拖到很远（clamp 上限）。
    fireEvent.pointerDown(screen.getByLabelText("拖动调整B 公司顺序"), {
      clientX: 10,
      clientY: 649,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 656, pointerId: 1 });
    // 激活瞬间顺序不变（656 仍在下一张卡片 850-1229 的上方，边缘未到）。
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
    fireEvent.pointerMove(document, { clientX: 10, clientY: 3000, pointerId: 1 });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);

    // 被拖条目与末条不再重叠：desiredTop 钳到 850，布局上缘也是 850 → transform 0。
    const draggedItem = document.querySelector<HTMLElement>(".profile-list-item.is-dragging");
    expect(draggedItem?.style.transform).toBe("translateY(0px)");
    expect(draggedItem?.querySelector<HTMLInputElement>('[aria-label^="公司-"]')?.value).toBe(
      "B 公司",
    );
    fireEvent.pointerUp(document, { clientX: 10, clientY: 3000, pointerId: 1 });
    expect(document.querySelector(".profile-list-item.is-dragging")).toBeNull();
  });
});
