# SPDX-License-Identifier: Apache-2.0
from urllib.parse import quote

import httpx
import pytest
from app.services.browser.cdp_client import WebsocketCdpClient


@pytest.mark.parametrize(
    "url",
    [
        "https://attacker.invalid/path?next=//other.invalid",
        "http://127.0.0.1:1/private",
        "https://example.invalid/\r\nHeader: injected",
    ],
)
def test_new_tab_url_is_encoded_data_on_the_declared_cdp_origin(url):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(200, json={"id": "synthetic-target", "type": "page"})

    client = WebsocketCdpClient("127.0.0.1", 9333, http_transport=httpx.MockTransport(handler))
    try:
        client.new_tab(url)
    finally:
        client.close()
    assert len(requests) == 1
    target = requests[0].url
    assert target.scheme == "http" and target.host == "127.0.0.1" and target.port == 9333
    assert target.path == "/json/new"
    assert target.query.decode() == quote(url, safe="")
