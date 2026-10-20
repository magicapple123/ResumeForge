// SPDX-License-Identifier: Apache-2.0
/**
 * 页边距控件（T5 搬迁 → 项 4a 滑块化）：从导出面板搬进预览的版式栏。
 *
 * 为什么搬家：页边距决定的是「眼前这份简历长什么样」，不是「导出成什么文件」。把它放在
 * 导出面板里，用户必须先开面板才能调版面，而且调完面板一关就看不到效果。搬过来之后
 * 与行距/字号并列，改完立刻重渲染。
 *
 * 为什么从数字框改成滑块（4a / D5）：三个控件（字号 / 行距 / 页边距）是同一类操作——
 * "边看边找，直到看着合适"。`InputNumber` 是"我已经知道要填 14"的思维，版式调整 100%
 * 属于另一种。形态与 `LineHeightControl` 同构（防抖、两端 ±、读数、随模板、复位），
 * 这样三行的视觉与手感一致。
 *
 * 取值范围与落点只有一份实现：`utils/pagePadding.ts`（`MIN/MAX` 与后端 FORMAT_FIELDS
 * 逐字一致，`clampPagePadding` 负责收口）。这里只管交互，不重复定义常量。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { MAX_PAGE_PADDING, MIN_PAGE_PADDING, clampPagePadding } from "../../utils/pagePadding";
import { pagePaddingProbeCss } from "../../utils/resumeFormatProbe";

/**
 * 提交防抖（毫秒）。
 *
 * 与行距同一档：页边距没有本地探针，每次提交都要后端重渲染一次，所以比字号的 180ms
 * 更保守——120ms 足以把一次拖动折叠成一次请求，又短到松手后几乎立刻看到结果。
 */
const COMMIT_DEBOUNCE_MS = 120;

/** 滑块步长：与后端 `FORMAT_FIELDS.page_padding.step` 一致，也与两端按钮共用一套边界。 */
const PAGE_PADDING_STEP = 1;

interface Props {
  /** 当前生效的页边距（用户的覆盖值，或模板默认值）；单位 mm。 */
  value: number;
  /** 用户是否设过覆盖：没设过时显示「随模板」，恢复按钮不可用。 */
  customized: boolean;
  disabled?: boolean;
  /** 没设过覆盖时显示的来源标签：随模板 / 随版式（选了版式预设时）。 */
  defaultHint?: string;
  /** 传数值 = 写入覆盖；传 `null` = 删掉覆盖（回到随模板）。 */
  onChange: (pagePadding: number | null) => void;
  /**
   * 拖动中的即时反馈（项 6 / D10）：与后端 `css_rule` 逐字一致的 CSS。
   * 传空串 = 清掉探针（复位时）。
   */
  onProbe?: (css: string) => void;
}

export default function PagePaddingControl({
  value,
  customized,
  disabled = false,
  defaultHint = "随模板",
  onChange,
  onProbe,
}: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 父组件确认了新值（提交成功或外部改动）后交回权威值，避免滑块停在中间态。
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

  // step=1 时不会有小数尾巴，但仍走同一个收口函数：越界值（历史草稿 / 程序化赋值）
  // 必须与后端白名单说同一件事，否则"设了 30mm，导出还是默认"。
  const shown = clampPagePadding(dragging ?? value);

  const commit = (next: number) => {
    const rounded = clampPagePadding(next);
    setDragging(rounded);
    // 即时反馈先于提交：探针与最终渲染是同一条规则的同一种数字格式（D10）。
    onProbe?.(pagePaddingProbeCss(rounded));
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
    // 删键而不是写回模板默认值：模板以后更新默认页边距时，这些简历才跟着变。
    onChange(null);
  };

  return (
    <Space size={6}>
      {/* 双击标题恢复默认（原先是末尾的 ↺ 按钮）。
          提示走 Tooltip 而不是原生 title：后者只对鼠标可见（理由同 LineHeightControl）。
          Tooltip 不产生 DOM，`<span>` 仍是 `Space` 的直接子节点。 */}
      <Tooltip title="双击或按回车恢复默认页边距">
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label="页边距（双击或按回车恢复默认）"
          onDoubleClick={reset}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          页边距
        </span>
      </Tooltip>
      <Space size={2} align="center">
        <Button
          size="small"
          type="text"
          icon={<MinusOutlined />}
          aria-label="减小页边距"
          disabled={disabled || shown <= MIN_PAGE_PADDING}
          onClick={() => commit(shown - PAGE_PADDING_STEP)}
        />
        <Slider
          className="resume-page-padding-slider"
          min={MIN_PAGE_PADDING}
          max={MAX_PAGE_PADDING}
          step={PAGE_PADDING_STEP}
          value={shown}
          disabled={disabled}
          aria-label="页边距（拖动调整）"
          ariaLabelForHandle="页边距"
          tooltip={{ formatter: (value) => (value == null ? "" : `${value}mm`) }}
          style={{ flex: "1 1 70px", minWidth: 56, margin: "0 2px" }}
          onChange={commit}
        />
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label="增大页边距"
          disabled={disabled || shown >= MAX_PAGE_PADDING}
          onClick={() => commit(shown + PAGE_PADDING_STEP)}
        />
      </Space>
      {/* 读数与来源标签各占一列（定宽，见 modules.css），与行距那一行落在同一条竖线上。 */}
      <span className="resume-measure-tail">
        <Typography.Text type="secondary" className="resume-measure-value">
          {shown}mm
        </Typography.Text>
        {/* 「随模板」只在没设过覆盖时出现：设过之后这个数字就是用户自己的选择，
            再标"随模板"会让人以为模板一改自己的值也会跟着变。位置始终保留，
            否则拖一下滑杆读数就会右移。 */}
        <span className={`resume-measure-source${customized ? " is-empty" : ""}`}>
          {customized ? "" : defaultHint}
        </span>
      </span>
    </Space>
  );
}
