// SPDX-License-Identifier: Apache-2.0
/**
 * 招呼语配图选择器的入口：按 `mode` 分派到两个语义不同的组件。
 *
 * ## 为什么分成两个组件而不是一个组件加分支
 *
 * 两处的"选中"根本不是一个动作：
 *
 * - **设置页（`mode="single"`）** 选的是"默认图"，而且这里就是**图片库的管理位置**——
 *   删库入口正当且必须存在（`GreetingImageSingleSelect`）。
 * - **队列编辑（`mode="multiple"`）** 选的是"这一条投递要发的 1..4 张"，`×` 只表示
 *   "这条不带了"，**不是**删库（`GreetingImageMultiSelect`）。R21 的病根正是这两件事共用
 *   同一份列表：用户在"编辑这一条"里看到一个带垃圾桶的库清单，既不敢点、点了还回 409。
 *
 * 保留同一个入口是因为调用方（`ApplyGreetingImageSection` / `QueueItemEditor`）只需要知道
 * "要配图"，不关心内部是下拉还是缩略图；上传逻辑也确实是同一段（`useGreetingImageUpload`）。
 */
import type { ApplyGreetingImageOption } from "../../types";
import { GREETING_IMAGE_MAX_FALLBACK } from "../../types";
import GreetingImageMultiSelect from "./GreetingImageMultiSelect";
import GreetingImageSingleSelect from "./GreetingImageSingleSelect";

export interface GreetingImagePickerProps {
  mode: "single" | "multiple";
  /** 直接使用时传值；放在 `Form.Item` 里时由表单项注入（因此可省略）。 */
  value?: number | number[] | null;
  onChange?: (next: number | number[] | null) => void;
  options: ApplyGreetingImageOption[];
  /** 后端下发的张数上限；缺省用兜底值（只有接口没回包时才会走到）。 */
  maxCount?: number;
  /** 后端下发的单张体积上限（`max_image_bytes`）；缺省用同源镜像常量。 */
  maxImageBytes?: number;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
}

export default function GreetingImagePicker({
  mode,
  value,
  onChange,
  options,
  maxCount = GREETING_IMAGE_MAX_FALLBACK,
  maxImageBytes,
  disabled,
  placeholder,
  ariaLabel,
}: GreetingImagePickerProps) {
  if (mode === "single") {
    return (
      <GreetingImageSingleSelect
        value={typeof value === "number" ? value : null}
        onChange={(next) => onChange?.(next)}
        options={options}
        maxImageBytes={maxImageBytes}
        disabled={disabled}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
      />
    );
  }
  return (
    <GreetingImageMultiSelect
      value={Array.isArray(value) ? value : []}
      onChange={(next) => onChange?.(next)}
      options={options}
      maxCount={maxCount}
      maxImageBytes={maxImageBytes}
      disabled={disabled}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
    />
  );
}
