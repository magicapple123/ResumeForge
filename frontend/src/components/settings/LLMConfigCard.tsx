// SPDX-License-Identifier: Apache-2.0
/** 大模型 API 配置：单区块。已保存记录以卡片呈现，新增与编辑共用同一弹窗。
 *
 * 信息架构（用户要求的交互重构）：
 * - 「使用」= 把该记录应用到当前生效配置；「测试连接」留在卡上；
 * - 「编辑」「删除」收进卡上的「···」下拉（弹层全局挂 body，不会被卡片裁剪）；
 * - 点卡片本体查看只读详情（密钥脱敏）；
 * - 带「使用中」标记的是当前生效的那条；编辑它并保存后，调用方会把改动同步到
 *   当前生效配置（见 SettingsPage 的 handleSaveRecord），避免生效内容与记录脱节。
 */
import {
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  MoreOutlined,
  PlusOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Card, Dropdown, Flex, Tag, Tooltip, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import LoadingBlock from "../common/LoadingBlock";
import type { FormInstance } from "antd";
import { useMemo, useState } from "react";
import type {
  LLMConfigRecord,
  LLMModelsResult,
  LLMTestResult,
  LLMThinkingResult,
} from "../../types";
import { formatDateTime } from "../../utils/format";
import type { LLMConfigSummary } from "./SettingsConfig";
import { CUSTOM_PRESET_LABEL_KEY, matchingPreset } from "./SettingsConfig";
import type { RecordFormValues } from "../../features/settings/useLLMRecordTools";
import { useCollapsedList } from "../common/useCollapsedList";
import LLMRecordModal from "./LLMRecordModal";
import LLMRecordViewModal from "./LLMRecordViewModal";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  records: LLMConfigRecord[];
  recordsLoading: boolean;
  activeRecordId: string | null;
  /** 当前生效配置的摘要（脱敏）：未来自任何记录时用于引导文案。 */
  configSummary: LLMConfigSummary | null;
  recordApplyingId: string | null;
  recordDeletingId: string | null;
  /** 卡上「测试连接」：逐卡触发、结果逐卡显示。 */
  recordTestingId: string | null;
  recordTestResults: Record<string, LLMTestResult>;
  /** 新增/编辑共用弹窗的表单与状态。 */
  recordForm: FormInstance<RecordFormValues>;
  recordModalOpen: boolean;
  /** null = 新增态；非 null = 正在编辑该记录。 */
  editingRecord: LLMConfigRecord | null;
  recordSaving: boolean;
  draftTesting: boolean;
  draftTestResult: LLMTestResult | null;
  /** 思考模式检测（弹窗内）：状态归 useLLMRecordTools，这里只透传。 */
  checkingThinking: boolean;
  thinkingResult: LLMThinkingResult | null;
  showingCustomEffort: boolean;
  effortOptions: { value: string; label: string }[];
  onProbeThinking: () => Promise<void>;
  onLoadThinkingOptions: () => Promise<LLMThinkingResult>;
  onBackToEffortPresets: () => void;
  onEffortCustom: (effort: string) => boolean;
  onClearThinkingResult: () => void;
  onOpenCreate: () => void;
  onOpenRecordEdit: (record: LLMConfigRecord) => void;
  onSaveRecord: () => void;
  onCloseRecordModal: () => void;
  onApplyRecord: (record: LLMConfigRecord) => void;
  onRemoveRecord: (record: LLMConfigRecord) => void;
  onTestRecord: (record: LLMConfigRecord) => void;
  onTestDraft: () => void;
  onPresetChange: (provider: string) => void;
  onFetchDraftModels: () => Promise<LLMModelsResult>;
}

export default function LLMConfigCard({
  records,
  recordsLoading,
  activeRecordId,
  configSummary,
  recordApplyingId,
  recordDeletingId,
  recordTestingId,
  recordTestResults,
  recordForm,
  recordModalOpen,
  editingRecord,
  recordSaving,
  draftTesting,
  draftTestResult,
  checkingThinking,
  thinkingResult,
  showingCustomEffort,
  effortOptions,
  onProbeThinking,
  onLoadThinkingOptions,
  onBackToEffortPresets,
  onEffortCustom,
  onClearThinkingResult,
  onOpenCreate,
  onOpenRecordEdit,
  onSaveRecord,
  onCloseRecordModal,
  onApplyRecord,
  onRemoveRecord,
  onTestRecord,
  onTestDraft,
  onPresetChange,
  onFetchDraftModels,
}: Props) {
  useLocale();
  const { modal } = App.useApp();
  const [viewingRecord, setViewingRecord] = useState<LLMConfigRecord | null>(null);
  // 「使用中」的记录永远排最顶部（用户要求）：当前生效的那张是最高频查看对象。
  // 稳定排序——其余记录保持原有顺序，不因切换使用而打乱；生效配置未来自任何记录
  // （activeRecordId 为 null）时不排序。
  const sortedRecords = useMemo(() => {
    if (activeRecordId === null) return records;
    const active = records.filter((record) => record.id === activeRecordId);
    return active.length > 0
      ? [...active, ...records.filter((record) => record.id !== activeRecordId)]
      : records;
  }, [records, activeRecordId]);
  // 记录多了也会刷屏：与数据集/技能一致，默认只展示前 5 张卡。
  const { visibleItems: visibleRecords, toggleNode: recordsToggleNode } =
    useCollapsedList(sortedRecords);
  const cardBusy =
    recordApplyingId !== null || recordDeletingId !== null || recordTestingId !== null;

  /** 删除走 confirm 二次确认（维持原 Popconfirm 的文案语义）。 */
  const confirmRemove = (record: LLMConfigRecord) => {
    modal.confirm({
      title: t("llmConfigCard.confirm.deleteTitle", { name: record.name }),
      content: t("llmConfigCard.confirm.deleteContent"),
      okText: t("llmConfigCard.action.delete"),
      cancelText: t("llmConfigCard.action.cancel"),
      okButtonProps: { danger: true },
      onOk: () => onRemoveRecord(record),
    });
  };

  return (
    <>
      <Card
        title={t("llmConfigCard.card.title")}
        className="settings-card"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={cardBusy || recordsLoading}
            onClick={onOpenCreate}
          >
            {t("llmConfigCard.action.create")}
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("llmConfigCard.hint.intro")}
        />
        <LoadingBlock spinning={recordsLoading}>
          {records.length === 0 ? (
            <EmptyState
              inline
              // 不再内嵌主按钮：这张卡的 extra 已经有「新建配置」，同一张卡里再放一颗
              // primary 就是两个同义主动作（§4.1）。改为写明按钮名——它同屏可见（§4.7）。
              description={t("llmConfigCard.empty.description")}
            />
          ) : (
            <Flex vertical gap={12}>
              {activeRecordId === null && configSummary?.scope === "dataset" && (
                <Alert
                  type="info"
                  showIcon
                  title={t("llmConfigCard.legacy.title")}
                  description={t("llmConfigCard.legacy.description", {
                    model: configSummary.model || t("llmConfigCard.fallback.model"),
                    baseUrl: configSummary.baseUrl || t("llmConfigCard.fallback.baseUrl"),
                  })}
                />
              )}
              {visibleRecords.map((record) => {
                const isActive = activeRecordId === record.id;
                const testResult = recordTestResults[record.id];
                return (
                  <Card
                    key={record.id}
                    size="small"
                    className="llm-record-card"
                    style={{ cursor: "pointer" }}
                    // 点卡片本体查看配置详情；按钮区与结果提示上会阻断冒泡。
                    onClick={() => setViewingRecord(record)}
                    title={
                      <Flex gap={8} wrap align="center">
                        {/* 「更新于 …」改为悬停显示，不再常驻占排版宽度。 */}
                        <Tooltip
                          title={t("llmConfigCard.tooltip.updatedAt", {
                            time: formatDateTime(record.updated_at),
                          })}
                        >
                          <Typography.Text strong>{record.name}</Typography.Text>
                        </Tooltip>
                        {isActive && (
                          <Tooltip title={t("llmConfigCard.tooltip.active")}>
                            <Tag color="blue">{t("llmConfigCard.tag.active")}</Tag>
                          </Tooltip>
                        )}
                      </Flex>
                    }
                  >
                    <Flex gap={8} wrap style={{ marginBottom: 12 }}>
                      <Tag>{t(matchingPreset(record)?.labelKey ?? CUSTOM_PRESET_LABEL_KEY)}</Tag>
                      <Typography.Text type="secondary">
                        {record.model || t("llmConfigCard.fallback.model")}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {record.base_url || t("llmConfigCard.fallback.baseUrl")}
                      </Typography.Text>
                      {record.api_key && (
                        // 脱敏承诺：卡片只说明"配置了密钥"，密钥本体与占位符都不渲染。
                        <Tag color="green">{t("llmConfigCard.tag.keyConfigured")}</Tag>
                      )}
                    </Flex>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Flex gap={8} wrap>
                        {/* 已是当前生效配置时「使用」无事可做：禁用置灰，避免
                            「能点但点了没效果」的怪观感（点卡片本体看详情不受影响）。 */}
                        <Button
                          size="small"
                          type={isActive ? "default" : "primary"}
                          icon={<SwapOutlined />}
                          disabled={cardBusy || isActive}
                          loading={recordApplyingId === record.id}
                          onClick={() => onApplyRecord(record)}
                        >
                          {t("llmConfigCard.action.apply")}
                        </Button>
                        <Button
                          size="small"
                          icon={<ApiOutlined />}
                          disabled={cardBusy}
                          loading={recordTestingId === record.id}
                          onClick={() => onTestRecord(record)}
                        >
                          {t("llmConfigCard.action.test")}
                        </Button>
                        <Dropdown
                          menu={{
                            items: [
                              {
                                key: "edit",
                                icon: <EditOutlined />,
                                label: t("llmConfigCard.action.edit"),
                              },
                              {
                                key: "delete",
                                icon: <DeleteOutlined />,
                                label: t("llmConfigCard.action.delete"),
                                danger: true,
                              },
                            ],
                            onClick: ({ key }) => {
                              if (key === "edit") onOpenRecordEdit(record);
                              else confirmRemove(record);
                            },
                          }}
                          trigger={["click"]}
                        >
                          <Button
                            size="small"
                            icon={<MoreOutlined />}
                            aria-label={t("llmConfigCard.aria.moreActions", { name: record.name })}
                            disabled={cardBusy}
                          />
                        </Dropdown>
                      </Flex>
                      {testResult && (
                        <Alert
                          style={{ marginTop: 12 }}
                          type={testResult.ok ? "success" : "error"}
                          showIcon
                          title={
                            testResult.ok
                              ? t("llmConfigCard.test.ok", {
                                  message: testResult.message,
                                  latency: `${testResult.latency_ms}`,
                                })
                              : t("llmConfigCard.test.failed", { message: testResult.message })
                          }
                        />
                      )}
                    </div>
                  </Card>
                );
              })}
              {recordsToggleNode}
            </Flex>
          )}
        </LoadingBlock>
      </Card>

      <LLMRecordModal
        open={recordModalOpen}
        mode={editingRecord ? "edit" : "create"}
        recordName={editingRecord?.name ?? ""}
        recordId={editingRecord?.id}
        form={recordForm}
        saving={recordSaving}
        testing={draftTesting}
        testResult={draftTestResult}
        onSave={onSaveRecord}
        onClose={onCloseRecordModal}
        onTest={onTestDraft}
        onPresetChange={onPresetChange}
        onFetchModels={onFetchDraftModels}
        checkingThinking={checkingThinking}
        thinkingResult={thinkingResult}
        showingCustomEffort={showingCustomEffort}
        effortOptions={effortOptions}
        onProbe={onProbeThinking}
        onLoadThinkingOptions={onLoadThinkingOptions}
        onBackToEffortPresets={onBackToEffortPresets}
        onEffortCustom={onEffortCustom}
        onClearThinkingResult={onClearThinkingResult}
      />

      <LLMRecordViewModal
        open={viewingRecord !== null}
        record={viewingRecord}
        onClose={() => setViewingRecord(null)}
      />
    </>
  );
}
