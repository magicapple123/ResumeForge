// SPDX-License-Identifier: Apache-2.0
/**
 * 简历照片面板：上传 / 照片库 / 切换与删除照片的界面文案。
 */
const profilePhoto = {
  "profilePhoto.action.choose": "选择照片",
  "profilePhoto.action.uploadNew": "上传新照片",
  "profilePhoto.action.library": "照片库（{count}）",

  "profilePhoto.upload.success": "照片已保存，可在这里切换使用哪一张",
  "profilePhoto.upload.formatError": "请选择 JPG、PNG 或 WebP 格式的照片",
  "profilePhoto.upload.tooLarge": "照片不能超过 {size} MB",
  "profilePhoto.upload.limit": "最多保存 {count} 张照片，请先删除不再使用的",
  "profilePhoto.upload.failed": "上传照片失败",
  "profilePhoto.upload.progress": "照片上传进度",
  "profilePhoto.upload.dropHint": "松开即可上传照片",
  "profilePhoto.upload.dropRejected": "只支持 JPG、PNG 或 WebP 照片",
  "profilePhoto.upload.formatsHint": "JPG、PNG 或 WebP，最大 {size} MB，最多保存 {count} 张",
  "profilePhoto.upload.loading": "正在读取照片…",

  "profilePhoto.preview.alt": "简历照片",

  "profilePhoto.switch.success": "已切换简历照片",
  "profilePhoto.switch.failed": "切换照片失败",

  "profilePhoto.delete.success": "已删除这张照片",
  "profilePhoto.delete.failed": "删除照片失败",

  "profilePhoto.library.title": "照片库",
  "profilePhoto.library.description": "点一张设为简历照片；简历上只会用你选中的这一张。",
  "profilePhoto.library.tooltipActive": "当前使用中",
  "profilePhoto.library.tooltipSelect": "设为简历照片",
  "profilePhoto.library.selectAria": "使用照片 {name}",
  "profilePhoto.library.deleteAria": "删除照片 {name}",
  "profilePhoto.library.activeTag": "使用中",
  "profilePhoto.library.photoAlt": "照片",
  "profilePhoto.library.empty": "还没有备选照片。上传新照片后就会出现在这里，可以随时切换。",
} as const;

export default profilePhoto;
