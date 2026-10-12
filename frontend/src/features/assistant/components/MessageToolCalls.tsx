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
import ActionProposalCard from "./ActionProposalCard";

/**
 * 工具名的中文说法；没列到的直接显示原名。
 *
 * 必须覆盖后端注册的**全部**工具：漏掉的那些会在"助手做了什么"这一行里露出
 * `import_candidate_job` 这样的内部名字，而这一行正是用户用来确认助手改动了什么的地方。
 * 后端新增工具时这里要一起补（`services/assistant_tools.py` 的 `_TOOLS`）。
 */
const TOOL_LABELS: Record<string, string> = {
  search_product_docs: "查阅简历通本地文档",
  get_overview: "查看整体概览",
  list_jobs: "查询岗位",
  get_job: "查看岗位详情",
  list_resumes: "查询简历",
  get_resume: "查看简历详情",
  get_profile: "查看个人资料",
  create_job: "新增岗位",
  update_job: "修改岗位",
  update_profile: "更新个人资料",
  add_profile_entry: "往资料里加一条经历",
  // 求职进度
  list_application_tracks: "查询求职进度",
  get_application_track: "查看求职进度详情",
  create_application_track: "新增求职进度",
  update_application_track: "修改求职进度",
  // 资料箱
  list_materials: "查询资料箱",
  get_material: "查看资料详情",
  create_material: "新增资料",
  update_material: "修改资料",
  // 事实台账
  list_claims: "查询事实台账",
  get_claim: "查看事实台账条目",
  create_claim: "新增事实台账条目",
  update_claim: "修改事实台账条目",
  // 备选岗位
  list_candidate_jobs: "查询备选岗位",
  get_candidate_job: "查看备选岗位详情",
  create_candidate_job: "新增备选岗位",
  update_candidate_job: "修改备选岗位",
  import_candidate_job: "把备选岗位导入岗位广场",
  // 面试深挖
  list_drill_sessions: "查询面试深挖记录",
  get_drill_report: "查看深挖复盘",
  // 模拟面试
  list_interview_sessions: "查询模拟面试",
  get_interview_report: "查看面试记录与报告",
  // 技能
  list_skills: "查询助手技能",
  get_skill: "查看技能详情",
  create_skill: "新建助手技能",
  update_skill: "修改助手技能",
  read_skill_knowledge: "查阅技能知识文件",
  // 简历版式与联网
  update_resume_layout: "调整简历版式",
  update_resume: "更新简历收藏/备注",
  create_format_template: "新建格式模板",
  update_format_template: "修改格式模板",
  list_format_templates: "查询格式模板",
  web_search: "联网搜索",
  // 提醒 / 内推 / 面经 / 题库 / 复盘 / 知识库 / 统计 / 分享包（知识审计补齐）
  list_reminders: "查询提醒",
  list_referrals: "查询内推",
  // 投递台（覆盖审计补齐：这块此前助手完全不知道）
  list_apply_queue: "查询投递队列",
  list_apply_records: "查询投递记录",
  list_interview_experiences: "查询面经",
  list_question_banks: "查询题库历史",
  list_reviews: "查询复盘历史",
  list_knowledge: "查询知识库",
  get_knowledge: "查看知识条目",
  create_knowledge: "新增知识条目",
  update_knowledge: "修改知识条目",
  get_analytics_overview: "查看求职统计",
  list_share_packages: "查询分享包",
  create_reminder: "新增提醒",
  update_reminder: "标记提醒完成/忽略",
  // P3 工具批：匹配分析记录 + 面经/内推写入
  list_match_analyses: "查询匹配分析记录",
  create_interview_experience: "新增面经",
  create_referral: "新增内推",
  // 我的文件（只读元数据）
  list_user_files: "查看我的文件",
  // 放宽模式工具：网申填充记录与历史对话（仅用户开启放宽模式后可见）
  list_web_form_fills: "查看网申填充记录",
  get_web_form_fill: "查看网申填写明细",
  list_chat_conversations: "查看历史对话",
  get_chat_conversation: "查看对话内容",
};

export function MessageToolCalls({ calls }: { calls: AssistantToolCall[] }) {
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
                {`助手做了什么（${calls.length}）`}
                {changedCount > 0 && (
                  <Typography.Text type="warning" className="assistant-tool-calls-flag">
                    · 改动了 {changedCount} 项
                  </Typography.Text>
                )}
                {failedCount > 0 && (
                  <Typography.Text type="danger" className="assistant-tool-calls-flag">
                    · {failedCount} 项失败
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
                      {TOOL_LABELS[call.name] ?? call.name}
                    </Typography.Text>
                    {call.ok ? (
                      <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
                        {call.summary}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="danger" style={{ marginLeft: 8 }}>
                        失败：{call.error}
                      </Typography.Text>
                    )}
                    {call.ok && call.link && (
                      // 用 href 而不是 router Link：这个组件也会被单独渲染在测试里。
                      <Typography.Link href={call.link} style={{ marginLeft: 8 }}>
                        前往查看
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
