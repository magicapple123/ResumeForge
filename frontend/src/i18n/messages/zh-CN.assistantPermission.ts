// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手「数据权限」（T11 四档）。
 *
 * 一个档位同时决定两轴：读（是否读取姓名/电话等真实资料）与写（是否允许直接改数据）。
 * 设置页存全局默认；输入框下拉按会话覆盖，覆盖只在本机。
 */
const assistantPermission = {
  "assistantPermission.label": "数据权限",
  "assistantPermission.menu.aria": "助手数据权限",
  "assistantPermission.menu.hint": "只覆盖当前对话；全局默认在设置页",
  "assistantPermission.followGlobal": "跟随全局",
  "assistantPermission.followGlobalWith": "跟随全局（{level}）",
  // 「跟随全局」这一项的说明必须与四档说明区分开：它讲的是"这是设置页的全局默认，
  // 在这里改只影响本对话"，而四档说明讲的是该档位能读写什么。
  "assistantPermission.followGlobal.desc":
    "用设置页的全局默认（当前：{level}）；在这里改只影响本对话",
  "assistantPermission.followGlobalHint": "发送第一条消息后可调整",
  "assistantPermission.level.read_only": "仅查看",
  "assistantPermission.level.read_full": "放宽读取",
  "assistantPermission.level.write_confirm": "可修改",
  "assistantPermission.level.write_full": "完全权限",
  "assistantPermission.level.read_only.desc": "只读，敏感字段脱敏",
  "assistantPermission.level.read_full.desc": "可读姓名、电话等真实资料",
  "assistantPermission.level.write_confirm.desc": "可改数据，读仍脱敏",
  "assistantPermission.level.write_full.desc": "可读真实资料，也可改数据",
  "assistantPermission.notice.readFull.title": "放宽读取已对当前对话生效",
  "assistantPermission.notice.readFull.body":
    "助手会看到姓名、电话、邮箱等真实资料与网申填写值，这些内容会发送给当前配置的模型服务。",
  "assistantPermission.notice.writeFull.title": "完全权限已对当前对话生效",
  "assistantPermission.notice.writeFull.body":
    "助手会读取真实资料，并可直接修改你的数据而不再逐条询问。可以随时切回。",
  "assistantPermission.notice.closeAria": "关闭本次权限提示",
  "assistantPermission.confirm.title": "开启{level}？",
  "assistantPermission.confirm.body": "开启后助手会直接修改你的数据，不再逐条询问。可以随时切回。",
  "assistantPermission.confirm.ok": "开启",
  "assistantPermission.confirm.cancel": "先不开",
  "assistantPermission.settings.title": "求职助手 · 数据权限",
  "assistantPermission.settings.intro":
    "这里设置的是全局默认；输入框旁的下拉只覆盖当前对话。档位同时决定助手能读什么、能不能直接改数据。",
  "assistantPermission.settings.aria": "全局数据权限档位",
  "assistantPermission.settings.state": "当前全局默认：{level}",
  "assistantPermission.settings.saveToast": "全局数据权限已改为{level}",
  "assistantPermission.settings.saveFailed": "保存数据权限失败，请稍后重试",
  "assistantPermission.settings.writeHint": "写档位下助手会直接修改你的数据，不再逐条询问。",
  "assistantPermission.settings.neverSent":
    "任何档位都不会发送：API 密钥等凭据与简历照片二进制；助手也没有删除类工具。",
} as const;

export default assistantPermission;
