// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位卡片网格：勾选/详情/导入/编辑/删除。
 * （自 CandidateJobsDrawer 拆出，closest() 冒泡守卫逐字随迁，行为等价。）
 * R8：批量选择入口收进卡片右键菜单（批量选择 + 编辑 + 单条删除）；多选模式下右键菜单收起。
 * 卡片上不再放「···」菜单（用户反馈三个点太吵）：编辑/删除走右键，详情走点卡片。
 * 右键菜单按「查看/编辑」与「批量/删除」分两组（divider 隔开），危险项 danger 标红。
 */
import { CheckSquareOutlined, DeleteOutlined, EditOutlined, EyeOutlined } from "@ant-design/icons";
import { Card, Checkbox, Space, Tag, Typography } from "antd";
import { RowActions, RowContextMenu, type RowMenuItem } from "../../common/RowActions";
import { t } from "../../../i18n";
import { candidateJobSourceLabelKey } from "../../../i18n/enum/jobs";
import { useLocale } from "../../../i18n/i18nContext";
import type { CandidateJob } from "../../../types";
import { formatDateTime } from "../../../utils/format";

export function CandidateCardGrid({
  items,
  selectedIds,
  batchAction,
  selecting,
  onEnterSelecting,
  onToggleSelected,
  onOpenDetails,
  onStartImport,
  onOpenEdit,
  onRemove,
}: {
  items: CandidateJob[];
  selectedIds: number[];
  batchAction: "import" | "delete" | null;
  /** 多选模式：勾选框只在多选模式渲染（用户反馈：平时不要勾选框）；右键菜单收起。 */
  selecting: boolean;
  /** 右键菜单「批量选择」的动作：进入多选模式（工具栏按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
  onToggleSelected: (candidateId: number, checked: boolean) => void;
  onOpenDetails: (candidate: CandidateJob) => Promise<void>;
  onStartImport: (candidate: CandidateJob) => Promise<void>;
  onOpenEdit: (candidate: CandidateJob) => void;
  onRemove: (candidate: CandidateJob) => Promise<void>;
}) {
  useLocale();
  return (
    <div className="candidate-job-card-grid">
      {items.map((candidate) => {
        const selected = selectedIds.includes(candidate.id);
        // 来源是落库的协议值（或后端站点名）：能对上语言包就翻，站点名原样显示。
        const sourceKey = candidateJobSourceLabelKey(candidate.source);
        const sourceLabel = sourceKey
          ? t(sourceKey)
          : candidate.source || t("jobs.candidate.detail.source-manual");
        /** 右键菜单：查看/编辑组 + 分隔线 + 批量/删除组（与原「···」菜单同一份确认）；
            多选时收起。功能与工具栏口径一致——「批量选择」进多选模式后，批量导入/
            批量删除/清空/退出都在工具栏上。 */
        const contextItems: RowMenuItem[] = selecting
          ? []
          : [
              {
                key: "detail",
                label: t("jobsCandidate.card.viewDetail"),
                icon: <EyeOutlined />,
                onClick: () => void onOpenDetails(candidate),
              },
              {
                key: "edit",
                label: t("jobs.candidate.action.edit"),
                icon: <EditOutlined />,
                onClick: () => onOpenEdit(candidate),
              },
              { key: "divider-batch", type: "divider" },
              {
                key: "batch_select",
                label: t("common.action.batchSelect"),
                icon: <CheckSquareOutlined />,
                onClick: onEnterSelecting,
              },
              {
                key: "delete",
                label: t("common.action.delete"),
                danger: true,
                icon: <DeleteOutlined />,
                confirm: t("jobsCandidate.card.deleteConfirm"),
                // 0050 起备选岗位是软删除：文案必须说"进回收站、可恢复"，
                // 不能再说"无法恢复"（说了就会让用户不敢删，也说不清去哪找回来）。
                confirmBody: t("common.note.trashRecovery"),
                onClick: () => void onRemove(candidate),
              },
            ];
        return (
          <RowContextMenu key={candidate.id} items={contextItems}>
            <Card
              hoverable
              className={`candidate-job-card${selected ? " is-selected" : ""}`}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button, a, input, .ant-dropdown, .row-actions")) return;
                void onOpenDetails(candidate);
              }}
              title={
                <Space>
                  {selecting && (
                    <Checkbox
                      checked={selected}
                      disabled={batchAction !== null}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => onToggleSelected(candidate.id, event.target.checked)}
                    />
                  )}
                  <Typography.Text strong>
                    {candidate.title || t("jobsCandidate.card.untitled")}
                  </Typography.Text>
                </Space>
              }
              extra={
                <Tag color={candidate.status === "imported" ? "green" : "orange"}>
                  {candidate.status === "imported"
                    ? t("jobsCandidate.card.statusImported")
                    : t("jobs.candidate.detail.status-pending")}
                </Tag>
              }
            >
              <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  {[
                    candidate.company || t("jobs.candidate.detail.company-unknown"),
                    candidate.location,
                    candidate.salary,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography.Text>
                <Space wrap>
                  <Tag>{sourceLabel}</Tag>
                  {candidate.images.length > 0 && (
                    <Tag color="blue">
                      {t("jobsCandidate.card.images", { count: candidate.images.length })}
                    </Tag>
                  )}
                  {candidate.raw_text && (
                    <Tag>
                      {t("jobsCandidate.card.rawLength", { count: candidate.raw_text.length })}
                    </Tag>
                  )}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t("jobsCandidate.card.updatedAt", {
                    time: formatDateTime(candidate.updated_at),
                  })}
                </Typography.Text>
                {/* 只保留主操作（待处理卡片的「导入到岗位」）；已导入卡片不渲染操作区，
                    否则空容器会在卡片底部撑出一截留白。 */}
                {candidate.status === "pending" && (
                  <RowActions
                    primary={[
                      {
                        key: "import",
                        label: t("jobs.candidate.action.import"),
                        onClick: () => void onStartImport(candidate),
                      },
                    ]}
                  />
                )}
              </Space>
            </Card>
          </RowContextMenu>
        );
      })}
    </div>
  );
}
