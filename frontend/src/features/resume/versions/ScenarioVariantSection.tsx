// SPDX-License-Identifier: Apache-2.0
/**
 * A5 / #29a：场景变体的**候选生成**区（创建入口已合并到 VariantCreatePanel）。
 *
 * 流程刻意分三步，源简历全程只读：派生独立变体（VariantCreatePanel 里"从职业场景派生"，
 * 后端冻结场景快照）→ 这里生成候选（受控修订服务，不落库）→ 看三态差异后采纳
 * （内容指纹 + 场景哈希双条件写）。复用：ResumeDiffView（仓库唯一三态差异渲染）、versionsApi。
 * 没有带场景上下文的变体时整块不渲染——不给用户一块空的"生成候选"区。
 */
import { App, Button, Input, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { ApiError } from "../../../api/client";
import AbortButton from "../../../components/common/AbortButton";
import { useAbortableRequest } from "../../../hooks/useAbortableRequest";
import type { ScenarioVariantPreviewOut, VariantOut } from "./types";
import { adoptScenarioVariant, previewScenarioVariant } from "./versionsApi";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { CareerContextRequest } from "../../../types";
import ResumeDiffView from "./ResumeDiffView";

interface Props {
  resumeId: number | null;
  /** 有上下文/被采纳后通知宿主刷新变体列表（源简历内容不变，不会触发宿主重载）。 */
  onChanged?: () => void;
  /** 宿主已知的变体列表（用于只展示带场景上下文的那些）。 */
  variants: VariantOut[];
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

function displayName(variant: VariantOut): string {
  const snapshot = variant.context_snapshot as { display_name?: unknown } | null | undefined;
  return typeof snapshot?.display_name === "string" && snapshot.display_name.trim()
    ? snapshot.display_name
    : t("careerScenarios.generate.source", { name: variant.name });
}

export default function ScenarioVariantSection({ resumeId, onChanged, variants }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [previewLoadingId, setPreviewLoadingId] = useState<number | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [preview, setPreview] = useState<ScenarioVariantPreviewOut | null>(null);
  const [actionError, setActionError] = useState("");
  // 生成候选是一次现场长调用：每一条都能单独停，停了已有的差异预览原样留着。
  const previewRequest = useAbortableRequest();
  const contextVariants = variants.filter((variant) => variant.context_snapshot);

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

  // 没有场景变体时整块不渲染（创建入口已合并到顶部 VariantCreatePanel）。
  if (contextVariants.length === 0) return null;

  return (
    <section
      aria-label={t("versions.variants.scenario.title")}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        border: "1px solid var(--rf-border-subtle)",
        borderRadius: "var(--rf-radius-control)",
      }}
    >
      <Typography.Text strong>{t("versions.variants.scenario.title")}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("versions.variants.scenario.hint")}
      </Typography.Text>
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
      <Input.TextArea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder={t("careerScenarios.variant.instructionsPlaceholder")}
        aria-label={t("careerScenarios.variant.instructions")}
        autoSize={{ minRows: 1, maxRows: 3 }}
        maxLength={500}
      />
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
