// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位卡片网格（`CandidateCardGrid`）与它的批量动作（`useCandidateBatchTools`）：
 * 卡片上的状态与来源取值、右键菜单的单条动作、导出/批量删除的结果提示。
 *
 * 「编辑」「导入到岗位」「待处理」「未识别公司」「手动添加」这几个取值复用
 * `jobs.candidate.*` 与 `common.action.*` 的既有 key：同一实体同一取值只留一处真相。
 */
const jobsCandidate = {
  /** 右键菜单：打开这张卡片的详情。 */
  "jobsCandidate.card.viewDetail": "查看详情",
  /** 卡片标题为空时的占位。 */
  "jobsCandidate.card.untitled": "（未识别岗位名）",
  /** 状态标签：已经导入岗位广场。 */
  "jobsCandidate.card.statusImported": "已导入",
  /** 单条删除的二次确认标题（动作 + 对象）。 */
  "jobsCandidate.card.deleteConfirm": "删除这条备选岗位？",
  /** 截图数量标签。 */
  "jobsCandidate.card.images": "截图 {count} 张",
  /** 招聘原文字数标签。 */
  "jobsCandidate.card.rawLength": "原文 {count} 字",
  /** 最后更新时间。 */
  "jobsCandidate.card.updatedAt": "更新于 {time}",
  /** 跨页全选：当前筛选下一条都没有。 */
  "jobsCandidate.batch.emptyFiltered": "当前筛选下没有备选岗位",
  /** 跨页全选：超过后端单次批量上限。 */
  "jobsCandidate.batch.overLimit":
    "当前筛选下共 {count} 条备选岗位，超出单次批量上限 5000 条；请先用搜索缩小范围",
  /** 跨页全选成功。 */
  "jobsCandidate.batch.selectAllDone": "已选中当前筛选下的全部 {count} 条候选（所有页）",
  /** 跨页全选取 id 失败。 */
  "jobsCandidate.batch.loadFailed": "获取备选岗位列表失败",
  /** 导出的 CSV 文件名（`{stamp}` 是时间戳）。 */
  "jobsCandidate.batch.exportFileName": "备选岗位-{stamp}.csv",
  /** 导出成功。 */
  "jobsCandidate.batch.exported": "已导出 {count} 条备选岗位",
  /** 导出失败（没有更具体的原因时）。 */
  "jobsCandidate.batch.exportFailed": "导出失败",
  /** 批量删除前没有勾选。 */
  "jobsCandidate.batch.needSelection": "请先选择备选岗位",
  /** 批量删除：部分失败。 */
  "jobsCandidate.batch.deletePartial": "已删除 {deleted} 个备选岗位，{failed} 个删除失败",
  /** 批量删除：全部成功。 */
  "jobsCandidate.batch.deleted": "已删除 {deleted} 个备选岗位",
  /** 批量删除失败（没有更具体的原因时）。 */
  "jobsCandidate.batch.deleteFailed": "批量删除失败",
} as const;

export default jobsCandidate;
