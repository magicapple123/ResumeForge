// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页 · 模型单价（0067）：**每百万 token**，输入拆「缓存命中 / 未命中」，输出一档。
 *
 * 三个决定：
 *
 * 1. **保存即新建一条记录**，不覆盖上一条：单价是"某服务商在某个时间点"的价目，用户要能
 *    同时留着"官方价 / 调价后"并给它们起名字（`PATCH .../records/{id}` 改名）。
 * 2. **单位写进标签**（"每百万 token"）。按千计的数字小到 0.000002，估出来的金额没有参考
 *    价值，用户也没法对着账单核对。
 * 3. **三档都可见**：命中价通常只有未命中的 1/10，合成一个"输入价"会把省下的钱算没。
 */
import { CheckCircleFilled, DeleteOutlined, MoreOutlined, PlusOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, Empty, Input, InputNumber, Space, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import { pt } from "../../features/resume-provenance/i18n";
import {
  activateUsagePricingRecord,
  deleteUsagePricingRecord,
  fetchUsagePricing,
  fetchUsagePricingRecords,
  renameUsagePricingRecord,
  saveUsagePricing,
} from "../../features/resume-provenance/api";
import type { UsagePricingIn, UsagePricingRecordOut } from "../../features/resume-provenance/types";
import { t as common } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";

const EMPTY_FORM: UsagePricingIn = {
  name: "",
  input_cache_hit_per_million: null,
  input_cache_miss_per_million: null,
  output_per_million: null,
  currency: "CNY",
};

/** 价格显示：null 表示这一档没填（不是 0）。 */
function priceText(value: number | null, currency: string): string {
  return value === null ? pt("settings.provenance.pricing.notSet") : `${value} ${currency}`;
}

export default function UsagePricingCard() {
  useLocale();
  const { message, modal } = App.useApp();
  const [form, setForm] = useState<UsagePricingIn>(EMPTY_FORM);
  const [records, setRecords] = useState<UsagePricingRecordOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [current, list] = await Promise.all([fetchUsagePricing(), fetchUsagePricingRecords()]);
      setRecords(list.items);
      // 表单默认用"当前生效"的那份，方便用户直接改一版再存。
      setForm({
        name: "",
        input_cache_hit_per_million: current.input_cache_hit_per_million,
        input_cache_miss_per_million: current.input_cache_miss_per_million,
        output_per_million: current.output_per_million,
        currency: current.currency || "CNY",
      });
      setError("");
    } catch (caught) {
      // 旧后端可能没有 records 端点：保持空列表，不影响其余设置。
      setError(caught instanceof Error ? caught.message : pt("settings.provenance.pricing.failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 与设置页其它卡片同一写法：首屏取数放到微任务里，避免在 effect 里同步 setState
    // （react-hooks/set-state-in-effect）。
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const submit = async () => {
    const prices = [
      form.input_cache_hit_per_million,
      form.input_cache_miss_per_million,
      form.output_per_million,
    ];
    if (prices.every((value) => value === null)) {
      setError(pt("settings.provenance.pricing.atLeastOne"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveUsagePricing({ ...form, currency: form.currency.trim() || "CNY" });
      message.success(pt("settings.provenance.pricing.saved"));
      await load();
    } catch (caught) {
      const text =
        caught instanceof Error ? caught.message : pt("settings.provenance.pricing.failed");
      setError(text);
      message.error(text);
    } finally {
      setSaving(false);
    }
  };

  const activate = async (record: UsagePricingRecordOut) => {
    setBusyId(record.id);
    try {
      await activateUsagePricingRecord(record.id);
      await load();
    } catch (caught) {
      message.error(
        caught instanceof Error ? caught.message : pt("settings.provenance.pricing.failed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const submitRename = async (record: UsagePricingRecordOut) => {
    setBusyId(record.id);
    try {
      await renameUsagePricingRecord(record.id, renameDraft.trim());
      setRenamingId(null);
      await load();
    } catch (caught) {
      message.error(
        caught instanceof Error ? caught.message : pt("settings.provenance.pricing.renameFailed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const remove = (record: UsagePricingRecordOut) => {
    modal.confirm({
      title: pt("settings.provenance.pricing.deleteTitle"),
      content: pt("settings.provenance.pricing.deleteBody", {
        name: record.name || pt("settings.provenance.pricing.unnamed"),
      }),
      okButtonProps: { danger: true },
      okText: common("common.action.delete"),
      cancelText: common("common.action.cancel"),
      onOk: async () => {
        try {
          await deleteUsagePricingRecord(record.id);
          await load();
        } catch (caught) {
          message.error(
            caught instanceof Error ? caught.message : pt("settings.provenance.pricing.failed"),
          );
        }
      },
    });
  };

  return (
    <div className="settings-pricing" data-usage-pricing="1">
      <Typography.Text strong>{pt("settings.provenance.pricing.title")}</Typography.Text>
      <div className="settings-pricing-hint">{pt("settings.provenance.pricing.hint")}</div>

      <div className="settings-pricing-grid">
        <label className="settings-pricing-field">
          <span className="settings-pricing-label">
            {pt("settings.provenance.pricing.nameLabel")}
          </span>
          <Input
            size="small"
            value={form.name}
            maxLength={64}
            aria-label={pt("settings.provenance.pricing.nameLabel")}
            placeholder={pt("settings.provenance.pricing.namePlaceholder")}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          />
        </label>
        <label className="settings-pricing-field">
          <span className="settings-pricing-label">
            {pt("settings.provenance.pricing.currencyLabel")}
          </span>
          <Input
            size="small"
            value={form.currency}
            aria-label={pt("settings.provenance.pricing.currency")}
            onChange={(event) =>
              setForm((current) => ({ ...current, currency: event.target.value }))
            }
          />
        </label>
      </div>

      <div className="settings-pricing-grid settings-pricing-grid--prices">
        <label className="settings-pricing-field">
          <span className="settings-pricing-label">
            {pt("settings.provenance.pricing.hitLabel")}
          </span>
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            style={{ width: "100%" }}
            value={form.input_cache_hit_per_million}
            aria-label={pt("settings.provenance.pricing.hit")}
            placeholder={pt("settings.provenance.pricing.hitPlaceholder")}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                input_cache_hit_per_million: typeof value === "number" ? value : null,
              }))
            }
          />
        </label>
        <label className="settings-pricing-field">
          <span className="settings-pricing-label">
            {pt("settings.provenance.pricing.missLabel")}
          </span>
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            style={{ width: "100%" }}
            value={form.input_cache_miss_per_million}
            aria-label={pt("settings.provenance.pricing.miss")}
            placeholder={pt("settings.provenance.pricing.missPlaceholder")}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                input_cache_miss_per_million: typeof value === "number" ? value : null,
              }))
            }
          />
        </label>
        <label className="settings-pricing-field">
          <span className="settings-pricing-label">
            {pt("settings.provenance.pricing.outputLabel")}
          </span>
          <InputNumber
            size="small"
            min={0}
            step={0.01}
            style={{ width: "100%" }}
            value={form.output_per_million}
            aria-label={pt("settings.provenance.pricing.output")}
            placeholder={pt("settings.provenance.pricing.outputPlaceholder")}
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                output_per_million: typeof value === "number" ? value : null,
              }))
            }
          />
        </label>
      </div>

      <div className="settings-pricing-example">{pt("settings.provenance.pricing.example")}</div>

      <div className="settings-pricing-actions">
        <Button
          size="small"
          type="primary"
          icon={<PlusOutlined />}
          loading={saving}
          onClick={() => void submit()}
        >
          {pt("settings.provenance.pricing.save")}
        </Button>
        <span className="settings-pricing-note">{pt("settings.provenance.pricing.savedHint")}</span>
      </div>
      {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}

      <div className="settings-pricing-records">
        <Typography.Text strong className="settings-pricing-records-title">
          {pt("settings.provenance.pricing.recordsTitle")}
        </Typography.Text>
        {records.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              loading
                ? pt("settings.provenance.pricing.recordsLoading")
                : pt("settings.provenance.pricing.recordsEmpty")
            }
          />
        ) : (
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {records.map((record) => (
              <div key={record.id} className="settings-pricing-record">
                <div className="settings-pricing-record-head">
                  {renamingId === record.id ? (
                    <Space size={6}>
                      <Input
                        size="small"
                        value={renameDraft}
                        maxLength={64}
                        autoFocus
                        aria-label={pt("settings.provenance.pricing.renameLabel")}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onPressEnter={() => void submitRename(record)}
                      />
                      <Button
                        size="small"
                        type="primary"
                        loading={busyId === record.id}
                        onClick={() => void submitRename(record)}
                      >
                        {pt("settings.provenance.pricing.renameSave")}
                      </Button>
                      <Button size="small" onClick={() => setRenamingId(null)}>
                        {common("common.action.cancel")}
                      </Button>
                    </Space>
                  ) : (
                    <>
                      <Typography.Text strong>
                        {record.name || pt("settings.provenance.pricing.unnamed")}
                      </Typography.Text>
                      {record.is_active ? (
                        <Tag color="green" icon={<CheckCircleFilled />}>
                          {pt("settings.provenance.pricing.active")}
                        </Tag>
                      ) : null}
                      <span className="settings-pricing-record-time">
                        {formatDateTime(record.updated_at ?? record.created_at ?? undefined)}
                      </span>
                    </>
                  )}
                </div>
                <div className="settings-pricing-record-prices">
                  {pt("settings.provenance.pricing.recordPrices", {
                    hit: priceText(record.input_cache_hit_per_million, record.currency),
                    miss: priceText(record.input_cache_miss_per_million, record.currency),
                    output: priceText(record.output_per_million, record.currency),
                  })}
                </div>
                <Space size={4} wrap>
                  {!record.is_active ? (
                    <Button
                      size="small"
                      type="link"
                      loading={busyId === record.id}
                      onClick={() => void activate(record)}
                    >
                      {pt("settings.provenance.pricing.activate")}
                    </Button>
                  ) : null}
                  <Button
                    size="small"
                    type="link"
                    onClick={() => {
                      setRenamingId(record.id);
                      setRenameDraft(record.name);
                    }}
                  >
                    {pt("settings.provenance.pricing.rename")}
                  </Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "delete",
                          danger: true,
                          icon: <DeleteOutlined />,
                          label: common("common.action.delete"),
                          onClick: () => remove(record),
                        },
                      ],
                    }}
                  >
                    <Button
                      size="small"
                      type="text"
                      icon={<MoreOutlined />}
                      aria-label={common("common.action.more")}
                    />
                  </Dropdown>
                </Space>
              </div>
            ))}
          </Space>
        )}
      </div>
    </div>
  );
}
