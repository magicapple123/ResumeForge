// SPDX-License-Identifier: Apache-2.0
/** 历史题库卡：历史条目 Collapse + 批量选择入口。
 *
 * 纯展示组件——删除确认（removeSelected/removeBank）与 useApi 状态由 QuestionBankPanel
 * 传入；零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 */
import { CheckSquareOutlined, DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Checkbox, Collapse, Pagination, Space, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import LoadingBlock from "../common/LoadingBlock";
import { RowActions, RowContextMenu, type RowActionItem } from "../common/RowActions";
import { TRASH_RECOVERY_NOTE } from "../common/rowActionMenu";
import BatchActionBar from "../common/BatchActionBar";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import type { useApi } from "../../hooks/useApi";
import { useClientPagination } from "../../hooks/useClientPagination";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
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

/**
 * 分组类型的显示名：键是 `types/` 里的中文协议值（协议值不改），值指向语言包 key。
 * 未登记的取值原样显示——历史记录里可能有旧版本写下的类型，别让它显示成一条裸 key。
 */
const GROUP_TYPE_LABEL_KEYS: Record<string, MessageKey> = {
  基础题: "questionBankPanel.group.basics", // i18n-ok: 协议值（types 中文枚举键）
  项目深挖题: "questionBankPanel.group.projectDeepDive", // i18n-ok: 协议值（types 中文枚举键）
  反问HR题: "questionBankPanel.group.askInterviewer", // i18n-ok: 协议值（types 中文枚举键）
};

function groupTypeLabel(type: string): string {
  const labelKey: MessageKey | undefined = GROUP_TYPE_LABEL_KEYS[type];
  return labelKey ? t(labelKey) : type;
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
                  label: t("common.action.batchSelect"),
                  icon: <CheckSquareOutlined />,
                  onClick: batch.enterSelecting,
                },
                {
                  key: "delete",
                  label: t("common.action.delete"),
                  danger: true,
                  icon: <DeleteOutlined />,
                  confirm: t("questionBankPanel.history.deleteTitle"),
                  confirmBody: TRASH_RECOVERY_NOTE,
                  onClick: () => void onRemoveBank(bank.id),
                },
              ] satisfies RowActionItem[])
        }
      >
        <Space wrap>
          <span>
            {bank.resume_title || bank.job_title || t("questionBankPanel.history.fallbackTitle")}
          </span>
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
            <Typography.Text strong>{groupTypeLabel(group.type)}</Typography.Text>
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
              aria-label={t("questionBankPanel.history.selectAria", {
                name: bank.resume_title || bank.job_title || bank.id,
              })}
              checked={batch.isSelected(bank.id)}
              onChange={() => batch.toggle(bank.id)}
            />
          ) : (
            onOpenRecord && (
              <Button size="small" onClick={() => onOpenRecord(bank)}>
                {t("questionBankPanel.action.viewDetail")}
              </Button>
            )
          )}
          {/* 删除收进「···」菜单：除回收站外，删除不再以按钮裸露（全局约定）。 */}
          <RowActions
            more={[
              {
                key: "delete",
                label: t("common.action.delete"),
                danger: true,
                confirm: t("questionBankPanel.history.deleteTitle"),
                confirmBody: TRASH_RECOVERY_NOTE,
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
          <Button danger disabled={batch.selectedCount === 0} onClick={removeSelected}>
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
          <Collapse items={historyItems} />
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
