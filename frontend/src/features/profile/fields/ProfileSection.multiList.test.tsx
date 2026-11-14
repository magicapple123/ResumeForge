// SPDX-License-Identifier: Apache-2.0
/**
 * 「多列表共存」一组单独守着另一个真实缺陷：资料页同时挂载 6 个分区列表，而每行的
 * `data-profile-list-item-index` 在各列表之间是重复的，几何采集一旦跨列表查询，
 * 同号下标就会互相顶替、gap 被算成几百像素——用户实测的"条目乱跳、拖不到位"。
 *
 * Split out of ProfileSection.test.tsx (line budget); cases and assertions moved verbatim.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form, Input } from "antd";
import type { FormInstance, FormListFieldData, FormListOperation } from "antd";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileSection from "./ProfileSection";

let formRef: FormInstance | null = null;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  formRef = null;
  vi.restoreAllMocks();
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
