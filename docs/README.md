<!-- 本文件由 scripts/check_docs_registry.py --write-index 生成；改口径请改 docs/doc-registry.json。 -->

# 文档索引

> 读之前先看状态，三类文档的可信度不同：
> **现役**（`current`）必须与当前代码一致，超期未复核会打红 CI；
> **过程记录**（`historical`）不保证与现状一致，到期会被处置；
> **不可变记录**（`record`）是 ADR 与实测档案，只增不改。登记表在 [`doc-registry.json`](doc-registry.json)。

## 现役文档（必须与代码一致）· 26 篇

复核截止 = 上次复核 + 该档窗口（A 90 天 / B 180 天）。

| 文档 | 用途 | 上次复核 | 复核截止 |
| --- | --- | --- | --- |
| [讲给面试官听：ResumeForge 项目讲解指南](INTERVIEW_GUIDE.md) | 讲给面试官听；版本号、测试规模这类数字最容易过期 | 2026-11-17 | 2027-05-16 |
| [项目导航图（Code Map）](PROJECT_MAP.md) | 菜单顺序与路由变了就要重排功能表 | 2026-11-17 | 2027-05-16 |
| [文档索引](README.md) | 本索引由 scripts/check_docs_registry.py 生成，不要手改 | 2026-11-17 | 2027-05-16 |
| [架构决策记录（ADR）索引](adr/README.md) | ADR 索引与状态词约定 | 2026-11-17 | 2027-05-16 |
| [与 AI 协作的作业规程](ai-collaboration-sop.md) | 协作规程；规则权威在 AGENTS.md，本文只写理由与仓库特有约束 | 2026-11-17 | 2027-05-16 |
| [排障规则：把问题抛给任意 AI 时](ai-troubleshooting.md) | 把日志落点与进程识别口径写死，最容易随启动器改动漂移 | 2026-11-17 | 2027-02-15 |
| [架构设计](architecture.md) | 架构总览。故意不登记覆盖路径：它描述全局，任何改动都相关，靠人工判断 | 2026-11-17 | 2027-05-16 |
| [缺陷模式速查](defect-patterns.md) | 缺陷模式库，按新增事故追加 | 2026-11-17 | 2027-05-16 |
| [桌面依赖供应链审计与豁免基线（2026-10-13，生产审计 PR-06）](desktop-supply-chain-audit.md) | 豁免基线与现状注；依赖升级要回看 | 2026-11-17 | 2027-05-16 |
| [macOS 桌面安装包构建任务书（给 macOS 上的 agent / 维护者）](mac-build-handoff.md) | macOS 打包交接 | 2026-11-17 | 2027-02-15 |
| [项目维护手册](maintenance.md) | 维护手册；启动/打包脚本与迁移链变动的主要落点 | 2026-11-17 | 2027-02-15 |
| [运营手册（Operations Runbook）](operations.md) | 发版与事故处置 | 2026-11-17 | 2027-02-15 |
| [Prompt 调参指南](prompt-tuning.md) | 提示词调参口径 | 2026-11-17 | 2027-05-16 |
| [简历质量规范（ResumeForge 本地版）](quality/resume-quality-standard.md) | 判据部分长期有效；实测证据各有日期，改渲染链要重跑 | 2026-11-17 | 2027-05-16 |
| [简历文档模型 v2（开发者说明）](resume-document-model.md) | 文档模型字段；schema 一加字段这里就要跟 | 2026-11-17 | 2027-05-16 |
| [Agent 安全验收清单（ResumeForge）](security-agent-checklist.md) | 工具面、路径与出网边界的验收清单 | 2026-11-17 | 2027-05-16 |
| [交付报告模板](templates/delivery-report.md) | 交付报告模板 | 2026-11-17 | 2027-05-16 |
| [任务书模板](templates/task-brief.md) | 任务书模板 | 2026-11-17 | 2027-05-16 |
| ["改了没用"排查树](troubleshooting-stale-build.md) | 「改了没用」的判定链 | 2026-11-17 | 2027-02-15 |
| [英文界面文案口径（English UI copy guide）](ui-copy-guide-en.md) | 英文文案口径，与中文规范同批维护 | 2026-11-17 | 2027-05-16 |
| [界面文案口径规范（项目长期约定）](ui-copy-guide.md) | 界面文案规范；语言包与文案闸门变动的主要落点 | 2026-11-17 | 2027-05-16 |
| [界面与交互质量规范](ui-quality.md) | 2026-11-17 审查未逐条核对这份文档，首次复核时要补 | 2026-11-17 | 2027-05-16 |
| [升级与数据安全](upgrading.md) | 升级路径与数据安全；三个更新器任一改动都要回看 | 2026-11-17 | 2027-02-15 |
| [使用指南](user-guide.md) | 面向用户的主文档；改设置页分组、卡片位置、界面文案都要回来对一遍 | 2026-11-17 | 2027-02-15 |
| [验证手册：怎样才算"改好了"](verification-playbook.md) | 判绿口径；CI 作业与测试脚本变动要同步 | 2026-11-17 | 2027-02-15 |
| [多分辨率适配 · 验证 harness](verification/responsive-20261023/README.md) | 验证 harness 的用法；同目录 PLAN.md 是历史方案 | 2026-11-17 | 2027-05-16 |

## 历史文档（过程记录，不保证与现状一致）· 7 篇

到期未处置会打红 CI：要么更新内容并改成 `current`，要么移进 `docs-archive/`。

| 文档 | 为什么还在 | 处置截止 |
| --- | --- | --- |
| [ResumeForge Agent 原生化建议](agent-native-roadmap.md) | 2026-11-07 的架构建议，未作为路线图采纳 | 2027-06-30 |
| [执行提示词：落实《求职 Agent 化三步》计划](job-search-agent-exec-prompt.md) | 一次性执行提示词，任务已合入；不要再当作业单执行 | 2027-03-31 |
| [求职 Agent 化三步：跟进巡检 · 投递交付单 · 求职偏好档](job-search-agent-plan.md) | 三步计划已实施（65760524），留作设计与验收记录 | 2027-06-30 |
| [简历通跨行业与专业工作台优化计划](resumeforge-industry-benchmark-plan.md) | 跨行业工作计划，已拆成多个批次落地 | 2027-09-30 |
| [增量批次系统设计（P0-1 ~ P0-8 / P1-1 ~ P1-2）](system_design.md) | 2026-09 增量批次的系统设计；结构已被 2.0 取代 | 2027-03-31 |
| [ResumeForge 技术债核实与治理计划](tech-debt-plan-2026-11-14.md) | 技术债施工记录；数字是 2026-11-14 快照 | 2027-06-30 |
| [ResumeForge 多分辨率 / 系统缩放适配方案（2026-10-23）](verification/responsive-20261023/PLAN.md) | 多分辨率适配方案；已落地，留作验收记录 | 2027-06-30 |

## 不可变记录（ADR / 实测档案）· 8 篇

只增不改：被推翻的决策在原处留「后续修订」，不重写历史；实测档案重测时新增一节，不改旧数字。

| 文档 | 性质 |
| --- | --- |
| [ADR-0001: 写入提案的数据集身份贯穿与数据集切换的 prepare/commit/compensate](adr/ADR-0001-dataset-scope-proposal-execution.md) | 决策记录 |
| [ADR-0002：可信交付账本——revision / artifact / attempt 三态关联与幂等键](adr/ADR-0002-trust-delivery-ledger.md) | 决策记录 |
| [ADR-0003：备份包资产清单（per-dataset asset manifest）与存储统计作用域](adr/ADR-0003-backup-asset-manifest-and-storage-scope.md) | 决策记录 |
| [ADR-0004: 桌面端五类路径的固定策略（程序目录 / 用户数据 / 日志 / 运行时 / 缓存）](adr/ADR-0004-desktop-data-directory-policy.md) | 决策记录 |
| [ADR-0005：备份恢复「先验后发布」与附件防覆盖](adr/ADR-0005-backup-restore-verify-before-publish.md) | 决策记录 |
| [标签 PDF 能力研究（D12）](quality/tagged-pdf-research-d12.md) | 标签 PDF 调研；2026-11-17 复测结论不变 |
| [模板质量档案（ResumeForge 内置模板）](quality/template-quality-archive.md) | 逐模板质量档案；评分与截图是 1.0.2 快照，页数已按 2.1.0 复核 |
| [制作台本地性能基线（W21 / plan §11）](quality/workbench-performance-baseline.md) | 单机性能实测快照；重测就新增一节，不改旧数字 |

## 已归档（`docs-archive/`，不进检索索引）· 2 篇

| 文档 | 归档日 | 原因 | 替代 |
| --- | --- | --- | --- |
| [简历制作台 Word 式操作改造清单（W01—W19，已搁置）](../docs-archive/resume-workbench-wordlike-plan-20261118.md) | 2026-11-18 | 工作底稿（不是产品文档）：QW/DF 规格与已搁置的 W01—W19 清单；进 docs/ 会污染助手检索的产品文档排序（test_assistant_document_tools 因此变红）。执行完成后归档。 | — |
| [简历制作台小步改进与缺陷清单（QW-1—QW-7 / DF-1—DF-10）](../docs-archive/resume-workbench-quick-wins-20261118.md) | 2026-11-18 | 工作底稿（不是产品文档）：QW/DF 规格与已搁置的 W01—W19 清单；进 docs/ 会污染助手检索的产品文档排序（test_assistant_document_tools 因此变红）。执行完成后归档。 | — |

## 怎么维护这一页

1. **新增文档**：写完 → 在 `docs/doc-registry.json` 加一行（status / tier / note）→ `--write-index`。
2. **复核**：读完确认仍成立 → `python scripts/check_docs_registry.py --review <path>` → `--write-index`。
3. **归档**：文件移到 `docs-archive/`、开头加 `> **历史…**` 横幅 → 登记表里从 `docs` 挪到 `archived` → `--write-index`。
4. **全量校验**：`python scripts/check_docs_registry.py --check-index`（CI 跑的就是这条）。

这条流程的判据与理由见 `maintenance.md` 的「文档生命周期」一节。
