// SPDX-License-Identifier: Apache-2.0
/**
 * 思考模式区：开关行 + 思考强度（下拉/自定义两态）+ 检测按钮 + 检测结果 Alert。
 * （两分支各自挂 name 的结构逐字保留；Form.Item 经 context 注册到调用方持有的同一 form。）
 */
import { ExperimentOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Form, Input, Row, Select, Switch, Typography } from "antd";
import type { LLMThinkingResult } from "../../../types";
import {
  CUSTOM_EFFORT_OPTION,
  MAX_REASONING_EFFORT_CHARS,
  isValidReasoningEffort,
} from "../../../types/assistant";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { EFFORT_TOOLTIP_KEY } from "./thinkingMeta";

export function ThinkingSection({
  thinkingEnabled,
  thinkingEffort,
  showingCustomEffort,
  effortOptions,
  checkingThinking,
  thinkingResult,
  saving,
  testing,
  onProbe,
  onBackToPresets,
}: {
  thinkingEnabled: boolean | undefined;
  thinkingEffort: string;
  showingCustomEffort: boolean;
  effortOptions: { value: string; label: string }[];
  checkingThinking: boolean;
  thinkingResult: LLMThinkingResult | null;
  saving: boolean;
  testing: boolean;
  onProbe: () => Promise<void>;
  onBackToPresets: () => void;
}) {
  useLocale();
  // 该型号**强制思考**（后端能力表 says supported=false，例如 GLM-5.3 / GPT-6 Astra /
  // Kimi K3）：开关置灰并说明原因——点了也关不掉，发关闭参数还会被上游 400
  // （清单 §11.5-D）。自动读表发生在弹窗打开时，不额外发上游请求。
  const cannotDisable = thinkingResult !== null && !thinkingResult.supported;
  // 读表结论（probed=false）不再单独弹提示条，避免打开弹窗就出现一条 vendor 说明；
  // 用户真的开了开关或点过检测时仍照旧显示。
  const showThinkingAlert =
    thinkingResult !== null && (thinkingResult.probed || thinkingEnabled === true);
  const thinkingAlertType = () => {
    if (!thinkingResult) return "info" as const;
    if (thinkingResult.reasoning_seen) return "success" as const;
    if (thinkingResult.accepted === false) return "error" as const;
    if (thinkingResult.probed) return "warning" as const;
    return "info" as const;
  };

  return (
    <>
      {/* 思考模式：**只作用于除「求职助手」以外的调用**。助手在它的输入框下方有自己的
          「思考强度」，两者刻意分开——否则"想换个档位试试"会变成一次全局改动。 */}
      <Row gutter={[16, 0]}>
        <Col xs={24} md={8}>
          <Form.Item
            name="thinking_enabled"
            label={t("llmUi.thinking.field.mode")}
            valuePropName="checked"
            tooltip={
              cannotDisable
                ? t("llmUi.thinking.tooltip.cannotDisable")
                : t("llmUi.thinking.tooltip.mode")
            }
          >
            <Switch
              // 禁用语义只传 true 或 undefined：显式 false 会短路 Form disabled。
              disabled={cannotDisable || undefined}
              checkedChildren={t("llmUi.thinking.switch.on")}
              unCheckedChildren={t("llmUi.thinking.switch.off")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          {/* 「下拉 / 自定义输入框」两态共用同一个字段名：**两个分支各自挂 `name`**，
              同一时刻只挂一个。这样字段始终是注册状态——`Form.useWatch` 只会在注册的
              字段上收到"配置异步载入"那次通知，不挂 name 的话载入值永远读不到。 */}
          {showingCustomEffort ? (
            <>
              <Form.Item
                name="thinking_effort"
                label={t("llmUi.thinking.field.effort")}
                tooltip={t(EFFORT_TOOLTIP_KEY)}
              >
                <Input
                  aria-label={t("llmUi.thinking.field.effort")}
                  maxLength={MAX_REASONING_EFFORT_CHARS}
                  placeholder={t("llmUi.thinking.placeholder.customEffort")}
                  status={isValidReasoningEffort(thinkingEffort) ? undefined : "error"}
                />
              </Form.Item>
              <Button
                type="link"
                size="small"
                className="llm-thinking-effort-back"
                onClick={onBackToPresets}
              >
                {t("llmUi.thinking.action.usePresets")}
              </Button>
            </>
          ) : (
            <Form.Item
              name="thinking_effort"
              label={t("llmUi.thinking.field.effort")}
              tooltip={t(EFFORT_TOOLTIP_KEY)}
            >
              <Select
                aria-label={t("llmUi.thinking.field.effort")}
                options={[
                  ...effortOptions,
                  { value: CUSTOM_EFFORT_OPTION, label: t("llmUi.thinking.option.custom") },
                ]}
                disabled={thinkingEnabled ? undefined : true}
                placeholder={t("llmUi.thinking.placeholder.defaultEffort")}
              />
            </Form.Item>
          )}
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label={t("llmUi.thinking.field.support")}
            tooltip={t("llmUi.thinking.tooltip.support")}
          >
            <Button
              icon={<ExperimentOutlined />}
              loading={checkingThinking}
              disabled={saving || testing}
              onClick={() => void onProbe()}
            >
              {t("llmUi.thinking.action.probe")}
            </Button>
          </Form.Item>
        </Col>
      </Row>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        {t("llmUi.thinking.note.probe")}
      </Typography.Text>
      {cannotDisable && thinkingResult && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title={t("llmUi.thinking.alert.cannotDisable")}
          description={thinkingResult.note}
        />
      )}
      {showThinkingAlert && thinkingResult && !cannotDisable && (
        <Alert
          type={thinkingAlertType()}
          showIcon
          style={{ marginBottom: 12 }}
          title={thinkingResult.probed ? thinkingResult.message : thinkingResult.note}
          description={
            thinkingResult.probed && thinkingResult.note ? thinkingResult.note : undefined
          }
        />
      )}
    </>
  );
}
