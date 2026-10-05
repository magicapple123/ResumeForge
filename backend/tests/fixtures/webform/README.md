# 网申匹配 / 执行语料

把"填写准确率"从感觉变成数字的回归语料。跑分实现见
`backend/tests/webform_corpus_support.py` 与 `backend/tests/webform_engine_support.py`，
人读报告见 `backend/scripts/webform_match_report.py`。

## 目录

| 路径 | 内容 |
|------|------|
| `pages/*.json` | 匹配语料：一页真实（脱敏）页面的控件清单 + 资料 + **人工确认过的**期望映射 |
| `execution/*.json` | 执行语料：写入 → 回读 → 结果分类的脚本化场景（含调用顺序） |
| `baseline.json` | 回归门槛：每个 case 的 correct / missing 基线，`--update-baseline` 生成 |

## 匹配语料 schema（pages/）

```jsonc
{
  "version": 1,
  "id": "hypergryph-2026-10-05-area-code-error-text",   // = 文件名
  "site": "鹰角", "captured_at": "2026-10-05",
  "source_test": "test_webform_engine_ambiguity.test_...", // 记录 incident 的用例（可空）
  "note": "这条 case 的页面结构 / 对错期待",
  "controls": [ /* 与页面脚本同形状的控件 dict 列表（见 engine/scripts.py） */ ],
  "profile": { "education_end": "2025-06" },
  "expect": {
    "mappings": [ {"field": "education_end", "index": 1, "value": "2025-06"} ], // value 可省
    "forbidden": [ {"field": "education_end", "index": 0} ],  // 这个框绝不能被填
    "low_confidence": ["education_end"]                        // 只观察、不断言
  }
}
```

跑分口径：`correct`（期望映射全中且写值一致）/ `wrong`（多填、写值不符、命中
forbidden）/ `missing`（期望没发生）。**`wrong` 必须为零**——错填比漏填危险。
`low_confidence` 的多/少只进报告，用于观察软信号调整的影响。

**"只填不点"（2026-10-05）**：下拉 / 单选 / 复选 / 日期控件 / 弹层选择器永远不自动填，
所以它们在 `expect` 里只会出现在 `forbidden` 一类——"这个框绝不能被填"。反过来写：
页面上这类控件没有对应的 `mappings` 条目不是漏填。

## 执行语料 schema（execution/）

```jsonc
{
  "version": 1,
  "id": "readback-mismatch-is-unverified",
  "note": "……",
  "controls": [ /* 同上 */ ],
  // 两个入口二选一：
  // - profile：自动匹配（下拉/单选/复选/日期到不了这里，见下）
  // - selections：显式填充（/fill），(控件序号, 字段, 值)，走 service.fill._rebuild_mapping
  "profile": { "name": "张三" },
  "script": [                                  // 有序脚本：第 N 次 evaluate 必须命中第 N 条
    {"needle": "rf:set-value", "reply": "{\"ok\": true, \"value\": \"张三\"}"},
    {"needle": "rf:read-back", "reply": {"raise": "RuntimeError", "message": "boom"}}
  ],
  "expect": {
    "outcomes": [ {
      "field": "name", "status": "unverified", "note_contains": "与期望不符",
      "reason": "value_mismatch",   // 可选：机器可读原因码（engine/recovery.py）
      "attempts": 2                 // 可选：实际尝试次数（重试阶梯的行为契约）
    } ],
    "mouse_events": 3,        // 可选：Input.dispatchMouseEvent 次数
    "no_click_rect": true     // 可选：断言没有取坐标点击
  }
}
```

脚本多执行/少执行/顺序不符都会直接失败——它同时钉住了"结果分类"与"调用序列"。

## 新增一条 case 的工作流

1. 真机采集（网申专用浏览器已打开目标页面）：
   `python scripts/collect_webform_sample.py --site 站点 --out tests/fixtures/webform/pages/<id>.json`
   （脚本自动剥离 value/display/checked 与 URL，并输出 shadow DOM / iframe 探针计数）
2. **人工填写** `profile` 与 `expect`（对着页面/实际填写结果确认；把握不准的框写进
   `forbidden`），删掉 `draft: true`。
3. 跑 `python scripts/webform_match_report.py` 核对数字。
4. 数字无误：`--update-baseline` 更新 `baseline.json`，与 case 一起提交。

## 脱敏纪律（测试会强制）

- 手机号只允许 `1xx00000000` 形状（明显合成）；邮箱只允许 `example.com` /
  `example.invalid` / `example.org` 域；身份证形状一律禁止。
- 语料里不要出现真实公司名之外的任何个人数据；页面 URL、标题不进语料。
- 骨架期（`draft: true`）的 case 会被 `test_webform_match_corpus.py` 挡下，不会
  混进基线。
