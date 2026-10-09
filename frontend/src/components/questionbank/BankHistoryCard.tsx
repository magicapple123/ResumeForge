/** 历史题库卡：历史条目 Collapse + 批量选择入口。
 *
 * 纯展示组件——删除确认（removeSelected/removeBank）与 useApi 状态由 QuestionBankPanel
 * 传入；零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 */
import { CheckSquareOutlined, DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Collapse,
  Empty,
  Pagination,
  Space,
  Spin,
  Typography,
} from "antd";
import { RowActions, RowContextMenu, type RowActionItem } from "../common/RowActions";
import BatchActionBar from "../common/BatchActionBar";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import type { useApi } from "../../hooks/useApi";
import { useClientPagination } from "../../hooks/useClientPagination";
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
  // 题库历史每次生成一份、持续累积，Collapse 一页 10 条（Collapse 没有内建分页）。
  const bankList = banks.data ?? [];
  const { page, setPage, paged: pagedBanks, total: bankTotal } = useClientPagination(bankList, 10);
  const historyItems = pagedBanks.map((bank) => ({
    key: String(bank.id),
    label: (
      // 右键菜单挂在折叠头标题上：批量选择（工具栏按钮已收进这里，R8）+ 删除。
      <RowContextMenu
        items={
          batch.selecting
            ? []
            : ([
                {
                  key: "batch_select",
                  label: "批量选择",
                  icon: <CheckSquareOutlined />,
                  onClick: batch.enterSelecting,
                },
                {
                  key: "delete",
                  label: "删除",
                  danger: true,
                  icon: <DeleteOutlined />,
                  confirm: "删除这条题库历史？",
                  onClick: () => void onRemoveBank(bank.id),
                },
              ] satisfies RowActionItem[])
        }
      >
        <Space wrap>
          <span>{bank.resume_title || bank.job_title || "题库"}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {bank.created_at.replace("T", " ").slice(0, 16)}
          </Typography.Text>
        </Space>
      </RowContextMenu>
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
        <>
          <Collapse items={historyItems} />
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={10}
              total={bankTotal}
              onChange={setPage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => `共 ${count} 份`}
            />
          </div>
        </>
      )}
    </Card>
  );
}
