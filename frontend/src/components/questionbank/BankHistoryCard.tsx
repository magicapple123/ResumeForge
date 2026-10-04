/** 历史题库卡：历史条目 Collapse + 批量选择入口。
 *
 * 纯展示组件——删除确认（removeSelected/removeBank）与 useApi 状态由 QuestionBankPanel
 * 传入；零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 */
import { CheckSquareOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Collapse, Empty, Space, Spin, Typography } from "antd";
import { RowActions } from "../common/RowActions";
import BatchActionBar from "../common/BatchActionBar";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import type { useApi } from "../../hooks/useApi";
import type { QuestionBankRecord } from "../../types";

type BanksState = ReturnType<typeof useApi<QuestionBankRecord[]>>;

interface Props {
  banks: BanksState;
  batch: BatchSelection<number>;
  /** 点击历史条目里的「查看详情」时回调，由父组件接管选中。 */
  onOpenRecord?: (record: QuestionBankRecord) => void;
  onRemoveBank: (id: number) => Promise<void>;
  removeSelected: () => void;
}

export default function BankHistoryCard({
  banks,
  batch,
  onOpenRecord,
  onRemoveBank,
  removeSelected,
}: Props) {
  const historyItems = (banks.data ?? []).map((bank) => ({
    key: String(bank.id),
    label: (
      <Space wrap>
        <span>{bank.resume_title || bank.job_title || "题库"}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {bank.created_at.replace("T", " ").slice(0, 16)}
        </Typography.Text>
      </Space>
    ),
    children: (
      <Space orientation="vertical" style={{ width: "100%" }}>
        {bank.groups.map((group) => (
          <div key={group.type}>
            <Typography.Text strong>{group.type}</Typography.Text>
            <ul style={{ paddingLeft: 20, margin: "4px 0" }}>
              {group.questions.map((item) => (
                <li key={item.question}>{item.question}</li>
              ))}
            </ul>
          </div>
        ))}
        <Space wrap>
          {batch.selecting ? (
            <Checkbox
              aria-label={`选择题库 ${bank.resume_title || bank.job_title || bank.id}`}
              checked={batch.isSelected(bank.id)}
              onChange={() => batch.toggle(bank.id)}
            />
          ) : (
            onOpenRecord && (
              <Button size="small" onClick={() => onOpenRecord(bank)}>
                查看详情
              </Button>
            )
          )}
          {/* 删除收进「···」菜单：除回收站外，删除不再以按钮裸露（全局约定）。 */}
          <RowActions
            more={[
              {
                key: "delete",
                label: "删除",
                danger: true,
                confirm: "删除这条题库历史？",
                onClick: () => void onRemoveBank(bank.id),
              },
            ]}
          />
        </Space>
      </Space>
    ),
  }));

  return (
    <Card
      size="small"
      title={
        <Space>
          <HistoryOutlined />
          历史题库
        </Space>
      }
      extra={
        !batch.selecting && (banks.data ?? []).length > 0 ? (
          <Button size="small" icon={<CheckSquareOutlined />} onClick={batch.enterSelecting}>
            批量选择
          </Button>
        ) : undefined
      }
    >
      {batch.selecting && (
        <BatchActionBar count={batch.selectedCount} onExit={batch.exitSelecting}>
          <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
            删除所选
          </Button>
        </BatchActionBar>
      )}
      {banks.loading && !banks.data ? (
        <Spin />
      ) : banks.error ? (
        <Alert type="error" showIcon title={banks.error} />
      ) : (banks.data ?? []).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存过题库" />
      ) : (
        <Collapse items={historyItems} />
      )}
    </Card>
  );
}
