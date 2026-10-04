/** 版本对比弹窗（受控）：基准版本展示 + 对比版本选择 + 字段级差异视图。
 *
 * 纯展示——diff 状态（diffAgainstId/diffResult/diffLoading）与三并发请求 handler
 * （selectDiffAgainst）保留在 ResumesPage，保证「版本对比」入口的重置语义逐字不变。
 */
import { Modal, Select, Space, Spin, Typography } from "antd";
import ResumeFieldDiffView from "../../components/ResumeFieldDiffView";
import type { DiffViewData } from "../../types/resumeFieldDiff";
import type { ResumeBrief } from "../../types";

interface Props {
  /** 对比基准（null 表示弹窗关闭）。 */
  diffBase: ResumeBrief | null;
  diffAgainstId: number | null;
  diffResult: DiffViewData | null;
  diffLoading: boolean;
  /** 可选的对比版本清单（当前列表数据，排除基准后作为下拉项）。 */
  items: ResumeBrief[];
  onSelect: (againstId: number) => void;
  onClose: () => void;
}

export default function ResumeDiffModal({
  diffBase,
  diffAgainstId,
  diffResult,
  diffLoading,
  items,
  onSelect,
  onClose,
}: Props) {
  return (
    <Modal
      title="版本对比"
      open={diffBase !== null}
      width="min(880px, calc(100vw - 24px))"
      footer={null}
      onCancel={onClose}
    >
      {diffBase && (
        <Space orientation="vertical" style={{ width: "100%" }} size="middle">
          <Space wrap>
            <Typography.Text>基准版本：</Typography.Text>
            <Typography.Text strong>{diffBase.title}</Typography.Text>
            <Typography.Text type="secondary">对比：</Typography.Text>
            <Select
              style={{ minWidth: 240 }}
              placeholder="选择要对比的版本"
              value={diffAgainstId ?? undefined}
              onChange={(value) => onSelect(value)}
              options={items
                .filter((item) => item.id !== diffBase.id)
                .map((item) => ({ value: item.id, label: item.title }))}
            />
          </Space>
          {diffLoading && <Spin />}
          {!diffLoading && diffResult && <ResumeFieldDiffView data={diffResult} />}
          {!diffLoading && !diffResult && (
            <Typography.Text type="secondary">选择一份其它简历后展示三态差异。</Typography.Text>
          )}
        </Space>
      )}
    </Modal>
  );
}
