/** 拖拽重排的共享几何内核：资料大分区栈与小条目列表共用同一套算法。
 *
 * 全部是纯函数（不读 DOM、不碰 React），因此可以直接单测；两条 hook 只负责
 * 「激活时量一次几何 → 每次指针移动调用这里 → 把结果写进 transform / 调 move」。
 *
 * ## 为什么插入判定用「指针行程制」而不是「前缘 vs 邻项几何」
 *
 * 几何规则（前缘越过邻项中心 / 前缘探进邻项 24px）都有一个共同问题：换位后下一
 * 邻项的触发阈值恰好落在被拖卡当前下缘下方**一个邻项高度**处——跨过一个 890px 的
 * 分区后，跨下一槽还要再拖 ~890px。首换位可以靠阈值做便宜，后续每槽始终与邻项
 * 高度耦合，长分区跨槽永远慢。
 *
 * 行程制把推进与邻项高度**彻底解耦**：插入位 = 当前位 + 指针自上次换位锚点以来的
 * 行程折算步数（`STEP_PX = 48`/槽），方向由行程符号决定：
 *
 * 1. 跨任何分区每槽都是恒定 48px 指针行程（890px 分区提速 ~18 倍）；
 * 2. 一次大幅甩动行程直接折算成多步、一次算到位（`floor(|travel| / STEP_PX)`），
 *    逐帧连续推进；
 * 3. **静止绝不误触**：行程 = 0 → 步数 = 0 → 插入位 = 当前位（±2px 抖动同理）；
 * 4. 行程锚点住在「内容坐标」上，自动滚动时随内容平移（`shiftSwapAnchor`）——贴边
 *    滚动期间指针不动而行程持续累积，顺序继续推进；外部滚动不平移锚点（防
 *    anchoring 正反馈环路）。
 *
 * 防抖仍由换位闩锁（`swapLatchOpen`，12px）兜亚步长抖动，与 gap 完全解耦。
 *
 * ## 为什么 transform 直接算「目标位置 − 布局位置」
 *
 * 旧实现把每次实时重排造成的布局位移累加进一个 `layoutShift` 再补偿。累加式补偿
 * 在「实时重排 + 自动滚动」下必然漂移：漏一次、多一次、或滚动同时发生，误差就永久
 * 留在累加器里，卡片与指针越拖越远。直接由「视觉目标位置 − 当前顺序下的布局位置」
 * 求 transform 天然无漂移——重排后同一帧内用新顺序重算即可。
 */

/** 一次拖拽激活时缓存的栈几何（视口坐标）。 */
export interface DragStackGeometry {
  /** 栈顶（首项上缘，视口坐标）。自动滚动时由调用方按滚动量平移。 */
  stackTop: number;
  /** 栈底（末项下缘，视口坐标）。自动滚动时同步平移。 */
  stackBottom: number;
  /** 相邻两项之间的间距（实测 CSS gap / margin）。 */
  gap: number;
  /** 与当前顺序**逐位对齐**的各项高度（重排时与顺序数组同步 splice）。 */
  heights: number[];
}

/**
 * 由栈顶、gap、各项高度推导栈底。
 *
 * 刻意不用「末项 rect.bottom」：分区卡片的 margin 并不规则（不同分区卡片的
 * margin-bottom 由 antd Card 自带），实测末项 bottom 与前缀和之间可能差几像素；
 * 一旦两者不一致，clamp 上限与前缀和就会互相矛盾（末位又变成不可达）。全部几何
 * 都从前缀和推导，模型自洽。
 */
export function stackBottomOf(stackTop: number, gap: number, heights: number[]): number {
  if (heights.length === 0) return stackTop;
  const total = heights.reduce((acc, height) => acc + height, 0);
  return stackTop + total + gap * (heights.length - 1);
}

/** 当前顺序下第 `index` 项的布局上缘（视口坐标，与前缀和模型一致）。
 *
 * `index` 越界时钳到末项（末项之后没有「下一项」可算）。 */
export function layoutTop(geometry: DragStackGeometry, index: number): number {
  const limit = Math.max(0, Math.min(index, geometry.heights.length - 1));
  let top = geometry.stackTop;
  for (let cursor = 0; cursor < limit; cursor += 1) {
    top += geometry.heights[cursor] + geometry.gap;
  }
  return top;
}

/**
 * 把「理想跟手位置」钳进栈范围：上不越过栈顶，下不越过「被拖项下缘贴栈底」。
 *
 * 下限/上限都用当前被拖项自身高度计算，与顺序无关（高度在拖拽期间不变），
 * 因此重排后 clamp 结果不需要重算上限。
 */
export function clampDesiredTop(
  geometry: DragStackGeometry,
  height: number,
  desiredTop: number,
): number {
  const minTop = geometry.stackTop;
  const maxTop = Math.max(minTop, geometry.stackBottom - height);
  return Math.min(maxTop, Math.max(minTop, desiredTop));
}

/**
 * 换位闩锁的最小位移（px）：真正 `move` 之后，指针必须再走这么远才允许下一次换位。
 *
 * 为什么不是给探针加减一个固定偏移（上一版的 ±4px）：那套滞回的死区是
 * `gap − 2×偏移`——条目 gap=12 时死区只剩 4px，**分区 gap=0 时死区是 −8px，等于没有
 * 滞回**，卡片在被拖项临界点上下 ±2px 抖动就会反复换位（QA 实测 10/10 翻转，邻卡在
 * −1636↔−746 之间弹跳）。闩锁把滞回量锚在「位移」上，与 gap 完全解耦：gap=0、不等高、
 * 超高卡片都成立；反向拖动超过 latch 也能立刻换回（不是单向锁死）。
 */
export const SWAP_LATCH_PX = 12;

/**
 * 换位闩锁是否打开：距离上一次真正换位的位移是否已经够大。
 *
 * **锚点（`lastSwapTop`）是「内容坐标」上的位置**：指针不动时它与 `desiredTop`
 * 同步不变；一旦自动滚动把内容挪动 `delta`，锚点必须跟着平移（见
 * `shiftSwapAnchor`），否则闩锁会永久关闭——滚动期间指针恒定 → `desiredTop`
 * 恒定 → `|desiredTop − 锚点| ≡ 0`，排序完全冻结（QA 实测：滚 972px、
 * orderChanges 0 次、松手落位偏差 1118.9px）。
 *
 * @param lastSwapTop 最近一次换位时的视觉目标位置（内容坐标；激活时初始化为激活位置）。
 * @param desiredTop 本次的视觉目标位置（视口坐标）。
 */
export function swapLatchOpen(
  lastSwapTop: number,
  desiredTop: number,
  latch: number = SWAP_LATCH_PX,
): boolean {
  return Math.abs(desiredTop - lastSwapTop) >= latch;
}

/**
 * 自动滚动后平移闩锁锚点：滚动 `delta`（>0 = 内容上移）等价于被拖项相对内容
 * **反向**移动 `delta`，所以锚点也要减去 `delta`，与 `stackTop -= delta` 同号。
 *
 * 符号写反（写成 `+ delta`）会让距离先缩小再反向增大：先是"每帧都换位"式的抖动，
 * 随后又冻结——两种症状都说明符号错了。
 *
 * 指针静止且不滚动时不会被调用，因此防抖语义（±2px 抖动不换位）保持不变。
 */
export function shiftSwapAnchor(lastSwapTop: number, scrollDelta: number): number {
  return lastSwapTop - scrollDelta;
}

/**
 * 每槽指针行程（px）：指针相对行程锚点每累计这么多位移，插入位推进一格。
 *
 * 取 48 的权衡：太小会被细微手抖连续推进（配合闩锁 12px 仍嫌密）；太大跨槽又变慢。
 * 48px/槽对 890px 的长分区是 ~18 倍提速，对手感是「轻推即走、停手即停」。
 */
export const TRAVEL_STEP_PX = 48;

/**
 * 目标插入位（行程制，两条 hook 的唯一入口）。
 *
 * `travelAnchor` 是上次换位（或激活）时的视觉目标位置（内容坐标，自动滚动时由
 * `applyScrollShift` 平移）。行程 = `desiredTop − travelAnchor`（带符号），插入位 =
 * 当前位 + 行程符号 × `floor(|travel| / TRAVEL_STEP_PX)`——一次大幅甩动按总行程
 * **一次折算到位**，逐帧连续推进，不是每步长一槽的累加器。
 *
 * 静止/微抖不误触：行程 0（或 < 步长）→ 步数 0 → 插入位 = 当前位，不换。
 * 两端可达：行程足够大时被 `minIndex`（分区 1，basic_info 固定首位）与 `lastIndex`
 * 钳住，栈顶/栈底都可达。
 *
 * @param lastIndex 栈内最后一个可用下标（heights.length − 1）。
 * @param dragIndex 被拖项当前下标（即锚点所在的下标 `anchorIndex`）。
 */
export function resolveTargetIndex(
  lastIndex: number,
  dragIndex: number,
  desiredTop: number,
  travelAnchor: number,
  minIndex = 0,
  step: number = TRAVEL_STEP_PX,
): number {
  if (lastIndex < 0 || dragIndex < 0 || dragIndex > lastIndex) {
    return Math.max(0, Math.min(minIndex, Math.max(0, lastIndex)));
  }
  const boundedStep = step > 0 ? step : TRAVEL_STEP_PX;
  const travel = desiredTop - travelAnchor;
  const steps = Math.floor(Math.abs(travel) / boundedStep);
  if (steps === 0) return dragIndex;
  const insertion = dragIndex + (travel > 0 ? steps : -steps);
  return Math.max(minIndex, Math.min(insertion, lastIndex));
}

/**
 * 该方向的自动滚动是否还有意义：被拖卡是否已经贴住对应的栈边界。
 *
 * `scrollDelta > 0` 表示容器向下滚（内容整体上移）：只有 `desiredTop` 还没贴上
 * 「栈底 − h」时才有意义；`scrollDelta < 0` 则只有还没贴上栈顶时有意义。
 *
 * 已经贴边时继续滚只会让页面空转——卡片钉住不动而页面狂滚，跟手误差越滚越大
 * （QA 实测空转 648px、误差涨到 432.9px），用户会以为拖拽失效。
 * 返回值直接喂给 `createEdgeAutoScroller` 的 `canScroll`：false 时本帧不滚也不排帧。
 */
export function canScrollTowards(
  geometry: DragStackGeometry,
  height: number,
  desiredTop: number,
  scrollDelta: number,
): boolean {
  if (scrollDelta === 0) return false;
  const maxTop = Math.max(geometry.stackTop, geometry.stackBottom - height);
  return scrollDelta > 0 ? desiredTop < maxTop - 0.5 : desiredTop > geometry.stackTop + 0.5;
}

/** 滚动来源：自动滚动器自发滚动 vs 外部滚动（用户滚轮 / 浏览器 scroll anchoring）。 */
export type DragScrollSource = "auto" | "external";

/** 一次滚动结算后的结果（几何 + 闩锁锚点）。 */
export interface DragScrollShift {
  geometry: DragStackGeometry;
  lastSwapTop: number;
}

/**
 * 结算一次滚动：几何（栈顶/栈底）**总是**平移；闩锁锚点**只在自发滚动**时平移。
 *
 * 为什么外部滚动不能动锚点：浏览器 scroll anchoring 在布局变动时会调 scrollTop
 * 来"保持视口"，若锚点也随之外移，指针几乎不用动就能再次换位 → 再次触发锚定，
 * 形成正反馈环路（QA 实测分区 10/10 翻转、邻卡弹跳 890px）。关掉 anchoring 是
 * 第一道防线，这里是第二道：即使将来又有外部滚动，也只会更新几何，不会捅开闩锁。
 *
 * 返回新对象（不原地改），`heights` 数组引用保持不变（重排时按需 splice）。
 */
export function applyScrollShift(
  geometry: DragStackGeometry,
  lastSwapTop: number,
  scrollDelta: number,
  source: DragScrollSource,
): DragScrollShift {
  return {
    geometry: {
      ...geometry,
      stackTop: geometry.stackTop - scrollDelta,
      stackBottom: geometry.stackBottom - scrollDelta,
    },
    lastSwapTop: source === "auto" ? shiftSwapAnchor(lastSwapTop, scrollDelta) : lastSwapTop,
  };
}

/** 视觉目标位置与当前布局位置的差，即应写入 `translateY` 的像素值。 */
export function dragTranslate(desiredTop: number, currentLayoutTop: number): number {
  return desiredTop - currentLayoutTop;
}

/** 不可变地把 `from` 位的元素挪到 `to` 位（越界或原地不动时原样返回）。 */
export function moveWithin<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
