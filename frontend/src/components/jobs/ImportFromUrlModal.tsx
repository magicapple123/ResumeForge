// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场「从链接导入」弹窗（#16C + #17A-F）。
 *
 * 两阶段流程：
 * 1. 抓列表（1 次请求）→ 预览表：每行可编辑、可取消勾选，显示来源 URL、原文摘要与四态；
 * 2. 对勾选的行「补齐详情」：按 ≤5 条/批逐批请求（同域限速 ≥2s），显示进度、可停止；
 *    中断时已完成的行保留，未完成的仍是「待补详情」。
 *
 * 导入后停在岗位广场（父组件刷新列表），不自动入队、不自动投递；详情没补的行如实写空，
 * 由预览里的「待补详情」说明，不拿列表摘要冒充 JD。
 */
import { LinkOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Flex,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
} from "antd";
import { useRef, useState } from "react";
import { isCancellation } from "../../api/client";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { commitFromUrl, fetchRowDetails, previewFromUrl } from "./importFromUrlApi";
import type { FetchEngine, FromUrlPreview, FromUrlRow } from "./importFromUrlApi";
import { ImportFromUrlPreviewTable } from "./ImportFromUrlPreviewTable";
import type { EditableRow } from "./ImportFromUrlPreviewTable";

/** 每批补详情条数：与后端 DETAIL_BATCH_LIMIT 一致（同域 ≥2s，5 条约 10 秒一批）。 */
const DETAIL_BATCH_LIMIT = 5;
/** 单次最多抓多少条（16E 硬上限 200）。 */
const MAX_PREVIEW_ROWS = 200;

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功（哪怕部分失败）后刷新岗位列表。 */
  onImported: () => void;
}

function withoutKey(row: EditableRow): FromUrlRow {
  const { key, ...rest } = row;
  void key; // 本地行 key 只用于前端对位，后端 schema 不认它。
  return rest;
}

export function ImportFromUrlModal({ open, onClose, onImported }: Props) {
  // 组件用 t()：必须订阅语言变化。
  useLocale();
  const { message } = App.useApp();
  const [url, setUrl] = useState("");
  const [engine, setEngine] = useState<FetchEngine>("auto");
  const [limit, setLimit] = useState<number | null>(null);
  // #16 分页：默认只抓 1 页；只跟随页面自己给出的「下一页」，不猜 URL 模板。
  const [pages, setPages] = useState(1);
  const [preview, setPreview] = useState<FromUrlPreview | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [detailProgress, setDetailProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [mergeMode, setMergeMode] = useState<"skip" | "fill_empty">("skip");
  const nextKey = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const busy = fetching || importing || detailProgress !== null;

  const reset = () => {
    setUrl("");
    setLimit(null);
    setPages(1);
    setPreview(null);
    setRows([]);
    setSelectedKeys([]);
    setDetailProgress(null);
    setMergeMode("skip");
  };

  const close = () => {
    if (busy) return;
    abortRef.current?.abort();
    reset();
    onClose();
  };

  const fetchPreview = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      message.warning(t("jobsImport.error.urlRequired"));
      return;
    }
    setFetching(true);
    try {
      const result = await previewFromUrl({
        url: trimmed,
        engine,
        limit: limit ?? 0,
        intent: "job_list",
        pages,
      });
      const mapped = result.rows.map((row) => ({ ...row, key: nextKey.current++ }));
      setPreview(result);
      setRows(mapped);
      setSelectedKeys(mapped.map((row) => row.key));
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setFetching(false);
    }
  };

  const onEdit = (key: number, field: string, value: string) => {
    setRows((previous) =>
      previous.map((row) =>
        row.key === key ? { ...row, data: { ...row.data, [field]: value } } : row,
      ),
    );
  };

  const onRemove = (key: number) => {
    setRows((previous) => previous.filter((row) => row.key !== key));
    setSelectedKeys((previous) => previous.filter((item) => item !== key));
  };

  const selectedRows = rows.filter((row) => selectedKeys.includes(row.key));
  const pendingRows = selectedRows.filter(
    (row) =>
      row.detail_url &&
      (row.field_states?.description === "not_fetched" ||
        row.field_states?.description === "fetch_failed"),
  );
  const hasExisting = rows.some((row) => row.existing_job_id != null);

  const stopDetails = () => {
    abortRef.current?.abort();
    message.info(t("jobsImport.progress.interrupted"));
  };

  const fillDetails = async () => {
    const targets = pendingRows;
    if (targets.length === 0) {
      message.info(t("jobsImport.state.notFetched"));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setDetailProgress({ done: 0, total: targets.length });
    let done = 0;
    let failed = 0;
    try {
      for (let start = 0; start < targets.length; start += DETAIL_BATCH_LIMIT) {
        const batch = targets.slice(start, start + DETAIL_BATCH_LIMIT);
        const result = await fetchRowDetails(
          batch.map(withoutKey),
          engine,
          preview?.url ?? url.trim(),
          controller.signal,
        );
        const byKey = new Map(batch.map((row, index) => [row.key, result.rows[index]]));
        setRows((previous) =>
          previous.map((row) => {
            const updated = byKey.get(row.key);
            return updated ? { ...updated, key: row.key } : row;
          }),
        );
        done += batch.length;
        failed += result.rows.filter(
          (row) => row.field_states?.description === "fetch_failed",
        ).length;
        setDetailProgress({ done, total: targets.length });
        if (controller.signal.aborted) break;
      }
    } catch (error) {
      if (!isCancellation(error)) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      abortRef.current = null;
      setDetailProgress(null);
    }
    if (failed > 0) {
      message.warning(t("jobsImport.toast.detailFailed", { count: failed }));
    }
  };

  const doImport = async () => {
    const selected = rows.filter((row) => selectedKeys.includes(row.key));
    if (selected.length === 0) {
      message.warning(t("jobsImport.error.selectFirst"));
      return;
    }
    setImporting(true);
    try {
      const result = await commitFromUrl(selected.map(withoutKey), mergeMode === "fill_empty");
      if (result.imported > 0) {
        message.success(t("jobsImport.toast.imported", { count: result.imported }));
      }
      if (result.updated > 0) {
        message.success(t("jobsImport.toast.updated", { count: result.updated }));
      }
      if (result.skipped.length > 0) {
        message.info(t("jobsImport.toast.skipped", { count: result.skipped.length }));
      }
      if (result.failed.length > 0) {
        // 有失败就留在预览里：用户能看清哪几条失败，改完再导。
        message.warning(t("jobsImport.toast.failed", { count: result.failed.length }));
        return;
      }
      if (result.imported > 0 || result.updated > 0) onImported();
      reset();
      onClose();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const methodLabel =
    preview?.method === "model" ? t("jobsImport.method.model") : t("jobsImport.method.rules");

  // #16 分页：truncated 时如实说明「为什么停」，不假装抓全了。
  const truncatedNotice = preview?.truncated
    ? preview.stop_reason === "limit"
      ? t("jobsImport.notice.truncatedLimit", {
          fetched: preview.pages_fetched,
          requested: preview.pages_requested,
        })
      : preview.stop_reason === "http_error"
        ? t("jobsImport.notice.truncatedHttpError", { fetched: preview.pages_fetched })
        : preview.stop_reason === "rejected"
          ? t("jobsImport.notice.truncatedRejected", { fetched: preview.pages_fetched })
          : t("jobsImport.notice.truncatedGeneric", { fetched: preview.pages_fetched })
    : "";

  return (
    <Modal
      title={t("jobsImport.title")}
      open={open}
      width={1080}
      onCancel={close}
      mask={{ closable: false }}
      footer={
        <Flex justify="space-between" align="center" gap={12} wrap>
          <Space wrap>
            <Typography.Text type="secondary">
              {t("jobsImport.selected", { count: selectedKeys.length })}
            </Typography.Text>
            <Button
              disabled={busy || pendingRows.length === 0}
              onClick={() => void fillDetails()}
              loading={detailProgress !== null}
            >
              {t("jobsImport.action.fetchDetails", { count: pendingRows.length })}
            </Button>
            {detailProgress ? (
              <Button danger onClick={stopDetails}>
                {t("jobsImport.action.stopDetails")}
              </Button>
            ) : null}
          </Space>
          <Space>
            <Button disabled={busy} onClick={close}>
              {t("common.action.cancel")}
            </Button>
            <Button
              type="primary"
              loading={importing}
              disabled={busy || selectedKeys.length === 0}
              onClick={() => void doImport()}
            >
              {t("jobsImport.action.import", { count: selectedKeys.length })}
            </Button>
          </Space>
        </Flex>
      }
    >
      <Flex gap={12} wrap align="flex-end">
        <div style={{ flex: "1 1 420px", minWidth: 300 }}>
          <Typography.Text strong>{t("jobsImport.form.urlLabel")}</Typography.Text>
          <Input
            value={url}
            prefix={<LinkOutlined />}
            placeholder={t("jobsImport.form.urlPlaceholder")}
            disabled={busy}
            onChange={(event) => setUrl(event.target.value)}
            onPressEnter={() => void fetchPreview()}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("jobsImport.form.urlHint")}
          </Typography.Text>
        </div>
        <div>
          <Typography.Text strong>{t("jobsImport.form.engineLabel")}</Typography.Text>
          <Select<FetchEngine>
            value={engine}
            style={{ width: 180, display: "block" }}
            disabled={busy}
            onChange={setEngine}
            options={[
              { value: "auto", label: t("jobsImport.form.engineAuto") },
              { value: "browser", label: t("jobsImport.form.engineBrowser") },
            ]}
          />
        </div>
        <div>
          <Typography.Text strong>{t("jobsImport.form.limitLabel")}</Typography.Text>
          <InputNumber
            min={0}
            max={MAX_PREVIEW_ROWS}
            value={limit}
            style={{ width: 220, display: "block" }}
            placeholder={t("jobsImport.form.limitPlaceholder")}
            disabled={busy}
            onChange={(value) => setLimit(typeof value === "number" ? value : null)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("jobsImport.form.limitHint")}
          </Typography.Text>
        </div>
        <div>
          <Typography.Text strong>{t("jobsImport.form.pagesLabel")}</Typography.Text>
          <InputNumber
            min={1}
            max={10}
            value={pages}
            style={{ width: 120, display: "block" }}
            disabled={busy}
            aria-label={t("jobsImport.form.pagesLabel")}
            onChange={(value) => setPages(typeof value === "number" ? value : 1)}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("jobsImport.form.pagesHint")}
          </Typography.Text>
        </div>
        <Button
          type="primary"
          ghost
          loading={fetching}
          disabled={importing}
          onClick={() => void fetchPreview()}
        >
          {rows.length > 0 ? t("jobsImport.action.refetch") : t("jobsImport.action.fetch")}
        </Button>
      </Flex>

      {preview && preview.warnings.length > 0 ? (
        <Alert
          style={{ marginTop: 12 }}
          type="warning"
          showIcon
          title={t("jobsImport.notice.warnings")}
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      {preview ? (
        <>
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
            {t("jobsImport.preview.total", { count: rows.length })}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            {t("jobsImport.preview.meta", {
              engine: preview.engine,
              method: methodLabel,
              date: preview.fetched_on,
            })}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            {t("jobsImport.preview.pages", {
              fetched: preview.pages_fetched,
              requested: preview.pages_requested,
            })}
          </Typography.Text>
          {truncatedNotice ? (
            <Alert style={{ marginTop: 8 }} type="warning" showIcon title={truncatedNotice} />
          ) : null}
        </>
      ) : (
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
          {t("jobsImport.preview.empty")}
        </Typography.Text>
      )}

      {hasExisting ? (
        <div style={{ marginTop: 8 }}>
          <Space wrap>
            <Typography.Text>{t("jobsImport.merge.label")}</Typography.Text>
            <Radio.Group
              value={mergeMode}
              disabled={busy}
              onChange={(event) => setMergeMode(event.target.value as "skip" | "fill_empty")}
            >
              <Radio.Button value="skip">{t("jobsImport.merge.skip")}</Radio.Button>
              <Radio.Button value="fill_empty">{t("jobsImport.merge.fillEmpty")}</Radio.Button>
            </Radio.Group>
          </Space>
          <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            {t("jobsImport.merge.hint")}
          </Typography.Text>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <ImportFromUrlPreviewTable
            rows={rows}
            selectedKeys={selectedKeys}
            onSelectedChange={setSelectedKeys}
            onEdit={onEdit}
            onRemove={onRemove}
            detailProgress={detailProgress}
          />
        </div>
      ) : null}
    </Modal>
  );
}
