/**
 * 行距控件（R20）：滑块 + 两端 ±0.05 + 读数 + 恢复默认。
 *
 * 单独成文件有两个原因：主版式控件已经逼近 500 行预算；行距是**唯一有防抖提交**的
 * 版式项（字号有本地探针，行距每次提交都要后端重渲染），把"拖动中值 / 提交 / 复位"
 * 这一套状态收在一处，比塞进主组件更容易看懂。
 */
import { MinusOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

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
  /** 用户是否设过覆盖：没设过时显示「随模板」，恢复按钮不可用。 */
  customized: boolean;
  disabled?: boolean;
  /** 传数值 = 写入覆盖；传 null = 删掉覆盖（回到随模板）。 */
  onChange: (lineHeight: number | null) => void;
  compact?: boolean;
}

export default function LineHeightControl({
  value,
  customized,
  disabled = false,
  onChange,
  compact = false,
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
    onChange(null);
  };

  return (
    <Space size={6}>
      {!compact && <Typography.Text type="secondary">行距</Typography.Text>}
      <Space size={2} align="center">
        <Tooltip title="收紧行距（-0.05）">
          <Button
            size="small"
            type="text"
            icon={<MinusOutlined />}
            aria-label="减小行距"
            disabled={disabled || shown <= LINE_HEIGHT_MIN}
            onClick={() => commit(shown - LINE_HEIGHT_STEP)}
          />
        </Tooltip>
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
          style={{ width: 120, margin: "0 2px" }}
          onChange={commit}
        />
        <Tooltip title="放宽行距（+0.05）">
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            aria-label="增大行距"
            disabled={disabled || shown >= LINE_HEIGHT_MAX}
            onClick={() => commit(shown + LINE_HEIGHT_STEP)}
          />
        </Tooltip>
      </Space>
      <Typography.Text type="secondary" style={{ minWidth: 34, display: "inline-block" }}>
        {shown.toFixed(2)}
      </Typography.Text>
      {!customized && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          随模板
        </Typography.Text>
      )}
      <Tooltip title="恢复模板默认行距">
        <Button
          size="small"
          type="text"
          icon={<UndoOutlined />}
          disabled={disabled || !customized}
          aria-label="恢复默认行距"
          onClick={reset}
        />
      </Tooltip>
    </Space>
  );
}
