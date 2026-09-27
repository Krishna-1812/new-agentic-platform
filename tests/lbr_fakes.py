"""Test doubles for Local Business Radar's outside calls (not a test module).

FakeSession stands in for requests.Session inside tracker/lbr_http.py: each
request is matched against handlers registered by URL substring, in order,
and every request is recorded so a test can assert what was sent.
"""

import json as _json


class FakeResponse:
    def __init__(self, status=200, body=None, headers=None, text=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {}
        self.text = text if text is not None else (_json.dumps(body) if body is not None else "")
        self.content = self.text.encode("utf-8")
        self.url = ""

    def json(self):
        if self._body is None:
            raise ValueError("no JSON")
        return self._body


class FakeSession:
    def __init__(self):
        self.handlers = []
        self.requests = []
        self.headers = {}

    def on(self, url_part, handler):
        """`handler` is a FakeResponse, a list of them (served in turn), or a
        callable (method, url, params, json) -> FakeResponse."""
        if isinstance(handler, list):
            queue = list(handler)
            self.handlers.append((url_part, lambda *a: queue.pop(0) if len(queue) > 1 else queue[0]))
        elif isinstance(handler, FakeResponse):
            self.handlers.append((url_part, lambda *a: handler))
        else:
            self.handlers.append((url_part, handler))
        return self

    def request(self, method, url, params=None, json=None, headers=None, timeout=None, **kw):
        self.requests.append({"method": method, "url": url, "params": params or {},
                              "json": json, "headers": headers or {}})
        for part, handler in self.handlers:
            if part in url:
                resp = handler(method, url, params or {}, json)
                resp.url = url
                return resp
        raise AssertionError("unexpected request: %s %s" % (method, url))

    def get(self, url, **kw):
        return self.request("GET", url, **kw)
