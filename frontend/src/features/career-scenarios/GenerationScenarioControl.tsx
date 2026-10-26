// SPDX-License-Identifier: Apache-2.0
/**
 * 生成弹窗内「职业场景（用于本次生成）」区块（A2 / 契约 §2.5）。
 *
 * 语义要点（改之前先读）：
 * - **默认关闭**：关闭时父组件不带 `career_context` 字段，旧请求逐字节不变；
 * - 打开后可选**已保存场景**或**内置快捷场景**，并列出本次会发送的维度；
 * - **就业状态单独保险框**（默认关闭）：即使场景里存了就业状态，也要显式勾选才发送；
 * - 目录加载失败只降级提示，不阻断开始生成；
 * - 选择状态在组件内部：弹窗打开后全站切换场景**不会**改写这里已选的内容
 *   （提交时也不重新读全局选择）。
 */
import { Alert, Checkbox, Select, Space, Switch, Tag, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { configuredDimensionLines, hasEmploymentStatus } from "./dimensions";
import { loadScenarioSelection } from "./scenarioSelectionStorage";
import type { CareerContextRequest, CareerScenario } from "./types";
import { useScenarioCatalog } from "./useScenarioCatalog";
import { useScenarioSelection } from "./useScenarioSelection";

interface Props {
  /** 要放进本次生成请求的上下文；null = 不启用。 */
  value: CareerContextRequest | null;
  onChange: (next: CareerContextRequest | null) => void;
  disabled?: boolean;
}

export default function GenerationScenarioControl({ value, onChange, disabled = false }: Props) {
  useLocale();
  const { scenarios, loading: scenariosLoading, error: scenariosError } = useScenarioSelection();
  const { catalog, loading: catalogLoading, error: catalogError } = useScenarioCatalog(true);
  // 当前窗口选择只在挂载时读一次：之后全站切换不回流（本区块的已选内容优先）。
  const [suggestedId] = useState<number | null>(() => loadScenarioSelection());
  const [enabled, setEnabled] = useState(value != null);

  const savedScenario = scenarios.find((item) => item.id === value?.scenario_id) ?? null;
  const preset = catalog?.presets.find((item) => item.key === value?.preset_key) ?? null;
  const selectedConfig = savedScenario?.config ?? preset?.config ?? null;

  const dimensions = configuredDimensionLines(selectedConfig, {
    includeEmploymentStatus: value?.include_employment_status === true,
  });

  const toggleEnabled = (next: boolean) => {
    setEnabled(next);
    if (!next) {
      onChange(null);
      return;
    }
    if (value) return;
    // 打开时只**读一次**当前窗口选择做预选；读不到就让用户自己挑。
    const candidate = scenarios.find((item) => item.id === suggestedId);
    onChange(candidate ? savedContext(candidate) : null);
  };

  const pickSaved = (scenarioId: number) => {
    const scenario = scenarios.find((item) => item.id === scenarioId);
    onChange(scenario ? savedContext(scenario) : null);
  };

  const pickPreset = (presetKey: string) => {
    const picked = catalog?.presets.find((item) => item.key === presetKey);
    if (!picked || !catalog) {
      onChange(null);
      return;
    }
    onChange({
      preset_key: picked.key,
      catalog_version: catalog.catalog_version,
      include_employment_status: false,
    });
  };

  const toggleEmploymentStatus = (checked: boolean) => {
    if (!value) return;
    onChange({ ...value, include_employment_status: checked });
  };

  const canDiscloseEmployment = hasEmploymentStatus(selectedConfig);

  return (
    <div>
      <Space size={10} align="center" style={{ marginBottom: 8 }}>
        <Switch
          checked={enabled}
          disabled={disabled || undefined}
          onChange={toggleEnabled}
          aria-label={t("careerScenarios.generate.switch")}
        />
        <Typography.Text strong>{t("careerScenarios.generate.title")}</Typography.Text>
      </Space>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        {t("careerScenarios.generate.switchHint")}
      </Typography.Text>

      {enabled ? (
        <Space orientation="vertical" size={10} style={{ width: "100%" }}>
          {catalogError ? (
            <Alert type="warning" showIcon title={t("careerScenarios.generate.catalogError")} />
          ) : null}
          {scenariosError ? (
            <Alert type="warning" showIcon title={t("careerScenarios.generate.listError")} />
          ) : null}

          <div>
            <Typography.Text type="secondary">
              {t("careerScenarios.generate.savedLabel")}
            </Typography.Text>
            <Select
              style={{ width: "100%", marginTop: 4 }}
              aria-label={t("careerScenarios.generate.savedLabel")}
              value={value?.scenario_id}
              placeholder={t("careerScenarios.generate.savedPlaceholder")}
              loading={scenariosLoading}
              disabled={disabled || undefined}
              onChange={pickSaved}
              options={scenarios.map((item) => ({ value: item.id, label: item.name }))}
              notFoundContent={t("careerScenarios.generate.emptyScenarios")}
            />
          </div>

          {!catalogError ? (
            <div>
              <Typography.Text type="secondary">
                {t("careerScenarios.generate.presetLabel")}
              </Typography.Text>
              <Select
                style={{ width: "100%", marginTop: 4 }}
                aria-label={t("careerScenarios.generate.presetLabel")}
                value={value?.preset_key}
                placeholder={t("careerScenarios.generate.presetPlaceholder")}
                loading={catalogLoading}
                disabled={disabled || undefined}
                onChange={pickPreset}
                options={(catalog?.presets ?? []).map((item) => ({
                  value: item.key,
                  label: item.name,
                }))}
                notFoundContent={t("careerScenarios.generate.emptyScenarios")}
              />
            </div>
          ) : null}

          {!value ? (
            <Typography.Text type="warning">
              {t("careerScenarios.generate.chooseOneHint")}
            </Typography.Text>
          ) : null}

          <div>
            <Typography.Text strong>{t("careerScenarios.generate.dimensionTitle")}</Typography.Text>
            <div style={{ marginTop: 6 }}>
              {dimensions.length === 0 ? (
                <Typography.Text type="secondary">
                  {t("careerScenarios.generate.dimensionEmpty")}
                </Typography.Text>
              ) : (
                dimensions.map((line) => (
                  <Tag key={line.key} style={{ marginBottom: 6 }}>
                    {t("careerScenarios.generate.dimensionLine", {
                      label: line.label,
                      value: line.value,
                    })}
                  </Tag>
                ))
              )}
            </div>
          </div>

          <Space size={8} align="start">
            <Checkbox
              checked={value?.include_employment_status === true}
              disabled={disabled || !value || !canDiscloseEmployment || undefined}
              onChange={(event) => toggleEmploymentStatus(event.target.checked)}
            >
              {t("careerScenarios.generate.employmentStatusLabel")}
            </Checkbox>
          </Space>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {canDiscloseEmployment || !value
              ? t("careerScenarios.generate.employmentStatusHint")
              : t("careerScenarios.generate.employmentStatusUnavailable")}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block" }}>
            {t("careerScenarios.generate.privacyHint")}
          </Typography.Text>
        </Space>
      ) : null}
    </div>
  );
}

/** 已保存场景 → 请求上下文：revision 用**选择时**的值，服务端据此判 409。 */
function savedContext(scenario: CareerScenario): CareerContextRequest {
  return {
    scenario_id: scenario.id,
    expected_revision: scenario.revision,
    include_employment_status: false,
  };
}
