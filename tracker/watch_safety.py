"""Page Watch: turning what a user typed into a link that is safe to open.

The server opens every watched page in a browser, so a link is a request this
server makes on a user's behalf. normalise() accepts what people actually
type ("vercel.com/pricing", "https://Vercel.com/pricing#plans") and returns
one canonical https link, or raises BadURL with a sentence that can be shown.
check() then refuses any host that does not resolve only to public addresses,
using the same rule as Local Business Radar (tracker/lbr_website.check_public).
"""

import re
from urllib.parse import urlsplit, urlunsplit

MAX_URL = 2000


class BadURL(ValueError):
    """A link that cannot be watched; the message is for the user."""


_SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*://")


def normalise(raw):
    """One canonical http(s) link from what the user typed, or BadURL."""
    text = (raw or "").strip()
    if not text:
        raise BadURL("Enter a link to watch.")
    if len(text) > MAX_URL:
        raise BadURL("That link is too long.")
    if any(c.isspace() for c in text):
        raise BadURL("A link cannot contain spaces. To find a page by name, use search instead.")
    if not _SCHEME.match(text):
        if text.startswith("//"):
            text = "https:" + text
        elif ":" in text.split("/", 1)[0] and not re.match(r"^[^:/]+:\d+(/|$)", text):
            raise BadURL("Only web pages (http or https) can be watched.")
        else:
            text = "https://" + text
    parts = urlsplit(text)
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https"):
        raise BadURL("Only web pages (http or https) can be watched.")
    if parts.username or parts.password:
        raise BadURL("Links with a username or password in them cannot be watched.")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host or "." not in host and not host.startswith("["):
        raise BadURL("That does not look like a website address.")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        raise BadURL("That website name has characters that cannot be used.")
    port = parts.port
    netloc = host if port in (None, 80 if scheme == "http" else 443) else "%s:%d" % (host, port)
    path = parts.path or "/"
    return urlunsplit((scheme, netloc, path, parts.query, ""))


def site_key(url):
    """The site a link belongs to, for spacing out checks: host without www."""
    host = (urlsplit(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def check(url):
    """Raise BadURL unless the link's host resolves only to public addresses."""
    from tracker import lbr_website
    try:
        lbr_website.check_public(url)
    except lbr_website.Blocked:
        raise BadURL("That address points inside a private network, so it cannot be watched.")
    except Exception:
        raise BadURL("That website could not be found. Check the address.")


def allowed(url):
    """True when a request to `url` may be made (the browser's per-request rule)."""
    try:
        check(url)
        return True
    except BadURL:
        return False
