// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「外发与用量」（R04）：调用模型/外发前看清楚"要发什么、花了多少"。
 *
 * ## 隐私边界（结构性）
 *
 * 外发预览的正文只存在本组件 state 与本次响应里：不写 localStorage/sessionStorage、
 * 不输出日志、不放进任何全局 store；关掉设置页即丢。组件不自动请求，两个动作都由按钮触发。
 */
import { Button, Card, Divider, Input, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { pt } from "../../features/resume-provenance/i18n";
import { useLocale } from "../../i18n/i18nContext";
import { fetchUsageSummary, previewOutbound } from "../../features/resume-provenance/api";
import type { OutboundPreviewOut, UsageSummaryOut } from "../../features/resume-provenance/types";
import OutboundPreviewCard from "../resume/sources/OutboundPreviewCard";
import UsagePricingCard from "./UsagePricingCard";
import UsageSummaryCard from "../resume/sources/UsageSummaryCard";

interface Props {
  /** 目标服务名（由设置页从现有 LLM/AI provider 配置取，不在本组件里造清单）。 */
  targetService?: string;
  className?: string;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "";
}

export default function SettingsProvenanceSection({ targetService, className }: Props) {
  useLocale();
  const toast = useToast();
  const [summary, setSummary] = useState<UsageSummaryOut | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<OutboundPreviewOut | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** 取一次用量汇总；失败只在本卡里说明，不影响外发预览。 */
  const loadUsage = async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      setSummary(await fetchUsageSummary({}));
    } catch (caught) {
      setUsageError(errorText(caught) || pt("settings.provenance.usageFailed"));
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      void loadUsage();
    });
    return () => {
      cancelled = true;
    };
    // 只在挂载时取一次；之后靠按钮手动刷新。
  }, []);

  const buildPreview = async () => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const next = await previewOutbound({
        target_service: targetService?.trim() || pt("settings.provenance.defaultTarget"),
        material_categories: [pt("settings.provenance.defaultMaterial")],
        body,
      });
      setPreview(next);
    } catch (caught) {
      const message = errorText(caught) || pt("settings.provenance.previewFailed");
      setPreviewError(message);
      toast.error(message);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Card className={className} data-settings-provenance="1">
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            {pt("settings.provenance.title")}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {pt("settings.provenance.hint")}
          </Typography.Text>
        </div>

        <Space size={8} wrap>
          <Button size="small" loading={usageLoading || undefined} onClick={() => void loadUsage()}>
            {pt("settings.provenance.loadUsage")}
          </Button>
        </Space>
        <UsageSummaryCard
          summary={summary}
          loading={usageLoading}
          error={usageError}
          onRetry={() => void loadUsage()}
        />

        <Divider style={{ margin: "4px 0" }} />

        <UsagePricingCard />

        <Divider style={{ margin: "4px 0" }} />

        <Typography.Text style={{ fontSize: 12 }}>
          {pt("settings.provenance.previewBody")}
        </Typography.Text>
        <Input.TextArea
          rows={3}
          value={body}
          maxLength={20000}
          showCount
          aria-label={pt("settings.provenance.previewBody")}
          onChange={(event) => setBody(event.target.value)}
        />
        <Space size={8}>
          <Button
            size="small"
            type="primary"
            loading={previewing || undefined}
            onClick={() => void buildPreview()}
          >
            {pt("settings.provenance.preview")}
          </Button>
        </Space>
        <OutboundPreviewCard
          preview={preview}
          loading={previewing}
          error={previewError}
          onRetry={() => void buildPreview()}
        />
      </Space>
    </Card>
  );
}
