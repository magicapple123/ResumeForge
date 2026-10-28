// SPDX-License-Identifier: Apache-2.0
/**
 * A5：按职业场景派生已有简历变体（创建 → 生成候选 → 看差异 → 采纳）。
 *
 * 流程刻意分三步，源简历全程只读：派生独立变体（后端冻结场景快照）→ 生成候选
 * （受控修订服务，不落库）→ 看三态差异后采纳（内容指纹 + 场景哈希双条件写）。
 * 复用：场景目录/已保存场景接口、ResumeDiffView（仓库唯一三态差异渲染）、versionsApi。
 * 不新造 diff 算法、不引入第二套弹层。
 */
import { App, Button, Input, Select, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../../../api/client";
import AbortButton from "../../common/AbortButton";
import { useAbortableRequest } from "../../../hooks/useAbortableRequest";
import {
  fetchCareerScenarioCatalog,
  listCareerScenarios,
} from "../../../features/career-scenarios/api";
import type {
  CareerScenario,
  CareerScenarioCatalog,
} from "../../../features/career-scenarios/types";
import type {
  ScenarioVariantPreviewOut,
  VariantOut,
} from "../../../features/resume-versions/types";
import {
  adoptScenarioVariant,
  createScenarioVariant,
  previewScenarioVariant,
} from "../../../features/resume-versions/versionsApi";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { CareerContextRequest } from "../../../types";
import ResumeDiffView from "../../ResumeDiffView";

interface Props {
  resumeId: number | null;
  /** 有上下文/被采纳后通知宿主刷新变体列表（源简历内容不变，不会触发宿主重载）。 */
  onChanged?: () => void;
  /** 宿主已知的变体列表（用于只展示带场景上下文的那些）。 */
  variants: VariantOut[];
}

const SAVED_PREFIX = "saved:";
const PRESET_PREFIX = "preset:";

function displayName(variant: VariantOut): string {
  const snapshot = variant.context_snapshot as { display_name?: unknown } | null | undefined;
  return typeof snapshot?.display_name === "string" && snapshot.display_name.trim()
    ? snapshot.display_name
    : t("careerScenarios.generate.source", { name: variant.name });
}

/** 从**服务端下发的快照**还原本次请求引用（引用而已，不接受快照本体）。 */
function referenceFromSnapshot(snapshot: unknown): CareerContextRequest | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = snapshot as Record<string, unknown>;
  const includeStatus =
    (value.disclosure as { include_employment_status?: unknown } | undefined)
      ?.include_employment_status === true;
  if (typeof value.scenario_id === "number" && typeof value.scenario_revision === "number") {
    return {
      scenario_id: value.scenario_id,
      expected_revision: value.scenario_revision,
      ...(includeStatus ? { include_employment_status: true } : {}),
    };
  }
  if (typeof value.preset_key === "string" && typeof value.catalog_version === "string") {
    return {
      preset_key: value.preset_key,
      catalog_version: value.catalog_version,
      ...(includeStatus ? { include_employment_status: true } : {}),
    };
  }
  return null;
}

type I18nKey = Parameters<typeof t>[0];

function conflictMessage(error: unknown, fallbackKey: I18nKey): string {
  if (error instanceof ApiError) {
    if (error.businessCode === "variant_content_conflict") {
      return t("careerScenarios.variant.conflictVariant");
    }
    if (error.businessCode === "career_scenario_context_changed") {
      return t("careerScenarios.variant.conflictScenario");
    }
    if (error.businessCode === "fact_lock_conflict") {
      return t("careerScenarios.variant.lockConflict");
    }
    return error.message || t(fallbackKey);
  }
  return t(fallbackKey);
}

export default function ScenarioVariantSection({ resumeId, onChanged, variants }: Props) {
  const locale = useLocale();
  const { message } = App.useApp();
  const [catalog, setCatalog] = useState<CareerScenarioCatalog | null>(null);
  const [scenarios, setScenarios] = useState<CareerScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [creating, setCreating] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [preview, setPreview] = useState<ScenarioVariantPreviewOut | null>(null);
  const [actionError, setActionError] = useState("");
  // 生成候选是一次现场长调用：每一条都能单独停，停了已有的差异预览原样留着。
  const previewRequest = useAbortableRequest();

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [catalogResult, scenariosResult] = await Promise.allSettled([
      fetchCareerScenarioCatalog(),
      listCareerScenarios(),
    ]);
    if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
    if (scenariosResult.status === "fulfilled") {
      // 防御：旧/异常响应可能没有 items（测试替身或代理错误页），不能让控件崩溃。
      const items = scenariosResult.value?.items;
      setScenarios(Array.isArray(items) ? items : []);
    }
    // 目录失败不阻断已保存场景；两者都失败才提示（旧生成流程也不应被这里卡住）。
    if (catalogResult.status === "rejected" && scenariosResult.status === "rejected") {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const options = useMemo(() => {
    // Group labels are translated inside this memo.
    void locale;
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
  }, [catalog, scenarios, locale]);

  const selectedContext = useCallback((): CareerContextRequest | null => {
    if (selected.startsWith(SAVED_PREFIX)) {
      const id = Number(selected.slice(SAVED_PREFIX.length));
      const scenario = scenarios.find((item) => item.id === id);
      if (!scenario) return null;
      return { scenario_id: scenario.id, expected_revision: scenario.revision };
    }
    if (selected.startsWith(PRESET_PREFIX) && catalog) {
      return {
        preset_key: selected.slice(PRESET_PREFIX.length),
        catalog_version: catalog.catalog_version,
      };
    }
    return null;
  }, [catalog, scenarios, selected]);

  const contextVariants = variants.filter((variant) => variant.context_snapshot);

  const submitCreate = async () => {
    const context = selectedContext();
    if (!resumeId || !name.trim() || !context) {
      message.warning(t("careerScenarios.variant.createRequired"));
      return;
    }
    setCreating(true);
    setActionError("");
    try {
      await createScenarioVariant(resumeId, { name: name.trim(), career_context: context });
      setName("");
      message.success(t("careerScenarios.variant.createSuccess"));
      onChanged?.();
    } catch (error) {
      setActionError(conflictMessage(error, "careerScenarios.variant.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const runPreview = async (variant: VariantOut) => {
    if (!resumeId) return;
    const context = referenceFromSnapshot(variant.context_snapshot);
    if (!context) {
      setActionError(t("careerScenarios.variant.loadFailed"));
      return;
    }
    setPreviewLoadingId(variant.id);
    setActionError("");
    const outcome = await previewRequest.run((signal) =>
      previewScenarioVariant(
        resumeId,
        variant.id,
        { career_context: context, instructions: instructions.trim() },
        signal,
      ),
    );
    setPreviewLoadingId(null);
    if (outcome.status === "ok") {
      setPreview(outcome.data);
      return;
    }
    if (outcome.status === "error") {
      setActionError(conflictMessage(outcome.error, "careerScenarios.variant.previewFailed"));
    }
    // aborted：用户自己按了停止——上一次的差异预览留着，不弹错误。
  };

  /** 停止生成候选：行内 loading 一起收起，按钮立刻可再点。 */
  const cancelPreview = () => {
    previewRequest.cancel();
    setPreviewLoadingId(null);
  };

  const adopt = async () => {
    if (!resumeId || !preview) return;
    const context = referenceFromSnapshot(preview.context_snapshot);
    if (!context) return;
    setAdopting(true);
    setActionError("");
    try {
      await adoptScenarioVariant(resumeId, preview.variant.id, {
        content: preview.candidate_content,
        expected_content_sha256: preview.base_content_sha256,
        expected_context_sha256: preview.context_sha256,
        career_context: context,
      });
      setPreview(null);
      message.success(t("careerScenarios.variant.adoptSuccess"));
      onChanged?.();
    } catch (error) {
      setActionError(conflictMessage(error, "careerScenarios.variant.adoptFailed"));
    } finally {
      setAdopting(false);
    }
  };

  return (
    <section
      aria-label={t("careerScenarios.variant.title")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        border: "1px solid var(--rf-border-subtle)",
        borderRadius: "var(--rf-radius-control)",
      }}
    >
      <Typography.Text strong>{t("careerScenarios.variant.title")}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("careerScenarios.variant.hint")}
      </Typography.Text>
      <Space wrap size={8}>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("careerScenarios.variant.namePlaceholder")}
          aria-label={t("careerScenarios.variant.nameAria")}
          maxLength={256}
          style={{ width: 200 }}
        />
        <Select
          value={selected || undefined}
          onChange={(value: string) => setSelected(value)}
          placeholder={t("careerScenarios.variant.scenarioPlaceholder")}
          aria-label={t("careerScenarios.variant.scenario")}
          loading={loading}
          showSearch
          optionFilterProp="label"
          options={options}
          style={{ width: 240 }}
        />
        <Button
          type="primary"
          loading={creating}
          disabled={!name.trim() || !selected}
          onClick={() => void submitCreate()}
        >
          {t("careerScenarios.variant.create")}
        </Button>
        <Button onClick={() => void loadOptions()}>{t("careerScenarios.variant.refresh")}</Button>
      </Space>
      {loadError ? (
        <Typography.Text type="danger">{t("careerScenarios.variant.loadFailed")}</Typography.Text>
      ) : null}
      {contextVariants.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t("careerScenarios.variant.empty")}
        </Typography.Text>
      ) : null}
      {contextVariants.map((variant) => (
        <div
          key={variant.id}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
        >
          <Tag color="blue">{displayName(variant)}</Tag>
          <Typography.Text>{variant.name}</Typography.Text>
          <Button
            size="small"
            loading={previewLoadingId === variant.id}
            onClick={() => void runPreview(variant)}
          >
            {t("careerScenarios.variant.generate")}
          </Button>
          {previewLoadingId === variant.id && <AbortButton size="small" onClick={cancelPreview} />}
        </div>
      ))}
      {contextVariants.length > 0 ? (
        <Input.TextArea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder={t("careerScenarios.variant.instructionsPlaceholder")}
          aria-label={t("careerScenarios.variant.instructions")}
          autoSize={{ minRows: 1, maxRows: 3 }}
          maxLength={500}
        />
      ) : null}
      {actionError ? <Typography.Text type="danger">{actionError}</Typography.Text> : null}
      {preview ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 12,
            border: "1px solid var(--rf-border-subtle)",
            borderRadius: "var(--rf-radius-control)",
            background: "var(--rf-surface-alt)",
          }}
        >
          <Space wrap size={8}>
            <Typography.Text strong>{t("careerScenarios.variant.diffTitle")}</Typography.Text>
            <Tag>{displayName(preview.variant)}</Tag>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("careerScenarios.variant.previewHint")}
          </Typography.Text>
          <ResumeDiffView diff={preview.content_diff} />
          <Space wrap size={8}>
            <Button type="primary" loading={adopting} onClick={() => void adopt()}>
              {t("careerScenarios.variant.adopt")}
            </Button>
            <Button onClick={() => setPreview(null)}>{t("careerScenarios.variant.discard")}</Button>
          </Space>
        </div>
      ) : null}
    </section>
  );
}
