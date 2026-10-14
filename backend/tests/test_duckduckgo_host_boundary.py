"""Redirect decoding recognises host boundaries and accepts only web schemes."""

import pytest
from app.services.search.duckduckgo import _unwrap_redirect


@pytest.mark.parametrize("host", ["duckduckgo.com.attacker.invalid", "attackerduckduckgo.com"])
def test_deceptive_host_is_not_treated_as_the_search_provider(host):
    url = f"https://{host}/l/?uddg=https%3A%2F%2Fexample.com%2Ftarget"
    assert _unwrap_redirect(url) == url


def test_provider_redirect_does_not_return_a_dangerous_scheme():
    assert _unwrap_redirect("https://duckduckgo.com/l/?uddg=javascript%3Aalert%281%29") == ""
