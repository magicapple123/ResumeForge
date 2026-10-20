// SPDX-License-Identifier: Apache-2.0
/**
 * 条目拖拽的**边缘换位**：用户反馈「拖到相邻卡片中间就换位、太敏感」的现场回归。
 *
 * 语义（见 `dragReorder.resolveItemEdgeTargetIndex`）：
 * - 下移：指针**接近**下一张卡片的底边（提前 24px）就换一位；
 * - 上移：指针**接近**上一张卡片的顶边（提前 24px）就换一位；
 * - 指针停在邻卡内部（哪怕停在中间、或已经进去半个卡片）都不换。
 *
 * 旧实现是「指针行程制」（每 48px 推进一格，与指针落在卡片里的位置无关），矮条目上
 * 48px 只等于半个邻卡 → 用户的手感是「刚碰到邻卡就翻」。本文件用真实指针事件序列
 * 驱动 ProfileSection（含 useProfileItemListDrag），断言 Form.List 的取值顺序。
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Form, Input } from "antd";
import type { FormInstance } from "antd";
import type { FormListFieldData, FormListOperation } from "antd/es/form/FormList";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProfileSection from "./ProfileSection";

/** 三条 60 高的条目、gap 10、栈顶 100：上缘 100/170/240，下缘 160/230/300。 */
const ITEM_HEIGHT = 60;
const ITEM_GAP = 10;
const LIST_TOP = 100;

const TOP_0 = LIST_TOP; // 100
const TOP_1 = LIST_TOP + ITEM_HEIGHT + ITEM_GAP; // 170
const TOP_2 = LIST_TOP + 2 * (ITEM_HEIGHT + ITEM_GAP); // 240
const BOTTOM_2 = TOP_2 + ITEM_HEIGHT; // 300
/** 与 dragReorder.ITEM_EDGE_TRIGGER_PX 对齐：接近边缘 24px 就换位。 */
const EDGE_TRIGGER = 24;

/** 条目几何桩：第 i 条固定在 LIST_TOP + i*(HEIGHT+GAP)（按 data 下标，与顺序无关）。 */
function stubItemRects(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const raw = (this as HTMLElement).dataset?.profileListItemIndex;
    const index = raw === undefined ? -1 : Number(raw);
    const top = index >= 0 && index < 3 ? LIST_TOP + index * (ITEM_HEIGHT + ITEM_GAP) : 0;
    const height = index >= 0 && index < 3 ? ITEM_HEIGHT : 0;
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

function Harness() {
  const [form] = Form.useForm();
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
        editable
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

/** 按下某个条目的把手（`fromY` 为指针落点）。 */
function pressHandle(label: string, fromY: number): void {
  fireEvent.pointerDown(screen.getByLabelText(`拖动调整${label}顺序`), {
    clientX: 10,
    clientY: fromY,
    pointerId: 1,
  });
}

/** 拖动中的一次指针移动（真实事件序列，逐帧推进）。 */
function moveTo(toY: number): void {
  fireEvent.pointerMove(document, { clientX: 10, clientY: toY, pointerId: 1 });
}

/** 被拖条目的 transform（无拖拽时返回 null）。 */
function draggedTransform(): string | null {
  const item = document.querySelector<HTMLElement>(".profile-list-item.is-dragging");
  return item ? item.style.transform : null;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  formRef = null;
  vi.restoreAllMocks();
});

describe("条目拖拽：接近邻卡边缘就换位", () => {
  it("指针停在下一张卡片中间不换位，接近下一张的底边（24px）就换一位", () => {
    stubItemRects();
    render(<Harness />);

    // 按住第 2 条（B，170-230）的中心 200 → grabOffset = 30。
    pressHandle("B 公司", 200);
    // 越过 6px 激活阈值：指针 260 落在第 3 条（C，240-300）的内部。
    moveTo(260);
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
    // 跟手但未换位：desiredTop = 260-30 = 230，布局上缘仍是 170 → translateY(60px)。
    expect(draggedTransform()).toBe("translateY(60px)");

    // 继续深入 C 的中间偏下（旧行程制在 48px 处就已翻位）→ 仍不换。
    moveTo(BOTTOM_2 - EDGE_TRIGGER - 1); // 275：还差 1px 才进入预判带
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);

    // 进入「接近底边」的 24px 预判带（276）→ 换到第 3 位。
    moveTo(BOTTOM_2 - EDGE_TRIGGER);
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    // 换位后 B 在末位，布局上缘 240；desiredTop 被钳到 240（栈底允许的最大上缘）→ 0。
    expect(draggedTransform()).toBe("translateY(0px)");

    // 松手：顺序保留、抬起态与 transform 清理干净。
    fireEvent.pointerUp(document, {
      clientX: 10,
      clientY: BOTTOM_2 - EDGE_TRIGGER,
      pointerId: 1,
    });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    expect(document.querySelector(".profile-list-item.is-dragging")).toBeNull();
  });

  it("反向：指针接近上一张卡片的顶边（24px）就换回原位", () => {
    stubItemRects();
    render(<Harness />);

    // 先把 B 拖到末位（进入 C 的底边预判带），顺序变成 A、C、B。
    pressHandle("B 公司", 200);
    moveTo(BOTTOM_2 - EDGE_TRIGGER);
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    moveTo(BOTTOM_2 + 20); // 继续往下：末位没有下一张卡片，不换。
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);

    // 回拖：B 现在在末位（240-300），C 在中间（170-230）。指针一路向上。
    moveTo(TOP_2); // 240：还在 C 的下方（C 下缘 230）→ 不换。
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    moveTo(TOP_1 + EDGE_TRIGGER + 1); // 195：还差 1px 才进入 C 顶边的预判带 → 不换。
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    // 进入 C 顶边的 24px 预判带（194）→ 换回第 2 位。
    moveTo(TOP_1 + EDGE_TRIGGER);
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);

    // 继续向上：上一张是 A（100-160），顶边 100，预判带 100..124。
    moveTo(TOP_0 + EDGE_TRIGGER + 1); // 125：还没进入 A 的预判带，不换。
    expect(currentCompanies()).toEqual(["A 公司", "B 公司", "C 公司"]);
    moveTo(TOP_0 + EDGE_TRIGGER); // 124：接近 A 的顶边 → 换到首位。
    expect(currentCompanies()).toEqual(["B 公司", "A 公司", "C 公司"]);

    fireEvent.pointerUp(document, {
      clientX: 10,
      clientY: TOP_0 + EDGE_TRIGGER,
      pointerId: 1,
    });
    expect(currentCompanies()).toEqual(["B 公司", "A 公司", "C 公司"]);
  });

  it("指针压在预判带内反复微抖（< 6px 闩锁）不会来回换位", () => {
    stubItemRects();
    render(<Harness />);

    pressHandle("B 公司", 200);
    moveTo(BOTTOM_2 - EDGE_TRIGGER); // 进入 C 底边的预判带 → 换到末位
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);

    // 在预判带线上下 ±2px 抖动：边缘判定本身已有「一整张卡片」的滞回，加上 6px 闩锁，
    // 顺序必须完全冻结（旧实现的现场是邻卡来回弹跳）。
    for (const y of [
      BOTTOM_2 - EDGE_TRIGGER + 2,
      BOTTOM_2 - EDGE_TRIGGER - 2,
      BOTTOM_2 - EDGE_TRIGGER + 1,
      BOTTOM_2 - EDGE_TRIGGER - 1,
    ]) {
      moveTo(y);
    }
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);

    fireEvent.pointerUp(document, {
      clientX: 10,
      clientY: BOTTOM_2 - EDGE_TRIGGER,
      pointerId: 1,
    });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
  });

  it("一次甩到父卡片底部：直接推进到末位（跨过多张时不会停在中间）", () => {
    stubItemRects();
    render(<Harness />);

    pressHandle("B 公司", 200);
    // 一次指针事件直接甩到父卡片底部之外：指针越过了 C 的底边预判带 → 直接到末位。
    act(() => {
      moveTo(5000);
    });
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);
    // 后续指针事件（指针已在末位外）不再推进：末位没有下一张卡片。
    moveTo(5005);
    expect(currentCompanies()).toEqual(["A 公司", "C 公司", "B 公司"]);

    fireEvent.pointerUp(document, { clientX: 10, clientY: 5005, pointerId: 1 });
  });
});
