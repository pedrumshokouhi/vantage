"""Shared pieces of the JSON API: the route table, request-field helpers and record/setting key sets."""
import re

from .. import db

KINDS = {"holding", "contact", "event", "decision", "note", "watch", "plan", "scenario", "investor", "ics_sub"}
SETTING_KEYS = {"base_currency", "interests", "objectives", "constraints", "max_position", "max_sector", "benchmark",
                "topic_weights", "muted", "muted_kinds", "kind_weights", "home_mode", "timezones", "voice", "audio_rate", "risk_tolerance"}
LIVE_ONLY_KEYS = {"anthropic_key", "anthropic_model", "sec_contact"}


class HTTPError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code
        self.msg = msg


ROUTES = []


def route(method, pattern, auth_required=True):
    rx = re.compile("^" + pattern + "$")

    def deco(fn):
        ROUTES.append((method, rx, fn, auth_required))
        return fn
    return deco


def need(d, *keys):
    for k in keys:
        if d.get(k) in (None, ""):
            raise HTTPError(400, "Missing field: %s" % k)


def text(d, key, limit=None):
    """A string field from a request body ("" when absent); a non-string is a 400, not a crash."""
    v = d.get(key)
    if v is None:
        return ""
    if not isinstance(v, str):
        raise HTTPError(400, "%s must be text" % key)
    return v[:limit] if limit else v


def int_param(h, key, default):
    try:
        return int(h.query.get(key) or default)
    except ValueError:
        raise HTTPError(400, "%s must be a whole number" % key)


def get_or_404(space, rid, kind=None):
    r = db.get_record(space, rid, kind)
    if not r:
        raise HTTPError(404, "Record not found")
    return r


def _num(x):
    if x is None:
        return None
    s = str(x).replace(",", "").replace("$", "").strip()
    if s in ("", "-", "--"):
        return None
    try:
        return float(s)
    except ValueError:
        return None
