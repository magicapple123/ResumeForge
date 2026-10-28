// SPDX-License-Identifier: Apache-2.0
/**
 * 「版本冲突」（W02 / A06 / R02）这一批新增的界面文案。
 *
 * 与 `zh-CN.workbench.ts` 分开：冲突是**保存状态机**的文案，将来「历史 / 版本」（W03/W13）
 * 也会复用同一批词；混在制作台外壳文件里会让 W13 找不到它。命名空间文件由 `zh-CN.ts`
 * 末尾 spread 合并（leads 登记），`t()` 调用点不受影响。
 *
 * 口径：标题写「这份简历已在别处被修改」——不说"冲突/失败"，用户要判断的是"怎么处理"；
 * 三个动作都能预测后果，禁用「确定」。长度按 `docs/ui-copy-guide.md`（正文 ≤30 字）。
 */

const conflict = {
  // ── 冲突条（制作台正文上方的浮层）────────────────────────────
  /** 冲突条的标题：说清发生了什么、在哪发生的（别处 = 另一个窗口 / 另一台设备）。 */
  "workbench.conflict.title": "这份简历已在别处被修改",
  /** 副标题：说明保存被拦下的原因，并指向下面三个动作。 */
  "workbench.conflict.body": "直接保存会覆盖别人的改动，请先选择怎么处理",
  /** 动作一：用服务端最新版本覆盖本地（会丢掉本地未保存的改动）。 */
  "workbench.conflict.action.use-latest": "用最新的",
  /** 动作二：并排看两边的差异，再决定（不写库）。 */
  "workbench.conflict.action.compare": "比较差异",
  /** 动作三：把本地这份另存成一份新简历，原简历不动。 */
  "workbench.conflict.action.save-copy": "另存副本",

  // ── 比较 ───────────────────────────────────────────────────
  /** 比较结果的两列表头：左边是本地（你正在改的），右边是服务端（最新）。 */
  "workbench.conflict.compare.local": "你的版本",
  "workbench.conflict.compare.latest": "服务端最新",
  /** 只改了排版参数时正文可能逐字相同：说清"没差异"不等于"没冲突"。 */
  "workbench.conflict.compare.empty": "正文没有差异，可能只是排版参数不同",

  // ── 三个动作的结果 / 失败 ──────────────────────────────────
  /** 用最新的成功：告知本地已被替换（含清掉草稿与加粗）。 */
  "workbench.conflict.use-latest.done": "已换成服务端最新版本",
  /** 用最新的失败：读不到最新版，用户可重试。 */
  "workbench.conflict.use-latest.failed": "没读到服务端最新版本，请重试",
  /** 另存副本的新标题格式：原名称 + 「（副本）」（括号用中文全角，与既有命名习惯一致）。 */
  "workbench.conflict.copy.title": "{title}（副本）",
  /** 另存副本成功：成功提示必须含对象（新简历的名字）。 */
  "workbench.conflict.copy.done": "已另存为副本「{title}」",
  /** 另存副本失败：动作 + 下一步。 */
  "workbench.conflict.copy.failed": "另存副本失败，请重试",
  /** 副本已建好、但原简历同步失败：两个结果分开说，别让用户以为副本也没成。 */
  "workbench.conflict.copy-sync.failed": "副本已保存，原简历没同步，请关闭后重开",

  // ── 保存失败（非冲突）──────────────────────────────────────
  /** 保存失败后顶部那条提示：明确"改动还在"，避免用户以为白改了。 */
  "workbench.conflict.save-failed": "保存没有成功，改动还留着，可以重试",

  // ── 宿主的保存结果提示（W02 从 `ResumeDetailModal` 搬出来，走 t()）────
  /** 正文保存成功：成功提示必须含对象（改的是这份简历）。 */
  "workbench.save.content-saved": "简历修改已保存",
  /** 版式保存成功（与简历预览底部那颗「保存」共用一句话）。 */
  "workbench.save.layout-saved": "排版设置已保存",
  /** 版式保存失败：动作 + 下一步。 */
  "workbench.save.layout-failed": "保存排版设置失败，请重试",
  /** 没有记录可写（只读 / 数据未就绪）：正常流程不可达，作为防御性错误文案。 */
  "workbench.save.no-record": "这份简历还没加载完，暂时不能保存",

  // ── W03 统一历史（左栏「历史」页签）──────────────────────────
  /** 左栏页签名（与「排版参数 / 文档大纲 / 表达资产 / 双语版本」同区）。 */
  "workbench.history.title": "历史",
  /** 撤销/恢复按钮。 */
  "workbench.history.undo": "撤销",
  "workbench.history.redo": "恢复",
  /** 空态：没有可撤销的操作。 */
  "workbench.history.empty": "还没有可以撤销的操作",
  /** 说明：点一步看它当时的摘要（只读预览，不直接改文档）。 */
  "workbench.history.preview.hint": "点一步查看当时的摘要",
  /** 预览条前缀：明确下面这行是"当时"的快照，不是列表里又多出的一步。 */
  "workbench.history.preview.label": "当时：",
  /** 分组标题：已发生 / 可恢复。 */
  "workbench.history.past": "已进行",
  "workbench.history.future": "可恢复",
  /** 步骤名：连续输入合并后仍显示"编辑正文"（一次停顿 = 一步）。 */
  "workbench.history.label.text": "编辑正文",
  "workbench.history.label.layout": "调整排版",
  "workbench.history.label.structure": "结构操作",
  /** 纸面加粗（overlay）单独成步：用户要看得出"这一步改的是粗体，不是正文"。 */
  "workbench.history.label.bold": "加粗",
  /** 摘要：内容 + 版式的可读快照（姓名 / 条目数 / 页数 / 版式名）。 */
  "workbench.history.summary": "{name} · {entries} 条 · {pages} 页",
  /** 当前状态行。 */
  "workbench.history.current": "当前状态",
  /** 撤销 / 恢复禁用时的说明（Tooltip）。 */
  "workbench.history.undo.hint": "没有可撤销的步骤",
  "workbench.history.redo.hint": "没有可恢复的步骤",
  /** 预览某一步时的两个动作：真正回退到那一步 / 取消选中。 */
  "workbench.history.jumpTo": "回到这一步",
  "workbench.history.backToCurrent": "回到当前",
  /** 回退的二次确认（不可逆的是"它之后的那几步"，所以要说清后果）。 */
  "workbench.history.jumpTo.confirm": "回到这一步会丢掉它之后的改动，确定吗？",
  /** 选中对象没有可读名字时的回退名（W07/W08 上下文面板共用）。 */
  "workbench.selection.entry": "条目",
} as const;

export default conflict;
