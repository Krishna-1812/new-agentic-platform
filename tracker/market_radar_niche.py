"""Market Radar: how precisely a company is placed in its market.

A profile that says "men's innerwear" is not wrong, but a brand whose whole site says Pima cotton, modal
and bamboo, zero polyester, sells to a different buyer and competes with different brands than "men's
innerwear" suggests. Everything downstream (the competitors searched for, how each is judged, the buyer
the report writes about) follows the niche, so the niche has to be the finest description the site
supports, not the broad category.

This module is the free half of that, with no model and no cost:

    stresses(site)             what the site itself keeps saying: its most repeated product, material and
                               audience words, weighted by where they sit (title and headline count most),
                               the things it says it is free of, and its price range
    check(positioning, st, site)  where a niche is vaguer than the site, or says something no page says
    needs_refine(flags)        whether a flag is serious enough for one more, small model call

Flags are kept and shown on the profile, never silently resolved either way.
"""
from __future__ import annotations

import re
import statistics
from collections import Counter

ZONE_WEIGHT = {"title": 5, "description": 4, "h1": 4, "h2": 2, "menu": 2, "products": 2, "body": 1}
HEADLINE_ZONES = ("title", "description", "h1")

# Words that say nothing about what a company sells: web furniture, shop mechanics, filler.
GENERIC = frozenset("""
a about above account across add after all also an and any are as at back be been best better but buy by can
cart check checkout choose click collection collections come contact content continue cookies copyright
customer customers day days default delivery details do does done download each easy email every explore
faq find first for free from get gift gifts give go good got great has have help here home how if in into is it
its join just keep know learn less let like links list live log login look made make many may me menu more most
my need never new news newsletter no not now of off offer offers on one only open or order orders other our out
over page pages password pay payment policy price prices privacy product products quality quick read refund
refunds register return returns review reviews right same save search see sell service services set shipping
shop shopping show sign signup skip so some start still store stores subscribe support terms than thanks
that the their them then there these they this those through time to today top try under up us use used view seller sellers arrival arrivals
want was way we welcome well what when where which while who why will with without work would year years you
your yours
""".split())

# Words a description uses to judge rather than to place; a niche may use them freely.
JUDGEMENT = frozenset("""
affordable based brand brands budget business buyers company customers direct end everyday focused focus
generalist high leading low market maker mid modern online premium quality retail segment services specialised
specialist specialized store stores supplier the luxury products product range essentials essential basic basics collection line
""".split())

MATERIALS = frozenset("""
cotton pima supima organic linen wool merino cashmere silk bamboo modal viscose tencel lyocell hemp leather
vegan polyester nylon spandex elastane denim recycled acrylic rayon jute canvas rubber steel titanium oak
walnut bamboo ceramic glass aluminium aluminum stainless cedar maple
""".split())
# Things a company says it leaves out ("zero polyester", "no sugar", "paraben free") that define it.
AVOIDED = MATERIALS | frozenset("""
sugar gluten dairy paraben sulfate phthalate plastic pesticide gmo additive preservative fragrance silicone
latex toxin chemical dye antibiotic hormone
""".split())
COMPASS = frozenset("north south east west northern southern eastern western central greater downtown".split())
AUDIENCE = frozenset("""
men man mens women woman womens kids kid boys girls baby babies toddlers teens teen unisex pets dogs cats
seniors athletes runners brides students parents mums moms dads founders developers marketers
""".split())

_WORD = re.compile(r"[a-z][a-z'’-]*[a-z]|[a-z]")
_NEGATION = re.compile(r"\b(?:zero|no|without|never|free of|free from|non|not made (?:of|with|from))[ -]"
                       r"([a-z]{4,})", re.I)
_PRICE = re.compile(r"(?:[$£€₹]|\brs\.?\s?|\binr\s?)\s?(\d[\d,]*(?:\.\d+)?)", re.I)
MAX_TERMS = 14


def words(text):
    """Lower-case word stems: possessives and plural endings removed, spelling variants joined, so that
    "men's", "mens" and "men" are one word and "fibre" and "fiber" are one."""
    out = []
    for w in _WORD.findall((text or "").lower().replace("’", "'")):
        for part in re.split(r"-", w):
            part = re.sub(r"'s?$", "", part).replace("'", "")
            if not part:
                continue
            part = part.replace("fibre", "fiber").replace("colour", "color")
            if len(part) > 3 and part.endswith("ies"):
                part = part[:-3] + "y"
            elif len(part) > 3 and part.endswith("s") and not part.endswith(("ss", "us", "is")):
                part = part[:-1]
            out.append(part)
    return out


# The same two lists in the stemmed form words() produces ("essentials" is stored as "essential").
_GEN = GENERIC | frozenset(words(" ".join(GENERIC)))
_JUDGE = JUDGEMENT | frozenset(words(" ".join(JUDGEMENT)))


def _brand_words(site):
    s = site.get("signals") or {}
    label = (site.get("domain") or "").split(".")[0]
    names = " ".join(str(x or "") for x in (s.get("site_name"), label))
    return set(words(names)) | set(words(re.sub(r"([a-z])([A-Z])", r"\1 \2", label)))


def _zones(site):
    """{zone: text} for the pages as the site gave them."""
    s = site.get("signals") or {}
    sm = s.get("sitemap") or {}
    texts = site.get("texts") or {}
    home = texts.get(site.get("home_url")) or next(iter(texts.values()), "")
    rest = " ".join(t for u, t in texts.items() if t is not home)
    heads = s.get("headings") or []
    return {
        "title": s.get("title") or "",
        "description": s.get("description") or "",
        "h1": " . ".join(h["text"] for h in heads if h.get("level") == "h1"),
        "h2": " . ".join(h["text"] for h in heads if h.get("level") == "h2"),
        "menu": " . ".join(s.get("menu_labels") or []),
        "products": " ".join(w for w, n in (sm.get("product_words") or []) for _ in range(min(int(n), 6))),
        "body": home + " " + rest,
    }


def _grams(tokens):
    for i, t in enumerate(tokens):
        yield t
        if i + 1 < len(tokens):
            yield t + " " + tokens[i + 1]


def _meaningful(term):
    parts = term.split()
    if any(len(p) < 3 for p in parts) or all(p in _GEN for p in parts):
        return False
    return not (len(parts) == 2 and (parts[0] in _GEN or parts[1] in _GEN))


def stresses(site):
    """What the site stresses, as facts for the profile prompt and for check(). Free."""
    zones = _zones(site)
    brand = _brand_words(site)
    absences = Counter(w for w in (m.group(1).lower() for m in _NEGATION.finditer(zones["body"] + " "
                                   + zones["title"] + " " + zones["description"]))
                       if w not in GENERIC)
    absent = {w for w, n in absences.items() if w in AVOIDED}
    absent_stems = {words(w)[0] for w in absent if words(w)}
    score, count, where = Counter(), Counter(), {}
    for zone, text in zones.items():
        toks = [t for t in words(text)]
        seen_here = Counter(g for g in _grams(toks)
                            if _meaningful(g) and not (set(g.split()) & brand)
                            and not (set(g.split()) & absent_stems))
        for g, n in seen_here.items():
            score[g] += ZONE_WEIGHT[zone] * min(n, 12)
            count[g] += n
            where.setdefault(g, set()).add(zone)
    # A phrase swallows its words when nearly every mention of the word is inside the phrase.
    terms = []
    for g, sc in score.most_common(80):
        if " " not in g:
            bigger = [h for h in score if " " in h and g in h.split() and count[h] >= 0.6 * count[g]]
            if bigger:
                continue
        zs = where[g]
        if count[g] < 2 and not (zs & set(HEADLINE_ZONES)):
            continue
        terms.append({"term": g, "score": sc, "mentions": count[g],
                      "in": [z for z in ZONE_WEIGHT if z in zs]})
        if len(terms) >= MAX_TERMS:
            break
    body_tokens = Counter(words(zones["body"] + " " + zones["title"] + " " + zones["description"]))
    materials = {w: n for w, n in body_tokens.most_common() if w in {words(m)[0] for m in MATERIALS}
                 and w not in absent_stems}
    audience = {w: n for w, n in body_tokens.most_common() if w in {words(a)[0] for a in AUDIENCE}}
    prices = []
    for m in _PRICE.finditer(zones["body"]):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if 0 < v < 1_000_000:
            prices.append(v)
    price = None
    if len(prices) >= 3:
        price = {"low": min(prices), "median": statistics.median(prices), "high": max(prices),
                 "seen": len(prices), "symbols": [c for c in "$£€₹" if c in zones["body"]][:2]}
    return {"terms": terms,
            "materials_named": dict(list(materials.items())[:8]),
            "audience_words": dict(list(audience.items())[:5]),
            "says_it_is_free_of": sorted(absent)[:6],
            "prices_seen": price,
            "headline": zones["title"] or zones["h1"]}


# == checking a niche against it =================================================================

def _niche_text(pos):
    parts = [pos.get("niche") or "", " ".join(pos.get("category_path") or [])]
    parts += [str(a.get("value") or "") for a in pos.get("defining_attributes") or []]
    return " ".join(parts)


_DEFINING = frozenset(words(" ".join(MATERIALS | AUDIENCE)))


def _strong(term, places=frozenset()):
    """A term that defines the business: a material or an audience the site names often, or any word in
    its title or headline. (A product type listed among many, such as "boxer briefs", is a range, not
    the niche.)"""
    toks = set(term["term"].split())
    if toks <= _JUDGE or toks <= places or toks & COMPASS:
        return False        # a judgement word, or where the business is, is not what it sells
    if term["mentions"] >= 3 and toks & _DEFINING:
        return True
    return bool(set(term["in"]) & {"title", "h1"}) and term["mentions"] >= 3


def place_words(*parts):
    """Stemmed words of the places a business is in (its city, region, service area), which describe where it
    is, not what it is."""
    return frozenset(w for part in parts for w in words(str(part or "")))


def check(pos, st, site, places=frozenset()):
    """Flags: [{"kind", "text"}]. kinds: too_vague, missing_term, unsupported, no_audience.
    The first three make needs_refine true. `places` are place_words() of where the business is."""
    if not pos:
        return [{"kind": "too_vague", "text": "No niche was written for this company."}]
    flags = []
    niche = set(words(_niche_text(pos)))
    meaningful = [w for w in words(pos.get("niche") or "") if w not in _GEN and w not in _JUDGE]
    if len(meaningful) < 3:
        flags.append({"kind": "too_vague", "text": "The niche is only %d meaningful word(s): name the "
                      "product, what sets it apart and who it is for." % len(meaningful)})
    missing = []
    for t in (st or {}).get("terms") or []:
        toks = set(t["term"].split())
        if _strong(t, places) and not (toks & niche):
            missing.append(t)
        if len(missing) >= 3:
            break
    for t in missing:
        flags.append({"kind": "missing_term", "text": "The site stresses \"%s\" (%d mentions, in its %s) "
                      "but the niche does not mention it." % (
                          t["term"], t["mentions"], " and ".join(t["in"][:3]))})
    corpus = set(words(" ".join(_zones(site).values())))
    brand = _brand_words(site)
    for w in dict.fromkeys(words(pos.get("niche") or "")):
        if len(w) >= 4 and w not in _GEN and w not in _JUDGE and w not in corpus and w not in brand:
            flags.append({"kind": "unsupported", "text": "The niche says \"%s\", which no page that was "
                          "read says." % w})
    aud = pos.get("audience") or {}
    if not (aud.get("who") or "").strip():
        flags.append({"kind": "no_audience", "text": "No target customer was described."})
    return flags


SERIOUS = ("too_vague", "missing_term", "unsupported")


def needs_refine(flags):
    return any(f.get("kind") in SERIOUS for f in flags or [])


def feedback(flags):
    """The flags as a short plain list for the refining prompt."""
    return [f["text"] for f in flags or [] if f.get("kind") in SERIOUS]
