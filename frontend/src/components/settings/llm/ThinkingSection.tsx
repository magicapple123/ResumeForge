/**
 * 思考模式区：开关行 + 思考强度（下拉/自定义两态）+ 检测按钮 + 检测结果 Alert。
 * （自 LLMConfigCard 拆出：:356-434 整块逐字随迁；两分支各自挂 name 的结构逐字保留；
 * Form.Item 经 context 注册到卡片持有的同一 form 实例。）
 */
import { ExperimentOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Row,
  Select,
  Switch,
  Typography,
} from "antd";
import type { LLMThinkingResult } from "../../../types";
import { CUSTOM_EFFORT_OPTION, MAX_REASONING_EFFORT_CHARS, isValidReasoningEffort } from "../../../types/assistant";
import { EFFORT_TOOLTIP } from "./thinkingMeta";

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
            label="思考模式"
            valuePropName="checked"
            tooltip="开启后，除「求职助手」以外的 AI 调用（简历生成、岗位解析、匹配分析等）会请求模型先思考再作答。默认关闭；各家对思考参数的写法与档位都不一样，可以先点右边的按钮检测。"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          {/* 「下拉 / 自定义输入框」两态共用同一个字段名：**两个分支各自挂 `name`**，
              同一时刻只挂一个。这样字段始终是注册状态——`Form.useWatch` 只会在注册的
              字段上收到"配置异步载入"那次通知，不挂 name 的话载入值永远读不到。 */}
          {showingCustomEffort ? (
            <>
              <Form.Item name="thinking_effort" label="思考强度" tooltip={EFFORT_TOOLTIP}>
                <Input
                  aria-label="思考强度"
                  maxLength={MAX_REASONING_EFFORT_CHARS}
                  placeholder="如 xhigh / max / 4096"
                  status={isValidReasoningEffort(thinkingEffort) ? undefined : "error"}
                />
              </Form.Item>
              <Button
                type="link"
                size="small"
                className="llm-thinking-effort-back"
                onClick={onBackToPresets}
              >
                用预设档位
              </Button>
            </>
          ) : (
            <Form.Item name="thinking_effort" label="思考强度" tooltip={EFFORT_TOOLTIP}>
              <Select
                aria-label="思考强度"
                options={[...effortOptions, { value: CUSTOM_EFFORT_OPTION, label: "自定义…" }]}
                disabled={thinkingEnabled ? undefined : true}
                placeholder="默认档位（不指定）"
              />
            </Form.Item>
          )}
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            label="支持情况"
            tooltip="上游没有「查询思考能力」的接口，所以这里分两步：只读内置表给出候选档位，点按钮则真的发一次最小请求——用来分辨「真的生效 / 被静默忽略 / 被上游拒绝」。"
          >
            <Button
              icon={<ExperimentOutlined />}
              loading={checkingThinking}
              disabled={saving || testing}
              onClick={() => void onProbe()}
            >
              检测思考支持
            </Button>
          </Form.Item>
        </Col>
      </Row>
      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
        「检测思考支持」会发一次最小请求，计入你的模型用量。思考模式只作用于除「求职助手」以外的
        AI 调用；助手的思考强度在它的输入框下方单独设置。
      </Typography.Text>
      {thinkingResult && (
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
