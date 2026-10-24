// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台 · **内容栏分隔条**（从 `ResumeZoomModal` 拆出，2026-10-24 W02）。
 *
 * 拆出来的唯一原因是行数预算：外壳文件要腾出位置给"冲突条 / 条件保存"的接线，
 * 而这一块是**纯展示 + 键盘等价**，不持有任何状态。参数栏没有分隔条（固定宽，
 * `WORKBENCH_WIDTH_LIMITS.params.min === max`），所以这里只认 `editor` 一种。
 */
import { t } from "../../i18n";
import {
  WORKBENCH_KEYBOARD_STEP,
  WORKBENCH_WIDTH_LIMITS,
  type WorkbenchColumnsApi,
} from "./useWorkbenchColumns";

/** 分隔条的无障碍名。参数栏自 2026-10-23 起固定宽，没有第二条可念。 */
const RESIZER_LABEL_KEY = {
  editor: "workbench.resizer.editor",
} as const;

export default function WorkbenchResizer({ columns }: { columns: WorkbenchColumnsApi }) {
  const kind = "editor" as const;
  const { widths, draggingKind, startDrag, nudge, reset } = columns;
  return (
    <div
      className={`resume-wb-resizer${draggingKind === kind ? " is-dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={t(RESIZER_LABEL_KEY[kind])}
      aria-valuenow={widths[kind]}
      aria-valuemin={WORKBENCH_WIDTH_LIMITS[kind].min}
      aria-valuemax={WORKBENCH_WIDTH_LIMITS[kind].max}
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
