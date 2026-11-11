// SPDX-License-Identifier: Apache-2.0
/**
 * #29D 面试页「这家公司面经 N 条」文案。
 *
 * 计数用 {count} 占位符（N 来自后端 related.total，不是本地列表长度）；
 * 错误态不用 toast：面试进行中弹提示会打断用户，改成一行灰字 +「重试」。
 */
const interviewKnowledge = {
  /** 计数按钮：点它跳知识库并按公司筛选。 */
  "interviewKnowledge.title": "这家公司面经 {count} 条",
  /** 首查进行中（避免"没有面经"与"还没查到"混为一谈）。 */
  "interviewKnowledge.loading": "正在查找这家公司的面经…",
  /** 失败提示（给出路：下一行就是「重试」）。 */
  "interviewKnowledge.error": "面经暂时没能加载",
  "interviewKnowledge.retry": "重试",
  /** 标题行的无障碍名：每一条都能点，读屏要能区分。 */
  "interviewKnowledge.openItem": "查看面经：{title}",
} as const;

export default interviewKnowledge;
