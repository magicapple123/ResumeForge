// SPDX-License-Identifier: Apache-2.0
/**
 * 「从资料填入」菜单（v2）：候选解析与合并**只走 frontend-core 的单一实现**
 * （features/profile-library/projectionContent）：document_entry（新契约首选）→
 * 原生 document_path 定位；source 去重、只填空、补板块/补条目、
 * 仅素材标记都在 helper 里，本组件只负责菜单与目标拦截。
 *
 * 目标语义（计划 §9.2：非法位置必须给可读提示，不静默失败）：
 * - 传 selectedPath（当前聚焦条目的 v2 路径）时，只允许"填进这个条目"的候选，其它候选
 *   在菜单里 disabled 并显示原因；点不匹配的候选也会 message.info。
 * - 成功 message.success「已从资料填入 N 个字段」；仅素材额外 info 不上纸面。
 * - 写入只通过 onChange 回流（宿主记历史/标脏）。
 */
import { ImportOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, Tooltip } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { getCurrentProjection } from "../../features/profile-library/api";
import {
  mergeProjectionCandidate,
  resolvableProjectionCandidates,
} from "../../features/profile-library/projectionContent";
import type { ResolvedProjectionCandidate } from "../../features/profile-library/projectionContent";
import type {
  PaperProjectionOut,
  ProjectionCandidateOut,
} from "../../features/profile-library/types";
import type { ResumeDocument } from "../../types/resumeDocument";

interface Props {
  document: ResumeDocument;
  onChange: (next: ResumeDocument) => void;
  /**
   * 当前聚焦条目的 v2 路径（如 education.ob_x）。给了就只允许"填进这个条目"的候选；
   * 其他分区/条目的候选禁用并给出原因（不静默 no-op）。
   */
  selectedPath?: string | null;
}

/** selectedPath -> 目标板块/条目（v2 路径前两段；header 等非条目路径返回 null）。 */
function targetOfPath(
  path: string | null | undefined,
): { section: string; entryId: string } | null {
  if (!path || path.startsWith("header.")) return null;
  const [section, entryId] = path.split(".");
  if (!section || !entryId) return null;
  return { section, entryId };
}

function candidateKey(candidate: ProjectionCandidateOut): string {
  return candidate.document_path || candidate.entry_id;
}

export default function ProfileFillMenu({ document, onChange, selectedPath = null }: Props) {
  useLocale();
  const { message } = App.useApp();
  const [projection, setProjection] = useState<PaperProjectionOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = targetOfPath(selectedPath);

  const ensureProjection = async () => {
    if (projection || loading) return;
    setLoading(true);
    setFailed(false);
    try {
      setProjection(await getCurrentProjection());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const candidates = resolvableProjectionCandidates(projection);
  const matchesTarget = (resolved: ResolvedProjectionCandidate): boolean => {
    if (!target) return true;
    return resolved.sectionKey === target.section && resolved.entry.id === target.entryId;
  };

  const applyCandidate = (resolved: ResolvedProjectionCandidate) => {
    if (!matchesTarget(resolved)) {
      message.info(t("editor.profileFill.needTarget"));
      return;
    }
    const result = mergeProjectionCandidate(document, resolved);
    if (result.filled <= 0) {
      message.info(t("editor.profileFill.empty"));
      return;
    }
    onChange(result.document);
    message.success(t("editor.profileFill.success", { count: result.filled }));
    if (result.materialOnly) message.info(t("document.toast.materialOnly"));
  };

  const items = Object.entries(
    candidates.reduce<Record<string, ResolvedProjectionCandidate[]>>((groups, resolved) => {
      (groups[resolved.candidate.section_name] ??= []).push(resolved);
      return groups;
    }, {}),
  ).map(([label, group]) => ({
    type: "group" as const,
    label,
    children: group.map((resolved) => {
      const allowed = matchesTarget(resolved);
      const candidate = resolved.candidate;
      const baseLabel = candidate.subtitle
        ? candidate.title + " · " + candidate.subtitle
        : candidate.title;
      return {
        key: candidateKey(candidate),
        disabled: !allowed,
        label: allowed ? baseLabel : baseLabel + " · " + t("editor.profileFill.needTarget"),
      };
    }),
  }));

  const button = (
    <Button
      size="small"
      icon={<ImportOutlined />}
      loading={loading || undefined}
      aria-label={t("editor.profileFill.aria.entry")}
      disabled={failed || undefined}
    >
      {t("editor.profileFill.title.entry")}
    </Button>
  );

  if (failed) {
    return <Tooltip title={t("editor.profileFill.empty")}>{button}</Tooltip>;
  }
  return (
    <Dropdown
      menu={{
        items,
        onClick: ({ key }) => {
          const resolved = candidates.find((item) => candidateKey(item.candidate) === key);
          if (resolved) applyCandidate(resolved);
        },
      }}
      trigger={["click"]}
      onOpenChange={(open) => {
        if (open) void ensureProjection();
      }}
    >
      {button}
    </Dropdown>
  );
}
