from __future__ import annotations

import re


LAST_PROMPT_MAX_CHARS = 1000


def shorten_prompt(text: str) -> str | None:
    """Whitespace-collapsed prompt, cut to LAST_PROMPT_MAX_CHARS with an ellipsis."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    return text if len(text) <= LAST_PROMPT_MAX_CHARS else text[: LAST_PROMPT_MAX_CHARS - 1].rstrip() + "…"
