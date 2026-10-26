// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「外发与用量」（R04）：调用模型/外发前看清楚"要发什么、花了多少"。
 *
 * ## 隐私边界（结构性）
 *
 * 外发预览的正文只存在本组件 state 与本次响应里：不写 localStorage/sessionStorage、
 * 不输出日志、不放进任何全局 store；关掉设置页即丢。组件不自动请求，两个动作都由按钮触发。
 */
import { Alert, Button, Card, Divider, Input, InputNumber, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import { useToast } from "../../hooks/useToast";
import { pt } from "../../features/resume-provenance/i18n";
import { useLocale } from "../../i18n/i18nContext";
import {
  fetchUsagePricing,
  fetchUsageSummary,
  previewOutbound,
  saveUsagePricing,
} from "../../features/resume-provenance/api";
import type {
  OutboundPreviewOut,
  UsagePricingOut,
  UsageSummaryOut,
} from "../../features/resume-provenance/types";
import OutboundPreviewCard from "../resume/sources/OutboundPreviewCard";
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
  const [pricing, setPricing] = useState<UsagePricingOut>({
    input_per_1k: null,
    output_per_1k: null,
    currency: "USD",
  });
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      setPricingLoading(true);
      void fetchUsagePricing()
        .then((next) => {
          if (!cancelled) setPricing(next);
        })
        .catch(() => {
          // 旧后端没有 pricing 端点时保持未配置态；不阻塞外发预览与用量展示。
        })
        .finally(() => {
          if (!cancelled) setPricingLoading(false);
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitPricing = async () => {
    const values = [pricing.input_per_1k, pricing.output_per_1k];
    const bad = values.some((value) => value !== null && (!Number.isFinite(value) || value < 0));
    if (bad) {
      setPricingError(pt("settings.provenance.pricing.invalid"));
      return;
    }
    // 后端校验：输入/输出单价必须同时配置或同时清空（只填一项会 422）。
    const filled = values.filter((value) => value !== null).length;
    if (filled === 1) {
      setPricingError(pt("settings.provenance.pricing.both"));
      return;
    }
    setPricingSaving(true);
    setPricingError(null);
    try {
      const saved = await saveUsagePricing({
        input_per_1k: pricing.input_per_1k,
        output_per_1k: pricing.output_per_1k,
        currency: pricing.currency.trim() || "CNY",
      });
      setPricing(saved);
      toast.success(pt("settings.provenance.pricing.saved"));
    } catch (caught) {
      const message = errorText(caught) || pt("settings.provenance.pricing.failed");
      setPricingError(message);
      toast.error(message);
    } finally {
      setPricingSaving(false);
    }
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    setUsageError(null);
    try {
      setSummary(await fetchUsageSummary());
    } catch (caught) {
      setUsageError(errorText(caught) || pt("settings.provenance.usageFailed"));
    } finally {
      setUsageLoading(false);
    }
  };

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

        <div data-usage-pricing="1">
          <Typography.Text strong>{pt("settings.provenance.pricing.title")}</Typography.Text>
          <div style={{ fontSize: 12, color: "var(--rf-text-secondary)", marginBottom: 6 }}>
            {pt("settings.provenance.pricing.hint")}
          </div>
          <Space size={8} wrap>
            <InputNumber
              size="small"
              min={0}
              step={0.1}
              value={pricing.input_per_1k}
              disabled={pricingLoading || undefined}
              aria-label={pt("settings.provenance.pricing.input")}
              placeholder={pt("settings.provenance.pricing.input")}
              onChange={(value) =>
                setPricing((current) => ({
                  ...current,
                  input_per_1k: typeof value === "number" ? value : null,
                }))
              }
            />
            <InputNumber
              size="small"
              min={0}
              step={0.1}
              value={pricing.output_per_1k}
              disabled={pricingLoading || undefined}
              aria-label={pt("settings.provenance.pricing.output")}
              placeholder={pt("settings.provenance.pricing.output")}
              onChange={(value) =>
                setPricing((current) => ({
                  ...current,
                  output_per_1k: typeof value === "number" ? value : null,
                }))
              }
            />
            <Input
              size="small"
              value={pricing.currency}
              aria-label={pt("settings.provenance.pricing.currency")}
              style={{ width: 90 }}
              onChange={(event) =>
                setPricing((current) => ({ ...current, currency: event.target.value }))
              }
            />
            <Button
              size="small"
              loading={pricingSaving || undefined}
              onClick={() => void submitPricing()}
            >
              {pt("settings.provenance.pricing.save")}
            </Button>
          </Space>
          {pricingError ? <Alert type="error" showIcon title={pricingError} /> : null}
        </div>

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
