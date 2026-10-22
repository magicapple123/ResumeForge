# SPDX-License-Identifier: Apache-2.0
"""演示数据的分域模块包（``scripts/seed_demo_data.py`` 的实现部分）。

⚠️ 本文件**只放文档字符串**，不得 ``import app``、也不得 import 本包内任何模块：
``scripts/seed_demo_data.py`` 必须先 ``_preparse_out()`` → 设好 ``DATABASE_URL`` →
才允许触碰 ``app.*``（``app.config`` 在导入时就把 ``database_url`` 缓存成进程内单例），
而包的 ``__init__`` 会在 ``from demo_data.base import …`` 之前被求值。
任何在这里的 ``import app`` 都会把演示库写回默认库。

模块分工（按数据写入顺序，顺序敏感，见 ``seed_demo_data.py::main``）：

``base``                引擎/表映射、``ins``/``row``、时间锚点、岗位来源判定、``init_db()``
``profile``             个人资料（user_profile / education / experience / project / skill / award）
``jobs``                岗位（job）与备选岗位（candidate_job）
``resumes_ledger``      简历（resume_record）与事实台账（claim_record）
``knowledge_interviews`` 资料箱（material）、知识库（knowledge_entry）、面试经验
``tracker_referrals``   求职进度（application_track）、内推（referral）、提醒（reminder）
``apply_assistant``     投递队列、模型配置、助手会话、助手技能
``checks``              只读接口自检清单与 ``run_checks()``
"""
