/**
 * 备选岗位卡片网格：勾选/详情/导入/编辑/删除。
 * （自 CandidateJobsDrawer 拆出，closest() 冒泡守卫逐字随迁，行为等价。）
 * R8：批量选择入口收进卡片右键菜单（批量选择 + 单条删除）；多选模式下右键菜单收起。
 */
import { CheckSquareOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Card, Checkbox, Space, Tag, Typography } from "antd";
import { RowActions, RowContextMenu, type RowActionItem } from "../../common/RowActions";
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
  /** 多选模式：勾选框本来就常驻，这里只控制右键菜单收起；批量按钮由父级控制显隐。 */
  selecting: boolean;
  /** 右键菜单「批量选择」的动作：进入多选模式（工具栏按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
  onToggleSelected: (candidateId: number, checked: boolean) => void;
  onOpenDetails: (candidate: CandidateJob) => Promise<void>;
  onStartImport: (candidate: CandidateJob) => Promise<void>;
  onOpenEdit: (candidate: CandidateJob) => void;
  onRemove: (candidate: CandidateJob) => Promise<void>;
}) {
  return (
    <div className="candidate-job-card-grid">
      {items.map((candidate) => {
        const selected = selectedIds.includes(candidate.id);
        /** 右键菜单：批量选择 + 单条删除（与「···」里的删除同一份确认）；多选时收起。 */
        const contextItems: RowActionItem[] = selecting
          ? []
          : [
              {
                key: "batch_select",
                label: "批量选择",
                icon: <CheckSquareOutlined />,
                onClick: onEnterSelecting,
              },
              {
                key: "delete",
                label: "删除",
                danger: true,
                icon: <DeleteOutlined />,
                confirm: "删除这条备选岗位？",
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
                  <Checkbox
                    checked={selected}
                    disabled={batchAction !== null}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => onToggleSelected(candidate.id, event.target.checked)}
                  />
                  <Typography.Text strong>{candidate.title || "（未识别岗位名）"}</Typography.Text>
                </Space>
              }
              extra={
                <Tag color={candidate.status === "imported" ? "green" : "orange"}>
                  {candidate.status === "imported" ? "已导入" : "待处理"}
                </Tag>
              }
            >
              <Space orientation="vertical" size={6} style={{ width: "100%" }}>
                <Typography.Text type="secondary">
                  {[candidate.company || "未识别公司", candidate.location, candidate.salary]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography.Text>
                <Space wrap>
                  <Tag>{candidate.source || "未知来源"}</Tag>
                  {candidate.images.length > 0 && (
                    <Tag color="blue">截图 {candidate.images.length} 张</Tag>
                  )}
                  {candidate.raw_text && <Tag>原文 {candidate.raw_text.length} 字</Tag>}
                </Space>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  更新于 {formatDateTime(candidate.updated_at)}
                </Typography.Text>
                <RowActions
                  primary={
                    candidate.status === "pending"
                      ? [
                          {
                            key: "import",
                            label: "导入到岗位",
                            onClick: () => void onStartImport(candidate),
                          },
                        ]
                      : []
                  }
                  more={[
                    {
                      key: "detail",
                      label: "查看详情",
                      onClick: () => void onOpenDetails(candidate),
                    },
                    {
                      key: "edit",
                      label: "编辑",
                      icon: <EditOutlined />,
                      onClick: () => onOpenEdit(candidate),
                    },
                    {
                      key: "delete",
                      label: "删除",
                      danger: true,
                      icon: <DeleteOutlined />,
                      confirm: "删除这条备选岗位？",
                      onClick: () => void onRemove(candidate),
                    },
                  ]}
                />
              </Space>
            </Card>
          </RowContextMenu>
        );
      })}
    </div>
  );
}
