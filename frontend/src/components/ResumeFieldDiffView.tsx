// SPDX-License-Identifier: Apache-2.0
/** 版本对比：默认的人性化、字段级视图。
 *
 * 主视图由前端 ``utils/resumeFieldDiff`` 计算出的字段级差异驱动：只展示有变化的区块、
 * 字符串字段做词级高亮、列表字段做条目级 +/- 对照、照片显示为 [图片] 占位。后端下发的
 * 源码 diff 降级为底部的「查看原始差异」折叠兜底，保留既有能力。
 */
import { Card, Collapse, Empty, Tag, Typography } from "antd";
import type { CSSProperties } from "react";
import type { DiffToken } from "../types/resumeWriting";
import type {
  DiffViewData,
  ListItemView,
  ListSectionDiff,
  ModifiedItemDiff,
  SectionDiff,
  StringSectionDiff,
  SubFieldDiff,
} from "../types/resumeFieldDiff";
import ResumeDiffView from "./ResumeDiffView";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/**
 * 三态配色与 `ResumeDiffView` 共用同一组 token（`--rf-diff-*`）：同一语义两套颜色
 * 必然让人困惑。浅色取值与原写死的 #d9f7be/#ffccc7/#135200/#a8071a 等值。
 */
const TOKEN_STYLE: Record<string, CSSProperties> = {
  added: { background: "var(--rf-diff-added-border)", color: "var(--rf-diff-added-text)" },
  removed: {
    background: "var(--rf-diff-removed-border)",
    color: "var(--rf-diff-removed-text)",
    textDecoration: "line-through",
  },
  unchanged: {},
};

function TokenText({ tokens }: { tokens: DiffToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={TOKEN_STYLE[token.type]}>
          {token.text}{" "}
        </span>
      ))}
    </>
  );
}

/** 旧→新两列；窄 Modal 下 flex-wrap 自动上下堆叠。 */
function TwoColumn({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>{children}</div>;
}

function Column({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ flex: "1 1 240px", minWidth: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {children}
    </div>
  );
}

function StringSectionCard({ section }: { section: StringSectionDiff }) {
  useLocale();
  const tag: { color: string; labelKey: MessageKey } = !section.oldText
    ? { color: "green", labelKey: "resumeFieldDiffView.tag.added" }
    : !section.newText
      ? { color: "red", labelKey: "resumeFieldDiffView.tag.removed" }
      : { color: "blue", labelKey: "resumeFieldDiffView.tag.modified" };
  return (
    <Card
      size="small"
      title={
        <span>
          <Typography.Text strong>{section.label}</Typography.Text>{" "}
          <Tag color={tag.color}>{t(tag.labelKey)}</Tag>
        </span>
      }
    >
      <TwoColumn>
        <Column>
          <Typography.Text type="secondary">{t("resumeFieldDiffView.column.old")}</Typography.Text>
          <div>
            {section.oldText ? (
              <TokenText tokens={section.oldTokens} />
            ) : (
              <Typography.Text type="secondary">{t("resumeFieldDiffView.empty")}</Typography.Text>
            )}
          </div>
        </Column>
        <Column>
          <Typography.Text type="secondary">{t("resumeFieldDiffView.column.new")}</Typography.Text>
          <div>
            {section.newText ? (
              <TokenText tokens={section.newTokens} />
            ) : (
              <Typography.Text type="secondary">{t("resumeFieldDiffView.empty")}</Typography.Text>
            )}
          </div>
        </Column>
      </TwoColumn>
    </Card>
  );
}

/** 新增/删除条目：红 − / 绿 + 边框块。 */
function ItemBlock({ item, sign }: { item: ListItemView; sign: "added" | "removed" }) {
  useLocale();
  // 语义 token：浅色下 --rf-accent-green=#52c41a、--rf-danger=#ff4d4f，与原写死值一致；
  // 深色下两者都会提亮，边框与加号才不会糊在暗底上。
  const color = sign === "added" ? "var(--rf-accent-green)" : "var(--rf-danger)";
  const bg = sign === "added" ? "var(--rf-diff-added-bg)" : "var(--rf-diff-removed-bg)";
  return (
    <div
      data-sign={sign}
      style={{ border: `1px solid ${color}`, borderRadius: 6, padding: "8px 12px", background: bg }}
    >
      <div style={{ fontWeight: 600, color }}>
        {sign === "added" ? "+ " : "− "}
        {item.title || t("resumeFieldDiffView.itemFallback")}
      </div>
      {item.lines.map((line, index) => (
        <div key={index} style={{ fontSize: 13 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function SubFieldRow({ sub }: { sub: SubFieldDiff }) {
  useLocale();
  if (sub.kind === "string") {
    return (
      <div>
        <Typography.Text type="secondary">
          {t("resumeFieldDiffView.subFieldLabel", { label: sub.label })}
        </Typography.Text>
        <TwoColumn>
          <Column>
            {sub.oldText ? (
              <TokenText tokens={sub.oldTokens} />
            ) : (
              <Typography.Text type="secondary">{t("resumeFieldDiffView.empty")}</Typography.Text>
            )}
          </Column>
          <Column>
            {sub.newText ? (
              <TokenText tokens={sub.newTokens} />
            ) : (
              <Typography.Text type="secondary">{t("resumeFieldDiffView.empty")}</Typography.Text>
            )}
          </Column>
        </TwoColumn>
      </div>
    );
  }
  return (
    <div>
      <Typography.Text type="secondary">
        {t("resumeFieldDiffView.subFieldLabel", { label: sub.label })}
      </Typography.Text>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {sub.removedLines.map((line, index) => (
          <div key={`r-${index}`} style={{ color: "var(--rf-error-text)" }}>
            − {line}
          </div>
        ))}
        {sub.addedLines.map((line, index) => (
          <div key={`a-${index}`} style={{ color: "var(--rf-success-text)" }}>
            + {line}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 修改条目：拆成子字段逐条对照。 */
function ModifiedItemBlock({ item }: { item: ModifiedItemDiff }) {
  useLocale();
  return (
    <div
      data-sign="modified"
      style={{
        border: "1px solid var(--rf-focus-ring)",
        borderRadius: 6,
        padding: "8px 12px",
        background: "var(--rf-info-bg)",
      }}
    >
      <Tag color="blue">{t("resumeFieldDiffView.tag.modified")}</Tag>
      <Typography.Text strong>{item.key || t("resumeFieldDiffView.itemFallback")}</Typography.Text>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {item.subfields.map((sub, index) => (
          <SubFieldRow key={index} sub={sub} />
        ))}
      </div>
    </div>
  );
}

function ListSectionCard({ section }: { section: ListSectionDiff }) {
  useLocale();
  return (
    <Card size="small" title={<Typography.Text strong>{section.label}</Typography.Text>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {section.removed.map((item, index) => (
          <ItemBlock key={`r-${index}`} item={item} sign="removed" />
        ))}
        {section.added.map((item, index) => (
          <ItemBlock key={`a-${index}`} item={item} sign="added" />
        ))}
        {section.modified.map((item, index) => (
          <ModifiedItemBlock key={`m-${index}`} item={item} />
        ))}
        {section.unchangedCount > 0 && (
          <Typography.Text type="secondary">
            {t("resumeFieldDiffView.unchangedItems", { count: section.unchangedCount })}
          </Typography.Text>
        )}
      </div>
    </Card>
  );
}

function SectionCard({ section }: { section: SectionDiff }) {
  return section.type === "string" ? (
    <StringSectionCard section={section} />
  ) : (
    <ListSectionCard section={section} />
  );
}

export default function ResumeFieldDiffView({ data }: { data: DiffViewData }) {
  useLocale();
  const { field, raw } = data;
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text>{t("resumeFieldDiffView.compare")}</Typography.Text>
        <Typography.Text strong>{field.baseTitle}</Typography.Text>
        <Typography.Text type="secondary"> → </Typography.Text>
        <Typography.Text strong>{field.againstTitle}</Typography.Text>
        <span style={{ marginLeft: 12 }}>
          <Tag color="green">
            {t("resumeFieldDiffView.stats.added", { added: raw.stats.added })}
          </Tag>
          <Tag color="red">
            {t("resumeFieldDiffView.stats.removed", { removed: raw.stats.removed })}
          </Tag>
          <Tag>{t("resumeFieldDiffView.stats.unchanged", { unchanged: raw.stats.unchanged })}</Tag>
        </span>
      </div>

      {field.changed.length === 0 ? (
        <Empty description={t("resumeFieldDiffView.emptyDescription")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {field.changed.map((section) => (
            <SectionCard key={section.key} section={section} />
          ))}
        </div>
      )}

      {field.unchangedLabels.length > 0 && (
        <Collapse
          style={{ marginTop: 12 }}
          items={[
            {
              key: "unchanged",
              label: t("resumeFieldDiffView.unchangedFields", {
                count: field.unchangedLabels.length,
              }),
              children: (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {field.unchangedLabels.map((label) => (
                    <Tag key={label}>{label}</Tag>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}

      <Collapse
        style={{ marginTop: 12 }}
        items={[
          {
            key: "raw",
            label: t("resumeFieldDiffView.raw.toggle"),
            children: <ResumeDiffView diff={raw} />,
          },
        ]}
      />
    </div>
  );
}
