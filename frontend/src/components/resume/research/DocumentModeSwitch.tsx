// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档模式」入口（W14 长 CV）：普通简历 ↔ 长 CV 的开关 + 篇幅上限 + 预算说明。
 *
 * ## 这个组件**不拥有**状态
 *
 * 模式存 在 `resume_record.document_mode`（后端列，snake_case），页数存 `page_limit`，
 * 两者都由宿主（制作台动作条 / 参数栏）保存。这里只做三件事：把当前值画出来、
 * 把用户的选择**夹紧后**回传、把"切换会让页数变小"这件事如实提示（不静默丢页数）。
 *
 * ## 为什么夹紧在前端也算一遍
 *
 * 后端会按模式再夹一次（`normalize_page_limit(value, mode)`，契约 §5.4）。前端这一遍
 * 是为了让控件当场显示"将要保存的值"，而不是等一次往返后跳一下——两处用同一组区间常量
 * （`MODE_PAGE_LIMITS`，旧后端兜底）并各有测试钉住。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Row, Segmented, Select, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { rt } from "../../../features/resume-research/i18n";
import {
  MODE_PAGE_LIMITS,
  defaultPageLimit,
  isOverBudget,
  normalizeDocumentMode,
  type DocumentMode,
} from "../../../features/resume-research/documentMode";

interface Props {
  /** 当前模式（后端 `document_mode`，未知/缺省按普通简历）。 */
  mode: DocumentMode | string | undefined;
  /** 当前篇幅上限。 */
  pageLimit: number;
  /** 保存出口；缺省 = 只读（生成流程等宿主）。 */
  onChange?: (next: { mode: DocumentMode; pageLimit: number }) => void;
  /** 宿主正在保存：控件禁用，避免连点。 */
  saving?: boolean;
  disabled?: boolean;
  /** 目录下发后覆盖本地兜底区间（后端就绪后使用）。 */
  limits?: Partial<Record<DocumentMode, readonly [number, number]>>;
  /** 长 CV 默认页数（后端目录下发后覆盖，缺省 2）。 */
  defaultLongCvPageLimit?: number;
  /** 当前排版结果页数（可选）：超过上限时给一句说明。 */
  pagesNeeded?: number | null;
}

export default function DocumentModeSwitch({
  mode,
  pageLimit,
  onChange,
  saving = false,
  disabled = false,
  limits,
  defaultLongCvPageLimit,
  pagesNeeded,
}: Props) {
  const [notice, setNotice] = useState<"clamped" | null>(null);
  const current = normalizeDocumentMode(mode);
  const readOnly = !onChange;
  const locked = readOnly || disabled || saving;

  const rangeFor = (target: DocumentMode): readonly [number, number] =>
    limits?.[target] ?? MODE_PAGE_LIMITS[target];

  const clampFor = (target: DocumentMode, value: number): number => {
    const [min, max] = rangeFor(target);
    if (!Number.isFinite(value)) {
      return defaultLongCvPageLimit !== undefined && target === "long_cv"
        ? Math.min(max, Math.max(min, defaultLongCvPageLimit))
        : defaultPageLimit(target);
    }
    return Math.min(max, Math.max(min, Math.round(value)));
  };

  const limitOptions = (() => {
    const [min, max] = rangeFor(current);
    return Array.from({ length: max - min + 1 }, (_unused, index) => {
      const value = min + index;
      return { value, label: rt("research.mode.limitOption", { count: value }) };
    });
  })();

  const handleMode = (value: string | number) => {
    if (!onChange) return;
    const next = normalizeDocumentMode(value);
    const nextLimit = clampFor(next, pageLimit);
    setNotice(nextLimit !== pageLimit ? "clamped" : null);
    onChange({ mode: next, pageLimit: nextLimit });
  };

  const handleLimit = (value: number) => {
    if (!onChange) return;
    setNotice(null);
    onChange({ mode: current, pageLimit: clampFor(current, value) });
  };

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Row gutter={8} align="middle">
        <Col flex="none">
          <Space size={4}>
            <Typography.Text strong>{rt("research.mode.label")}</Typography.Text>
            <Tooltip title={rt("research.mode.hint")}>
              <Button
                type="text"
                size="small"
                icon={<InfoCircleOutlined />}
                aria-label={rt("research.mode.hint")}
              />
            </Tooltip>
          </Space>
        </Col>
        <Col flex="auto">
          <Segmented
            value={current}
            disabled={locked || undefined}
            onChange={handleMode}
            aria-label={rt("research.mode.label")}
            options={[
              { value: "resume", label: rt("research.mode.resume") },
              { value: "long_cv", label: rt("research.mode.longCv") },
            ]}
          />
        </Col>
        <Col flex="none">
          <Space size={4}>
            <Typography.Text type="secondary">{rt("research.mode.limitLabel")}</Typography.Text>
            <Select
              value={clampFor(current, pageLimit)}
              disabled={locked || undefined}
              onChange={handleLimit}
              options={limitOptions}
              aria-label={rt("research.mode.limitLabel")}
              style={{ width: 96 }}
            />
          </Space>
        </Col>
      </Row>
      {current === "long_cv" ? (
        <Alert type="info" showIcon title={rt("research.mode.budget")} />
      ) : null}
      {notice === "clamped" ? (
        <Alert type="warning" showIcon title={rt("research.mode.clampedToResume")} />
      ) : null}
      {isOverBudget(pagesNeeded, clampFor(current, pageLimit)) ? (
        <Alert
          type="warning"
          showIcon
          title={rt("research.mode.overBudget", {
            pages: Math.round(Number(pagesNeeded)),
            limit: clampFor(current, pageLimit),
          })}
        />
      ) : null}
      {readOnly ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {rt("research.mode.readonlyHint")}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
