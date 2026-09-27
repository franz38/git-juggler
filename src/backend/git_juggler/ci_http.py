from __future__ import annotations

import json
from typing import Callable, ContextManager, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class _Response(Protocol):
    def read(self) -> bytes: ...


def fetch_json(
    url: str,
    headers: dict[str, str],
    opener: Callable[..., ContextManager[_Response]] = urlopen,
) -> dict | None:
    request = Request(url, headers=headers)
    try:
        with opener(request, timeout=10) as response:  # noqa: S310 - configured user URL, read-only local app integration
            body = response.read().decode("utf-8")
    except (HTTPError, URLError, TimeoutError, OSError):
        return None
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None
