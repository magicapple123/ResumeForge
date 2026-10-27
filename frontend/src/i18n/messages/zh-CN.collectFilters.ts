// SPDX-License-Identifier: Apache-2.0
/**
 * 采集页签「按招聘网站的条件筛」：读取/重读动作、站点筛选条件测试、结果明细。
 *
 * 模块级常量 `SOURCE_TAG` 里的 `text` / `hint`（读取自你的登录会话 / 全网通用清单 …）
 * 仍是中文字面量，需先改成 labelKey，留待下一批。
 */
const collectFilters = {
  "collectFilters.toast.needCondition": "请先选择至少一项站点筛选条件，再测试它是否生效",
  "collectFilters.toast.testFailed": "测试筛选条件失败",
  "collectFilters.unread.title": "没能读到招聘网站的筛选条件",
  "collectFilters.unread.body":
    "不影响采集：关键词与城市照常生效。点下面的「重新读取」可以再试一次。",
  "collectFilters.action.reload": "重新读取",
  "collectFilters.action.test": "测试是否生效",
  "collectFilters.section.title": "按招聘网站的条件筛",
  "collectFilters.section.loading": "正在读取站点的筛选条件…",
  "collectFilters.test.hint":
    "在真实招聘网站页面上逐项检查你选的条件现在能不能选到（会临时导航到筛选栏，测试完不影响采集）",
  "collectFilters.intro":
    "这些是招聘网站筛选栏里的条件，网站在搜索时就替你筛掉了，比采回来再筛更准、也少翻很多页。选项清单读自站点本身，站点改版时会自动跟着变。",
  "collectFilters.launch.title": "想拿到你这个账号可见的完整选项，请先启动投递专用浏览器",
  "collectFilters.launch.body":
    "个别选项因人而异（例如学生账号在「求职类型」里能看到「实习」），只有在你已登录的浏览器里才读得到。当前用的是全网通用清单，够用但不一定全。",
  "collectFilters.result.partial": "有 {count} 项条件没能生效",
  "collectFilters.result.all": "选中的条件全部能在站点上真实选到",
  "collectFilters.result.applied": "已生效",
  "collectFilters.result.unapplied": "未生效",
  "collectFilters.result.itemLabel": "{label}：{value}",
  "collectFilters.result.itemDetail": "{label}：{value}——{detail}",
  "collectFilters.result.unlimited": "{label}——{detail}",
  "collectFilters.tag.any": "不限",
  "collectFilters.aria.group": "站点筛选-{label}",
} as const;

export default collectFilters;
