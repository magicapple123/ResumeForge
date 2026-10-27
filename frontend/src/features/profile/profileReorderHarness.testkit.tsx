// SPDX-License-Identifier: Apache-2.0
/**
 * 分区拖拽重排用例的共享脚手架（行数预算拆分的产物）。
 *
 * 从 `useProfileSectionReorder.test.tsx` 抽出：用例按「拖拽行为」与「焦点收尾」
 * 拆成两个文件后，两边都需要同一套 jsdom 布局桩、Harness 组件与事件助手。
 * 文件后缀刻意是 `.testkit.tsx`（不含 `.test.`），不会被当成测试文件。
 *
 * **纯搬迁**：Harness、几何桩与助手逐字未改，用例与断言留在各自的测试文件里。
 *
 * 读屏标签（拖动 / 上移 / 下移 / 重置）在 i18n 迁移时改为 `t()`：取值仍是分区 key，
 * 中文渲染结果逐字未变，所以用例里按中文标签定位的写法保持原样。
 */
/* 测试专用脚手架：本文件既导出 Harness 组件（用例需要）也导出几何桩/助手；
   Fast Refresh 的"只导出组件"约束针对应用模块，对不被应用引用的 testkit 不适用。 */
/* eslint-disable react-refresh/only-export-components */

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { vi } from "vitest";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_LABELS,
} from "../../components/profile/ProfileSectionConfig";
import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";
import { resetScrollAnchoringStateForTests } from "../../components/profile/dragAutoScroll";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useProfileSectionReorder } from "./useProfileSectionReorder";
import { COMPACT_SECTION_HEIGHT_PX } from "./profileCompactDrag";

/** 每个分区的高度（jsdom 无布局，测试里用 getBoundingClientRect 桩出栈式布局）。
 *
 * summary 刻意给 140px：行程制下「一次激活内拖到 clamp 上限」的可用行程 =
 * stackBottom − 被拖项高 − 其静止槽位。projects（默认顺序 index 3）到末位需要 4 步 =
 * 4×48 = 192px 行程，stub 栈在 projects 之下必须留足这个余量——真实分区都在几百
 * 像素以上，该前提天然成立。 */
const HEIGHTS: Record<ProfileSectionKey, number> = {
  basic_info: 100,
  experiences: 80,
  projects: 60,
  skills: 40,
  educations: 30,
  awards: 20,
  campus_experiences: 20,
  summary: 140,
};
export const STACK_TOP = 200;
/** 拖动激活期紧凑条的高度（与 profile.css 的 `.is-compact` 一致，取自生产常量）。 */
export const COMPACT_HEIGHT_PX = COMPACT_SECTION_HEIGHT_PX;
/** 紧凑态的类名（生产实现由 ProfileSectionShell 挂，见 profile.css）。 */
export const COMPACT_CLASS = "is-compact";

/** 默认顺序下的分区栈几何（gap=0）：
 * basic 200-300、edu 300-330、exp 330-410、projects 410-470、skills 470-510、
 * campus 510-530、awards 530-550、summary 550-690。 */
export function currentOrder(): ProfileSectionKey[] {
  const raw = screen.getByTestId("section-stack").getAttribute("data-order") ?? "";
  return raw.split(",").filter(Boolean) as ProfileSectionKey[];
}

export function Harness({ editing = true }: { editing?: boolean }) {
  useLocale();
  const reorder = useProfileSectionReorder({ editing, saving: false, photoReading: false });
  // 与 ProfileSectionStack 相同的消费方式：顺序 + 拖拽态经外部 store 订阅。
  const { sectionOrder, reordering, draggingKey, compact } = useSyncExternalStore(
    reorder.sectionOrderStore.subscribe,
    reorder.sectionOrderStore.getSnapshot,
  );
  return (
    <div
      className={`profile-section-stack${reordering ? " is-section-reordering" : ""}`}
      data-order={sectionOrder.join(",")}
      data-testid="section-stack"
    >
      {/* 与生产实现一致：DOM 顺序固定为默认序，视觉顺序交给 CSS order；
          分区壳按 reordering 挂 is-section-reordering（强制真实布局）、
          按 compact 挂 is-compact（拖动激活期全部折叠成 52px 紧凑条）。 */}
      {DEFAULT_SECTION_ORDER.map((key) => (
        <div
          key={key}
          data-profile-section-key={key}
          className={`profile-section-sortable${reordering ? " is-section-reordering" : ""}${
            draggingKey === key ? " is-dragging" : ""
          }${compact ? ` ${COMPACT_CLASS}` : ""}`}
          style={{ order: sectionOrder.indexOf(key) }}
          // 与生产实现（ProfileSectionShell）一致：根节点是可编程聚焦的落点。
          tabIndex={-1}
        >
          <button
            type="button"
            className="profile-section-drag-handle"
            aria-label={t("featuresMisc.profileReorder.dragAria", { label: key })}
            onPointerDown={(event) => reorder.handleSectionPointerDown(event, key)}
          />
          <button
            type="button"
            aria-label={t("featuresMisc.profileReorder.moveUpAria", { label: key })}
            onClick={() => reorder.moveSectionByOffset(key, -1)}
          />
          <button
            type="button"
            aria-label={t("featuresMisc.profileReorder.moveDownAria", { label: key })}
            onClick={() => reorder.moveSectionByOffset(key, 1)}
          />
          <button
            type="button"
            aria-label={t("featuresMisc.profileReorder.resetAria", { label: key })}
            onClick={() => reorder.resetSectionReorder(DEFAULT_SECTION_ORDER)}
          />
          {/* 与生产实现一致：分区壳里有标题栏（紧凑条的可见内容就是它）。 */}
          <div className="profile-section-titlebar">{SECTION_LABELS[key]}</div>
        </div>
      ))}
    </div>
  );
}

/** 把分区高度桩成按 **视觉序（CSS order）** 从 STACK_TOP 起的垂直栈（gap=0）。
 * 真实浏览器里 flex 容器按 order 摆放分区；jsdom 没有布局，这里按各分区当前的
 * order 内联样式排序模拟——每次 rect 查询都现算，splice 更新 order 后立刻反映。
 *
 * `options.compactHeight`：模拟「拖动激活期全部分区折叠成紧凑条」的真实布局——
 * 带 `is-compact` 类（生产实现由 ProfileSectionShell 挂）的分区一律报这个高度。
 * 不传时保持展开高度表（既有用例的几何前提一字不改）。 */
export function stubSectionRects(options: { compactHeight?: number } = {}) {
  const { compactHeight } = options;
  /** 某个分区当前应报的高度：折叠态走固定高度，展开态走高度表。 */
  const heightOf = (node: Element): number => {
    const element = node as HTMLElement;
    if (compactHeight !== undefined && element.classList?.contains(COMPACT_CLASS)) {
      return compactHeight;
    }
    return HEIGHTS[(element.dataset?.profileSectionKey ?? "") as ProfileSectionKey] ?? 0;
  };
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const siblings = this.parentElement ? Array.from(this.parentElement.children) : [];
    const visualOrder = (sibling: Element) =>
      Number((sibling as HTMLElement).style?.order ?? "0") || 0;
    const visualSiblings = [...siblings].sort((a, b) => visualOrder(a) - visualOrder(b));
    let top = STACK_TOP;
    for (const sibling of visualSiblings) {
      if (sibling === this) break;
      top += heightOf(sibling);
    }
    const height = heightOf(this);
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

/** pointerdown → 一步越过阈值（激活 + 重排 + 写 transform 全在同一个事件里同步完成）。 */
export function dragTo(key: ProfileSectionKey, fromY: number, toY: number) {
  fireEvent.pointerDown(
    screen.getByLabelText(t("featuresMisc.profileReorder.dragAria", { label: key })),
    {
      clientX: 10,
      clientY: fromY,
      pointerId: 1,
    },
  );
  fireEvent.pointerMove(document, { clientX: 10, clientY: toY, pointerId: 1 });
}

export function draggedTransform(key: ProfileSectionKey): string {
  return (
    document.querySelector<HTMLElement>(`[data-profile-section-key="${key}"]`)?.style.transform ??
    ""
  );
}

/** 每个用例后的统一清理（原 afterEach 主体）。 */
export function resetReorderTestState() {
  cleanup();
  vi.restoreAllMocks();
  // 本文件多处 `vi.stubGlobal("requestAnimationFrame", …)`：restoreAllMocks 不管全局桩，
  // 不还原的话下一个用例会拿到「回调只入队、永不执行」的 rAF（曾经让焦点用例直接超时）。
  vi.unstubAllGlobals();
  // jsdom 里补偿帧不一定被排空，锚定引用计数会跨用例残留，这里清干净。
  resetScrollAnchoringStateForTests();
  document.documentElement.style.removeProperty("overflow-anchor");
}

/** 接管 rAF：回调进队列，由用例显式排空（jsdom 的 rAF 依赖计时器，act 里不可靠）。 */
export function captureAnimationFrames(): FrameRequestCallback[] {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  return frames;
}

export function drainAnimationFrames(frames: FrameRequestCallback[]) {
  act(() => {
    let guard = 0;
    while (frames.length > 0 && guard < 30) {
      frames.shift()?.(0);
      guard += 1;
    }
  });
}
