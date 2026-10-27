// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位新增 / 编辑弹窗（`JobFormModal`）与它的静态字段（`JobFormFields`）：
 * 弹窗标题、字段标签、占位符、校验提示，以及识别与批量保存的 Toast。
 *
 * 两类中文**不在这里**：
 * - 「手动填写 / 粘贴文本识别 / 图片识别 / 文档识别」是提交给后端的录入方式
 *   （`JOB_RECOGNITION_SOURCES`），作为协议值留在组件里；
 * - 「校招 / 开放中」这类岗位类型与状态同样是落库值（`types/job.ts`），要让它们
 *   跟着界面语言变，得先把 `types/job.ts` 的选项表改成 labelKey（另起一批）。
 */
const jobForm = {
  "jobForm.title.create": "手动添加岗位",
  "jobForm.title.edit": "编辑岗位",
  "jobForm.title.confirmImport": "确认要导入的招聘信息",
  "jobForm.field.title": "岗位名称",
  "jobForm.field.company": "公司名称",
  "jobForm.field.location": "工作地点",
  "jobForm.field.salary": "薪资范围",
  "jobForm.field.jobType": "岗位类型",
  "jobForm.field.status": "状态",
  "jobForm.field.sourceUrl": "投递链接",
  "jobForm.field.postedAt": "发布时间（选填）",
  "jobForm.field.description": "岗位描述（JD）",
  "jobForm.field.requirements": "任职要求（选填）",
  "jobForm.field.additionalInfo": "其他招聘信息（选填）",
  "jobForm.field.note": "备注（选填）",
  "jobForm.required.title": "请填写岗位名称",
  "jobForm.required.description": "请填写岗位描述",
  "jobForm.required.url": "请输入合法的 URL",
  "jobForm.placeholder.title": "如：市场营销专员（校招）",
  "jobForm.placeholder.company": "如：字节跳动",
  "jobForm.placeholder.location": "如：北京",
  "jobForm.placeholder.salary": "如：25-40K·15薪",
  "jobForm.placeholder.sourceUrl": "招聘官网投递链接（选填）",
  "jobForm.placeholder.description": "粘贴完整 JD，生成简历时 AI 会据此定制内容",
  "jobForm.placeholder.requirements": "可单独填写任职要求，没有可留空",
  "jobForm.placeholder.additionalInfo":
    "如：公司与团队介绍、岗位编号、福利待遇、工作安排、申请或面试流程",
  "jobForm.placeholder.note": "记录投递进展、内推联系人、面试安排等",
  "jobForm.images.tooLarge": "单张图片不能超过 2 MB",
  "jobForm.images.limit": "备注最多放 {count} 张图片",
  "jobForm.images.readFailed": "读取图片失败，请重试",
  "jobForm.parse.needMaterial": "请先粘贴招聘信息，或添加截图、上传文档",
  "jobForm.parse.noContent": "没有识别到内容，请检查资料或稍后重试",
  "jobForm.parse.noFields": "没有识别到内容，表单未改动",
  "jobForm.parse.failed": "识别招聘信息失败",
  "jobForm.parse.multiFound": "识别出 {count} 份招聘信息，请确认后保存",
  "jobForm.parse.filledByAi": "已使用 AI 识别并填入表单，请核对后再保存",
  "jobForm.parse.filledByRule": "已使用本地规则识别并填入表单，请核对后再保存",
  "jobForm.drafts.engineAi": "AI 拆分",
  "jobForm.drafts.engineRule": "按分隔符拆分",
  "jobForm.drafts.fallbackTitle": "待补充岗位",
  "jobForm.drafts.unnamed": "未命名岗位",
  "jobForm.drafts.failure": "{title}：{reason}",
  "jobForm.drafts.saved": "已保存 {count} 个岗位",
  "jobForm.drafts.partialFailed": "有 {count} 条未保存：{message}",
  "jobForm.save.updated": "岗位已更新",
  "jobForm.save.created": "岗位已添加",
  "jobForm.save.failed": "保存失败",
} as const;

export default jobForm;
