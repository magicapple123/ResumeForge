/** 拖拽几何内核的纯计算测试：槽位/前缀和、clamp、行程制换位（48px/槽）、边缘换位、
 * 两端可达、不漂移。 */

import { describe, expect, it } from "vitest";
import {
  applyScrollShift,
  canScrollTowards,
  clampDesiredTop,
  dragTranslate,
  ITEM_EDGE_TRIGGER_PX,
  ITEM_SWAP_LATCH_PX,
  layoutTop,
  moveWithin,
  resolveItemEdgeTargetIndex,
  resolveTargetIndex,
  shiftSwapAnchor,
  stackBottomOf,
  swapLatchOpen,
  SWAP_LATCH_PX,
  TRAVEL_STEP_PX,
  type DragStackGeometry,
} from "./dragReorder";

/** 真机实测的 projects 几何：3 条 379 高、gap 12、栈顶 68。 */
function tallGeometry(): DragStackGeometry {
  return {
    stackTop: 68,
    stackBottom: stackBottomOf(68, 12, [379, 379, 379]),
    gap: 12,
    heights: [379, 379, 379],
  };
}

describe("stackBottomOf / layoutTop", () => {
  it("栈底 = 栈顶 + 高度和 + gap×(n-1)", () => {
    expect(stackBottomOf(68, 12, [379, 379, 379])).toBe(1229);
    expect(stackBottomOf(200, 0, [100, 80, 60])).toBe(440);
    // 空栈退化为栈顶（不让调用方拿到 -Infinity）。
    expect(stackBottomOf(200, 10, [])).toBe(200);
  });

  it("布局上缘是「前面各项高度 + gap」的前缀和", () => {
    const geometry = tallGeometry();
    expect(layoutTop(geometry, 0)).toBe(68);
    expect(layoutTop(geometry, 1)).toBe(459);
    expect(layoutTop(geometry, 2)).toBe(850);
    // 越界下标钳到末项（末项之后没有可算的「下一项」）。
    expect(layoutTop(geometry, -3)).toBe(68);
    expect(layoutTop(geometry, 99)).toBe(850);
  });
});

describe("clampDesiredTop", () => {
  it("钳在 [栈顶, 栈底 − 被拖项高] 之间", () => {
    const geometry = tallGeometry();
    expect(clampDesiredTop(geometry, 379, 0)).toBe(68);
    expect(clampDesiredTop(geometry, 379, 400)).toBe(400);
    // 末位可达的前提：clamp 上限正好是「末槽的上缘」（等高时）。
    expect(clampDesiredTop(geometry, 379, 10_000)).toBe(850);
  });
});

describe("resolveTargetIndex（行程制：每 TRAVEL_STEP_PX 推进一格）", () => {
  it("静止与 ±2px 抖动 0 换位（行程 0 → 步数 0 → 插入位 = 当前位）", () => {
    // 拖第 2 条静止在自己的锚点上：不换。
    expect(resolveTargetIndex(2, 1, 500, 500)).toBe(1);
    // ±2px 微抖：远不足一步，不换（比几何规则更强，天然成立但必须测）。
    expect(resolveTargetIndex(2, 1, 502, 500)).toBe(1);
    expect(resolveTargetIndex(2, 1, 498, 500)).toBe(1);
    // 栈顶/栈底静止同理。
    expect(resolveTargetIndex(2, 0, 0, 0)).toBe(0);
    expect(resolveTargetIndex(2, 2, 200, 200)).toBe(2);
  });

  it("48px/槽推进：下/上对称，恰好一步换一位，不足一步不换", () => {
    // 锚点 500、当前位 1。下拖 47px 不换，48px 恰好一步 → 第 3 位；97px 两步越界钳到末位。
    expect(resolveTargetIndex(2, 1, 547, 500)).toBe(1);
    expect(resolveTargetIndex(2, 1, 548, 500)).toBe(2);
    expect(resolveTargetIndex(2, 1, 597, 500)).toBe(2); // 1+2 → 钳到 lastIndex=2
    // 上拖对称：47px 不换，48px → 第 1 位。
    expect(resolveTargetIndex(2, 1, 453, 500)).toBe(1);
    expect(resolveTargetIndex(2, 1, 452, 500)).toBe(0);
  });

  it("一次大行程多槽一次到位 + clamp 两端可达", () => {
    // 行程 200 → 4 步：2+4=6；行程 1000 → 钳到末位 7（minIndex 0）。
    expect(resolveTargetIndex(7, 2, 700, 500)).toBe(6);
    expect(resolveTargetIndex(7, 2, 1500, 500)).toBe(7);
    // 向上大行程：钳到首位；分区栈 minIndex=1 时钳到 1（basic_info 固定首位）。
    expect(resolveTargetIndex(7, 5, 0, 800)).toBe(0);
    expect(resolveTargetIndex(7, 5, 0, 800, 1)).toBe(1);
  });

  it("minIndex 钳位：分区栈传 1，basic_info 不被顶替", () => {
    expect(resolveTargetIndex(7, 3, 0, 500, 1)).toBe(1);
    // 拖到栈底：目标位是末位，不会越过 lastIndex。
    expect(resolveTargetIndex(7, 3, 2000, 500, 1)).toBe(7);
  });

  it("空栈/非法被拖下标不抛异常（无法定位被拖项时返回下限，不推进）", () => {
    expect(resolveTargetIndex(-1, 0, 100, 0)).toBe(0);
    expect(resolveTargetIndex(-1, 0, 100, 0, 1)).toBe(0);
    expect(resolveTargetIndex(2, 9, 600, 500)).toBe(0);
  });

  it("与换位闩锁组合：步长 48 ≥ 闩锁 12，凡达一步的行程必开闩；不足一步不申请换位", () => {
    expect(TRAVEL_STEP_PX).toBeGreaterThan(SWAP_LATCH_PX);
    // 行程恰好一步（±48）：闩锁必然打开 → 换位不被拦（亚步长防抖由步数 0 兜住）。
    expect(swapLatchOpen(500, 548)).toBe(true);
    expect(swapLatchOpen(500, 452)).toBe(true);
    // 不足一步：步数 0 → 插入位 = 当前位，根本不会申请换位（闩锁无需介入）。
    expect(resolveTargetIndex(2, 1, 530, 500)).toBe(1);
    expect(resolveTargetIndex(2, 1, 547, 500)).toBe(1);
    // 换位后锚点重置：再 ±2px 抖动行程归零，不二次换位。
    const anchorAfterSwap = 548;
    expect(resolveTargetIndex(2, 2, 550, anchorAfterSwap)).toBe(2);
    expect(resolveTargetIndex(2, 2, 546, anchorAfterSwap)).toBe(2);
  });

  it("行程锚点随自动滚动平移（shiftSwapAnchor）：贴边滚动期间顺序持续推进", () => {
    // 指针静止（desiredTop 恒 500）、被拖项在位 1：每帧 auto tick 平移锚点 14px，
    // 行程持续累积，跨过 48px 步长即推进一格（B7c 语义：滚动期间排序会推进）。
    let anchor = 500;
    let dragIndex = 1;
    let swaps = 0;
    for (let frame = 0; frame < 6; frame += 1) {
      anchor = shiftSwapAnchor(anchor, 14);
      const target = resolveTargetIndex(2, dragIndex, 500, anchor);
      if (target !== dragIndex && swapLatchOpen(anchor, 500)) {
        dragIndex = target;
        anchor = 500; // 换位后锚点 = 当时 desiredTop
        swaps += 1;
      }
    }
    expect(swaps).toBeGreaterThanOrEqual(1);
    expect(dragIndex).toBe(2);
    // 对照：外部滚动不平移锚点 → 行程恒 0 → 不推进（防 anchoring 环路）。
    const externalAnchor = 500;
    let externalSwaps = 0;
    for (let frame = 0; frame < 6; frame += 1) {
      const target = resolveTargetIndex(2, 1, 500, externalAnchor);
      if (target !== 1) externalSwaps += 1;
    }
    expect(externalSwaps).toBe(0);
  });

  it("TRAVEL_STEP_PX = 48（每槽行程常量契约）", () => {
    expect(TRAVEL_STEP_PX).toBe(48);
  });
});

describe("resolveItemEdgeTargetIndex（条目拖拽：接近邻卡边缘就换位）", () => {
  /** 三条 100 高的等高条目：上缘 0/100/200，下缘 100/200/300。 */
  const flat = (): DragStackGeometry => ({
    stackTop: 0,
    stackBottom: 300,
    gap: 0,
    heights: [100, 100, 100],
  });

  it("下移：指针接近**下一张卡片的底边**（提前 24px）就换一位（中间绝不换）", () => {
    const geometry = flat();
    // 下一张（index 1）的下缘 = layoutTop(1) + 100 = 200；预判带 24px → 176。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 175)).toBe(0);
    expect(resolveItemEdgeTargetIndex(geometry, 0, 176)).toBe(1);
    // 到边上仍然换（预判是提前，不是替代）。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 200)).toBe(1);
    // 关键回归：指针停在下一张卡片**中间**（旧行程制 48px 早就翻了一位）→ 不换。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 150)).toBe(0);
    // 自己的下缘（100）也不算：压过自己的边界不代表接近邻卡边缘。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 100)).toBe(0);
  });

  it("上移：指针接近**上一张卡片的顶边**（提前 24px）就换一位（与下移对称）", () => {
    // 顶边随 stackTop 平移：stackTop=100 时上一张的顶边正好落在 100，预判带 100..124。
    const offset: DragStackGeometry = {
      stackTop: 100,
      stackBottom: 400,
      gap: 0,
      heights: [100, 100, 100],
    };
    expect(resolveItemEdgeTargetIndex(offset, 1, 125)).toBe(1);
    expect(resolveItemEdgeTargetIndex(offset, 1, 124)).toBe(0);
    // stackTop=0 时上一张的顶边是 0，预判带 0..24：指针 25 还没进入，24 才换。
    expect(resolveItemEdgeTargetIndex(flat(), 1, 25)).toBe(1);
    expect(resolveItemEdgeTargetIndex(flat(), 1, 24)).toBe(0);
    expect(resolveItemEdgeTargetIndex(flat(), 1, 100)).toBe(1);
    // 顶边之上（负坐标）继续成立。
    expect(resolveItemEdgeTargetIndex(flat(), 1, -50)).toBe(0);
  });

  it("两端边界：首位不能再上移、末位不能再下移；越界下标原样返回", () => {
    const geometry = flat();
    expect(resolveItemEdgeTargetIndex(geometry, 0, -1000)).toBe(0);
    expect(resolveItemEdgeTargetIndex(geometry, 2, 1000)).toBe(2);
    // 空栈 / 越界下标：没有任何邻卡可判，原值返回（不抛异常、不推进）。
    expect(resolveItemEdgeTargetIndex(geometry, -1, 500)).toBe(-1);
    expect(resolveItemEdgeTargetIndex(geometry, 7, 500)).toBe(7);
    const empty: DragStackGeometry = { stackTop: 0, stackBottom: 0, gap: 0, heights: [] };
    expect(resolveItemEdgeTargetIndex(empty, 0, 0)).toBe(0);
  });

  it("gap 计入边缘：按 layoutTop 前缀和算，且不在邻卡内部提前触发", () => {
    const geometry: DragStackGeometry = {
      stackTop: 0,
      stackBottom: 324,
      gap: 8,
      heights: [100, 100, 100],
    };
    // layoutTop(1) = 100+8 = 108 → 下一张下缘 = 208；预判带 184。
    expect(layoutTop(geometry, 1)).toBe(108);
    expect(resolveItemEdgeTargetIndex(geometry, 0, 183)).toBe(0);
    expect(resolveItemEdgeTargetIndex(geometry, 0, 184)).toBe(1);
    // 上移侧的顶边不含 gap 前缀（上一张上缘 = 0）；108 不是边缘，也不在预判带内。
    expect(resolveItemEdgeTargetIndex(geometry, 1, 108)).toBe(1);
    expect(resolveItemEdgeTargetIndex(geometry, 1, 24)).toBe(0);
  });

  it("拖到父卡片底部：一次越过多个边缘时直接推进到末位（不会停在中间）", () => {
    // 四条 100 高的条目：0-100 / 100-200 / 200-300 / 300-400。
    const geometry: DragStackGeometry = {
      stackTop: 0,
      stackBottom: 400,
      gap: 0,
      heights: [100, 100, 100, 100],
    };
    // 只越过第一张的预判带 → 只换一位。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 200)).toBe(1);
    // 越过第二张的预判带（300-24=276）→ 目标第 3 位；拖到父卡片底部 → 末位。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 300)).toBe(2);
    expect(resolveItemEdgeTargetIndex(geometry, 0, 1000)).toBe(3);
    // 反向：从末位拖到父卡片顶部，同样一次回到首位。
    expect(resolveItemEdgeTargetIndex(geometry, 3, -1000)).toBe(0);
    // 指针在 100（第 2 张上缘）只回到第 2 位；到 24（首张顶边的预判带）才回首位。
    expect(resolveItemEdgeTargetIndex(geometry, 3, 100)).toBe(1);
    expect(resolveItemEdgeTargetIndex(geometry, 3, 24)).toBe(0);
  });

  it("与行程制对照：矮条目上 48px 行程早已翻位，边缘判定纹丝不动（用户抱怨的那一版）", () => {
    const geometry = flat();
    // 行程制：指针自锚点 0 走 48px → 步数 1 → 换到 index 1。
    expect(resolveTargetIndex(2, 0, 48, 0)).toBe(1);
    // 边缘判定：同样的 48px 只到下一张卡片的中段，不换。
    expect(resolveItemEdgeTargetIndex(geometry, 0, 48)).toBe(0);
    // 自然滞回 = 一整张卡片高度；预判带 24px 小于卡片高度，闩锁 6px 小于预判带。
    expect(ITEM_EDGE_TRIGGER_PX).toBe(24);
    expect(ITEM_SWAP_LATCH_PX).toBe(6);
    expect(ITEM_SWAP_LATCH_PX).toBeLessThan(ITEM_EDGE_TRIGGER_PX);
    expect(ITEM_EDGE_TRIGGER_PX).toBeLessThan(geometry.heights[0]);
  });
});

describe("swapLatchOpen（换位闩锁，与 gap 解耦）", () => {
  it("边界：0 / ±latch / 超过 latch", () => {
    expect(swapLatchOpen(500, 500)).toBe(false);
    expect(swapLatchOpen(500, 512)).toBe(true);
    expect(swapLatchOpen(500, 488)).toBe(true);
    // 差一点点（11.9px）不算
    expect(swapLatchOpen(500, 511.9)).toBe(false);
    expect(swapLatchOpen(500, 488.1)).toBe(false);
    // 自定义 latch
    expect(swapLatchOpen(500, 510, 10)).toBe(true);
    expect(swapLatchOpen(500, 509.9, 10)).toBe(false);
  });

  it("状态机：换位后 <latch 不动、≥latch 可再换、反向对称", () => {
    let lastSwap = 0;
    const canSwap = (top: number) => swapLatchOpen(lastSwap, top);
    // 第一次换位在 100
    expect(canSwap(100)).toBe(true);
    lastSwap = 100;
    // 临界点 ±2px 抖动：全部被锁死（这正是 gap=0 分区缺失的滞回）
    for (const top of [102, 100, 98, 102, 98]) expect(canSwap(top)).toBe(false);
    // 继续前进超过 latch → 允许第二次换位
    expect(canSwap(112)).toBe(true);
    lastSwap = 112;
    expect(canSwap(110)).toBe(false);
    // 反向拖 ≥latch 也能立刻换回（不是单向锁死）
    expect(canSwap(100)).toBe(true);
  });

  it("闩锁量与 gap 无关：gap=0 的分区与 gap=12 的条目用同一常量", () => {
    expect(SWAP_LATCH_PX).toBe(12);
    // ±2px 抖动在两种 gap 下都被锁死（旧实现的死区是 gap−8，gap=0 时完全没有滞回）。
    for (const top of [502, 498, 502, 498, 501]) expect(swapLatchOpen(500, top)).toBe(false);
    // 位移恰好达到 latch 就放开。
    expect(swapLatchOpen(500, 512)).toBe(true);
    // gap 只影响布局前缀和（与本函数无关），复核模型仍自洽。
    expect(layoutTop({ stackTop: 0, stackBottom: 300, gap: 0, heights: [100, 100, 100] }, 1)).toBe(
      100,
    );
    expect(layoutTop({ stackTop: 0, stackBottom: 324, gap: 12, heights: [100, 100, 100] }, 1)).toBe(
      112,
    );
  });
});

describe("shiftSwapAnchor（自动滚动时锚点随内容平移）", () => {
  it("指针静止 + 逐帧滚动：距离随滚动累积，闩锁能重新打开（冻结回归）", () => {
    // 指针视口位置恒定（自动滚动期间指针不动）：desiredTop 恒为 900。
    const desiredTop = 900;
    let anchor = 900;
    // 未滚动时 ±2px 抖动依旧被锁死（防抖不退化）。
    for (const jitter of [2, -2, 2]) expect(swapLatchOpen(anchor, desiredTop + jitter)).toBe(false);
    // 第一帧滚 14px（内容上移）：锚点同步平移 → 距离 14 ≥ latch → 打开。
    anchor = shiftSwapAnchor(anchor, 14);
    expect(swapLatchOpen(anchor, desiredTop)).toBe(true);
    expect(desiredTop - anchor).toBe(14);
    // 换位后锚点重置为当前 desiredTop；再滚 5px 仍不足 latch → 继续锁死。
    anchor = desiredTop;
    anchor = shiftSwapAnchor(anchor, 5);
    expect(swapLatchOpen(anchor, desiredTop)).toBe(false);
    // 连续再滚 7px（累计 12）→ 打开。
    anchor = shiftSwapAnchor(anchor, 7);
    expect(swapLatchOpen(anchor, desiredTop)).toBe(true);
  });

  it("符号：锚点与 stackTop 同号平移（写成 +delta 会把卡片往回拽）", () => {
    // 内容上移（scrollTop 增大，delta>0）→ 锚点减小，锚点在被拖项上方。
    expect(shiftSwapAnchor(500, 14)).toBe(486);
    expect(shiftSwapAnchor(500, -14)).toBe(514);
    const desiredTop = 500;
    const shifted = shiftSwapAnchor(500, 14);
    expect(Math.abs(desiredTop - shifted)).toBe(14);
    // 方向断言：锚点必须落在 desiredTop 上方（内容走了，锚点跟着走），
    // 写成 += 时会落在下方——距离绝对值一样，但换位方向会反过来（每帧来回换位）。
    expect(shifted).toBeLessThan(desiredTop);
    expect(shiftSwapAnchor(500, 0)).toBe(500);
  });

  it("滚动累计距离达到 latch 后每一帧都可换位（滚动是连续位移，不是抖动）", () => {
    const desiredTop = 1200;
    let anchor = 1200;
    let opened = 0;
    for (let frame = 0; frame < 6; frame += 1) {
      anchor = shiftSwapAnchor(anchor, 14);
      if (swapLatchOpen(anchor, desiredTop)) {
        opened += 1;
        anchor = desiredTop; // 换位后重置
      }
    }
    expect(opened).toBeGreaterThanOrEqual(1);
  });
});

describe("applyScrollShift（滚动结算：几何总是动，锚点只在自发滚动时动）", () => {
  const geometry: DragStackGeometry = {
    stackTop: 200,
    stackBottom: 500,
    gap: 10,
    heights: [100, 100, 100],
  };

  it("自发滚动（auto）：几何与闩锁锚点同时平移，指针不动也能达到 latch", () => {
    const result = applyScrollShift(geometry, 300, 14, "auto");
    expect(result.geometry.stackTop).toBe(186);
    expect(result.geometry.stackBottom).toBe(486);
    expect(result.lastSwapTop).toBe(286);
    // 指针仍停在 300：锚点被推开 14 ≥ latch → 允许下一次换位（滚动期间排序会推进）。
    expect(swapLatchOpen(result.lastSwapTop, 300)).toBe(true);
  });

  it("外部滚动（external）：只平移几何、锚点不动（正反馈护栏）", () => {
    // 模拟浏览器 scroll anchoring 把 scrollTop 推了 890px
    const result = applyScrollShift(geometry, 300, 890, "external");
    expect(result.geometry.stackTop).toBe(200 - 890);
    expect(result.geometry.stackBottom).toBe(500 - 890);
    expect(result.lastSwapTop).toBe(300);
    // 关键：锚点没动 → 闩锁距离仍是 0 → 不会凭空换位再触发 anchoring（环路断开）。
    expect(swapLatchOpen(result.lastSwapTop, 300)).toBe(false);
  });

  it("不原地改几何，heights 引用保持不变（重排时按需 splice）", () => {
    const result = applyScrollShift(geometry, 300, 10, "auto");
    expect(result.geometry).not.toBe(geometry);
    expect(result.geometry.heights).toBe(geometry.heights);
    expect(geometry.stackTop).toBe(200);
  });
});

describe("canScrollTowards（clamp 后停滚）", () => {
  const geometry: DragStackGeometry = {
    stackTop: 100,
    stackBottom: 500,
    gap: 0,
    heights: [200, 200],
  };

  it("还没贴边时两个方向都允许滚", () => {
    expect(canScrollTowards(geometry, 200, 200, 14)).toBe(true);
    expect(canScrollTowards(geometry, 200, 200, -14)).toBe(true);
  });

  it("已经 clamp 在栈底（向下）时不再滚，反之亦然", () => {
    // 下边界 = 500 - 200 = 300；desiredTop 350 已被钳到 300。
    expect(canScrollTowards(geometry, 200, 350, 14)).toBe(false);
    // 但此时向上仍有空间。
    expect(canScrollTowards(geometry, 200, 350, -14)).toBe(true);
    // 上边界：desiredTop 60 被钳到 100。
    expect(canScrollTowards(geometry, 200, 60, -14)).toBe(false);
    expect(canScrollTowards(geometry, 200, 60, 14)).toBe(true);
  });

  it("恰好停在边界（desiredTop == 上/下界）就视为无空间；delta=0 一律不滚", () => {
    // 下界 = 500-200 = 300
    expect(canScrollTowards(geometry, 200, 300, 14)).toBe(false);
    expect(canScrollTowards(geometry, 200, 299.4, 14)).toBe(true);
    // 上界 = 100
    expect(canScrollTowards(geometry, 200, 100, -14)).toBe(false);
    expect(canScrollTowards(geometry, 200, 100.6, -14)).toBe(true);
    expect(canScrollTowards(geometry, 200, 200, 0)).toBe(false);
  });
});

describe("dragTranslate（跟手位置直接计算，不累加漂移）", () => {
  it("transform = 视觉目标位置 − 当前顺序下的布局位置", () => {
    expect(dragTranslate(410, 420)).toBe(-10);
    expect(dragTranslate(200, 300)).toBe(-100);
    expect(dragTranslate(850, 850)).toBe(0);
  });

  it("连续重排后，视觉位置始终等于「布局位置 + transform」（行程制推进）", () => {
    const gap = 10;
    let geometry: DragStackGeometry = {
      stackTop: 200,
      gap,
      heights: [100, 80, 60, 40],
      stackBottom: stackBottomOf(200, gap, [100, 80, 60, 40]),
    };
    let dragIndex = 1;
    const draggedHeight = geometry.heights[dragIndex];
    const grabOffset = 40;
    // 行程锚点：激活时 = 被拖项布局上缘；每次换位后 = 当时 desiredTop。
    let travelAnchor = layoutTop(geometry, dragIndex);

    // 指针一路向下：每次都把「布局位置 + transform」与理想位置对齐，不允许累计误差。
    for (const pointerY of [450, 520, 640]) {
      const desiredTop = clampDesiredTop(geometry, draggedHeight, pointerY - grabOffset);
      const targetIndex = resolveTargetIndex(
        geometry.heights.length - 1,
        dragIndex,
        desiredTop,
        travelAnchor,
      );
      if (targetIndex !== dragIndex) {
        geometry = { ...geometry, heights: moveWithin(geometry.heights, dragIndex, targetIndex) };
        dragIndex = targetIndex;
        travelAnchor = desiredTop;
      }
      const translate = dragTranslate(desiredTop, layoutTop(geometry, dragIndex));
      expect(layoutTop(geometry, dragIndex) + translate).toBe(desiredTop);
      // 没有被 clamp 时，理想位置就是 指针 − grabOffset；被 clamp 时也不允许出现
      // 「布局位置 + transform」与 clamp 结果不一致的累计漂移。
      const expectedTop = Math.min(
        Math.max(pointerY - grabOffset, geometry.stackTop),
        geometry.stackBottom - draggedHeight,
      );
      expect(desiredTop).toBe(expectedTop);
    }
    // 首次移动行程 100px（两步）即到末位，其后被 clamp 钳在栈底（不再推进也不漂移）。
    expect(dragIndex).toBe(3);
  });
});

describe("moveWithin", () => {
  it("不可变地把元素挪位；原地/越界时返回原数组", () => {
    const source = [1, 2, 3];
    expect(moveWithin(source, 0, 2)).toEqual([2, 3, 1]);
    expect(source).toEqual([1, 2, 3]);
    expect(moveWithin(source, 1, 1)).toBe(source);
    expect(moveWithin(source, -1, 2)).toBe(source);
    expect(moveWithin(source, 0, 5)).toBe(source);
  });
});
