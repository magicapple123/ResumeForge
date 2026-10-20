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
import { CUSTOM_PRESET_LABEL, matchingPreset } from "./SettingsConfig";
import type { RecordFormValues } from "../../features/settings/useLLMRecordTools";
import { useCollapsedList } from "../common/useCollapsedList";
import LLMRecordModal from "./LLMRecordModal";
import LLMRecordViewModal from "./LLMRecordViewModal";

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
      title: `删除记录“${record.name}”？`,
      content: "删除记录不会影响当前正在使用的配置",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => onRemoveRecord(record),
    });
  };

  return (
    <>
      <Card
        title="大模型 API 配置"
        className="settings-card"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={cardBusy || recordsLoading}
            onClick={onOpenCreate}
          >
            新增配置
          </Button>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="支持所有兼容 OpenAI Chat Completions 协议的模型服务（DeepSeek、豆包、Kimi、通义千问、智谱、MiniMax、硅基流动、OpenRouter、OpenAI、Gemini、Ollama 等），也可切换到 Anthropic 原生协议直连 Claude。所有数据集共用这里的配置：每张卡片是一份已保存的记录，点卡片本体查看详情，可直接测试连接、切换「使用中」。API Key 加密保存在本地数据目录，不进入备份包。"
        />
        <LoadingBlock spinning={recordsLoading}>
          {records.length === 0 ? (
            <EmptyState
              inline
              description="暂无配置记录，点右上「新增配置」创建第一份；当前生效的配置会继续正常使用"
            />
          ) : (
            <Flex vertical gap={12}>
              {activeRecordId === null && configSummary?.scope === "dataset" && (
                <Alert
                  type="info"
                  showIcon
                  title="当前沿用本数据集旧配置，保存后将升级为全局配置"
                  description={`正在使用：${configSummary.model || "未填写模型"} · ${configSummary.baseUrl || "未填写地址"}。保存一次（或在下方新建记录后点「使用」）即改为所有数据集共用。`}
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
                        <Tooltip title={`更新于 ${formatDateTime(record.updated_at)}`}>
                          <Typography.Text strong>{record.name}</Typography.Text>
                        </Tooltip>
                        {isActive && (
                          <Tooltip title="当前生效的配置：简历生成与求职助手正在用它">
                            <Tag color="blue">使用中</Tag>
                          </Tooltip>
                        )}
                      </Flex>
                    }
                  >
                    <Flex gap={8} wrap style={{ marginBottom: 12 }}>
                      <Tag>{matchingPreset(record)?.label ?? CUSTOM_PRESET_LABEL}</Tag>
                      <Typography.Text type="secondary">
                        {record.model || "未填写模型"}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {record.base_url || "未填写地址"}
                      </Typography.Text>
                      {record.api_key && (
                        // 脱敏承诺：卡片只说明"配置了密钥"，密钥本体与占位符都不渲染。
                        <Tag color="green">密钥已配置</Tag>
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
                          使用
                        </Button>
                        <Button
                          size="small"
                          icon={<ApiOutlined />}
                          disabled={cardBusy}
                          loading={recordTestingId === record.id}
                          onClick={() => onTestRecord(record)}
                        >
                          测试连接
                        </Button>
                        <Dropdown
                          menu={{
                            items: [
                              { key: "edit", icon: <EditOutlined />, label: "编辑" },
                              {
                                key: "delete",
                                icon: <DeleteOutlined />,
                                label: "删除",
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
                            aria-label={`更多操作（${record.name}）`}
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
                              ? `${testResult.message}（耗时 ${testResult.latency_ms}ms）`
                              : `连接失败：${testResult.message}`
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
