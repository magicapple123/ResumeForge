// SPDX-License-Identifier: Apache-2.0
/**
 * 栏目条的**溢出计算**：给定每个栏目的布局盒子与轨道状态，算出"哪些栏目没显示出来"和
 * "右缘渐隐从哪开始"。纯函数、不碰 DOM、不读全局——所以它能在 jsdom 里被直接钉住。
 *
 * ## 为什么要单独抽出来
 *
 * jsdom 没有布局引擎（`clientWidth` / `offsetLeft` 恒为 0），`EditorTabStrip` 里那段
 * "量一遍"的代码在测试里永远走"没有溢出"分支。抽成纯函数之后，唯一值得钉住的那部分
 * ——**滚动之后渐隐起点必须跟着变**——可以直接喂输入来验证，不必伪造整个布局。
 *
 * ## 两个坐标
 *
 * - `offsetLeft` / `offsetWidth` 是**内容坐标**（相对轨道内容起点，不随滚动改变）；
 * - 遮罩 `mask-image` 贴在轨道的**盒子**上，不跟内容滚，所以渐隐起点必须是**视口坐标**：
 *   `offsetLeft + offsetWidth - scrollLeft`。这就是"滚动之后要重算"的全部原因：同一个
 *   栏目在滚动后占的视口位置变了。
 *
 * ## 判据
 *
 * - 右侧：视口内右边界超过 `clientWidth - reserve` 的，从它开始（连同后面全部）都没显示完；
 * - 左侧：视口内右边界 `<= 0` 的已经被滚出左边，同样属于"没显示出来"。**这条不能省**：
 *   否则把栏目条滚到最右端时"右边一栏都没被切"，下拉按钮会消失，而被滚出去的左边几栏
 *   就再也没有入口了——用户原话是"如果标签显示完全了，就不显示三角下拉"。
 * - 渐隐起点取**最后一个完整可见栏目的视口右边界**（升序遍历，最后赋值的那个）；一个
 *   完整可见的都没有时返回 `null`，由调用方退化成"不渐隐"（遮罩从 0 开始会把整条擦掉）。
 */
export interface TabBox {
  /** 内容坐标左边界（`offsetLeft`）。 */
  offsetLeft: number;
  /** 宽度（`offsetWidth`）。 */
  offsetWidth: number;
}

export interface TabOverflowOptions {
  /** 轨道可见宽度（`clientWidth`）。`<= 0` 视为还没布局。 */
  clientWidth: number;
  /** 轨道已横向滚过的距离（`scrollLeft`）。 */
  scrollLeft: number;
  /** 右侧要留给三角按钮的宽度。 */
  reserve: number;
}

export interface TabOverflow {
  /** 没显示出来的栏目下标（升序）。空数组 = 全都看得见。 */
  hiddenIndexes: number[];
  /** 渐隐起点（视口坐标 px）。`null` = 不渐隐。 */
  fadeFrom: number | null;
}

/**
 * 算一次溢出状态。
 *
 * 边界：`clientWidth <= 0`（首帧 / 无布局引擎）或没有栏目时返回"没有溢出"——宁可这一帧
 * 少一颗三角按钮，也不要摆一颗点开是空菜单的按钮。
 */
export function computeTabOverflow(
  boxes: readonly TabBox[],
  options: TabOverflowOptions,
): TabOverflow {
  const { clientWidth, scrollLeft, reserve } = options;
  if (clientWidth <= 0 || boxes.length === 0) return { hiddenIndexes: [], fadeFrom: null };

  const limit = clientWidth - reserve;
  const hiddenIndexes: number[] = [];
  let fadeFrom: number | null = null;

  boxes.forEach((box, index) => {
    const viewportRight = box.offsetLeft + box.offsetWidth - scrollLeft;
    if (viewportRight > limit || viewportRight <= 0) {
      hiddenIndexes.push(index);
      return;
    }
    // 升序遍历：循环结束时留下的就是最后一个完整可见栏目的右边界。
    fadeFrom = viewportRight;
  });

  if (hiddenIndexes.length === 0) return { hiddenIndexes: [], fadeFrom: null };
  // 一个完整可见的都没有：不做渐隐（否则遮罩会盖住全部内容）。
  return { hiddenIndexes, fadeFrom: fadeFrom !== null && fadeFrom > 0 ? fadeFrom : null };
}
