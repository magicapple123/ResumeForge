// SPDX-License-Identifier: Apache-2.0
/**
 * 「助手做了什么」工具调用折叠面板 + 写入提案卡（RF-01）。
 *
 * 从 AssistantMessageContent 拆出（500 行预算守卫）：工具调用明细与提案卡是
 * 自洽的展示单元，与 Markdown 正文渲染没有共享逻辑。`TOOL_LABELS` 必须覆盖
 * 后端注册的全部工具（漏掉的会露出内部名），新增写工具时同步补。
 */

import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { Collapse, Typography } from "antd";
import type { AssistantToolCall } from "../../../types";
import { t } from "../../../i18n";
import type { MessageKey } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import ActionProposalCard from "./ActionProposalCard";

/**
 * 工具名的中文说法；没列到的直接显示原名。
 *
 * 必须覆盖后端注册的**全部**工具：漏掉的那些会在"助手做了什么"这一行里露出
 * `import_candidate_job` 这样的内部名字，而这一行正是用户用来确认助手改动了什么的地方。
 * 后端新增工具时这里要一起补（`services/assistant_tools.py` 的 `_TOOLS`）。
 */
const TOOL_LABELS: Record<string, MessageKey> = {
  search_product_docs: "toolLabel.search_product_docs",
  get_overview: "toolLabel.get_overview",
  list_jobs: "toolLabel.list_jobs",
  get_job: "toolLabel.get_job",
  list_resumes: "toolLabel.list_resumes",
  get_resume: "toolLabel.get_resume",
  get_profile: "toolLabel.get_profile",
  create_job: "toolLabel.create_job",
  update_job: "toolLabel.update_job",
  update_profile: "toolLabel.update_profile",
  add_profile_entry: "toolLabel.add_profile_entry",
  list_application_tracks: "toolLabel.list_application_tracks",
  get_application_track: "toolLabel.get_application_track",
  create_application_track: "toolLabel.create_application_track",
  update_application_track: "toolLabel.update_application_track",
  list_materials: "toolLabel.list_materials",
  get_material: "toolLabel.get_material",
  create_material: "toolLabel.create_material",
  update_material: "toolLabel.update_material",
  list_claims: "toolLabel.list_claims",
  get_claim: "toolLabel.get_claim",
  create_claim: "toolLabel.create_claim",
  update_claim: "toolLabel.update_claim",
  list_candidate_jobs: "toolLabel.list_candidate_jobs",
  get_candidate_job: "toolLabel.get_candidate_job",
  create_candidate_job: "toolLabel.create_candidate_job",
  update_candidate_job: "toolLabel.update_candidate_job",
  import_candidate_job: "toolLabel.import_candidate_job",
  list_drill_sessions: "toolLabel.list_drill_sessions",
  get_drill_report: "toolLabel.get_drill_report",
  list_interview_sessions: "toolLabel.list_interview_sessions",
  get_interview_report: "toolLabel.get_interview_report",
  list_skills: "toolLabel.list_skills",
  get_skill: "toolLabel.get_skill",
  create_skill: "toolLabel.create_skill",
  update_skill: "toolLabel.update_skill",
  read_skill_knowledge: "toolLabel.read_skill_knowledge",
  update_resume_layout: "toolLabel.update_resume_layout",
  update_resume: "toolLabel.update_resume",
  create_format_template: "toolLabel.create_format_template",
  update_format_template: "toolLabel.update_format_template",
  list_format_templates: "toolLabel.list_format_templates",
  web_search: "toolLabel.web_search",
  list_reminders: "toolLabel.list_reminders",
  list_referrals: "toolLabel.list_referrals",
  list_apply_queue: "toolLabel.list_apply_queue",
  list_apply_records: "toolLabel.list_apply_records",
  list_interview_experiences: "toolLabel.list_interview_experiences",
  list_question_banks: "toolLabel.list_question_banks",
  list_reviews: "toolLabel.list_reviews",
  list_knowledge: "toolLabel.list_knowledge",
  get_knowledge: "toolLabel.get_knowledge",
  create_knowledge: "toolLabel.create_knowledge",
  update_knowledge: "toolLabel.update_knowledge",
  get_analytics_overview: "toolLabel.get_analytics_overview",
  list_share_packages: "toolLabel.list_share_packages",
  create_reminder: "toolLabel.create_reminder",
  update_reminder: "toolLabel.update_reminder",
  list_match_analyses: "toolLabel.list_match_analyses",
  create_interview_experience: "toolLabel.create_interview_experience",
  create_referral: "toolLabel.create_referral",
  list_user_files: "toolLabel.list_user_files",
  list_web_form_fills: "toolLabel.list_web_form_fills",
  get_web_form_fill: "toolLabel.get_web_form_fill",
  list_chat_conversations: "toolLabel.list_chat_conversations",
  get_chat_conversation: "toolLabel.get_chat_conversation",
};

export function MessageToolCalls({ calls }: { calls: AssistantToolCall[] }) {
  useLocale();
  // 写入提案卡放在折叠面板**外面**：待确认的写入必须一眼可见，不能藏在
  // "助手做了什么"的折叠里等用户点开（RF-01）。历史消息里的提案也会走到这里，
  // 卡片自己刷新状态（executed/rejected/失效）。
  const proposals = calls.filter((call) => call.proposal);
  if (!calls.length) return null;
  // 这里原来刻意**不折叠**，理由是"助手动了用户的数据，这件事必须一眼可见"。用户反馈
  // 这串记录每回答一次就铺开一整列、太吵，所以改成默认折叠的折叠面板；但**原来的意图
  // 用折叠标题承接下来**：标题永远可见，且直接写明「改动了 N 项」「N 项失败」——不展开
  // 也能一眼看出它动没动数据、有没有出错，只是把逐条明细挪到展开之后。这样既安静，
  // 又没有把"它改了我的数据"藏进折叠里。
  const changedCount = calls.filter((call) => call.changed).length;
  const failedCount = calls.filter((call) => !call.ok).length;
  return (
    <>
      {proposals.length > 0 && (
        <div className="assistant-write-proposals">
          {proposals.map((call, index) => (
            <ActionProposalCard
              key={call.proposal?.proposal_id ?? `proposal-${index}`}
              proposal={call.proposal!}
            />
          ))}
        </div>
      )}
      <Collapse
        className="assistant-tool-calls"
        size="small"
        items={[
          {
            key: "tool-calls",
            label: (
              <span className="assistant-tool-calls-label">
                {t("toolCalls.header", { count: calls.length })}
                {changedCount > 0 && (
                  <Typography.Text type="warning" className="assistant-tool-calls-flag">
                    · {t("toolCalls.changed", { count: changedCount })}
                  </Typography.Text>
                )}
                {failedCount > 0 && (
                  <Typography.Text type="danger" className="assistant-tool-calls-flag">
                    · {t("toolCalls.failed", { count: failedCount })}
                  </Typography.Text>
                )}
              </span>
            ),
            children: (
              <ul>
                {calls.map((call, index) => (
                  <li key={`${call.name}-${index}`}>
                    {call.ok ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                    <Typography.Text strong style={{ marginLeft: 6 }}>
                      {TOOL_LABELS[call.name] ? t(TOOL_LABELS[call.name]) : call.name}
                    </Typography.Text>
                    {call.ok ? (
                      <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                        {call.summary}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="danger" style={{ marginLeft: 8 }}>
                        {t("toolCalls.error", { error: call.error })}
                      </Typography.Text>
                    )}
                    {call.ok && call.link && (
                      // 用 href 而不是 router Link：这个组件也会被单独渲染在测试里。
                      <Typography.Link href={call.link} style={{ marginLeft: 8 }}>
                        {t("toolCalls.view")}
                      </Typography.Link>
                    )}
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </>
  );
}
