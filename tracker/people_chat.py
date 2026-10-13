"""People & Signals chat: write what you want in plain words, get the people.

    parsed = understand("marketing people at Stripe")            # free: plain rules
    summary = answer(parsed, client, progress=print)             # free: Saleshandy searches

"Marketing people at Stripe", "who is the CMO of Databricks?", "VP Sales and
CFO at Notion, Ramp", "top 5 engineers at hubspot.com", "and their sales
team?" (a follow-up: the last request's company is kept) are read by plain
rules, no model needed. When the rules cannot tell who or what was asked
for, and the viewer is staff with a Claude key, one small Claude call reads
the message (capped well under a cent); otherwise the chat asks.

What comes back has the shape of a People & Signals map summary, so the
reveal (emails and LinkedIn, credits, after a yes), the CSV and the run
list all work on it unchanged. Searching is free; Saleshandy's search
results carry no email or LinkedIn address, those arrive with the reveal.
"""
from __future__ import annotations

import re
from decimal import Decimal

from . import account_mapper as am
from . import saleshandy_client as sh

MAX_COMPANIES = 5
MAX_ASKS = 4
DEFAULT_TEAM = 10
MAX_TEAM = 25
DEFAULT_TITLE = 3
MAX_TITLE = am.MAX_PER_ROLE
MAX_MESSAGE = 500
PARSE_CAP_USD = Decimal("0.02")

LEADER_LEVELS = ["C-Level", "Founder", "Owner", "President/Vice President", "Director", "Head"]

# == words ===================================================================================

# Words that carry no meaning of their own in a request.
FILLER = set("""a an the all any some every each find show list give get fetch pull me us my our please can could would
should will you i we want need like to contact reach look looking search for of at in from with on by working work works
who whom whose is are was were what which where there their its it's them they this that those these also now then about
tell let lets let's names name email emails address addresses linkedin profile profiles details detail info information
hi hello hey thanks thank ok okay yes no just only top best key main relevant right good people person persons folks
team teams staff employees employee members member professionals personnel department departments dept group contacts
individuals guys""".split())
TEAM_WORDS = set("people person persons folks team teams staff employees employee members member professionals personnel "
                 "department departments dept group contacts individuals guys".split())
NOISE_IN_ROLE = {"the", "a", "an", "all", "any", "some", "every", "each", "top", "best", "key", "main", "relevant",
                 "right", "good"}
SEPARATORS = {",", ";", "+", "/", "and", "or", "plus", "then", "also"}
CONNECTORS = {"at", "in", "from", "for", "with", "@", "within", "inside", "near", "around", "of", "on", "by"}
JOINERS = {"of", "&", "de", "la", "van", "von", "der", "du", "y"}     # inside a company's name: "Bank of America"
LOCATION_CONNECTORS = {"in", "near", "around", "from", "based"}
NUMBER_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen "
    "eighteen nineteen twenty".split())}

# A singular seniority word makes a request a job title ("VP of Sales", "CMO").
TITLE_WORDS = {"chief", "cxo", "vp", "svp", "evp", "avp", "vice", "president", "director", "head", "manager", "lead",
               "founder", "cofounder", "owner", "principal", "partner", "gm", "md", "senior", "sr", "junior", "executive"}
TITLE_WORDS |= set(am.ABBREVIATIONS) - {"it", "hr", "bd"}

# Plural words stand for a level across a team: "directors in finance", "marketing leaders".
PLURAL_LEVELS = {
    "leaders": LEADER_LEVELS, "leadership": LEADER_LEVELS, "management": LEADER_LEVELS, "execs": LEADER_LEVELS,
    "executives": LEADER_LEVELS, "decisionmakers": LEADER_LEVELS, "heads": ["Head", "Director", "President/Vice President", "C-Level"],
    "directors": ["Director"], "managers": ["Manager"], "vps": ["President/Vice President"],
    "founders": ["Founder"], "cofounders": ["Founder"], "owners": ["Owner"], "partners": ["Partner"],
    "csuite": ["C-Level", "Founder"], "clevel": ["C-Level", "Founder"], "chiefs": ["C-Level"],
    "presidents": ["President/Vice President"], "seniors": ["Director", "Head", "President/Vice President", "C-Level"],
}
LEVEL_LABEL = {"leaders": "leaders", "leadership": "leadership", "management": "management", "execs": "executives",
               "executives": "executives", "decisionmakers": "decision-makers", "heads": "heads",
               "directors": "directors", "managers": "managers", "vps": "VPs", "founders": "founders",
               "cofounders": "founders", "owners": "owners", "partners": "partners", "csuite": "C-suite",
               "clevel": "C-suite", "chiefs": "chiefs", "presidents": "presidents", "seniors": "senior people"}

# Job families that are not a department of their own.
OCCUPATIONS = {
    "engineer": (["Engineer"], ["Engineering and Technical"]), "developer": (["Developer", "Engineer"], ["Engineering and Technical"]),
    "programmer": (["Programmer", "Developer"], ["Engineering and Technical"]), "designer": (["Designer"], ["Design"]),
    "recruiter": (["Recruiter", "Talent Acquisition"], ["Human Resources"]), "accountant": (["Accountant"], ["Finance & Accounting"]),
    "analyst": (["Analyst"], []), "consultant": (["Consultant"], []), "scientist": (["Scientist"], []),
    "marketer": (["Marketing"], ["Marketing"]), "salesperson": (["Sales"], ["Sales"]), "salespeople": (["Sales"], ["Sales"]),
    "seller": (["Sales"], ["Sales"]), "sdr": (["Sales Development Representative", "SDR"], ["Sales"]),
    "bdr": (["Business Development Representative", "BDR"], ["Sales"]), "writer": (["Writer", "Content"], ["Marketing"]),
    "lawyer": (["Lawyer", "Counsel", "Attorney"], ["Legal"]), "attorney": (["Attorney", "Counsel"], ["Legal"]),
    "nurse": (["Nurse"], ["Medical"]), "doctor": (["Physician", "Doctor"], ["Medical"]),
}
# The title words that find a department's people when Saleshandy has not filled in the department.
DEPT_KEYWORDS = {
    "Marketing": ["Marketing"], "Sales": ["Sales"], "Finance & Accounting": ["Finance", "Accounting"],
    "Human Resources": ["HR", "Human Resources", "People", "Talent"], "Engineering and Technical": ["Engineering", "Engineer", "Technology"],
    "Product": ["Product"], "Operations": ["Operations"], "Legal": ["Legal", "Counsel"], "Design": ["Design"],
    "Customer Service": ["Customer Success", "Customer Support", "Customer Experience"], "Project Management": ["Project", "Program"],
    "Research": ["Research"], "Medical": ["Medical", "Clinical"], "C-Suite": [],
}
# Said as one word, kept as one. Spaced phrases are joined token by token, so a company's case survives.
GLUE_ONE = {"decision-makers": "decisionmakers", "decision-maker": "decisionmaker", "c-suite": "csuite",
            "c-level": "clevel", "co-founders": "cofounders", "co-founder": "cofounder", "csuite": "csuite"}
GLUE_MANY = (("decision", "makers"), "decisionmakers"), (("decision", "maker"), "decisionmaker"), \
    (("c", "suite"), "csuite"), (("c", "level"), "clevel"), (("vice", "presidents"), "vps"), \
    (("vice", "president"), "vp"), (("co", "founders"), "cofounders"), (("co", "founder"), "cofounder"), \
    (("human", "resources"), "hr"), (("business", "development"), "bizdev"), (("demand", "generation"), "demandgen"), \
    (("demand", "gen"), "demandgen"), (("customer", "success"), "customersuccess"), \
    (("sales", "people"), "salespeople"), (("sales", "person"), "salesperson")
UNGLUE = {"demandgen": "demand generation", "bizdev": "business development", "customersuccess": "customer success",
          "salespeople": "sales", "salesperson": "sales", "decisionmakers": "decision-makers", "csuite": "c-suite",
          "clevel": "c-level", "cofounders": "co-founders", "cofounder": "co-founder"}
ACRONYMS = {"ceo", "cfo", "coo", "cto", "cmo", "cro", "cio", "ciso", "cpo", "chro", "cco", "cdo", "cso", "cgo", "vp", "svp",
            "evp", "avp", "gm", "md", "hr", "bd", "it", "seo", "sdr", "bdr", "ux", "ui", "b2b", "b2c", "saas", "r&d", "cxo", "pr"}
SMALL = {"of", "and", "the", "for", "in", "at", "to", "&"}

DOMAIN_RE = re.compile(r"^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")
URL_RE = re.compile(r"https?://(?:www\.)?([^\s/?#]+)\S*", re.I)
QUOTE_RE = re.compile(r"[\"“”]([^\"“”]{1,120})[\"“”]")

HELP = ("Tell me who you are looking for and where, in plain words. For example: "
        "“marketing people at Stripe”, “the CMO of Databricks”, "
        "“VP Sales and CFO at Notion and Ramp” or “top 5 engineers at hubspot.com”.")
ROLE_CHOICES = ["Leadership", "Marketing team", "Sales team", "Engineering team", "Finance team", "HR team"]


# == small helpers ==============================================================================

def _low(text):
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def titled(words):
    """"head of demand generation" -> "Head of Demand Generation"; "cmo" -> "CMO"."""
    out = []
    for i, w in enumerate(words):
        lw = w.lower()
        if lw in ACRONYMS:
            out.append(lw.upper())
        elif lw in SMALL and i:
            out.append(lw)
        else:
            out.append(w[:1].upper() + w[1:].lower() if w.islower() or w.isupper() else w)
    return " ".join(out)


def _depts(word):
    return am.departments_for(UNGLUE.get(word, word))


def _singular(word):
    if word in ("sales", "business", "operations", "success", "analytics", "marketing", "ops", "its", "bizdev"):
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith("s") and not word.endswith("ss") and len(word) > 3:
        return word[:-1]
    return word


def _domain_label(domain):
    host = domain.split(".")
    label = host[-2] if len(host) >= 2 and host[-2] not in ("co", "com", "org", "net", "ac", "gov") else host[0]
    if len(host) >= 3 and host[-2] in ("co", "com", "org", "net", "ac", "gov"):
        label = host[-3]
    return label.replace("-", " ").title()


def _as_domain(token):
    t = token.lower().strip(".,;:!?)(")
    if t.startswith("www."):
        t = t[4:]
    return t if DOMAIN_RE.match(t) and not t.endswith((".png", ".jpg", ".pdf")) else None


def _number(token):
    t = token.lower()
    if t.isdigit() and 0 < int(t) <= 99:
        return int(t)
    return NUMBER_WORDS.get(t) if t in NUMBER_WORDS and NUMBER_WORDS[t] > 0 else None


# == reading the words ===========================================================================

def _tokens(message):
    """[(kind, text, original)]: Q quoted name, D domain, S separator, C connector, T team word, N number,
    R role word, F filler, O other (part of a company's name)."""
    text = (message or "").strip()[:MAX_MESSAGE]
    quoted = []

    def keep(m):
        quoted.append(m.group(1).strip())
        return " \x00%d\x00 " % (len(quoted) - 1)
    text = QUOTE_RE.sub(keep, text)
    text = URL_RE.sub(lambda m: " " + m.group(1) + " ", text)
    raw = [t.strip() for t in re.findall(r"\x00\d+\x00|[&@,;+/]|[^\s,;&@+/?!()]+", text) if t.strip()]
    words = []
    i = 0
    while i < len(raw):
        low = raw[i].lower()
        for pair, whole in GLUE_MANY:
            n = len(pair)
            if tuple(x.lower() for x in raw[i:i + n]) == pair:
                words.append((whole, " ".join(raw[i:i + n])))
                i += n
                break
        else:
            words.append((GLUE_ONE.get(low, low), raw[i]))
            i += 1
    toks = []
    for w, orig in words:
        m = re.fullmatch(r"\x00(\d+)\x00", orig)
        if m:
            toks.append(("Q", quoted[int(m.group(1))], quoted[int(m.group(1))]))
            continue
        lw = w.strip(".:'\u2019\"")
        lw = re.sub(r"(?:'s|\u2019s)$", "", lw)
        if orig == "&":
            toks.append(("O", "&", orig))
        elif lw in SEPARATORS:
            toks.append(("S", lw, orig))
        elif lw == "@":
            toks.append(("C", "at", orig))
        elif _as_domain(lw):
            toks.append(("D", _as_domain(lw), orig))
        elif _number(lw):
            toks.append(("N", str(_number(lw)), orig))
        elif lw in TEAM_WORDS:
            toks.append(("T", lw, orig))
        elif lw in CONNECTORS:
            toks.append(("C", lw, orig))
        elif _is_role_word(lw, orig):
            toks.append(("R", lw, orig))
        elif lw in FILLER or lw == "based":
            toks.append(("F", lw, orig))
        else:
            toks.append(("O", orig.strip(".,:;\"'"), orig))
    return toks


def _is_role_word(lw, orig=""):
    if lw in TITLE_WORDS or lw in PLURAL_LEVELS or lw in OCCUPATIONS:
        return True
    s = _singular(lw)
    if s in TITLE_WORDS or s in OCCUPATIONS or lw in ("cmos", "ceos", "cfos", "ctos", "cros", "coos", "cios", "cisos"):
        return True
    if lw == "it":
        return orig == "IT"
    if lw in ("hr", "bizdev", "demandgen", "customersuccess", "marketers", "salespeople"):
        return True
    return bool(_depts(lw)) and lw not in ("people", "service") or lw == "support"


def _company_runs(toks):
    """Positions of company names: runs of O/Q/D tokens, joined across "of" and "&" when an O token is on both sides."""
    runs, i, n = [], 0, len(toks)
    while i < n:
        if toks[i][0] in ("O", "Q", "D") and not (toks[i][0] == "O" and toks[i][1] == "&"):
            j = i + 1
            while j < n:
                k, t = toks[j][0], toks[j][1]
                if k in ("O", "Q", "D") and t != "&":
                    j += 1
                elif ((k == "C" and t == "of") or (k == "O" and t == "&") or (k == "F" and t in JOINERS)) \
                        and j + 1 < n and toks[j + 1][0] == "O" and toks[j + 1][1] != "&":
                    j += 2
                else:
                    break
            runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def _name_of(toks, a, b):
    parts = [toks[x][1] if toks[x][0] in ("Q", "D") else toks[x][2] for x in range(a, b)]
    name = " ".join(p for p in parts if p).strip()
    name = re.sub(r"\s+&\s+", " & ", name)
    return name


# == turning words into asks =====================================================================

def _ask_from_segment(words, count_hint=None):
    """words: lower-case role/filler/team tokens of one part of the request -> an ask, or None."""
    core = [w for w in words if w not in NOISE_IN_ROLE]
    team_words = [w for w in core if w in TEAM_WORDS]
    core = [w for w in core if w not in TEAM_WORDS]
    plural = [w for w in core if w in PLURAL_LEVELS]
    depts = []
    for w in core:
        for d in _depts(w):
            if d not in depts:
                depts.append(d)
    if not core and not plural:
        return None
    core_clean = [w for w in core if w not in FILLER or w in ("of", "in", "for", "and")]
    if plural:
        levels = []
        for w in plural:
            for lv in PLURAL_LEVELS[w]:
                if lv not in levels:
                    levels.append(lv)
        dept_words = [w for w in core_clean if w not in PLURAL_LEVELS and w not in FILLER]
        dept = [d for d in depts if d != "C-Suite"] if dept_words else []
        label_words = dept_words + [LEVEL_LABEL.get(plural[0], plural[0])]
        kw = []
        for d in dept:
            kw += [k for k in DEPT_KEYWORDS.get(d, []) if k not in kw]
        return {"kind": "team", "label": titled(label_words), "departments": dept, "levels": levels,
                "keywords": kw, "role": None}
    senior = [w for w in core if w in TITLE_WORDS or _singular(w) in TITLE_WORDS or re.fullmatch(r"c[a-z]os", w)]
    if senior:
        role_words = [w[:-1] if re.fullmatch(r"c[a-z]os", w) else w for w in core_clean
                      if w not in ("and", "or") and not (w in FILLER and w not in ("of", "in", "for"))]
        while role_words and role_words[-1] in ("of", "in", "for"):
            role_words.pop()
        while role_words and role_words[0] in ("of", "in", "for"):
            role_words.pop(0)
        if not role_words:
            return None
        role = titled([x for w in role_words for x in UNGLUE.get(w, w).split(" ")])
        return {"kind": "title", "label": role, "role": role, "departments": am.departments_for(role),
                "levels": am.levels_for(role), "keywords": []}
    occ = [w for w in core if _singular(w) in OCCUPATIONS]
    if occ:
        kw, dept = [], []
        for w in occ:
            k, d = OCCUPATIONS[_singular(w)]
            kw += [x for x in k if x not in kw]
            dept += [x for x in d if x not in dept]
        extra = [w for w in core if w not in occ and w not in FILLER]
        for w in extra:
            for d in _depts(w):
                if d not in dept:
                    dept.append(d)
        word = _singular(occ[0])
        label = titled([word]) if word in ("salesperson", "salespeople") else titled([word]) + "s"
        if word in ("salesperson", "salespeople"):
            label = "Sales team"
        return {"kind": "team", "label": label, "departments": dept, "levels": [], "keywords": kw, "role": None}
    if depts:
        words = [w for w in core_clean if w not in FILLER or w == "of"]
        while words and words[-1] in ("of", "and"):
            words.pop()
        while words and words[0] in ("of", "and"):
            words.pop(0)
        kw = []
        for d in depts:
            kw += [k for k in DEPT_KEYWORDS.get(d, []) if k not in kw]
        label = titled([x for w in words for x in UNGLUE.get(w, w).split(" ")] or [depts[0]])
        if depts == ["C-Suite"]:
            return {"kind": "team", "label": "Leadership", "departments": [], "levels": ["C-Level", "Founder", "Owner"],
                    "keywords": [], "role": None}
        return {"kind": "team", "label": label + " team", "departments": [d for d in depts if d != "C-Suite"],
                "levels": [], "keywords": kw, "role": None}
    return None


def _rules(message, context=None):
    toks = _tokens(message)
    runs = _company_runs(toks)
    used = set()
    companies, where = [], None
    first_company_end = None
    for a, b in runs:
        prev = toks[a - 1] if a else None
        # "... at Stripe in London": a place after a company is a place, not another company
        if companies and prev and prev[0] == "C" and prev[1] in LOCATION_CONNECTORS and a - 1 >= first_company_end:
            where = " ".join(toks[x][2] for x in range(a, b))
            used.update(range(a - 1, b))
            continue
        if len(companies) and prev and prev[0] == "F" and prev[1] == "based" and a >= 2:
            where = " ".join(toks[x][2] for x in range(a, b))
            used.update(range(a - 2, b))
            continue
        doms = [toks[x][1] for x in range(a, b) if toks[x][0] == "D"]
        names = [x for x in range(a, b) if toks[x][0] != "D"]
        if doms and not names:
            for d in doms:
                companies.append({"name": _domain_label(d), "domain": d})
        else:
            name = _name_of(toks, a, b) if not doms else " ".join(
                toks[x][2] if toks[x][0] != "Q" else toks[x][1] for x in names)
            companies.append({"name": name, "domain": doms[0] if doms else None})
        if first_company_end is None:
            first_company_end = b
        used.update(range(a, b))
    # numbers: "top 5", "10 marketing people"
    count = None
    for i, (k, t, _) in enumerate(toks):
        if k == "N" and i not in used:
            nxt = toks[i + 1][0] if i + 1 < len(toks) else None
            prv = toks[i - 1][1] if i else None
            if nxt in ("R", "T", "F") or prv in ("top", "first", "best", "about"):
                count = int(t)
                used.add(i)
                break
    if any(t[1] in ("all", "everyone", "everybody") for t in toks if t[0] == "F"):
        count = count or MAX_TEAM
    # the rest, in order, is what was asked for; separators and the places where a company was taken out split it
    starts = {x for x in range(len(toks)) if x in used and (x - 1 not in used)}
    segments, cur = [], []
    for i, (k, t, o) in enumerate(toks):
        if i in used:
            if i in starts and cur:
                segments.append(cur)
                cur = []
            continue
        if k == "S":
            if cur:
                segments.append(cur)
            cur = []
        elif k in ("R", "T", "F"):
            cur.append(t)
        elif k == "C" and t in ("of", "in", "for"):
            cur.append(t)
        elif k == "C":
            if cur:
                segments.append(cur)
            cur = []
    if cur:
        segments.append(cur)
    asks = []
    for seg in segments:
        while seg and seg[-1] in FILLER | {"of", "in", "for"} and seg[-1] not in TEAM_WORDS:
            seg = seg[:-1]
        ask = _ask_from_segment(seg)
        if not ask:
            continue
        # "Head of Sales and Marketing": the bare department after "and" belongs to the title before it
        if asks and ask["kind"] == "team" and not ask["levels"] and not ask["keywords"] == [] and asks[-1]["kind"] == "title" \
                and not any(w in TEAM_WORDS for w in seg) and ask["label"].lower().endswith(" team") and \
                len(seg) == 1 and seg[0] not in OCCUPATIONS:
            prev_ask = asks[-1]
            if prev_ask["departments"] and not _has_team_word(segments):
                prev_ask["role"] = prev_ask["label"] = prev_ask["role"] + " and " + ask["label"][:-5]
                prev_ask["departments"] = am.departments_for(prev_ask["role"])
                continue
        if ask["label"].lower() not in [a["label"].lower() for a in asks]:
            asks.append(ask)
    return {"companies": companies, "asks": asks, "where": where, "count": count}


def _has_team_word(segments):
    return any(w in TEAM_WORDS for seg in segments for w in seg)


def _greeting(message):
    words = re.findall(r"[a-z']+", _low(message))
    if not words:
        return True
    chatter = {"hi", "hello", "hey", "help", "thanks", "thank", "you", "ok", "okay", "what", "can", "do", "how", "does",
               "this", "work", "works", "who", "are", "is", "it", "yo", "good", "morning", "afternoon", "evening", "cool",
               "great", "nice", "awesome", "i", "ask", "anything", "start", "begin", "examples", "example", "show", "me"}
    return all(w in chatter for w in words) and not any(am.departments_for(w) for w in words if w not in ("it",))


# == the whole message ===========================================================================

def _limit(companies, asks):
    note = None
    if len(companies) > MAX_COMPANIES:
        note = "I took the first %d companies; ask again for the rest." % MAX_COMPANIES
        companies = companies[:MAX_COMPANIES]
    if len(asks) > MAX_ASKS:
        note = (note + " " if note else "") + "I took the first %d kinds of people." % MAX_ASKS
        asks = asks[:MAX_ASKS]
    return companies, asks, note


def understand(message, context=None, *, claude=None):
    """-> {"kind": "search" | "clarify" | "help", ...}. `context` is the last request's {"companies", "asks"}, so a
    follow-up that names only a company or only the people keeps the other half. `claude(message, context)`, when
    given, is asked only if the rules found nothing to go on; it returns the same fields or None."""
    message = (message or "").strip()
    if not message or _greeting(message):
        return {"kind": "help", "reply": HELP}
    context = context or {}
    got = _rules(message, context)
    companies, asks = got["companies"], got["asks"]
    how = "rules"
    if (not companies or not asks) and claude is not None:
        try:
            smart = claude(message, context)
        except Exception:
            smart = None
        if smart and smart.get("companies") and smart.get("asks"):
            companies, asks, how = smart["companies"], smart["asks"], "claude"
            got = dict(got, where=smart.get("where") or got["where"], count=smart.get("count") or got["count"])
        elif smart and smart.get("reply") and not (smart.get("companies") or smart.get("asks")):
            return {"kind": "clarify", "need": "details", "reply": smart["reply"], "choices": []}
    if not companies and context.get("companies") and asks:
        companies, how = [dict(c) for c in context["companies"]], "context"
    if not asks and context.get("asks") and companies and got["companies"]:
        asks, how = [dict(a) for a in context["asks"]], "context"
    if not companies and not asks:
        return {"kind": "clarify", "need": "details", "reply": "I could not find a company or a kind of person in that. " + HELP,
                "choices": []}
    if not companies:
        return {"kind": "clarify", "need": "company", "asks": asks,
                "reply": "Which company should I look at? You can also give its website, like stripe.com.", "choices": []}
    if not asks:
        names = ", ".join(c["name"] for c in companies[:3])
        return {"kind": "clarify", "need": "role", "companies": companies,
                "reply": "Who at %s? Choose one, or write the job title or team you want." % names, "choices": ROLE_CHOICES}
    companies, asks, note = _limit(companies, asks)
    count = got.get("count")
    if count:
        for a in asks:
            if a["kind"] == "team":
                a["count"] = max(1, min(int(count), MAX_TEAM))
            else:
                a["count"] = max(1, min(int(count), MAX_TITLE))
    for a in asks:
        a.setdefault("count", None)
    return {"kind": "search", "companies": companies, "asks": asks, "where": got.get("where"), "how": how, "note": note}


# == Claude, for what the rules cannot read (staff only, capped) =================================

READ_SYSTEM = (
    "You read one message from a salesperson who wants to find people at companies. Return: the companies "
    "(name, and the website domain only if the message gives one), and what they want, as one or more asks. An ask is "
    "either a specific job title (kind 'title', e.g. 'VP of Marketing', with the title written as people write it) or a "
    "group of people (kind 'team', e.g. all marketing people, or only the directors in finance). For a team ask set "
    "'department' to one of: Marketing, Sales, Finance & Accounting, Human Resources, Engineering and Technical, Product, "
    "Operations, Legal, Design, Customer Service, Project Management, Research, Medical, or empty; and 'seniority' to any "
    "of: C-Level, Founder, Owner, President/Vice President, Partner, Director, Head, Manager, Senior, Specialist, or empty. "
    "'count' is how many people they asked for, or 0. 'location' is a city or country they want the people to be in, or "
    "empty. If the message names no company, or no kind of person, leave that list empty and put one short question in "
    "'reply'. Use the earlier request only when the message clearly refers back to it ('their sales team', 'what about "
    "Notion'). Never invent companies.")
READ_SCHEMA = {"type": "object", "additionalProperties": False, "required": ["companies", "asks", "count", "location", "reply"],
               "properties": {
                   "companies": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                                 "required": ["name", "domain"], "properties": {"name": {"type": "string"}, "domain": {"type": "string"}}}},
                   "asks": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                            "required": ["kind", "label", "titles", "department", "seniority"],
                            "properties": {"kind": {"type": "string"}, "label": {"type": "string"},
                                           "titles": {"type": "array", "items": {"type": "string"}},
                                           "department": {"type": "string"},
                                           "seniority": {"type": "array", "items": {"type": "string"}}}}},
                   "count": {"type": "integer"}, "location": {"type": "string"}, "reply": {"type": "string"}}}
DEPARTMENTS = [d for d in DEPT_KEYWORDS if d != "C-Suite"]
LEVELS = ["C-Level", "Founder", "Owner", "President/Vice President", "Partner", "Director", "Head", "Manager", "Senior",
          "Specialist"]


def from_claude(data):
    """The model's JSON -> companies/asks in this module's shape, every value checked."""
    companies, asks = [], []
    for c in (data or {}).get("companies") or []:
        name = re.sub(r"\s+", " ", str(c.get("name") or "")).strip()[:120]
        dom = _as_domain(str(c.get("domain") or ""))
        if name and name.lower() not in [x["name"].lower() for x in companies]:
            companies.append({"name": name, "domain": dom})
    for a in (data or {}).get("asks") or []:
        label = re.sub(r"\s+", " ", str(a.get("label") or "")).strip()[:80]
        titles = [re.sub(r"\s+", " ", str(t)).strip()[:80] for t in a.get("titles") or [] if str(t).strip()]
        dept = str(a.get("department") or "").strip()
        levels = [lv for lv in a.get("seniority") or [] if lv in LEVELS]
        if a.get("kind") == "title" and (titles or label):
            role = titles[0] if titles else label
            asks.append({"kind": "title", "label": role, "role": role, "departments": am.departments_for(role),
                         "levels": am.levels_for(role), "keywords": [], "variants": titles[1:5]})
        elif dept in DEPARTMENTS or levels:
            asks.append({"kind": "team", "label": label or titled([dept.lower()]) + " team", "role": None,
                         "departments": [dept] if dept in DEPARTMENTS else [], "levels": levels,
                         "keywords": DEPT_KEYWORDS.get(dept, []) if dept in DEPARTMENTS else titles[:4]})
        elif titles:
            asks.append({"kind": "team", "label": label or titles[0], "role": None, "departments": [],
                         "levels": levels, "keywords": titles[:4]})
    count = data.get("count") if isinstance(data, dict) else None
    return {"companies": companies, "asks": asks, "count": count if isinstance(count, int) and count > 0 else None,
            "where": (data or {}).get("location") or None, "reply": str((data or {}).get("reply") or "").strip()[:300]}


def claude_reader(model, budget):
    """A `claude` function for understand(): one small call, booked against `budget`."""
    from . import contact_lab as lab

    def read(message, context):
        prior = ""
        if context.get("companies") or context.get("asks"):
            prior = "Earlier request: companies %s; people %s.\n" % (
                ", ".join(c["name"] for c in context.get("companies") or []) or "none",
                ", ".join(a["label"] for a in context.get("asks") or []) or "none")
        data = lab._json_call(budget, "chat_read", model, READ_SYSTEM, prior + "Message: " + message[:MAX_MESSAGE],
                              READ_SCHEMA, 700)
        return from_claude(data)
    return read


def clean_context(ctx):
    """The last request, as the browser sends it back: every value checked, so a hand-made one can say nothing
    this module would not have said itself."""
    out = {"companies": [], "asks": []}
    if not isinstance(ctx, dict):
        return out
    for c in (ctx.get("companies") or [])[:MAX_COMPANIES]:
        if isinstance(c, dict) and isinstance(c.get("name"), str) and c["name"].strip():
            dom = _as_domain(str(c.get("domain") or ""))
            out["companies"].append({"name": re.sub(r"\s+", " ", c["name"]).strip()[:120], "domain": dom})
    for a in (ctx.get("asks") or [])[:MAX_ASKS]:
        if not isinstance(a, dict) or a.get("kind") not in ("title", "team") or not isinstance(a.get("label"), str):
            continue
        ask = {"kind": a["kind"], "label": a["label"].strip()[:80], "role": None,
               "departments": [d for d in (a.get("departments") or []) if d in DEPARTMENTS][:3],
               "levels": [lv for lv in (a.get("levels") or []) if lv in LEVELS or lv in LEADER_LEVELS][:8],
               "keywords": [str(k).strip()[:40] for k in (a.get("keywords") or []) if str(k).strip()][:6], "count": None}
        if a["kind"] == "title":
            role = str(a.get("role") or a["label"]).strip()[:80]
            if not role:
                continue
            ask["role"] = role
            ask["variants"] = [str(v).strip()[:80] for v in (a.get("variants") or []) if str(v).strip()][:4]
        if ask["label"]:
            out["asks"].append(ask)
    return out


# == which company? ==============================================================================

MAX_CANDIDATES = 8
CLOSE_SCORE = 60          # a company this close in name to the one asked for is a real candidate


def _guess_domain(name):
    slug = re.sub(r"[^a-z0-9]", "", _low(name))
    return slug + ".com" if slug else None


def candidates_for(name, client):
    """The companies Saleshandy lists under a name, closest first (free). One search by name and, when the name
    could be a website, one by its likely domain, so the company is found even when its listed name differs.
    -> [{name, domain, industry, employees, hq, linkedin, founded, score}]"""
    found = {}

    def add(c, bonus=0):
        dom = c.get("domain")
        if not dom or dom in found:
            return
        found[dom] = {"name": c.get("name") or dom, "domain": dom, "industry": c.get("industry"),
                      "employees": c.get("employees"), "hq": c.get("hq"), "linkedin": c.get("linkedin"),
                      "founded": c.get("founded"), "score": min(100, am.name_score(name, c.get("name") or "") + bonus)}
    for c in client.search_companies({"company_name": {"includes": [name]}})["companies"]:
        add(c)
    guess = _guess_domain(name)
    if guess and guess not in found:
        for c in client.search_companies({"company_domain": {"includes": [guess]}})["companies"]:
            if c.get("domain") == guess:
                add(c, 40)
    out = sorted(found.values(), key=lambda c: (c["score"], c["employees"] or 0), reverse=True)
    return [c for c in out if c["score"] > 0][:MAX_CANDIDATES]


def resolve_plan(parsed, client):
    """Before searching for people, settle which company each name means (free). A company whose website is known
    is settled. A name that exactly one company in Saleshandy answers to is settled. Anything else, several
    companies of that name, only a near name, or none, is put to the user.
    -> (companies with domains where settled, [{"name", "candidates"}] still to choose)"""
    settled, needs = [], []
    for company in parsed["companies"]:
        if company.get("domain"):
            settled.append(dict(company))
            continue
        cands = candidates_for(company["name"], client)
        close = [c for c in cands if c["score"] >= CLOSE_SCORE]
        if len(close) == 1 and close[0]["score"] >= 100:
            settled.append({"name": company["name"], "domain": close[0]["domain"]})
        else:
            settled.append(dict(company))
            needs.append({"name": company["name"], "candidates": cands})
    return settled, needs


def clean_request(req):
    """A request the browser sends back after the user chose a company: every value checked, as clean_context does,
    plus the place, the count and how it was read."""
    ctx = clean_context(req)
    if not ctx["companies"] or not ctx["asks"]:
        return None
    count = None
    for a, raw in zip(ctx["asks"], (req.get("asks") or [])):
        n = raw.get("count") if isinstance(raw, dict) else None
        if isinstance(n, int) and not isinstance(n, bool) and n > 0:
            a["count"] = min(n, MAX_TEAM if a["kind"] == "team" else MAX_TITLE)
    where = req.get("where")
    how = req.get("how") if req.get("how") in ("rules", "claude", "context") else "rules"
    return {"kind": "search", "companies": ctx["companies"], "asks": ctx["asks"], "count": count,
            "where": re.sub(r"\s+", " ", where).strip()[:60] if isinstance(where, str) and where.strip() else None,
            "how": how, "note": None}


def apply_picks(parsed, picks):
    """The companies the user chose, by the name asked for: name and website."""
    picks = picks if isinstance(picks, dict) else {}
    for c in parsed["companies"]:
        dom = _as_domain(str(picks.get(c["name"]) or ""))
        if dom:
            c["domain"] = dom
    return parsed


# == finding the people ==========================================================================

DROP_ALWAYS = ("former", "retired", "aspiring", "freelance", "student", "ex-")
DROP_UNLESS_ASKED = ("intern", "internship", "assistant", "trainee", "apprentice")


def _title_ok(person, message_low):
    title = _low(person.get("title"))
    if not title:
        return False
    for w in DROP_ALWAYS + tuple(w for w in DROP_UNLESS_ASKED if w not in message_low):
        if re.search(r"(?<![a-z])%s" % re.escape(w), title):
            return False
    return True


def _rank_key(p):
    levels = am.levels_for(p.get("title"))
    return (max([am.LEVEL_RANK.get(lv, 0) for lv in levels] or [0]), bool(p.get("decision_maker")),
            p.get("experience_years") or 0)


def _in_place(person, where):
    words = [w for w in re.findall(r"[a-z]+", _low(where)) if len(w) > 1]
    hay = _low(person.get("location") or "")
    return bool(words) and all(w in hay for w in words)


def find_team(company_name, domain, ask, client, count, *, message=""):
    """Up to `count` people of a team, the most senior first. -> (people, also, attempts, total)."""
    base = am._base(domain, company_name)
    msg = _low(message)
    levels = ask.get("levels") or []
    depts = ask.get("departments") or []
    kws = ask.get("keywords") or []
    exclude = ["intern", "assistant", "trainee", "former"] if "intern" not in msg and "assistant" not in msg else ["former"]
    tries = []
    if depts:
        f = dict(base, department={"includes": depts})
        if levels:
            f["management_level"] = {"includes": levels}
        tries.append(("%s department at %s" % (" / ".join(depts), domain or company_name), f))
    if kws:
        f = dict(base, job_title={"includes": kws, "excludes": exclude, "exactMatch": 0})
        if levels:
            f["management_level"] = {"includes": levels}
        tries.append(("titles with %s at %s" % (", ".join(kws[:3]), domain or company_name), f))
    if not tries and levels:
        tries.append(("%s at %s" % (" / ".join(levels[:3]), domain or company_name),
                      dict(base, management_level={"includes": levels})))
    found, attempts, total = {}, [], 0
    for how, filters in tries:
        # A company with a known domain is searched only at that domain: a search by its name brings in namesakes.
        if len(found) >= count:
            break
        res = client.search_people(filters)
        people = res["people"]
        if "company_domain" not in filters:
            people = [p for p in people if am.name_score(company_name, p.get("company") or "") >= 70]
        people = [p for p in people if _title_ok(p, msg)]
        attempts.append({"how": how, "total": res["total"], "kept": len(people)})
        if people:
            total = max(total, res["total"])
        for p in people:
            found.setdefault(p["id"], p)
    ordered = sorted(found.values(), key=_rank_key, reverse=True)
    picked = [dict(p, score=100 - i) for i, p in enumerate(ordered[:count])]
    also = [dict(p, score=60) for p in ordered[count:count + am.MAX_ALSO]]
    return picked, also, attempts, total


def find_title(company_name, domain, ask, client, count):
    """The people holding one job title. -> (picked, also, attempts, total)."""
    plan = am.role_plan(ask["role"], ask.get("variants") or ())
    people, attempts = am.find_people(company_name, domain, plan, client, by_name=False)
    picked, also = am.rank(people, plan, count)
    total = attempts[-1]["total"] if attempts else 0
    return picked, also, attempts, total


def answer_company(company, asks, client, *, where=None, message="", progress=None):
    say = progress or (lambda s: None)
    rec = {"name": company["name"], "input_domain": company.get("domain"), "domain": None, "resolved": None,
           "roles": [], "insights": None, "errors": []}
    say("finding %s" % company["name"])
    r = am.resolve(company, client)
    rec["resolved"], rec["domain"] = r, r["domain"]
    if r["company"] and r["company"].get("name"):
        rec["display_name"] = r["company"]["name"]
    seen = set()
    for ask in asks:
        say("looking for %s at %s" % (ask["label"].lower(), company["name"]))
        if ask["kind"] == "team":
            picked, also, attempts, total = find_team(company["name"], rec["domain"], ask,
                                                      client, ask.get("count") or DEFAULT_TEAM, message=message)
        else:
            picked, also, attempts, total = find_title(company["name"], rec["domain"], ask, client,
                                                       ask.get("count") or DEFAULT_TITLE)
        picked = [p for p in picked if p["id"] not in seen]
        also = [p for p in also if p["id"] not in seen]
        note = None
        if where and (picked or also):
            near = [p for p in picked + also if _in_place(p, where)]
            if near:
                picked = [p for p in picked if _in_place(p, where)]
                also = [p for p in also if _in_place(p, where)]
                note = "Showing people in %s." % where
            else:
                note = "None of them list %s as their location; showing everyone found." % where
        seen |= {p["id"] for p in picked}
        rec["roles"].append({"role": ask["label"], "kind": ask["kind"], "picked": picked, "also": also,
                             "attempts": attempts, "total": total, "note": note,
                             "status": "found" if picked else ("close" if also else "not_found")})
    return rec


def answer(parsed, client, *, message="", progress=None, on_company=None):
    """Runs a parsed request. -> a map-style summary (companies, roles, picked, also)."""
    say = progress or (lambda s: None)
    companies, asks = parsed["companies"], parsed["asks"]
    out = {"settings": {"roles": [a["label"] for a in asks], "per_role": DEFAULT_TITLE, "insights": False,
                        "use_claude": False, "model": None},
           "chat": {"message": message[:MAX_MESSAGE], "asks": asks, "where": parsed.get("where"), "how": parsed.get("how")},
           "plans": None, "companies": [], "stopped": None, "credits": None}
    try:
        out["credits"] = client.credits()
    except sh.AuthError:
        raise
    except sh.SaleshandyError as e:
        out["credits"] = {"error": str(e)}
    for i, company in enumerate(companies, 1):
        def step(s, i=i):
            say("%s (%d/%d)" % (s, i, len(companies)))
        try:
            out["companies"].append(answer_company(company, asks, client, where=parsed.get("where"),
                                                   message=message, progress=step))
        except sh.RateLimited as e:
            out["stopped"] = "Stopped: %s. The companies before it are kept." % e
            break
        except sh.AuthError:
            raise
        except sh.SaleshandyError as e:
            out["companies"].append({"name": company["name"], "input_domain": company.get("domain"),
                                     "domain": company.get("domain"), "resolved": None, "roles": [],
                                     "insights": None, "errors": [str(e)]})
        if on_company:
            on_company(out)
    out["totals"] = am.totals(out["companies"])
    out["requests"] = len(client.log)
    return out
