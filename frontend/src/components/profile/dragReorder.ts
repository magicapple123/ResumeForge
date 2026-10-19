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
 * ## 为什么「小条目」不用行程制，而用**邻卡边缘**判定
 *
 * 分区卡片又高又少（890px/块），按行程推进才能跨得动；条目（教育/经历/项目）却
 * 又多又矮（60~380px/条），48px/槽在条目列表里意味着「拖到邻卡中间就换位」——用户
 * 实测的原话是「太敏感、总在我没想换的地方翻」。条目的心理模型是**卡片**：手指要
 * 真的把卡拖到「下一张卡的下缘」或「上一张卡的上缘」，才算压过去一张。
 *
 * 于是条目拖拽单独走 `resolveItemEdgeTargetIndex`：判定只看**指针 y 与邻卡边缘**的
 * 相对位置，既不看邻卡中线（更敏感），也不看指针行程（与卡片高度无关，矮卡上极敏感）。
 * 触发点比边缘提前 `ITEM_EDGE_TRIGGER_PX`：用户不必把指针精确压到像素级边缘，只要
 * 「快要到」就换，松手前能看到下一格已经让开。天然滞回 = 一整张卡片的高/矮，指针停在
 * 邻卡中间随便晃都不会换位。
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
 * 条目拖拽的边缘换位闩锁（px）：距上一次真正换位至少移动这么远才允许再换一次。
 *
 * 边缘判定本身已经有一整张卡片高度的天然滞回（换位后要换回来得走到另一侧的边缘），
 * 这条闩锁只兜「指针恰好压在边缘线上」的亚像素抖动与自动滚动的逐帧重复判定：指针
 * 停在 `nextBottom` 上不动时，±1~2px 的手抖不该让同一处反复换位。
 *
 * 取 6 的原因：小于拖拽激活阈值（同为 6px）则会与激活抖动同量级、兜不住；大于 6 会让
 * 「到边后想立刻再换一位」的手感变钝（用户已经拖过一整张卡，不该再等）。
 */
export const ITEM_SWAP_LATCH_PX = 6;

/**
 * 条目拖拽的「快要到边缘」预判距离（px）。
 *
 * 用户的原话是「拖到**快要到**下一张小卡片底部或者上一张小卡片顶部时就更换位置」：
 * 精确压到边缘线才换，指针得走完整张卡，手感偏迟；提前 24px（约一行正文的高度）
 * 换位，视觉上卡片刚接近邻卡边缘就让开，松手前能确认落点。
 *
 * 不按卡片高度做百分比：矮卡（60px）的 24px 已经接近半张，高卡（380px）的 24px
 * 又太贴边；固定 24px 更接近「接近边缘」的直觉，也让边缘闩锁（6px）始终小于预判带。
 */
export const ITEM_EDGE_TRIGGER_PX = 24;

/**
 * 条目拖拽的「边缘换位」：指针**接近**下一张卡片的底边、或上一张卡片的顶边
 * （提前 `ITEM_EDGE_TRIGGER_PX`）就换位。返回目标下标（可能跨多格）或原位。
 *
 * 跨多格是刻意的：拖到父卡片底部时指针已经越过后面所有条目的边缘，若一次只推进
 * 一位，会停在中间而不是末位（用户实测「拖到它所在的大卡片底部时无法正常换位」）。
 * 指针只越过一张卡时仍然只换一位，所以「不敏感」的手感不变。
 *
 * ## 为什么是「边缘」而不是「邻卡中线」或「48px 行程」
 *
 * 1. **中线（前缘越过邻中心）**：换位阈值落在邻卡内部，被拖卡只要盖住邻卡一半就翻。
 *    条目卡矮（60px）时阈值只有 30px，比鼠标手抖的幅度大不了多少——用户抱怨的
 *    「拖到相邻卡片中间就换位，太敏感」正是这条。
 * 2. **行程制（`resolveTargetIndex`，48px/槽）**：与邻卡几何完全解耦，但正因如此，
 *    在矮条目上 48px 只等于「半个邻卡」，仍然是「盖住就翻」；而且它和指针在卡片里的
 *    位置无关，用户无法建立「拖过一张卡才换」的空间直觉。
 * 3. **接近边缘（本函数）**：阈值锚在**邻卡的真实下缘/上缘**上，并提前 24px——
 *    下移要 `pointerY >= layoutTop(next) + height(next) - 24`，
 *    上移要 `pointerY <= layoutTop(prev) + 24`。用户不必精确压到像素级边缘，
 *    「快要到」就换；换位量仍接近一整张卡，且自带滞回：换位后想换回来，指针得走到
 *    **另一侧**的边缘去（隔着一整张卡），±2px 抖动不可能触发。
 *
 * 判定只用**指针 y**，不用 `desiredTop`（被拖卡的视觉上缘）：`desiredTop` 已经被
 * `clampDesiredTop` 钳在栈内、又带着抓取偏移，拿它跟边缘比会把「手指位置」和「卡片
 * 位置」混在一起——贴边钳住时 `desiredTop` 不再跟手，边缘判定就会永久失效或永久触发。
 *
 * @param geometry 激活时缓存的栈几何（`heights` 与当前顺序逐位对齐）。
 * @param sourceIndex 被拖条目**当前**下标。
 * @param pointerY 指针的视口 y（不是卡片位置，也不是内容坐标）。
 * @returns 目标下标（下移/上移可跨多格）或原位 `sourceIndex`。
 */
export function resolveItemEdgeTargetIndex(
  geometry: DragStackGeometry,
  sourceIndex: number,
  pointerY: number,
): number {
  const count = geometry.heights.length;
  // 越界下标（空栈 / 几何尚未采集完成）原样返回：没有任何邻卡可判，不推进。
  if (sourceIndex < 0 || sourceIndex >= count) return sourceIndex;

  // 下移：从当前位开始逐张检查「接近下一张底边」；指针越过的最后一张就是目标。
  // 必须**循环**而不是只比较下一张：用户把条目拖到父卡片底部时，指针已经越过
  // 后面所有条目的边缘，只推进一位会停在中间（用户实测「拖到底部无法正常换位」）。
  let target = sourceIndex;
  while (target + 1 < count) {
    const nextBottom = layoutTop(geometry, target + 1) + geometry.heights[target + 1];
    if (pointerY >= nextBottom - ITEM_EDGE_TRIGGER_PX) target += 1;
    else break;
  }
  if (target !== sourceIndex) return target;

  // 上移：与下移对称，从当前位逐张往上检查「接近上一张顶边」。
  while (target - 1 >= 0) {
    const prevTop = layoutTop(geometry, target - 1);
    if (pointerY <= prevTop + ITEM_EDGE_TRIGGER_PX) target -= 1;
    else break;
  }

  return target;
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
