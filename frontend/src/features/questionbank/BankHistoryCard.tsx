// SPDX-License-Identifier: Apache-2.0
/** 历史题库卡：单行摘要 + 批量选择入口。
 *
 * 纯展示组件——删除确认（removeSelected/removeBank）与 useApi 状态由 QuestionBankPanel
 * 传入；零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 */
import { CheckSquareOutlined, DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Listy, Pagination, Space, Typography } from "antd";
import EmptyState from "../../components/common/EmptyState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { RowActions, RowContextMenu, type RowActionItem } from "../../components/common/RowActions";
import BatchActionBar from "../../components/common/BatchActionBar";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import type { useApi } from "../../hooks/useApi";
import { useClientPagination } from "../../hooks/useClientPagination";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { QuestionBankRecord } from "../../types";
import { formatServerTime } from "../../utils/serverTime";

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
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  // The parent hides this mounted list during detail view, preserving the current page.
  const bankList = banks.data ?? [];
  const { page, setPage, paged: pagedBanks, total: bankTotal } = useClientPagination(bankList, 10);
  const renderHistory = (bank: QuestionBankRecord) => {
    const count = Array.isArray(bank.groups)
      ? bank.groups.reduce((sum, group) => sum + group.questions.length, 0)
      : 0;
    const deleteAction: RowActionItem = {
      key: "delete",
      label: t("common.action.delete"),
      danger: true,
      icon: <DeleteOutlined />,
      confirm: t("questionBankPanel.history.deleteTitle"),
      confirmBody: t("common.note.trashRecovery"),
      onClick: () => void onRemoveBank(bank.id),
    };
    return (
      <RowContextMenu
        items={
          batch.selecting
            ? []
            : ([
                {
                  key: "batch_select",
                  label: t("common.action.batchSelect"),
                  icon: <CheckSquareOutlined />,
                  onClick: batch.enterSelecting,
                },
                deleteAction,
              ] satisfies RowActionItem[])
        }
      >
        <ListyItem
          actions={[
            onOpenRecord && (
              <Button key="view" size="small" onClick={() => onOpenRecord(bank)}>
                {t("questionBankPanel.action.viewDetail")}
              </Button>
            ),
            <RowActions key="more" more={[deleteAction]} />,
          ]}
        >
          <Space wrap>
            {batch.selecting && (
              <Checkbox
                aria-label={t("questionBankPanel.history.selectAria", {
                  name: bank.resume_title || bank.job_title || bank.id,
                })}
                checked={batch.isSelected(bank.id)}
                onChange={() => batch.toggle(bank.id)}
              />
            )}
            <Typography.Text strong>
              {bank.resume_title || bank.job_title || t("questionBankPanel.history.fallbackTitle")}
            </Typography.Text>
            <Typography.Text type="secondary">{formatServerTime(bank.created_at)}</Typography.Text>
            <Typography.Text type="secondary">
              {t("questionBankPanel.history.questionCount", { count })}
            </Typography.Text>
          </Space>
        </ListyItem>
      </RowContextMenu>
    );
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <HistoryOutlined />
          {t("questionBankPanel.history.title")}
        </Space>
      }
    >
      {batch.selecting && (
        <BatchActionBar
          count={batch.selectedCount}
          onExit={batch.exitSelecting}
          pageSelectAll={{
            allSelected:
              pagedBanks.length > 0 && pagedBanks.every((item) => batch.isSelected(item.id)),
            someSelected: pagedBanks.some((item) => batch.isSelected(item.id)),
            onToggle: (checked) =>
              batch.selectPage(
                pagedBanks.map((item) => item.id),
                checked,
              ),
          }}
        >
          <Button danger disabled={batch.selectedCount === 0 || undefined} onClick={removeSelected}>
            {t("questionBankPanel.action.deleteSelected")}
          </Button>
        </BatchActionBar>
      )}
      {banks.loading && !banks.data ? (
        <LoadingBlock />
      ) : banks.error ? (
        <Alert type="error" showIcon title={banks.error} />
      ) : (banks.data ?? []).length === 0 ? (
        <EmptyState inline description={t("questionBankPanel.empty.noHistory")} />
      ) : (
        <>
          <Listy
            items={pagedBanks}
            rowKey={(bank) => bank.id}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={renderHistory}
          />
          <div style={{ textAlign: "right", marginTop: 12 }}>
            <Pagination
              current={page}
              pageSize={10}
              total={bankTotal}
              onChange={setPage}
              hideOnSinglePage
              showSizeChanger={false}
              showTotal={(count) => t("questionBankPanel.history.total", { count })}
            />
          </div>
        </>
      )}
    </Card>
  );
}
