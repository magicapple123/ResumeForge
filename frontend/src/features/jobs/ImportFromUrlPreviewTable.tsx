// SPDX-License-Identifier: Apache-2.0
/**
 * 链接导入的预览表（#16C / 17B / 17E）：每行可编辑、可取消勾选，并显示来源 URL、
 * 原文摘要（≤120 字）与字段四态。
 *
 * 为什么把四态摆在单元格上而不是只给一个总状态：用户要能区分「页面没写」和「我们
 * 还没去抓」——前者补详情也没用，后者点「补齐详情」就能填上。四个值：
 * filled / not_on_page / not_fetched / fetch_failed（后端 field_states 原样返回）。
 */
import { Button, ConfigProvider, Input, Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { FieldState, FromUrlRow } from "./importFromUrlApi";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useState } from "react";

export interface EditableRow extends FromUrlRow {
  /** 前端本地稳定 key（用户编辑后行仍可对应）。 */
  key: number;
}

interface Props {
  rows: EditableRow[];
  selectedKeys: number[];
  onSelectedChange: (keys: number[]) => void;
  onEdit: (key: number, field: string, value: string) => void;
  onRemove: (key: number) => void;
  /** 补详情进度：非空时表格下方显示进度说明。 */
  detailProgress?: { done: number; total: number } | null;
}

function stateHintKey(state: FieldState | undefined): MessageKey | null {
  if (state === "not_on_page") return "jobsImport.state.notOnPage";
  if (state === "not_fetched") return "jobsImport.state.notFetched";
  if (state === "fetch_failed") return "jobsImport.state.fetchFailed";
  return null;
}

function FieldCell({
  value,
  state,
  onChange,
  placeholder,
}: {
  value: string;
  state: FieldState | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  useLocale();
  const [editing, setEditing] = useState(false);
  const hint = stateHintKey(state);
  if (!value && !editing) {
    return (
      <Button
        type="text"
        size="small"
        onClick={() => setEditing(true)}
        aria-label={t("jobsImport.action.editField")}
        style={{ paddingInline: 0, maxWidth: "100%" }}
      >
        <Typography.Text type={state === "fetch_failed" ? "danger" : "secondary"} ellipsis>
          {hint ? t(hint) : placeholder || "—"}
        </Typography.Text>
      </Button>
    );
  }
  return (
    <Tooltip title={hint ? t(hint) : undefined}>
      <Input
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={t("jobsImport.action.editField")}
        autoFocus={editing}
        onBlur={() => setEditing(false)}
        onPressEnter={() => setEditing(false)}
      />
    </Tooltip>
  );
}

export function ImportFromUrlPreviewTable({
  rows,
  selectedKeys,
  onSelectedChange,
  onEdit,
  onRemove,
  detailProgress,
}: Props) {
  // 组件用 t()：必须订阅语言变化。
  useLocale();
  const dataOf = (row: EditableRow) => row.data ?? {};

  const columns: TableColumnsType<EditableRow> = [
    {
      title: t("jobsImport.column.title"),
      key: "title",
      width: 190,
      fixed: "left",
      ellipsis: true,
      render: (_value, row) => (
        <FieldCell
          value={dataOf(row).title ?? ""}
          state={row.field_states?.title}
          onChange={(value) => onEdit(row.key, "title", value)}
        />
      ),
    },
    {
      title: t("jobsImport.column.company"),
      key: "company",
      width: 160,
      render: (_value, row) => (
        <FieldCell
          value={dataOf(row).company ?? ""}
          state={row.field_states?.company}
          onChange={(value) => onEdit(row.key, "company", value)}
        />
      ),
    },
    {
      title: t("jobsImport.column.location"),
      key: "location",
      width: 120,
      render: (_value, row) => (
        <FieldCell
          value={dataOf(row).location ?? ""}
          state={row.field_states?.location}
          onChange={(value) => onEdit(row.key, "location", value)}
        />
      ),
    },
    {
      title: t("jobsImport.column.salary"),
      key: "salary",
      width: 120,
      render: (_value, row) => (
        <FieldCell
          value={dataOf(row).salary ?? ""}
          state={row.field_states?.salary}
          onChange={(value) => onEdit(row.key, "salary", value)}
        />
      ),
    },
    {
      title: t("jobsImport.column.postedAt"),
      key: "posted_at",
      width: 150,
      render: (_value, row) => (
        <div>
          <FieldCell
            value={dataOf(row).posted_at ?? ""}
            state={row.field_states?.posted_at}
            onChange={(value) => onEdit(row.key, "posted_at", value)}
          />
          {row.posted_at_inferred ? (
            <Tag color="orange" style={{ marginInlineEnd: 0 }}>
              {t("jobsImport.tag.postedAtInferred")}
            </Tag>
          ) : null}
          {!dataOf(row).posted_at && row.posted_at_raw ? (
            <Typography.Text type="secondary" style={{ fontSize: 12, display: "block" }}>
              {t("jobsImport.postedAt.raw", { raw: row.posted_at_raw })}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: t("jobsImport.column.source"),
      key: "source",
      width: 170,
      render: (_value, row) => {
        const source = row.detail_url || dataOf(row).source_url || "";
        return source ? (
          <Tooltip title={source}>
            <Typography.Link href={source} target="_blank" rel="noreferrer" ellipsis>
              {source}
            </Typography.Link>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary">{t("jobsImport.state.notOnPage")}</Typography.Text>
        );
      },
    },
    {
      title: t("jobsImport.column.summary"),
      key: "summary",
      width: 220,
      render: (_value, row) => (
        <Tooltip title={row.summary || t("jobsImport.preview.untitled")}>
          <Typography.Text type="secondary" ellipsis>
            {row.summary || "—"}
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: t("jobsImport.column.status"),
      key: "status",
      width: 210,
      render: (_value, row) => {
        const states = row.field_states ?? {};
        const detailFailed = Object.values(states).includes("fetch_failed");
        const detailPending = Object.values(states).includes("not_fetched");
        const descriptionFilled = states.description === "filled";
        return (
          <div style={{ display: "flex", gap: 4, whiteSpace: "nowrap", overflow: "hidden" }}>
            {row.existing_job_id != null ? (
              <Tag color="blue">{t("jobsImport.tag.existing")}</Tag>
            ) : null}
            {detailPending ? <Tag>{t("jobsImport.tag.detailPending")}</Tag> : null}
            {detailFailed ? (
              <Tooltip title={row.detail_error || ""}>
                <Tag color="red">{t("jobsImport.tag.detailFailed")}</Tag>
              </Tooltip>
            ) : null}
            {descriptionFilled ? (
              <Tag color={row.jd_split ? "green" : "default"}>
                {row.jd_split ? t("jobsImport.tag.jdSplit") : t("jobsImport.tag.jdUnsplit")}
              </Tag>
            ) : null}
            {row.job_type_inferred ? (
              <Tag color="orange">{t("jobsImport.tag.jobTypeInferred")}</Tag>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t("jobsImport.column.actions"),
      key: "actions",
      width: 80,
      render: (_value, row) => (
        <Button type="link" size="small" danger onClick={() => onRemove(row.key)}>
          {t("jobsImport.action.remove")}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <ConfigProvider theme={{ components: { Table: { cellPaddingBlockSM: 4 } } }}>
        <Table<EditableRow>
          size="small"
          rowKey="key"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{
            x: columns.reduce((total, column) => total + Number(column.width ?? 0), 32),
            y: 360,
          }}
          rowSelection={{
            fixed: true,
            columnWidth: 32,
            selectedRowKeys: selectedKeys,
            onChange: (keys) => onSelectedChange(keys.map(Number)),
          }}
        />
      </ConfigProvider>
      {detailProgress ? (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("jobsImport.progress.details", {
            done: detailProgress.done,
            total: detailProgress.total,
          })}
        </Typography.Text>
      ) : null}
    </div>
  );
}
