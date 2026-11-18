// SPDX-License-Identifier: Apache-2.0
/** 识别结果逐字段落位（I-35）。
 *
 * 为什么不是一次性 `setFieldsValue`：9 个字段在同一瞬间出现，用户分不清哪些是识别出来的、
 * 哪些是自己原来填的。按固定顺序逐个写入（每步 60ms），每个字段写入时亮 400ms 的浅底，
 * 眼睛能跟着走一遍。
 *
 * 三个必须清干净的出口：关闭弹窗、开始新的识别、组件卸载。定时器留在 ref 里，任何一处
 * 不清就会出现"往已卸载的表单里写"或"旧结果盖掉新结果"。
 */
import type { FormInstance } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { RECOGNIZED_CONTENT_FIELDS } from "./jobFormOptions";

/** 相邻两个字段的间隔：9 个字段约 0.5s，够看清又不至于让人等。 */
export const FILL_STEP_MS = 60;
/** 单字段高亮时长。 */
export const FILL_HIGHLIGHT_MS = 400;

export type FillingField = (typeof RECOGNIZED_CONTENT_FIELDS)[number] | null;

/** `prefers-reduced-motion: reduce` → 一次填完，不做逐个动画。 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSequentialFill<T extends object>(form: FormInstance<T>) {
  const [fillingField, setFillingField] = useState<FillingField>(null);
  const steps = useRef<number[]>([]);
  const highlights = useRef<number[]>([]);

  const cancel = useCallback(() => {
    steps.current.forEach((id) => window.clearTimeout(id));
    highlights.current.forEach((id) => window.clearTimeout(id));
    steps.current = [];
    highlights.current = [];
    setFillingField(null);
  }, []);

  // 卸载时清定时器：否则回调会往已经销毁的表单实例里写。
  useEffect(() => cancel, [cancel]);

  const fill = useCallback(
    (draft: T) => {
      cancel();
      const present = RECOGNIZED_CONTENT_FIELDS.filter((field) =>
        String((draft as Record<string, unknown>)[field] ?? "").trim(),
      );
      if (present.length === 0) return;
      if (prefersReducedMotion()) {
        form.setFieldsValue(draft as never);
        return;
      }
      present.forEach((field, index) => {
        steps.current.push(
          window.setTimeout(() => {
            // 字段名来自 `RECOGNIZED_CONTENT_FIELDS`，必然是表单的合法路径；
            // antd 的 NamePath 是条件类型，这里按运行时事实断言。
            form.setFieldValue(field as never, (draft as Record<string, unknown>)[field] as never);
            setFillingField(field);
            highlights.current.push(
              window.setTimeout(() => {
                // 只撤自己的高亮：下一字段可能已经亮起来了。
                setFillingField((current) => (current === field ? null : current));
              }, FILL_HIGHLIGHT_MS),
            );
          }, index * FILL_STEP_MS),
        );
      });
    },
    [cancel, form],
  );

  return { fillingField, fill, cancel };
}
