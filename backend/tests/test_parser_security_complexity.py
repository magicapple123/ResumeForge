"""Bounded subprocesses verify real adversarial inputs without hanging the test runner."""

import subprocess
import sys

import pytest


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
            timeout=5,
        )
    except subprocess.TimeoutExpired:
        pytest.fail(f"{case}: adversarial input exceeded 5 seconds")
    assert result.returncode == 0, result.stderr
    assert "bounded parser completed" in result.stdout
