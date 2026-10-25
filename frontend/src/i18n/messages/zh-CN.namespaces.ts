// SPDX-License-Identifier: Apache-2.0
/**
 * 语言包命名空间的**聚合点**。
 *
 * zh-CN.ts 是 500 行零豁免预算的硬线：每新增一个领域命名空间，如果都往主文件里加
 * import 与 spread，两条固定开销会很快把它顶过线。这里把"有哪些命名空间、按什么顺序合并"
 * 收成一处——主文件只 import 本文件并展开一次。
 *
 * 登记新命名空间时**只改本文件**（import + spread 各一行），zh-CN.ts 不动。
 * 合并顺序 = 下方展开顺序；后展开的键覆盖先展开的，因此新命名空间不要与既有 key 重名。
 */

import assets from "./zh-CN.assets";
import bilingual from "./zh-CN.bilingual";
import careerScenarios from "./zh-CN.careerScenarios";
import conflict from "./zh-CN.conflict";
import delivery from "./zh-CN.delivery";
import fontDownload from "./zh-CN.fontDownload";
import fonts from "./zh-CN.fonts";
import optimizer from "./zh-CN.optimizer";
import outline from "./zh-CN.outline";
import pagination from "./zh-CN.pagination";
import params from "./zh-CN.params";
import preflight from "./zh-CN.preflight";
import preview from "./zh-CN.preview";
import profileFacts from "./zh-CN.profileFacts";
import provenance from "./zh-CN.provenance";
import proview from "./zh-CN.proview";
import research from "./zh-CN.research";
import responsive from "./zh-CN.responsive";
import review from "./zh-CN.review";
import rich from "./zh-CN.rich";
import trial from "./zh-CN.trial";
import typography from "./zh-CN.typography";
import versions from "./zh-CN.versions";
import workbench from "./zh-CN.workbench";

const namespaces = {
  /** 简历制作台（2026-10-23）。 */
  ...workbench,
  /** 简历预览的缩放条（2026-10-23）。 */
  ...preview,
  /** 多分辨率适配（2026-10-23）。 */
  ...responsive,
  /** 简历字体（内置思源黑体按需下载）与工作台「版式」页签。 */
  ...fonts,
  /** 字符级加粗（右键菜单）与制作台实时预览（R4 / R5）。 */
  ...rich,
  /** 字体下载/取消/删除/样张 · 板块顺序 · 精确模式字族说明。 */
  ...fontDownload,
  /** 模板一览口径 · 参数复位 · 写作增强提示 · 精确预览补页。 */
  ...params,
  /** W06「文档大纲」。 */
  ...outline,
  /** W02 保存冲突三选一。 */
  ...conflict,
  /** W15/D04/D05/D09/D10/D13/D14 专业视图。 */
  ...proview,
  /** W14 科研栏目与长 CV 模式。 */
  ...research,
  /** W07 局部排版。 */
  ...typography,
  /** W17 私有表达资产。 */
  ...assets,
  /** W11 统一检查面板。 */
  ...preflight,
  /** W18 离线对象批注。 */
  ...review,
  /** W10 当前内容试模板。 */
  ...trial,
  /** W16 双语版本与术语表。 */
  ...bilingual,
  /** W12 持久来源/事实锁/外发预览/用量。 */
  ...provenance,
  /** W08 分页控制。 */
  ...pagination,
  /** W13 命名版本与岗位变体。 */
  ...versions,
  /** W19 导出配置与交付原件。 */
  ...delivery,
  /** W09 有约束版面优化。 */
  ...optimizer,
  /** A2 职业场景（选择/编辑/本次生成披露）。 */
  ...careerScenarios,
  /** A3 补充事实（论文/科研/专利/证照/作品/实践）。 */
  ...profileFacts,
} as const;

export default namespaces;
