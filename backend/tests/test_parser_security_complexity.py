# SPDX-License-Identifier: Apache-2.0
"""Bounded subprocesses verify real adversarial inputs without hanging the test runner."""

import subprocess
import sys

import pytest

# 预算只用来判"卡死"，不是性能断言。
#
# 每个用例都要现起一个解释器；`import app` 那串模块冷启动实测 ~1.1s，而 `-n auto`
# 满载（16 个 worker + 本机别的服务）时同样的启动会冲到 5s 以上——2026-10-22 全量
# 跑时 7 档集体超时，单跑却全部通过，正是"成败取决于机器当时有多忙"的形态。
#
# 用例真正要防的是正则回溯爆炸：30000 字符输入下那是小时量级，30s 与 5s 的判别力
# 没有区别，但 30s 不会把"机器同时在跑别的测试"误判成解析器退化。
BOUNDED_INPUT_BUDGET_SECONDS = 30


@pytest.mark.parametrize(
    "case", ["email", "separator", "salary", "job-id", "updated", "skill", "template"]
)
def test_adversarial_parser_input_finishes_in_a_bounded_process(case):
    code = r"""
import sys
from app.services.profile_parser.entry_constants import _EMAIL_RE, _ENTRY_SEPARATOR_RE
from app.services.profile_parser.skill_fields import _skill_name_and_level
from app.services.job_parser.section_constants import _SALARY_RE, _JOB_ID_RE, _UPDATED_DATE_RE
from app.services.resume.resume_template_store import sanitize_template_html
case = sys.argv[1]
if case == 'email': _EMAIL_RE.search('+' * 30000)
elif case == 'separator': _ENTRY_SEPARATOR_RE.split(' ' * 30000)
elif case == 'salary': _SALARY_RE.search('9' * 30000)
elif case == 'job-id': _JOB_ID_RE.match('ReqID' + ' ' * 30000)
elif case == 'updated': _UPDATED_DATE_RE.match('updated' + ' ' * 30000)
elif case == 'skill': _skill_name_and_level('Python ' + '(' * 30000)
elif case == 'template': sanitize_template_html('<object>' * 20000)
print('bounded parser completed')
"""
    try:
        result = subprocess.run(
            [sys.executable, "-c", code, case],
            capture_output=True,
            text=True,
            timeout=BOUNDED_INPUT_BUDGET_SECONDS,
        )
    except subprocess.TimeoutExpired:
        pytest.fail(f"{case}: adversarial input exceeded {BOUNDED_INPUT_BUDGET_SECONDS} seconds")
    assert result.returncode == 0, result.stderr
    assert "bounded parser completed" in result.stdout
