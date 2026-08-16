# Prompt 调参指南

所有提示词模板集中在 `backend/app/prompts/`，与业务代码完全分离——改模板不需要动代码。

## 模板清单

| 文件 | 作用 | 何时调整 |
| --- | --- | --- |
| `resume_generate_system.md` | 系统提示词：角色设定与全局规则（真实性、岗位匹配、量化、输出格式） | 生成质量、防虚构约束 |
| `resume_generate_user.md` | 用户提示词：个人资料 + JD + 定制要求 + JSON 结构示例 | 结构字段、JD 使用方式 |
| `resume_fix_json.md` | JSON 修复提示词 | 模型输出 JSON 经常失败时 |

## 常见调参场景

### 1. 生成内容太"空"、没有针对性

强化 JD 匹配要求，在 `resume_generate_system.md` 的第 2 条规则后补充：

```markdown
2. 岗位匹配：仔细阅读 JD，逐条对照 JD 中的技能要求与个人资料中的
   经历/项目/技能，在 summary 与项目 highlights 中显式回应这些要求；
   每条经历描述都应服务于「证明自己匹配该岗位」这个目标。
```

### 2. AI 夸大或虚构成果

收紧真实性约束，同时配合 `check_consistency`（见下文）：

```markdown
1. 真实性第一：只能使用个人资料中已有的信息；资料中没有的具体数字
   （如"性能提升 40%"）一律不得出现，改用定性描述（如"显著提升性能"）。
```

### 3. 输出 JSON 经常解析失败

- 在 `resume_generate_system.md` 末尾加一句：`输出必须以 { 开头、以 } 结尾`。
- 换更强的基础模型（解析能力与基础模型强相关）。
- 调整 `temperature`（设置页）：生成类任务建议 0.3-0.7，降低发散。

### 4. 换一种简历风格

- 后端：在 `backend/app/services/resume_generator.py` 的 `TONE_GUIDES` 加新风格及指令。
- 前端：在 `frontend/src/config.ts` 的 `RESUME_TONES` 同步加选项。

## 防虚构校验（代码层兜底）

Prompt 只能约束，不能保证。`resume_generator.py` 中的 `check_consistency`
会把生成结果与资料库对比：学校、公司、项目名对不上时，给用户返回警告
（预览页顶部黄色提示）。发现误报/漏报时调整 `_similar` 的匹配策略即可。

## 调试建议

- 后端日志能看到完整调用链（`app/api/resumes.py` 有 logger 输出）。
- 生成弹窗中保留了模型的原始流式输出，方便判断是模型问题还是解析问题。
- 单测 `tests/test_resume_generator.py` 用假 Provider 覆盖了解析与校验逻辑，改完模板后跑一遍 `pytest` 即可回归。
