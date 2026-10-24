// SPDX-License-Identifier: Apache-2.0
/**
 * 打印检查（D10）：打开弹层时**现场**从纸面 iframe 读颜色并算对比度。
 *
 * 为什么按需测而不是常驻：读 `getComputedStyle` 会触发布局，而这段提示只在用户主动
 * 检查时才需要新鲜数据；常驻测量会让"拖动滑杆"这种高频路径每次多一次强制布局。
 *
 * 只读：结果只用来显示提示，没有写回颜色的路径（任务要求"不自动改稿"）。
 */
import { InfoCircleOutlined } from "@ant-design/icons";
import { Button, Popover, Space, Tag, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import {
  diagnoseColors,
  readColorSample,
  type DiagnosticItem,
  type DiagnosticResult,
} from "../../../features/resume-proview/printDiagnostics";
import type { RefObject } from "react";
import { useState } from "react";

const ITEM_LABEL_KEY: Record<DiagnosticItem, MessageKey> = {
  text: "proview.diagnostics.item.text",
  accent: "proview.diagnostics.item.accent",
  line: "proview.diagnostics.item.line",
};

const LOW_KEY: Record<DiagnosticItem, MessageKey> = {
  text: "proview.diagnostics.textLow",
  accent: "proview.diagnostics.accentLow",
  line: "proview.diagnostics.lineLow",
};

function formatRatio(ratio: number): string {
  return (Math.round(ratio * 10) / 10).toFixed(1);
}

interface Props {
  /** 预览视口：里面有 N 个纸面 iframe。 */
  viewportRef: RefObject<HTMLElement | null>;
}

export default function PrintCheckControl({ viewportRef }: Props) {
  const [result, setResult] = useState<DiagnosticResult | null>(null);
  const [open, setOpen] = useState(false);

  const measure = () => {
    const frame = viewportRef.current?.querySelector("iframe");
    const doc = frame?.contentDocument ?? null;
    setResult(diagnoseColors(readColorSample(doc)));
  };

  const content = (
    <Space direction="vertical" size={8} style={{ maxWidth: 320 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("proview.diagnostics.hint")}
      </Typography.Text>
      {result === null ? null : result.measured ? (
        result.findings.map((finding) => (
          <Space key={finding.item} size={6} align="start">
            <Tag>{t(ITEM_LABEL_KEY[finding.item])}</Tag>
            <Typography.Text type={finding.ok ? "secondary" : "warning"} style={{ fontSize: 12 }}>
              {finding.ok
                ? t("proview.diagnostics.item.ok", { ratio: formatRatio(finding.ratio) })
                : t(LOW_KEY[finding.item], { ratio: formatRatio(finding.ratio) })}
            </Typography.Text>
          </Space>
        ))
      ) : (
        <Typography.Text type="secondary">{t("proview.diagnostics.unavailable")}</Typography.Text>
      )}
      {result !== null && result.measured && result.findings.every((item) => item.ok) ? (
        <Typography.Text type="success" style={{ fontSize: 12 }}>
          {t("proview.diagnostics.ok")}
        </Typography.Text>
      ) : null}
      <Button size="small" onClick={measure}>
        {t("proview.diagnostics.refresh")}
      </Button>
    </Space>
  );

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      title={t("proview.diagnostics.title")}
      content={content}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) measure();
      }}
    >
      <Tooltip title={t("proview.diagnostics.hint")}>
        <Button
          size="small"
          type="text"
          icon={<InfoCircleOutlined />}
          aria-label={t("proview.diagnostics.label")}
        >
          {t("proview.diagnostics.label")}
        </Button>
      </Tooltip>
    </Popover>
  );
}
