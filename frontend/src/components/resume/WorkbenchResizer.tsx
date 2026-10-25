// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 · **可拖动分隔条**（从 `ResumeZoomModal` 拆出，2026-10-24 W02）。
 *
 * 拆出来的唯一原因是行数预算：外壳文件要腾出位置给"冲突条 / 条件保存"的接线，
 * 而这一块是**纯展示 + 键盘等价**，不持有任何状态。
 *
 * 2026-10-25 起两条：参数栏右边一条、内容栏右边一条（用户口径："第一列也支持调整宽度"）。
 * 参数栏曾短暂固定宽（2026-10-23），现在回到可调，所以这里按 `kind` 生成无障碍名与
 * aria 区间；两条分隔条共用同一套拖动/键盘/双击复位语义，差别只在夹取上下限。
 *
 * 关闭语义与键盘：
 * - 双击 = **两条都复位**（动作条上的「恢复默认列宽」是同一个动作的显式入口）；
 * - ←/→ 每次 16px，与 antd 间距刻度同源；`Home`/`End` 不是本控件的语义（复位有双击）。
 */
import { t } from "../../i18n";
import {
  WORKBENCH_KEYBOARD_STEP,
  WORKBENCH_WIDTH_LIMITS,
  type WorkbenchColumnKind,
  type WorkbenchColumnsApi,
} from "./useWorkbenchColumns";

/** 两条分隔条的无障碍名（参数栏 / 内容栏各一条）。 */
const RESIZER_LABEL_KEY = {
  params: "workbench.resizer.params",
  editor: "workbench.resizer.editor",
} as const;

interface Props {
  columns: WorkbenchColumnsApi;
  kind: WorkbenchColumnKind;
}

export default function WorkbenchResizer({ columns, kind }: Props) {
  const { widths, draggingKind, startDrag, nudge, reset } = columns;
  const limit = WORKBENCH_WIDTH_LIMITS[kind];
  return (
    <div
      className={`resume-wb-resizer resume-wb-resizer-${kind}${draggingKind === kind ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t(RESIZER_LABEL_KEY[kind])}
      aria-valuenow={widths[kind]}
      aria-valuemin={limit.min}
      aria-valuemax={limit.max}
      data-column={kind}
      tabIndex={0}
      onMouseDown={(event) => startDrag(kind, event)}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        // 只有左右方向键有意义（分隔条是竖直的）；`preventDefault` 挡住页面横向滚动。
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          nudge(kind, -WORKBENCH_KEYBOARD_STEP);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          nudge(kind, WORKBENCH_KEYBOARD_STEP);
        }
      }}
    />
  );
}
