// SPDX-License-Identifier: Apache-2.0
/**
 * #29a：岗位变体的**唯一**创建入口。
 *
 * 旧页面把「按职业场景派生」与「派生岗位变体」两块几乎一样的表单并排放，各带一个刷新按钮，
 * 用户不知道什么时候该用哪个。现在改为 Segmented 二选一 + 一个「创建变体」：
 * 同一时间只渲染一个表单，两路共用名称输入与提交按钮；列表刷新统一放到已有变体列表。
 */
import { Alert, Button, Input, Segmented, Select, Space, Typography } from "antd";
import { App } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { autoNameTime } from "./model";
import type { CareerContextRequest } from "../../../types";
import { fetchCareerScenarioCatalog, listCareerScenarios } from "../../career-scenarios/api";
import type { CareerScenario, CareerScenarioCatalog } from "../../career-scenarios/types";
import { createScenarioVariant } from "./versionsApi";
import type { VariantOut, VersionOut } from "./types";

const SAVED_PREFIX = "saved:";
const PRESET_PREFIX = "preset:";

type CreateMode = "manual" | "scenario";

interface Props {
  resumeId: number | null;
  /** 命名版本列表：手动派生时可选择以哪一版为基底。 */
  versions: VersionOut[];
  /** 从当前简历（或指定命名版本）派生岗位变体。 */
  onCreateManual: (name: string, baseVersionId?: number | null) => Promise<VariantOut | null>;
  /** 从职业场景派生变体后通知宿主刷新列表。 */
  onCreated?: () => void;
}

export default function VariantCreatePanel({
  resumeId,
  versions,
  onCreateManual,
  onCreated,
}: Props) {
  useLocale();
  const { message } = App.useApp();
  const [mode, setMode] = useState<CreateMode>("manual");
  const [name, setName] = useState("");
  const [baseVersionId, setBaseVersionId] = useState<number | undefined>(undefined);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [creating, setCreating] = useState(false);
  const [catalog, setCatalog] = useState<CareerScenarioCatalog | null>(null);
  const [scenarios, setScenarios] = useState<CareerScenario[]>([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioError, setScenarioError] = useState(false);

  const loadScenarios = useCallback(async () => {
    setScenarioLoading(true);
    setScenarioError(false);
    const [catalogResult, scenariosResult] = await Promise.allSettled([
      fetchCareerScenarioCatalog(),
      listCareerScenarios(),
    ]);
    if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
    if (scenariosResult.status === "fulfilled") {
      const items = scenariosResult.value?.items;
      setScenarios(Array.isArray(items) ? items : []);
    }
    // 目录失败不阻断已保存场景；两者都失败才提示（与旧表单同一口径）。
    if (catalogResult.status === "rejected" && scenariosResult.status === "rejected") {
      setScenarioError(true);
    }
    setScenarioLoading(false);
  }, []);

  // 场景数据只在切到"从场景派生"时按需拉取：默认的手动派生不需要它。
  useEffect(() => {
    if (mode !== "scenario") return;
    queueMicrotask(() => {
      void loadScenarios();
    });
  }, [loadScenarios, mode]);

  const scenarioOptions = useMemo(() => {
    const saved = scenarios.map((scenario) => ({
      value: SAVED_PREFIX + String(scenario.id),
      label: scenario.name,
    }));
    const presets = (catalog?.presets ?? []).map((preset) => ({
      value: PRESET_PREFIX + preset.key,
      label: preset.name,
    }));
    return [
      ...(saved.length ? [{ label: t("careerScenarios.selector.saved"), options: saved }] : []),
      ...(presets.length
        ? [{ label: t("careerScenarios.selector.preset"), options: presets }]
        : []),
    ];
  }, [catalog, scenarios]);

  const selectedContext = useCallback((): CareerContextRequest | null => {
    if (selectedScenario.startsWith(SAVED_PREFIX)) {
      const id = Number(selectedScenario.slice(SAVED_PREFIX.length));
      const scenario = scenarios.find((item) => item.id === id);
      return scenario ? { scenario_id: scenario.id, expected_revision: scenario.revision } : null;
    }
    if (selectedScenario.startsWith(PRESET_PREFIX) && catalog) {
      return {
        preset_key: selectedScenario.slice(PRESET_PREFIX.length),
        catalog_version: catalog.catalog_version,
      };
    }
    return null;
  }, [catalog, scenarios, selectedScenario]);

  const submit = async () => {
    if (resumeId == null) return;
    // #28/#29：名称留空自动按时间命名，创建按钮不因"没名字"而不可用。
    const effectiveName =
      name.trim() || t("versions.variants.create.defaultName", { time: autoNameTime() });
    if (mode === "scenario") {
      const context = selectedContext();
      if (!context) {
        message.warning(t("versions.variants.create.scenarioRequired"));
        return;
      }
      setCreating(true);
      try {
        await createScenarioVariant(resumeId, { name: effectiveName, career_context: context });
        message.success(t("versions.variants.create.success", { name: effectiveName }));
        setName("");
        setSelectedScenario("");
        onCreated?.();
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      } finally {
        setCreating(false);
      }
      return;
    }
    setCreating(true);
    const created = await onCreateManual(effectiveName, baseVersionId ?? null);
    setCreating(false);
    if (created) {
      message.success(t("versions.variants.create.success", { name: created.name }));
      setName("");
    }
  };

  return (
    <section
      aria-label={t("versions.variants.create.title")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        border: "1px solid var(--rf-border-subtle)",
        borderRadius: "var(--rf-radius-control)",
      }}
    >
      <Space size={8} wrap>
        <Typography.Text strong>{t("versions.variants.create.title")}</Typography.Text>
        <Segmented<CreateMode>
          value={mode}
          onChange={(value) => setMode(value)}
          aria-label={t("versions.variants.create.modeAria")}
          options={[
            { value: "manual", label: t("versions.variants.mode.manual") },
            { value: "scenario", label: t("versions.variants.mode.scenario") },
          ]}
        />
      </Space>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {mode === "scenario"
          ? t("careerScenarios.variant.hint")
          : t("versions.variants.create.hint")}
      </Typography.Text>
      <Space wrap size={8}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("versions.variants.create.namePlaceholder")}
          aria-label={t("versions.variants.create.name")}
          maxLength={256}
          style={{ width: 220 }}
        />
        {mode === "manual" ? (
          <Select
            allowClear
            value={baseVersionId}
            onChange={(value) => setBaseVersionId(value)}
            placeholder={t("versions.variants.base.current")}
            aria-label={t("versions.variants.base.current")}
            style={{ width: 200 }}
            options={versions.map((version) => ({ value: version.id, label: version.name }))}
          />
        ) : (
          <Select
            value={selectedScenario || undefined}
            onChange={(value: string) => setSelectedScenario(value)}
            placeholder={t("careerScenarios.variant.scenarioPlaceholder")}
            aria-label={t("careerScenarios.variant.scenario")}
            loading={scenarioLoading}
            showSearch
            optionFilterProp="label"
            options={scenarioOptions}
            style={{ width: 240 }}
          />
        )}
        <Button type="primary" loading={creating} onClick={() => void submit()}>
          {t("versions.variants.create.action")}
        </Button>
      </Space>
      {scenarioError ? (
        <Alert
          type="warning"
          showIcon
          title={t("careerScenarios.variant.loadFailed")}
          action={
            <Button size="small" onClick={() => void loadScenarios()}>
              {t("versions.error.retry")}
            </Button>
          }
        />
      ) : null}
    </section>
  );
}
