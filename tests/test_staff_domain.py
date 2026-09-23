"""The /p2 staff gate and what the UI says about it are one value.

They were two. brand.staff_domain said one domain and fed the 403 page, the
Field Guide and the admin copy; app.py checked a hard-coded "@position2.com"
in twelve places. So the 403 page told users of the stated domain they would
get in, and the gate refused them. Nothing errored, because the two never met.

Now the gate reads STAFF_EMAIL_SUFFIX, which is derived from brand.staff_domain,
and the default is the domain the gate always enforced -- so this is a refactor,
not an access change, and the tests below pin both halves of that.
"""

import os
import re
import sys

import pytest

os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as appmod  # noqa: E402
from brand import BRAND  # noqa: E402


def test_the_gate_and_the_brand_read_the_same_value():
    assert appmod.STAFF_EMAIL_SUFFIX == "@" + BRAND["staff_domain"]
    assert BRAND["staff_domain"] in BRAND["access_note"], (
        "access_note states a different domain from the one the gate enforces")


def test_no_staff_check_hard_codes_a_domain_again():
    """Strip comments and docstrings first: they are allowed to describe the
    rule. Code is not allowed to restate it."""
    src = open(appmod.__file__, encoding="utf-8").read()
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    code = "\n".join(line.split("#", 1)[0] for line in src.splitlines())
    hits = re.findall(r'endswith\(\s*["\']@[\w.-]+["\']\s*\)|=\s*["\']@[\w-]+\.[\w.]+["\']', code)
    assert not hits, "a staff check hard-codes its domain instead of reading STAFF_EMAIL_SUFFIX: %s" % hits


@pytest.fixture
def client():
    appmod.app.config["TESTING"] = True
    return appmod.app.test_client()


def _sign_in(client, email):
    with client.session_transaction() as s:
        s["google_user"] = {"email": email, "name": "T", "given_name": "T", "picture": None}


def test_a_staff_account_still_reaches_p2(client):
    _sign_in(client, "someone" + appmod.STAFF_EMAIL_SUFFIX)
    assert client.get("/p2/hub").status_code == 200


@pytest.mark.parametrize("email", ["someone@example.com", "someone@gmail.com"])
def test_anyone_else_is_still_refused(client, email):
    assert client.get("/p2/hub").status_code in (302, 303)  # signed out: to login
    _sign_in(client, email)
    assert client.get("/p2/hub").status_code in (302, 303, 403)
