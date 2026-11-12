// SPDX-License-Identifier: Apache-2.0
/**
 * 高级调整折叠块的内部内容：Top P / Top K、惩罚项、随机种子、停止词、思考参数形态。
 * （**零 props**——纯 Form.Item name 注册在调用方持有的父 Form 上，弹窗/页面表单通用。）
 */
import { Alert, Col, Form, InputNumber, Row, Select } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { THINKING_STYLE_OPTIONS } from "./thinkingMeta";

export function AdvancedParamsSection() {
  useLocale();
  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title={t("advancedParams.alert.emptyNotSent")}
      />
      <Row gutter={[16, 0]}>
        <Col xs={24} md={6}>
          <Form.Item name="top_p" label="Top P" tooltip={t("advancedParams.tooltip.topP")}>
            <InputNumber
              min={0}
              max={1}
              step={0.05}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="frequency_penalty"
            label={t("advancedParams.field.frequencyPenalty")}
            tooltip={t("advancedParams.tooltip.frequencyPenalty")}
          >
            <InputNumber
              min={-2}
              max={2}
              step={0.1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="presence_penalty"
            label={t("advancedParams.field.presencePenalty")}
            tooltip={t("advancedParams.tooltip.presencePenalty")}
          >
            <InputNumber
              min={-2}
              max={2}
              step={0.1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="seed"
            label={t("advancedParams.field.seed")}
            tooltip={t("advancedParams.tooltip.seed")}
          >
            <InputNumber
              min={0}
              step={1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item name="top_k" label="Top K" tooltip={t("advancedParams.tooltip.topK")}>
            <InputNumber
              min={0}
              max={1000}
              step={1}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="repetition_penalty"
            label={t("advancedParams.field.repetitionPenalty")}
            tooltip={t("advancedParams.tooltip.repetitionPenalty")}
          >
            <InputNumber
              min={0}
              max={2}
              step={0.05}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="thinking_budget"
            label={t("advancedParams.field.thinkingBudget")}
            tooltip={t("advancedParams.tooltip.thinkingBudget")}
          >
            <InputNumber
              min={0}
              max={100000}
              step={1024}
              style={{ width: "100%" }}
              placeholder={t("advancedParams.placeholder.leaveEmpty")}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={6}>
          <Form.Item
            name="thinking_style"
            label={t("advancedParams.field.thinkingStyle")}
            tooltip={t("advancedParams.tooltip.thinkingStyle")}
          >
            <Select
              options={THINKING_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              }))}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="stop"
            label={t("advancedParams.field.stop")}
            tooltip={t("advancedParams.tooltip.stop")}
          >
            <Select
              mode="tags"
              open={false}
              suffixIcon={null}
              placeholder={t("advancedParams.placeholder.stop")}
            />
          </Form.Item>
        </Col>
      </Row>
      <Alert
        type="info"
        showIcon
        style={{ marginTop: 4 }}
        title={t("advancedParams.alert.protocolNote")}
      />
    </>
  );
}
