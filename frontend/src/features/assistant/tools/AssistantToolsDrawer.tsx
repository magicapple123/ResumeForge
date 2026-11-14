// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { Checkbox, Collapse, Drawer, Input, Space, Tag, Typography } from "antd";
import type { AssistantTool } from "../../../api/assistant";
import { formatErrorGuidance } from "../../../api/errorGuidance";
import EmptyState from "../../../components/common/EmptyState";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t, type MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useAssistantTools } from "./useAssistantTools";
import "./assistantTools.css";

const CATEGORY_LABELS: Record<string, MessageKey> = {
  core: "assistantTools.category.core",
  data: "assistantTools.category.data",
  relaxed: "assistantTools.category.relaxed",
  report: "assistantTools.category.report",
  search: "assistantTools.category.search",
  document: "assistantTools.category.document",
  quality: "assistantTools.category.quality",
  diagnosis: "assistantTools.category.diagnosis",
  web: "assistantTools.category.web",
  tasks: "assistantTools.category.tasks",
};

function ToolRow({ tool }: { tool: AssistantTool }) {
  useLocale();
  return (
    <article
      className="assistant-tool-row"
      data-tool-name={tool.name}
      data-tool-writes={tool.writes}
    >
      <Space wrap size={6}>
        <Typography.Text code>{tool.name}</Typography.Text>
        <Tag color={tool.writes ? "warning" : "default"}>
          {t(tool.writes ? "assistantTools.writable" : "assistantTools.readOnly")}
        </Tag>
      </Space>
      <Typography.Paragraph className="assistant-tool-description">
        {tool.description}
      </Typography.Paragraph>
      <Collapse
        size="small"
        ghost
        items={[
          {
            key: "parameters",
            label: t("assistantTools.parameters"),
            children: (
              <pre className="assistant-tool-parameters">
                {JSON.stringify(tool.parameters, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    </article>
  );
}

export default function AssistantToolsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useLocale();
  const inventory = useAssistantTools(open);
  const [query, setQuery] = useState("");
  const [writableOnly, setWritableOnly] = useState(false);
  const groups = useMemo(() => {
    const grouped = new Map<string, AssistantTool[]>();
    const needle = query.trim().toLowerCase();
    for (const tool of inventory.data?.items ?? []) {
      if (writableOnly && !tool.writes) continue;
      if (needle && !`${tool.name} ${tool.description}`.toLowerCase().includes(needle)) continue;
      const group = grouped.get(tool.category) ?? [];
      group.push(tool);
      grouped.set(tool.category, group);
    }
    return [...grouped];
  }, [inventory.data, query, writableOnly]);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("assistantTools.title")}
      size="large"
      className="assistant-tools-drawer"
      footer={<Typography.Text type="secondary">{t("assistantTools.footer")}</Typography.Text>}
    >
      <Typography.Paragraph>{t("assistantTools.intro")}</Typography.Paragraph>
      <div className="assistant-tools-filters">
        <Input
          allowClear
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("assistantTools.search")}
          aria-label={t("assistantTools.search")}
        />
        <Checkbox
          checked={writableOnly}
          onChange={(event) => setWritableOnly(event.target.checked)}
        >
          {t("assistantTools.writableOnly")}
        </Checkbox>
      </div>
      {inventory.status === "loading" || inventory.status === "idle" ? <LoadingBlock /> : null}
      {inventory.status === "error" ? (
        <ErrorState
          description={formatErrorGuidance(inventory.error, t("assistantTools.retry"))}
          onRetry={inventory.reload}
          retryLabel={t("assistantTools.retry")}
        />
      ) : null}
      {inventory.status === "ready" ? (
        <>
          <Typography.Paragraph type="secondary" data-testid="assistant-tools-count">
            {t("assistantTools.count", {
              count: groups.reduce((total, [, items]) => total + items.length, 0),
            })}
          </Typography.Paragraph>
          {groups.length === 0 ? (
            <EmptyState inline description={t("assistantTools.noMatch")} />
          ) : (
            groups.map(([category, tools]) => (
              <section
                key={category}
                className="assistant-tools-group"
                data-tool-category={category}
              >
                <Typography.Title level={5}>
                  {CATEGORY_LABELS[category] ? t(CATEGORY_LABELS[category]) : category} ·{" "}
                  {tools.length}
                </Typography.Title>
                {tools.map((tool) => (
                  <ToolRow key={tool.name} tool={tool} />
                ))}
              </section>
            ))
          )}
        </>
      ) : null}
    </Drawer>
  );
}
