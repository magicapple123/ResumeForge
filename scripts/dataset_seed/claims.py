# SPDX-License-Identifier: Apache-2.0
"""事实台账：10 条可核验的事实，覆盖工作、项目、荣誉、教育与技能五类。

台账不是"简历里的句子"，而是"这句话的依据"：``source_fact`` 写证据在哪、
``boundary`` 写这句话的边界（哪些情况不成立），``verification_status`` 决定它能不能
进正式简历。三个字段缺一个，生成出来的内容就会变成没法回答追问的漂亮话。
"""

from __future__ import annotations

from datetime import timedelta

from dataset_seed.base import NOW, ins, row

CLAIMS = [
    {
        "title": "季度会员召回率从 8.1% 提升到 12.4%",
        "category": "实习/工作",
        "subject": "澜石数据科技（上海）有限公司 / 用户增长分析师",
        "source_fact": "召回活动的分群投放记录与季度结案报告：召回人数 23.1 万 / 触达 186 万。",
        "candidate_wording": "主导 186 万会员的分层召回，季度召回率从 8.1% 提升到 12.4%。",
        "responsibility_level": "项目负责人",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["分层为什么是 5 层而不是 3 层", "召回率的分母怎么算"],
            "difficulties": ["高层级用户收到券后反而降低复购，第一版方案是负向的"],
            "verification": ["分群投放记录", "季度结案报告"],
            "result": "连续两个季度召回率稳定在 12% 以上",
        },
        "boundary": "召回率口径为「触达后 30 天内产生购买」，不含自然复购。",
        "risk_notes": [],
        "last_verified": "2026-10-20",
    },
    {
        "title": "新客 7 日留存从 31% 提升到 38%",
        "category": "实习/工作",
        "subject": "澜石数据科技（上海）有限公司 / 用户增长分析师",
        "source_fact": "12 组 AB 实验的实验平台记录，最终上线组的 D7 留存为 38.2%，对照组 31.4%。",
        "candidate_wording": "主导新客 7 日留存实验，把留存从 31% 提升到 38%。",
        "responsibility_level": "主导方案或交付",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么选权益而不是内容作为干预", "样本量与实验周期怎么定"],
            "difficulties": ["前两周分流有偏差，查出来是新客标识延迟"],
            "verification": ["实验平台记录", "分流校验日志"],
            "result": "上线后连续 6 周维持在 37%-39%",
        },
        "boundary": "7 日留存定义为「注册后第 7 天有登录或下单」，不含推送唤醒。",
        "risk_notes": [],
        "last_verified": "2026-10-20",
    },
    {
        "title": "季度获客成本下降 17%",
        "category": "实习/工作",
        "subject": "澜石数据科技（上海）有限公司 / 用户增长分析师",
        "source_fact": "渠道台账：CAC 从 86 元降到 71 元，停投 4 个低质渠道。",
        "candidate_wording": "与投放团队共建渠道质量评分，季度获客成本下降 17%。",
        "responsibility_level": "负责模块",
        "verification_status": "待确认",
        "allowed_uses": ["resume"],
        "interview_details": {
            "decisions": ["低质渠道的判定阈值", "停投后量级缺口怎么补"],
            "difficulties": ["与投放侧的归因口径不一致，开过三次对齐会"],
            "verification": [],
            "result": None,
        },
        "boundary": "CAC 只算付费投放，不含自然流量与裂变。",
        "risk_notes": ["财务口径尚未复核"],
        "last_verified": "",
    },
    {
        "title": "活动归因看板每月节省 12 小时人工对数",
        "category": "项目经历",
        "subject": "多渠道活动归因看板 / 独立开发",
        "source_fact": "上线前后的工时记录：原先每周 3 小时手工对数，上线后每月 0 小时。",
        "candidate_wording": "独立开发多渠道归因看板，统一 7 个渠道口径，每月节省 12 小时对数时间。",
        "responsibility_level": "项目负责人",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么同时做末次点击与线性归因", "事件链怎么去重"],
            "difficulties": ["渠道自报数据与实际成交差 30%，市场侧一开始不接受"],
            "verification": ["工时记录", "看板截图"],
            "result": "市场与增长两侧连续 4 个月使用同一份数字",
        },
        "boundary": "节省的是分析师的汇总时间，不含渠道侧的投放操作时间。",
        "risk_notes": [],
        "last_verified": "2026-10-18",
    },
    {
        "title": "会员流失预警模型 AUC 0.82",
        "category": "项目经历",
        "subject": "会员流失预警模型 / 模型负责人",
        "source_fact": "12 万样本的留出集评估：LightGBM 版本 AUC 0.822，逻辑回归基线 0.761。",
        "candidate_wording": "用 LightGBM 搭建会员流失预警模型，AUC 0.82，比基线高 6 个百分点。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么不用深度学习", "阈值怎么选"],
            "difficulties": ["样本正负比 1:9，需要重采样与代价敏感"],
            "verification": ["评估报告", "代码仓库"],
            "result": "模型思路后来被改造成会员分层的输入之一",
        },
        "boundary": "AUC 是离线留出集结果，未做线上 AB 验证。",
        "risk_notes": [],
        "last_verified": "2026-10-12",
    },
    {
        "title": "招聘周期从 42 天降到 29 天",
        "category": "项目经历",
        "subject": "招聘漏斗诊断 / 分析负责人",
        "source_fact": "HR 系统导出 14 个月数据，诊断前后各取 3 个月对比。",
        "candidate_wording": "主导招聘漏斗诊断，平均招聘周期从 42 天降到 29 天。",
        "responsibility_level": "主导方案或交付",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么先改技术岗 JD 而不是流程", "周期怎么定义"],
            "difficulties": ["HR 系统字段缺失，前 4 个月的数据要手工补"],
            "verification": ["诊断报告", "HR 季度复盘材料"],
            "result": "技术岗初筛通过率 18%→29%",
        },
        "boundary": "周期口径为「发布到入职」，不含编制审批时间。",
        "risk_notes": [],
        "last_verified": "2026-09-28",
    },
    {
        "title": "带 1 名实习生独立交付 2 份专题分析",
        "category": "实习/工作",
        "subject": "澜石数据科技（上海）有限公司 / 用户增长分析师",
        "source_fact": "实习期 4 个月，实习生独立完成渠道质量与内容转化两份专题。",
        "candidate_wording": "带 1 名实习生，负责其 SQL 规范与实验设计 review，实习期内独立交付 2 份专题分析。",
        "responsibility_level": "负责模块",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["怎么安排 review 节奏"],
            "difficulties": ["第一版 SQL 全表扫描，跑一次 20 分钟"],
            "verification": ["专题文档"],
            "result": None,
        },
        "boundary": "两份专题的选题由我确定，执行与结论由实习生完成。",
        "risk_notes": [],
        "last_verified": "2026-10-08",
    },
    {
        "title": "国家奖学金（前 2%）",
        "category": "荣誉奖项",
        "subject": "上海大学 / 市场营销",
        "source_fact": "获奖证书与学校公示名单。",
        "candidate_wording": "国家奖学金（专业前 2%）。",
        "responsibility_level": "参与",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": [],
            "difficulties": [],
            "verification": ["证书"],
            "result": None,
        },
        "boundary": "评选口径为综合测评，专业排名第一。",
        "risk_notes": [],
        "last_verified": "2026-09-01",
    },
    {
        "title": "会议论文第二作者",
        "category": "教育经历",
        "subject": "上海财经大学 / 应用统计",
        "source_fact": "JMSAC 2022 论文集 pp.118-126，作者顺序：周敏华、林知遥、陈立。",
        "candidate_wording": "会议论文第二作者（中国营销科学学术年会）。",
        "responsibility_level": "参与",
        "verification_status": "已确认",
        "allowed_uses": ["resume", "interview"],
        "interview_details": {
            "decisions": ["为什么用眼动而不是问卷"],
            "difficulties": ["有效样本只有 96 人，剔除标准要提前定"],
            "verification": ["论文集", "实验数据"],
            "result": None,
        },
        "boundary": "我负责数据清洗与中介效应检验，研究设计由导师主导。",
        "risk_notes": [],
        "last_verified": "2026-09-15",
    },
    {
        "title": "日语 N2 112 分",
        "category": "专业技能",
        "subject": "语言能力 / 日语",
        "source_fact": "JLPT 成绩单：总分 112/180（语言知识 38、阅读 34、听力 40）。",
        "candidate_wording": "日语 JLPT N2（112/180），可日常交流。",
        "responsibility_level": "参与",
        "verification_status": "已过期",
        "allowed_uses": ["resume"],
        "interview_details": {
            "decisions": [],
            "difficulties": [],
            "verification": ["成绩单"],
            "result": None,
        },
        "boundary": "成绩 2021 年取得，实际口语久未练习。",
        "risk_notes": ["口语需重新准备"],
        "last_verified": "2026-06-01",
    },
]


def seed() -> None:
    """写 10 条事实台账。"""
    ins(
        "claim_record",
        [
            row(
                **claim,
                sources=[],
                created_at=NOW - timedelta(days=20 - index),
                updated_at=NOW - timedelta(days=20 - index),
                deleted_at=None,
            )
            for index, claim in enumerate(CLAIMS)
        ],
    )
