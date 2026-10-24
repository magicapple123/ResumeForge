// SPDX-License-Identifier: Apache-2.0
/**
 * 照片大小控件：60–160%，步进 2%，读数写百分比。
 *
 * ## 为什么是"系数"而不是"绝对尺寸"
 *
 * 照片尺寸由模板自己决定（`calc(var(--fs) * 6.3)` 之类，8 个模板各不相同），这里只给一个
 * **系数**，落在 `format_config.photo_scale`：HTML 走 `--photo-scale` 变量，PDF/Word 由
 * `resolve_layout` 乘进 `photo_width_ratio / photo_height_ratio`。宽高同乘 → 宽高比不变 →
 * 8 个模板的取景裁剪结果一像素都不变，只有画框变大变小。
 *
 * ## 为什么读数写 `115%` 而不是 `1.15x`
 *
 * 用户想的是"照片多大"，不是"系数多少"。UI 层因此全程用**整数百分比**，落库时才 `/100`
 * ——顺带把 `0.02` 的浮点尾巴挡在界面之外（`1.1500000000000001` 不会上屏）。
 *
 * ## 为什么不设"过大警告"
 *
 * `1.6×` 时经典模板的照片约 37×48mm，页头仍宽裕。写死一条警告只会变成噪音，而
 * "装不下就报溢出"这条既有口径已经兜住了真正的后果（§6.1：参数即呈现，不自动缩照片）。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import {
  MAX_PHOTO_SCALE,
  MIN_PHOTO_SCALE,
  fromPhotoPercent,
  toPhotoPercent,
} from "../../utils/pageMargins";
import { photoScaleProbeCss } from "../../utils/resumeFormatProbe";
import ParamResetButton from "./ParamResetButton";

/**
 * 提交防抖（毫秒）。与页边距 / 行距同值：一次提交就要后端重渲染一次。
 *
 * 照片系数没有"本地即时缩放"的替代通道——预览里的照片尺寸由模板 CSS 的
 * `var(--photo-scale, 1)` 决定，所以探针（`:root` 变量）是拖动中唯一的反馈。
 */
const COMMIT_DEBOUNCE_MS = 120;

/** 滑杆的百分比区间与步长：由系数区间派生，保证"界面上的两端"就是"存储的两端"。 */
const MIN_PERCENT = toPhotoPercent(MIN_PHOTO_SCALE);
const MAX_PERCENT = toPhotoPercent(MAX_PHOTO_SCALE);
const PERCENT_STEP = 2;

interface Props {
  /** 当前照片大小（整数百分比，60–160）。 */
  value: number;
  /** 用户是否设过覆盖：没设过时显示来源标签。 */
  customized: boolean;
  /**
   * 这份简历是否有照片。`false` 时滑杆禁用并写清原因；`undefined`（生成前配置阶段拿不到
   * 内容）**不禁用**——只是没有即时预览，滑块仍然可用。
   */
  hasPhoto?: boolean;
  disabled?: boolean;
  /** 没设过覆盖时显示的来源标签：随模板。 */
  defaultHint?: string;
  /** 「恢复到打开时的值」：`visible` 为真时占用来来源胶囊那一格。 */
  restore?: { visible: boolean; onReset: () => void };
  /** 传百分比 = 写入覆盖；传 `null` = 删掉覆盖（回到 100% 随模板）。 */
  onChange: (percent: number | null) => void;
  /** 拖动中的即时反馈：`:root { --photo-scale: …; }`。空串 = 清掉探针。 */
  onProbe?: (css: string) => void;
}

export default function PhotoScaleControl({
  value,
  customized,
  hasPhoto,
  disabled = false,
  defaultHint,
  restore,
  onChange,
  onProbe,
}: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 没有照片时系数是**惰性**的（PDF/Word 连页头空间都不预留，见设计 §6.3）：
  // 所以"拖不动"不是功能缺失，而是"这一项对这份简历没有意义"。
  const noPhoto = hasPhoto === false;
  const locked = disabled || noPhoto;

  // 父组件确认了新值之后交回权威值，避免滑块停在中间态。
  const signature = `${value}:${customized}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDragging(null);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  /**
   * 夹进滑杆区间并取整到百分比。
   *
   * **刻意不"对齐到 2% 网格"**：`step = 2` 是拖动手感，不是存储契约。后端白名单只校验
   * `0.6–1.6` 区间（`round(number, 3)`），所以 `1.15` 是一个合法值（设计 §8.2 就拿它举例）。
   * 若在这里把 115 吸附到 116，界面上就会写着 116% 而纸面画的是 115%——正是"松手后跳一下"
   * 那种最难解释的偏差。
   */
  const normalize = (value: number): number => {
    if (!Number.isFinite(value)) return toPhotoPercent(1);
    return Math.round(Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, value)));
  };

  const shown = normalize(dragging ?? value);

  const commit = (next: number) => {
    if (noPhoto) return;
    const rounded = normalize(next);
    setDragging(rounded);
    // 即时反馈先于提交：探针写的就是后端 `format_css` 会写的那条 `:root` 声明。
    // 100% 时探针返回空串（后端也不写），所以"拖回 100%"与"从没设过"完全等价。
    onProbe?.(photoScaleProbeCss(fromPhotoPercent(rounded)));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onChange(rounded);
    }, COMMIT_DEBOUNCE_MS);
  };

  const reset = () => {
    if (!customized) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDragging(null);
    onProbe?.("");
    // 删键而不是写回 100：存储里"没调过"只有一种形态，以后模板改默认策略时才会跟着变。
    onChange(null);
  };

  return (
    <Space size={6}>
      {/* 双击标题恢复默认（与行距 / 页边距 / 字号同一套交互）。
          提示走 Tooltip 而不是原生 title：后者只对鼠标可见，键盘 / 读屏用户拿不到
          "这里可双击"这条唯一可发现性信息。 */}
      <Tooltip title={t("resume.photo.scale.resetTooltip")}>
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label={t("resume.photo.scale.resetLabel")}
          onDoubleClick={reset}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          {t("resume.photo.scale.label")}
        </span>
      </Tooltip>
      <Space size={2} align="center">
        <Button
          size="small"
          type="text"
          icon={<MinusOutlined />}
          aria-label={t("resume.photo.scale.decrease")}
          disabled={locked || shown <= MIN_PERCENT}
          onClick={() => commit(shown - PERCENT_STEP)}
        />
        <Slider
          className="resume-photo-scale-slider"
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={PERCENT_STEP}
          value={shown}
          disabled={locked}
          aria-label={t("resume.photo.scale.sliderLabel")}
          ariaLabelForHandle={t("resume.photo.scale.sliderLabel")}
          tooltip={{ formatter: (value) => (value == null ? "" : `${Math.round(value)}%`) }}
          // 宽度可收缩：`flex-basis` 70px 是"舒服的宽度"，但下限必须是 0——滑杆写死
          // `minWidth: 56` 时，内联样式优先级高于任何 CSS 规则，制作台左栏（三列 grid）
          // 在 360–380px 时这一行会横向溢出 10px，把「+」画到读数胶囊底下。
          // 弹窗里这条下限本来也走不到：那里的滑杆宽度由 `.is-stacked .ant-slider`
          // 的 `width: 200px` 决定（200 > 56），压缩只在侧栏这类窄宿主里发生。
          style={{ flex: "1 1 70px", minWidth: 0, margin: "0 2px" }}
          onChange={commit}
        />
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label={t("resume.photo.scale.increase")}
          disabled={locked || shown >= MAX_PERCENT}
          onClick={() => commit(shown + PERCENT_STEP)}
        />
      </Space>
      {/* 读数仍显示（`100%`）：禁用态下"这一项现在是多少"依然是有用的信息。 */}
      <span className="resume-measure-tail">
        <Typography.Text type="secondary" className="resume-measure-value">
          {shown}%
        </Typography.Text>
        {/* 没有照片时这个位置写原因，而不是留空：滑杆灰着又没有任何解释，用户会以为
            控件坏了。位置始终占着，读数才不会左右跳。 */}
        <span className={`resume-measure-source${customized && !noPhoto ? " is-empty" : ""}`}>
          {noPhoto ? (
            t("resume.photo.scale.noPhoto")
          ) : restore?.visible ? (
            // 改过之后这一格由 ↺ 接管（与行距/页边距同一处入口）。
            <ParamResetButton label={t("resume.photo.scale.label")} onReset={restore.onReset} />
          ) : customized ? (
            ""
          ) : (
            (defaultHint ?? t("resume.photo.scale.hintTemplate"))
          )}
        </span>
      </span>
    </Space>
  );
}
