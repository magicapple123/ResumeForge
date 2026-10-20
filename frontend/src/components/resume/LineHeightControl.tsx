// SPDX-License-Identifier: Apache-2.0
/**
 * 行距控件（R20）：滑块 + 两端 ±0.05 + 读数 + 恢复默认。
 *
 * 单独成文件有两个原因：主版式控件已经逼近 500 行预算；行距是**唯一有防抖提交**的
 * 版式项（字号有本地探针，行距每次提交都要后端重渲染），把"拖动中值 / 提交 / 复位"
 * 这一套状态收在一处，比塞进主组件更容易看懂。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { lineHeightProbeCss } from "../../utils/resumeFormatProbe";

/** 可用区间与步长：与后端 `FORMAT_FIELDS` 的 line_height 逐项一致。 */
export const LINE_HEIGHT_MIN = 1.2;
export const LINE_HEIGHT_MAX = 2.2;
export const LINE_HEIGHT_STEP = 0.05;

/**
 * 提交防抖（毫秒）。
 *
 * 行距没有本地探针（不像字号能直接改 `--fs`），每次提交都要向后端重渲染一次，所以
 * 比字号的 180ms 更保守：120ms 足以把一次拖动折叠成一次请求，又短到松手后几乎立刻
 * 看到结果。
 */
const COMMIT_DEBOUNCE_MS = 120;

interface Props {
  /** 当前生效的行距（用户的覆盖值，或模板默认值）。 */
  value: number;
  /** 没设过覆盖时显示的来源标签：随模板 / 随版式（选了版式预设时）。 */
  defaultHint?: string;
  /** 用户是否设过覆盖：没设过时显示来源标签，恢复按钮不可用。 */
  customized: boolean;
  disabled?: boolean;
  /** 传数值 = 写入覆盖；传 null = 删掉覆盖（回到随模板）。 */
  onChange: (lineHeight: number | null) => void;
  /**
   * 拖动中的即时反馈（项 6 / D10）：把与后端 `css_rule` 逐字一致的 CSS 交出去，
   * 由宿主注入预览 iframe。传空串 = 清掉探针（复位时）。
   */
  onProbe?: (css: string) => void;
}

export default function LineHeightControl({
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

  const shown = Math.round((dragging ?? value) * 100) / 100;

  const commit = (next: number) => {
    // 0.05 步长下的浮点尾巴（1.7000000000000002）会直接落到落库值与读数里，先规整。
    const rounded =
      Math.round(Math.min(LINE_HEIGHT_MAX, Math.max(LINE_HEIGHT_MIN, next)) * 100) / 100;
    setDragging(rounded);
    // 即时反馈先于提交：探针与最终渲染必须是**同一条规则的同一种数字格式**（D10）。
    onProbe?.(lineHeightProbeCss(rounded));
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
    onChange(null);
  };

  return (
    <Space size={6}>
      {/* 双击标题恢复默认（原先是末尾的 ↺ 按钮，四个控件就有四颗图标）。
          提示改用 Tooltip 而不是原生 title：原生 title 只对鼠标可见，键盘用户拿不到
          "这里可双击"这条唯一可发现性信息；Tooltip 同时由 aria-label 兜住读屏。
          Tooltip 只挂事件、不产生 DOM，`<span>` 仍是 `Space` 的直接子节点
          （`.resume-measure-*` 的栅格约束依赖这个层级）。
          标签在行首、气泡默认向上弹，不会像 ± 按钮那样盖住同排的滑块。
          单击刻意不重置（误点代价是丢掉手调的行距），所以键盘侧给的是 Enter / 空格。 */}
      <Tooltip title="双击或按回车恢复默认行距">
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label="行距（双击或按回车恢复默认）"
          onDoubleClick={reset}
          onKeyDown={(event) => {
            // 只接管 Enter / 空格：其它按键必须留给滑块的既有键盘行为。
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          行距
        </span>
      </Tooltip>
      <Space size={2} align="center">
        <Button
          size="small"
          type="text"
          icon={<MinusOutlined />}
          aria-label="减小行距"
          disabled={disabled || shown <= LINE_HEIGHT_MIN}
          onClick={() => commit(shown - LINE_HEIGHT_STEP)}
        />
        <Slider
          className="resume-line-height-slider"
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={LINE_HEIGHT_STEP}
          value={shown}
          disabled={disabled}
          aria-label="行距（拖动调整）"
          ariaLabelForHandle="行距"
          tooltip={{ formatter: (value) => (value == null ? "" : Number(value).toFixed(2)) }}
          style={{ flex: "1 1 70px", minWidth: 56, margin: "0 2px" }}
          onChange={commit}
        />
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label="增大行距"
          disabled={disabled || shown >= LINE_HEIGHT_MAX}
          onClick={() => commit(shown + LINE_HEIGHT_STEP)}
        />
      </Space>
      {/* 读数与来源标签**各占一列**（定宽，见 modules.css）：三行滑杆的读数因此落在
          同一条竖线上。此前两者一起靠右收口，字号那一行没有来源标签，读数就整体右移。 */}
      <span className="resume-measure-tail">
        <Typography.Text type="secondary" className="resume-measure-value">
          {shown.toFixed(2)}
        </Typography.Text>
        {/* 来源标签做成小胶囊：一段裸露的说明文字紧挨着读数时，会被读成"读数的后半句"。
            没设过覆盖才显示内容，但**位置始终占着**——否则用户一拖滑杆，
            读数就会向右跳一格，三行读数又对不齐了。 */}
        <span className={`resume-measure-source${customized ? " is-empty" : ""}`}>
          {customized ? "" : defaultHint}
        </span>
      </span>
    </Space>
  );
}
