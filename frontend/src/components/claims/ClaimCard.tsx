// SPDX-License-Identifier: Apache-2.0
/**
 * 一条台账条目的只读展示。
 *
 * 排版上刻意把「原始事实」和「简历表述」并排：这两行放在一起，用户一眼就能看出措辞
 * 有没有比事实更强——这正是这个功能要防的事。占位符单独高亮，因为它同时意味着
 * "这条还没核实"和"导出终稿会被拦下"。
 */
import { DeleteOutlined, EditOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { Claim, ClaimSummary } from "../../types";
import { hasPlaceholder } from "../../types";
import {
  claimCategoryLabelKey,
  claimResponsibilityLabelKey,
  claimSourceTypeLabelKey,
  claimStatusLabelKey,
} from "../../i18n/enum/claims";
import { useRowActionMenu } from "../common/rowActionMenu";
import { claimResponsibilityColor, claimStatusColor } from "./claimPresentation";

interface Props {
  /** 全量条目（详情/旧列表）或分页摘要行（GET /api/claims/page，只有 ≤200 字摘要）。 */
  claim: Claim | ClaimSummary;
  onEdit: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  /** 批量选择模式（ClaimsPage 传入）：收起行内操作、头部出现勾选框。 */
  selecting?: boolean;
  selected?: boolean;
  onToggleSelected?: (checked: boolean) => void;
}

/** 把含占位符的文本切出来单独高亮，让"哪里还没写"一眼可见。 */
function Wording({ text }: { text: string }) {
  useLocale();
  if (!text) {
    return <Typography.Text type="secondary">{t("claimCard.wording.empty")}</Typography.Text>;
  }
  if (!hasPlaceholder(text)) return <span>{text}</span>;
  const parts = text.split(/(【[^】]*】)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("【") ? (
          <mark key={index} className="claim-placeholder">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

export default function ClaimCard({
  claim,
  onEdit,
  onDelete,
  onConfirm,
  selecting = false,
  selected = false,
  onToggleSelected,
}: Props) {
  useLocale();
  const buildMenu = useRowActionMenu();
  // 「标记已确认」点击后确认流程就开始了，提示不该继续挂在按钮上（受控开关）。
  const [confirmTipOpen, setConfirmTipOpen] = useState(false);
  // 摘要行（分页列表）只有 excerpt 字段；全量条目用原文/表述全文。
  const isSummary = "source_fact_excerpt" in claim;
  const sourceFact = isSummary ? claim.source_fact_excerpt : claim.source_fact;
  const wording = isSummary ? claim.candidate_wording_excerpt : claim.candidate_wording;
  // 摘要行没有这些字段（详情接口才有），统一收成 undefined 让下面的条件自然跳过。
  const interview = isSummary ? undefined : claim.interview_details;
  const boundary = isSummary ? "" : claim.boundary;
  const sources = isSummary ? [] : claim.sources;
  const allowedUses = isSummary ? [] : claim.allowed_uses;
  const hasInterviewDetail =
    Boolean(interview?.result) ||
    (interview?.decisions?.length ?? 0) > 0 ||
    (interview?.difficulties?.length ?? 0) > 0 ||
    (interview?.verification?.length ?? 0) > 0;
  // 显示名走语言包；协议值本身就可能是后端新加的取值，查不到时回退成原值。
  const categoryKey = claimCategoryLabelKey(claim.category);
  const responsibilityKey = claimResponsibilityLabelKey(claim.responsibility_level);
  const statusKey = claimStatusLabelKey(claim.verification_status);

  return (
    <article className="claim-card">
      <header className="claim-card-head">
        <Space size={6} wrap>
          <Typography.Text strong>
            {claim.title || claim.subject || t("claimCard.header.fallbackTitle", { id: claim.id })}
          </Typography.Text>
          <Tag>{categoryKey ? t(categoryKey) : claim.category}</Tag>
          <Tag color={claimResponsibilityColor(claim.responsibility_level)}>
            {responsibilityKey ? t(responsibilityKey) : claim.responsibility_level}
          </Tag>
          <Tag color={claimStatusColor(claim.verification_status)}>
            {statusKey ? t(statusKey) : claim.verification_status}
          </Tag>
          {claim.last_verified && (
            <Typography.Text type="secondary" className="claim-card-verified">
              {t("claimCard.header.lastVerified", { date: claim.last_verified })}
            </Typography.Text>
          )}
        </Space>
        <Space size={4}>
          {selecting && onToggleSelected ? (
            <Checkbox
              aria-label={t("claimCard.header.selectAria", {
                name: claim.title || claim.subject || claim.id,
              })}
              checked={selected}
              onChange={(event) => onToggleSelected(event.target.checked)}
            />
          ) : (
            <>
              {claim.verification_status !== "已确认" && ( // i18n-ok: 协议值（后端枚举中文值，不能翻译）
                <Tooltip
                  open={confirmTipOpen}
                  onOpenChange={setConfirmTipOpen}
                  title={t("claimCard.action.confirmTooltip")}
                >
                  <span onClick={() => setConfirmTipOpen(false)}>
                    <Button size="small" type="link" onClick={onConfirm}>
                      {t("claimCard.action.confirm")}
                    </Button>
                  </span>
                </Tooltip>
              )}
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: buildMenu([
                    {
                      key: "edit",
                      label: t("claimCard.action.edit"),
                      icon: <EditOutlined />,
                      onClick: onEdit,
                    },
                    {
                      key: "delete",
                      label: t("claimCard.action.delete"),
                      danger: true,
                      icon: <DeleteOutlined />,
                      // 软删由父级用 useDeleteUndo 兜：这里**不再问**，撤销入口在 Toast 上。
                      undo: true,
                      onClick: onDelete,
                    },
                  ]),
                }}
              >
                <Button
                  size="small"
                  type="text"
                  icon={<MoreOutlined />}
                  aria-label={t("claimCard.action.moreAria", {
                    name: claim.title || claim.subject || claim.id,
                  })}
                />
              </Dropdown>
            </>
          )}
        </Space>
      </header>

      <div className="claim-card-body">
        <div className="claim-card-row">
          <span className="claim-card-label">{t("claimCard.field.sourceFact")}</span>
          <div className="claim-card-value">
            <Wording text={sourceFact} />
          </div>
        </div>
        <div className="claim-card-row">
          <span className="claim-card-label">{t("claimCard.field.wording")}</span>
          <div className="claim-card-value">
            <Wording text={wording} />
          </div>
        </div>
        {boundary && (
          <div className="claim-card-row">
            <span className="claim-card-label">{t("claimCard.field.boundary")}</span>
            <div className="claim-card-value">{boundary}</div>
          </div>
        )}
      </div>

      {(sources.length > 0 || allowedUses.length > 0 || hasInterviewDetail) && (
        <footer className="claim-card-foot">
          {sources.length > 0 && (
            <Space size={4} wrap>
              <span className="claim-card-label">{t("claimCard.evidence.title")}</span>
              {sources.map((source, index) => {
                const sourceKey = claimSourceTypeLabelKey(source.type);
                return (
                  <Tooltip
                    key={index}
                    title={`${source.location}${source.public ? "" : t("claimCard.evidence.privateSuffix")}`}
                  >
                    <Tag>{sourceKey ? t(sourceKey) : source.type}</Tag>
                  </Tooltip>
                );
              })}
            </Space>
          )}
          {allowedUses.length > 0 && (
            <Space size={4} wrap>
              <span className="claim-card-label">{t("claimCard.field.allowedUses")}</span>
              {allowedUses.map((use) => (
                <Tag key={use}>{use}</Tag>
              ))}
            </Space>
          )}
          {hasInterviewDetail && (
            <Typography.Text type="secondary" className="claim-card-interview">
              {t("claimCard.interview.prepared")}
            </Typography.Text>
          )}
        </footer>
      )}

      {/*
        建议只在这里渲染一次：规则本身全部由后端 claim_warnings() 算出并随条目下发。
        前端再判一遍"强主张缺面试细节"之类的规则，同一条提示就会显示两遍，
        而且两处的措辞迟早会漂移。
      */}
      {claim.warnings.length > 0 && (
        <ul className="claim-card-warnings">
          {claim.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
