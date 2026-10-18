"""Search Query Analysis: static/js/sqr_core.js run in Node.

The rules and the ranking decide which search terms a client's account is told to block and which to bid on, so a wrong verdict costs real
money either way. The file is executed, not read. What is pinned here:

  * rule matching is on whole words: "student" is not "dent", "pearlescent" is not the competitor Pearl, "duke" is not the UK, "normal teeth"
    is not a trip to Normal, IL; a measure ("64 slice ct") is not a street address; "dr near me" is not a practitioner;
  * a word list still matches what it should (the same checks the other way round);
  * negatives are ranked by money wasted on terms that never converted, a negative whose terms converted or that would also stop a relevant
    term or a keyword the account bids on is held back from the priority list, one that cannot stop the term that raised it is replaced by
    one that can, and what the account already blocks is not suggested again;
  * keywords are summed over ad groups, never a duplicate, never blocked, never for a campaign that takes none, and tiered on real response;
  * the model reads only terms that were clicked, costliest first, up to a limit, and every row count is counted in rows;
  * the CSV fallback reads the same things Google Ads would say.

The platform ships no per-client rulebook, only the Automatic rules. The hooks a client rulebook can set (a core word list with a veto, model
hints, a campaign territory map with ambiguous city names, forbidden negatives, routing negatives, partner products that are never negated)
are exercised through ACME below: a fictional client, Acme Dental in Springfield, defined for these tests only.
"""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CORE = os.path.join(ROOT, "static", "js", "sqr_core.js")
pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")

PRELUDE = r"""
const C = require(%s);
const R = (term, o) => Object.assign({term, campaign: "C1", adGroup: "A1", campaignType: "SEARCH", clicks: 0, impressions: 10, cost: 0, conversions: 0, status: ""}, o || {});
const STUB = {id: "t", label: "T", note: "", competitors: ["rival"], classifyDeterministic(t) {
  const l = t.toLowerCase();
  if (l.includes("brand")) return {status: "Relevant", subtype: "Brand"};
  if (l.includes("rival")) return {status: "Competitor", subtype: "Named competitor", negMatchType: "Exact", negLevel: "Account"};
  if (l.includes("jobs")) return {status: "Not Relevant", subtype: "Jobs", negMatchType: "Phrase", negText: "jobs", negLevel: "Account"};
  if (l.includes("faraway")) return {status: "Not Relevant", subtype: "Out of area", negMatchType: "Phrase", negLevel: "Campaign"};
  if (l.includes("elsewhere")) return {status: "Not Relevant", subtype: "Location Mismatch"};
  if (l.includes("coverage")) return {status: "Client Review", subtype: "Insurance"};
  if (l.includes("core")) return {status: "Relevant", subtype: "Core"};
  return null;
}};
// A fictional client rulebook, for these tests only: Acme Dental, Springfield. It is built the way a real one would be, from the core's own
// matchers and hint patterns, so every hook the core gives a rulebook is exercised.
const IL = /\b(il|illinois)\b/i;
const ACME = {
  id: "acme", label: "Acme Dental (test)", note: "",
  brandRe: /(acme\s*dental|acmedental|acme\s*dentistry)/i,
  competitors: ["Summit Dental", "Bright Smile Studio", "Pearl", "Dr Hale", "Lakeside Family Dentistry"],
  insuranceBrands: ["delta dental", "metlife", "cigna"],
  outOfArea: ["chicago", "st louis", "uk"],
  territoryMap: {springfield: ["Springfield", "Chatham"], normal: ["Normal", "Bloomington"], decatur: ["Decatur"], riverton: ["Riverton"]},
  ambiguousCities: {normal: IL, bloomington: IL, decatur: IL},
  coreSignal: ["dental", "tooth", "teeth", "oral", "gum", "tmj", "invisalign", "braces", "implant", "veneer", "crown", "bridge", "denture", "whitening",
               "extraction", "root canal", "cleaning", "checkup", "appointment", "dentis", "orthodont"],
  coreVeto: /\b(carpet|house|window|car|office)\s+cleaning\b|\bcleaning\s+(services?|company|supplies)\b|\b(breast|hair)\s+implants?\b|\b(crown royal|crown molding|bridge loan)\b/i,
  modelHint: C.hint(C.HINTS.jobs, C.HINTS.school, C.HINTS.diy, C.HINTS.price, C.HINTS.info, C.HINTS.pet, C.HINTS.product, C.HINTS.charity),
  classifyDeterministic(term, slug, row) {
    const t = term.trim(); if (!t) return null;
    if (this.brandRe.test(t)) return {status: "Relevant", subtype: "Brand"};
    if (C.has(this, "competitors", t) || C.individual(this, t)) return {status: "Competitor", subtype: "Named competitor / practitioner", negMatchType: "Exact", negLevel: "Account"};
    if (C.isAddress(t)) return {status: "Not Relevant", subtype: "Specific Address Query"};
    if (C.PHONE_RE.test(t)) return {status: "Not Relevant", subtype: "Specific Phone Query"};
    if (/\bschool\b/i.test(t) && !/dental school/i.test(t)) return {status: "Not Relevant", subtype: "Education/Training", negText: "dental school", negMatchType: "Phrase", negLevel: "Account"};
    if (/\bmedicare\b/i.test(t)) return {status: "Not Relevant", subtype: "Medicare Not Accepted", negText: "medicare", negMatchType: "Phrase", negLevel: "Account"};
    if (C.has(this, "insuranceBrands", t)) return {status: "Client Review", subtype: "Insurance Network Brand"};
    if (C.has(this, "outOfArea", t)) return {status: "Not Relevant", subtype: "Out-of-Area Location", negMatchType: "Phrase", negLevel: "Campaign"};
    const mismatch = C.radiusTargeted(row) ? null : C.campaignServesCity(slug || "", this.territoryMap, t, this.ambiguousCities);
    if (mismatch === false) return {status: "Not Relevant", subtype: "Location Mismatch"};
    if (C.core(this, t)) return {status: "Relevant", subtype: "Core dental intent"};
    return null;
  },
};
const RS = {acme: ACME, generic: C.RULESETS.generic};
const model = map => async terms => ({results: Object.fromEntries(terms.map(t => [t, map[t] || {status: "Not Relevant", subtype: "No Clear Intent", by: "model"}])), fallback: 0, failures: []});
const M = (status, subtype) => ({status, subtype: subtype || "x", by: "model"});
const neg = (text, match, level, campaigns) => ({text, match, level: level || "account", campaigns: campaigns || []});
""" % json.dumps(CORE)


def js(body):
    """Run `body` (the statements of an async function, ending in a return) in Node; the returned value comes back as JSON."""
    code = PRELUDE + "(async () => {" + body + "})().then(v => console.log(JSON.stringify(v === undefined ? null : v))).catch(e => { console.error(e.stack); process.exit(1); });"
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def verdict(ruleset, term, slug="x"):
    out = js("const v = RS[%s].classifyDeterministic(%s, %s); return v ? [v.status, v.subtype] : null;" % (json.dumps(ruleset), json.dumps(term), json.dumps(slug)))
    return tuple(out) if out else None


# ── Rule matching ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("ruleset,term,slug,expected", [
    # the middle of a word is not the word
    ("acme", "carpet cleaning near me", "springfield", None),                       # a core word in another trade: the model decides
    ("acme", "cleaning services near me", "springfield", None),
    ("acme", "breast implants cost", "springfield", None),
    ("acme", "student loan forgiveness", "springfield", None),                      # "dent" is inside "student"
    ("acme", "moral values", "springfield", None),                                  # "oral" is inside "moral"
    ("acme", "argument essay", "springfield", None),                                # "gum" is inside "argument"
    ("acme", "pearlescent veneers", "springfield", ("Relevant", "Core dental intent")),   # the competitor "Pearl" is inside "pearlescent"
    ("acme", "dentist near duke hospital", "springfield", ("Relevant", "Core dental intent")),   # "uk" is inside "duke"
    # "dr near me" is not a practitioner; a named one is
    ("acme", "dr near me", "springfield", None),
    ("acme", "best dds near me", "springfield", None),
    ("acme", "dr smith dentist", "springfield", ("Competitor", "Named competitor / practitioner")),
    ("acme", "dentist on lakeshore dr springfield il", "springfield", ("Relevant", "Core dental intent")),   # Drive, not a doctor
    ("acme", "1200 lakeshore plaza dr suite 100 springfield il 62704", "springfield", ("Not Relevant", "Specific Address Query")),
    ("acme", "john kowalski dds", "springfield", ("Competitor", "Named competitor / practitioner")),
    # a measure is not a street address
    ("acme", "64 slice ct scan dental implants", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "24 hour dentist near me", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "100 elm street dentist", "springfield", ("Not Relevant", "Specific Address Query")),
    ("acme", "250 river rd dentist", "springfield", ("Not Relevant", "Specific Address Query")),
    ("acme", "217-555-0142 dentist", "springfield", ("Not Relevant", "Specific Phone Query")),
    # a place name that is also a word is another campaign's city only with its state
    ("acme", "normal teeth color what to expect", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "dentist normal il", "springfield", ("Not Relevant", "Location Mismatch")),
    ("acme", "dentist normal il", "normal", ("Relevant", "Core dental intent")),
    ("acme", "dentist decatur", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "dentist decatur il", "springfield", ("Not Relevant", "Location Mismatch")),
    ("acme", "bloomington blue cross dental", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "dentist riverton", "springfield", ("Not Relevant", "Location Mismatch")),
    ("acme", "dentist chatham", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "dentist peoria", "brandcampaign", ("Relevant", "Core dental intent")),   # a campaign not in the map: never a mismatch
    # a service word does not settle a term that hints at a category the model is asked about
    ("acme", "dental hygienist jobs", "springfield", None),
    ("acme", "how to whiten teeth at home", "springfield", None),
    ("acme", "free dental clinic near me", "springfield", None),
    ("acme", "affordable dentist near me", "springfield", ("Relevant", "Core dental intent")),   # "affordable" and "offer" are not price-seeking hints
    ("acme", "do dentists offer payment plans", "springfield", ("Relevant", "Core dental intent")),
    # and the rules still fire on what they are for, in their order
    ("acme", "dentist near me", "springfield", ("Relevant", "Core dental intent")),
    ("acme", "student dentist school", "springfield", ("Not Relevant", "Education/Training")),
    ("acme", "acme dental implants", "springfield", ("Relevant", "Brand")),
    ("acme", "summit dental near me", "springfield", ("Competitor", "Named competitor / practitioner")),
    ("acme", "does acme dental take medicare", "springfield", ("Relevant", "Brand")),
    ("acme", "acme dental vs summit dental", "springfield", ("Relevant", "Brand")),               # brand beats competitor
    ("acme", "summit dental 123 main street", "springfield", ("Competitor", "Named competitor / practitioner")),   # competitor beats address
    ("acme", "123 main street medicare", "springfield", ("Not Relevant", "Specific Address Query")),
    ("acme", "dentist that takes medicare", "springfield", ("Not Relevant", "Medicare Not Accepted")),
    ("acme", "delta dental insurance dentist", "springfield", ("Client Review", "Insurance Network Brand")),
    ("acme", "dentist chicago", "springfield", ("Not Relevant", "Out-of-Area Location")),
    ("acme", "dentist in the uk", "springfield", ("Not Relevant", "Out-of-Area Location")),
    ("generic", "anything at all", "x", None),
])
def test_each_rule_decides_on_words_not_letters(ruleset, term, slug, expected):
    assert verdict(ruleset, term, slug) == expected


def test_the_word_list_matchers():
    out = js("""
      const p = C.phraseRe(["Dr Smith", "uline", "amazon.com"]), s = C.signalRe(["dentis", "mri", "crown", "invisalign"]);
      return {
        phrase: ["dr smith", "buy from uline", "masculine", "dr smithfield", "amazon.com coupons", "amazon.company"].map(t => p.test(t)),
        signal: ["dentist", "dentistry near me", "student", "mri", "primrose", "mris", "crown", "crowne plaza", "crowns", "invisalign cost", "uninvisalign"].map(t => s.test(t)),
      };""")
    assert out["phrase"] == [True, True, False, False, True, False]
    assert out["signal"] == [True, True, False, True, False, True, True, False, True, True, False]


def test_a_campaign_is_matched_to_its_longest_territory_name():
    out = js("""
      const map = {lake: ["Lakeview"], lakewest: ["Lakeview", "Riverton"], decatur: ["Decatur"]};
      return [C.campaignServesCity("lakewestbrand", map, "riverton dentist", null), C.campaignServesCity("lakefamily", map, "riverton dentist", null), C.campaignServesCity("nothing", map, "decatur dentist", null)];""")
    assert out == [True, False, None]          # lakefamily is Lakeview's campaign: Riverton belongs to the other one


def test_a_dr_is_a_doctor_only_when_a_name_follows_and_it_is_not_a_street():
    out = js("""return ['dr near me', 'dr appointment', 'dr jones', 'dr. patel office', 'top dmd', 'maria lopez dmd', 'dentist dr warren', 'my dr patel', 'dentist near dr smith',
        'dentist on lakeshore dr springfield il', '100 maple dr riverton il 62561', '1200 lakeshore plaza dr suite 100 springfield il', 'main dr dentist', '300 family dr smithfield il', 'family dr smith'].map(t => C.individual({}, t));""")
    assert out == [False, False, True, True, False, True, True, True, True, False, False, False, False, False, True]


def test_addresses_and_measures():
    out = js("return ['100 elm street', '1234 main st raleigh', '64 slice ct scan', '3 tesla mri', '24 hour way dentist', '10 year warranty st', '500 oak ave'].map(t => C.isAddress(t));")
    assert out == [True, True, False, False, False, False, True]


# ── The pipeline ────────────────────────────────────────────────────────────

def test_only_clicked_terms_go_to_the_model_costliest_first_up_to_the_limit():
    out = js("""
      const asked = [];
      const rows = [R("a", {clicks: 5, cost: 10}), R("b", {clicks: 1, cost: 50}), R("c", {clicks: 0, cost: 0}), R("d", {clicks: 2, cost: 30}), R("e", {clicks: 0, cost: 0.5})];
      const r = await C.analyze(STUB, rows, {modelCap: 3, classify: async terms => { asked.push(terms); return model({})(terms); }});
      return {asked, by: Object.fromEntries(r.rows.map(x => [x.term, x._det.by + "/" + x._det.status + "/" + x._det.subtype])), s: r.summary};""")
    assert out["asked"] == [["b", "d", "a"]]                                    # costliest first; c never clicked, e fell outside the limit
    assert out["by"]["c"] == "skipped/Not reviewed/No clicks"
    assert out["by"]["e"] == "skipped/Not reviewed/Over the review limit"       # cost, so it deserves a look, but past the limit
    assert out["s"]["skipped"] == 2 and out["s"]["byModel"] == 3 and out["s"]["notReviewedSpend"] == 0.5
    assert out["s"]["overLimit"] == 1                                            # only the row that cost money and went unread is a warning


def test_every_count_is_a_count_of_rows_even_when_a_term_repeats():
    out = js("""
      const rows = ["x1", "x1", "x1", "brand a", "x2"].map((t, i) => R(t, {clicks: 1, cost: 1, campaign: "C" + i}));
      const r = await C.analyze(STUB, rows, {classify: async terms => ({results: {"x1": {status: "Not Relevant", subtype: "No Clear Intent", by: "fallback"}, "x2": M("Relevant")}, fallback: 1, failures: ["boom"]})});
      return r.summary;""")
    assert (out["byRule"], out["byModel"], out["fallback"], out["totalRows"], out["uniqueTerms"]) == (1, 1, 3, 5, 3)
    assert out["byRule"] + out["byModel"] + out["fallback"] + out["skipped"] == out["totalRows"]


def test_a_model_answer_is_found_whatever_its_case_or_spacing():
    out = js("""
      const r = await C.analyze(STUB, [R("Some  Odd Term", {clicks: 1, cost: 2})], {classify: async terms => ({results: {"Some Odd Term": M("Relevant", "Model said")}, fallback: 0, failures: []})});
      return r.rows[0]._det;""")
    assert out["status"] == "Relevant" and out["by"] == "model"


def test_negatives_are_ranked_by_money_wasted_and_a_converting_term_is_never_a_priority():
    out = js("""
      const rows = [R("rival one", {clicks: 40, cost: 50, conversions: 6}), R("rival two", {clicks: 10, cost: 20}), R("rival three", {clicks: 20, cost: 30}), R("brand core", {clicks: 9, cost: 9, conversions: 2})];
      const r = await C.analyze(STUB, rows, {});
      return {pri: r.priorityNegatives.map(n => n.text), review: r.reviewNegatives.map(n => [n.text, n.risks]), all: r.allNegatives.map(n => n.text)};""")
    assert out["pri"] == ["rival three", "rival two"]
    assert out["review"] == [["rival one", ["converted"]]]
    assert out["all"] == ["rival three", "rival two", "rival one"]


def test_a_phrase_negative_that_cannot_stop_its_own_term_becomes_one_that_can():
    out = js("""
      const rs = Object.assign({}, STUB, {classifyDeterministic: t => ({status: "Not Relevant", subtype: "Education", negMatchType: "Phrase", negText: "dental school", negLevel: "Account"})});
      const rows = [R("school of dental hygiene", {clicks: 1, cost: 4}), R("dental school fees", {clicks: 1, cost: 3})];
      const r = await C.analyze(rs, rows, {});
      return r.allNegatives.map(n => [n.text, n.matchType]).sort();""")
    assert out == [["dental school", "Phrase"], ["school of dental hygiene", "Phrase"]]


def test_a_campaign_negative_is_one_per_campaign_performance_max_included():
    out = js("""
      const rows = [R("faraway city dentist", {campaign: "A", clicks: 1, cost: 5}), R("faraway city dentist", {campaign: "B", clicks: 1, cost: 4}),
                    R("faraway town dentist", {campaign: "P", campaignType: "PERFORMANCE_MAX", clicks: 1, cost: 3}), R("elsewhere dentist", {campaign: "P", campaignType: "PERFORMANCE_MAX", clicks: 1, cost: 3})];
      const r = await C.analyze(STUB, rows, {});
      return r.allNegatives.map(n => [n.text, n.level, n.campaign]).sort();""")
    # a place that is wrong for one campaign is not wrong everywhere, so no negative may be turned into an account-wide one
    assert out == [["elsewhere dentist", "Campaign", "P"], ["faraway city dentist", "Campaign", "A"], ["faraway city dentist", "Campaign", "B"], ["faraway town dentist", "Campaign", "P"]]


def test_a_term_that_spent_with_no_conversion_gets_an_exact_negative_whoever_judged_it():
    out = js("""
      const rows = [R("model said no", {clicks: 3, cost: 12}), R("elsewhere dentist", {clicks: 2, cost: 8}), R("cheap one", {clicks: 1, cost: 0.4}),
                    R("converted though", {clicks: 4, cost: 20, conversions: 1}), R("gone fallback", {clicks: 2, cost: 9}), R("no clicks term", {clicks: 0, cost: 0}),
                    R("already out", {clicks: 2, cost: 6, status: "EXCLUDED"})];
      const mm = {"model said no": M("Not Relevant", "Job posting"), "cheap one": M("Not Relevant"), "converted though": M("Not Relevant"), "already out": M("Not Relevant")};
      const r = await C.analyze(STUB, rows, {classify: async terms => { const x = await model(mm)(terms); x.results["gone fallback"] = {status: "Not Relevant", subtype: "No Clear Intent", by: "fallback"}; return x; }});
      return r.allNegatives.map(n => [n.text, n.matchType, n.level, n.campaign, n.implied, n.by, n.reason]);""")
    assert sorted(out) == [["elsewhere dentist", "Exact", "Campaign", "C1", True, "rule", "Not relevant, spent and never converted (Location Mismatch)"],
                           ["model said no", "Exact", "Campaign", "C1", True, "model", "Not relevant, spent and never converted (Job posting)"]]


def test_what_the_account_already_blocks_is_not_suggested_again():
    out = js("""
      const rows = [R("rival one", {clicks: 2, cost: 9}), R("rival two", {clicks: 2, cost: 8}), R("faraway x", {clicks: 2, cost: 7, campaign: "A"}), R("rival four", {clicks: 2, cost: 6}),
                    R("rival five", {clicks: 2, cost: 5, campaign: "A"}), R("jobs here", {clicks: 2, cost: 4, campaign: "A"})];
      const existing = [neg("rival", "PHRASE"), neg("rival two", "EXACT"), neg("faraway x", "PHRASE", "campaign", ["A"]), neg("rival four", "EXACT", "adgroup", ["C1"]),
                        neg("rival five", "EXACT", "list", ["B"]), neg("jobs", "EXACT")];
      const r = await C.analyze(STUB, rows, {negatives: existing});
      return {left: r.allNegatives.map(n => n.text).sort(), skipped: r.negativesSkipped};""")
    # "rival" phrase covers one/two/four/five; an exact "jobs" does not cover the phrase "jobs"; a list on campaign B does not reach campaign A
    assert out["left"] == ["jobs"] and out["skipped"] == 5


def test_a_wider_existing_negative_covers_a_narrower_suggestion_but_not_the_other_way():
    out = js("""
      const c = C.buildCover([neg("dentist jobs", "PHRASE"), neg("cheap", "BROAD"), neg("exact one", "EXACT")]);
      return [C.isCovered(c, "dentist jobs", "EXACT", "Account", []), C.isCovered(c, "jobs", "PHRASE", "Account", []), C.isCovered(c, "nyc dentist jobs", "PHRASE", "Account", []),
              C.isCovered(c, "very cheap dentist", "EXACT", "Account", []), C.isCovered(c, "exact one", "EXACT", "Account", []), C.isCovered(c, "exact one", "PHRASE", "Account", []),
              C.isCovered(c, "dentist jobs", "EXACT", "Campaign", ["A"])];""")
    assert out == [True, False, True, True, True, False, True]


def test_a_negative_that_would_stop_a_relevant_term_or_a_bid_keyword_is_held_back():
    out = js("""
      const rs = Object.assign({}, STUB, {classifyDeterministic: t => /brand/.test(t) ? {status: "Relevant", subtype: "Brand"}
        : /medicare/.test(t) ? {status: "Not Relevant", subtype: "Medicare", negMatchType: "Phrase", negText: "medicare", negLevel: "Account"} : null});
      const rows = [R("dentist medicare", {clicks: 5, cost: 30}), R("brand medicare", {clicks: 8, cost: 12, conversions: 2}), R("medicare supplement dentist", {clicks: 3, cost: 9})];
      const r = await C.analyze(rs, rows, {keywords: [{text: "medicare dentist plan", match: "PHRASE", campaign: "C1"}]});
      const n = r.allNegatives[0];
      return {pri: r.priorityNegatives.length, rev: r.reviewNegatives.map(x => x.text), risks: n.risks, ex: n.collateral.ex, conflicts: n.conflicts, wasted: n.wasted};""")
    assert out["pri"] == 0 and out["rev"] == ["medicare"]
    assert out["risks"] == ["blocks relevant terms", "blocks a keyword you bid on"]
    assert out["ex"] == ["brand medicare"] and out["conflicts"] == ["medicare dentist plan"] and out["wasted"] == 39


def test_keywords_are_summed_over_ad_groups_tiered_and_ranked():
    out = js("""
      const rows = [R("core a", {adGroup: "G1", clicks: 4, impressions: 40, cost: 20, conversions: 0.6}), R("core a", {adGroup: "G2", clicks: 6, impressions: 60, cost: 30, conversions: 0.7}),   // 1.3 together
                    R("core b", {clicks: 3, impressions: 40, cost: 9}),                       // 7.5% click rate: tier 2
                    R("core c", {clicks: 2, impressions: 20, cost: 9}),                        // too little
                    R("core d", {clicks: 3, impressions: 100, cost: 9}),                       // 3%: too little
                    R("core e", {clicks: 9, impressions: 90, cost: 9, conversions: 0.4}),     // a partial conversion: tier 2
                    R("brand core five word term", {clicks: 5, impressions: 60, cost: 5, conversions: 1, campaign: "P", campaignType: "PERFORMANCE_MAX", adGroup: ""})];
      const r = await C.analyze(STUB, rows, {});
      return {k: r.allKeywords.map(k => [k.term, k.tier, k.matchType, k.whereToAdd, Math.round(k.conversions * 10) / 10, k.clicks, k.cpa && Math.round(k.cpa * 100) / 100]), skipped: r.keywordsSkipped};""")
    assert out["k"] == [["core a", 1, "Phrase Match", "C1 / G2", 1.3, 10, 38.46],
                        ["brand core five word term", 1, "Search Theme", "P", 1, 5, 5],
                        ["core e", 2, "Phrase Match", "C1 / A1", 0.4, 9, 22.5],
                        ["core b", 2, "Phrase Match", "C1 / A1", 0, 3, None]]
    assert out["skipped"]["weak"] == 2


def test_a_keyword_is_never_suggested_twice_or_into_a_block_or_a_campaign_that_takes_none():
    out = js("""
      const rows = [R("core have", {clicks: 5, impressions: 50, cost: 5, conversions: 2}), R("core added", {clicks: 5, impressions: 50, cost: 5, conversions: 2, status: "ADDED"}),
                    R("core excluded", {clicks: 5, impressions: 50, cost: 5, conversions: 2, status: "EXCLUDED"}), R("core blocked", {clicks: 5, impressions: 50, cost: 5, conversions: 2}),
                    R("core shop", {clicks: 5, impressions: 50, cost: 5, conversions: 2, campaignType: "SHOPPING"}), R("core fine", {clicks: 5, impressions: 50, cost: 5, conversions: 2}),
                    R("core only a", {clicks: 5, impressions: 50, cost: 5, conversions: 2, campaign: "A"}), R("core only a", {clicks: 5, impressions: 50, cost: 5, conversions: 2, campaign: "B"})];
      const r = await C.analyze(STUB, rows, {keywords: [{text: "[Core Have]", match: "EXACT"}], negatives: [neg("blocked", "PHRASE"), neg("core only a", "EXACT", "campaign", ["A"])]});
      return {k: r.allKeywords.map(k => k.term), s: r.keywordsSkipped};""")
    assert sorted(out["k"]) == ["core fine", "core only a"]                      # a campaign's negative blocks the term in that campaign only
    assert out["s"] == {"existing": 3, "blocked": 2, "type": 1, "weak": 0}


def test_the_summary_says_where_the_money_went():
    out = js("""
      const rows = [R("brand core", {clicks: 10, cost: 100, conversions: 5}), R("elsewhere x", {clicks: 4, cost: 40}), R("elsewhere y", {clicks: 1, cost: 10, conversions: 1}),
                    R("rival z", {clicks: 2, cost: 25}), R("coverage q", {clicks: 2, cost: 15, conversions: 1}), R("coverage r", {clicks: 1, cost: 5})];
      const r = await C.analyze(STUB, rows, {});
      return {s: r.summary, review: r.clientReview};""")
    s = out["s"]
    assert (s["totalSpend"], s["totalConv"], s["wastedSpend"], s["competitorSpend"], s["relevantSpendPct"], s["relevantPct"]) == (195, 7, 40, 25, 51, 17)
    assert out["review"] == [{"subtype": "Insurance", "count": 2, "cost": 20, "conversions": 1, "examples": ["coverage q", "coverage r"]}]


def test_rows_that_are_not_search_terms_are_dropped_and_an_empty_range_says_so():
    out = js("""
      const rows = [R("Total: Search terms"), R("total: account"), R("Other search terms"), R("--"), R("  "), R("brand core", {clicks: 1, cost: 1})];
      const r = await C.analyze(STUB, rows, {});
      let err = ""; try { await C.analyze(STUB, [R("Total: x")], {}); } catch (e) { err = e.message; }
      return {n: r.summary.totalRows, err};""")
    assert out["n"] == 1 and out["err"] == "There are no search terms in that range."


# ── A whole rulebook, end to end ────────────────────────────────────────────

def test_a_client_rulebook_runs_end_to_end_without_a_model():
    out = js("""
      const rows = [R("acme dental office", {clicks: 5, cost: 10, conversions: 2}), R("summit dental near me", {clicks: 4, cost: 25}), R("dentist that takes medicare", {clicks: 6, cost: 31}),
                    R("dentist near me", {clicks: 20, impressions: 200, cost: 80, conversions: 3}), R("carpet cleaning near me", {clicks: 2, cost: 9})];
      const r = await C.analyze(ACME, rows, {classify: async terms => ({results: Object.fromEntries(terms.map(t => [t, M("Not Relevant", "Home service")])), fallback: 0, failures: []})});
      return {neg: r.priorityNegatives.map(n => [n.text, n.matchType, n.level, n.wasted]), kw: r.allKeywords.map(k => [k.term, k.tier]), cc: r.rows.find(x => x.term.includes("carpet"))._det.by};""")
    assert out["neg"] == [["medicare", "Phrase", "Account", 31], ["summit dental near me", "Exact", "Account", 25], ["carpet cleaning near me", "Exact", "Campaign", 9]]
    assert [k[0] for k in out["kw"]] == ["dentist near me", "acme dental office"]       # three conversions beat two
    assert out["cc"] == "model"


def test_a_place_named_in_a_performance_max_search_is_not_a_location_mismatch():
    out = js("""
      const cases = [["dentist in riverton", "acmegenericspringfield", {campaign: "Acme_Generic_Springfield", campaignType: "SEARCH"}],
                     ["dentist in riverton", "acmepmaxspringfield", {campaign: "Acme_Pmax_Springfield", campaignType: "PERFORMANCE_MAX"}],
                     ["dentist in riverton", "acmepmaxspringfield", {campaign: "Acme_Pmax_Springfield", campaignType: ""}],
                     ["dentist chicago", "acmepmaxspringfield", {campaign: "Acme_Pmax_Springfield", campaignType: "PERFORMANCE_MAX"}]];
      return cases.map(([t, slug, row]) => { const v = ACME.classifyDeterministic(t, slug, row); return v ? v.subtype : null; });""")
    assert out == ["Location Mismatch", "Core dental intent", "Core dental intent", "Out-of-Area Location"]   # a far-away city is still out of area


def test_a_competitor_is_matched_by_the_listed_name_not_by_a_longer_word():
    out = js("""
      return [C.competitorName(STUB, "rival pump"), C.competitorName(STUB, "arrival times"), C.competitorName(STUB, "nothing"), C.competitorName(ACME, "Summit Dental implants cost"),
              C.competitorName(ACME, "pearlescent veneers")];""")
    assert out == ["rival", "", "", "summit dental", ""]


# ── The CSV fallback ────────────────────────────────────────────────────────

def test_the_csv_fallback_reads_what_google_ads_would_say():
    out = js(r"""
      const terms = 'Search terms report\nSep 1 - Sep 30, 2026\nSearch term,Added/Excluded,Campaign,Ad group,Campaign type,Clicks,Impr.,Cost,Conversions\n' +
        'dentist near me,None,Brand,G1,Search,12,100,"€1,234.50",3.5\nroot canal,Added,Brand,G1,Search,2,10,$4.00,0\nTotal: Search terms,,,,,14,110,"€1,238.50",3.5\n';
      const t = C.rowsFromCsv(terms);
      const kw = C.keywordsFromCsv('Keyword,Match type,Campaign,Ad group\n"[root canal]",Exact match,Brand,G1\n');
      const ng = C.negativesFromCsv('Negative keyword,Level,Campaign,Match type\njobs,Campaign,Brand,Phrase match\nfree,Account,,Broad match\n');
      return {rows: t.rows.map(r => [r.term, r.status, r.cost, r.conversions, r.clicks]), kw, ng, bad: C.rowsFromCsv("a,b\n1,2").error};""")
    assert out["rows"][:2] == [["dentist near me", "", 1234.5, 3.5, 12], ["root canal", "ADDED", 4, 0, 2]]
    assert out["kw"] == [{"text": "root canal", "match": "EXACT", "campaign": "Brand", "adGroup": "G1"}]
    assert out["ng"] == [{"text": "jobs", "match": "PHRASE", "level": "campaign", "campaigns": ["Brand"]}, {"text": "free", "match": "BROAD", "level": "account", "campaigns": []}]
    assert out["bad"].startswith("Couldn't find a 'Search term' column")


def test_how_a_negative_blocks_each_match_type():
    out = js("""
      const b = (t, m, x) => C.blocks({text: t, match: m}, x);
      return {
        exact: [b("jobs", "EXACT", "jobs"), b("jobs", "EXACT", "dentist jobs")],
        phrase: [b("dentist jobs", "PHRASE", "nyc dentist jobs now"), b("jobs", "PHRASE", "dentistjobs"), b("job", "PHRASE", "dentist jobs"), b("dentist jobs", "PHRASE", "jobs for a dentist")],
        broad: [b("cheap dentist", "BROAD", "dentist that is cheap"), b("cheap dentist", "BROAD", "cheap hygienist")],
      };""")
    assert out == {"exact": [True, False], "phrase": [True, False, False, False], "broad": [True, False]}


def test_a_negative_of_unknown_match_type_covers_only_that_exact_query_and_a_campaign_one_never_the_account():
    out = js("""
      const unknown = C.buildCover([{text: "dentist jobs", match: "", level: "account", campaigns: []}]);
      const camp = C.buildCover([neg("dentist jobs", "PHRASE", "campaign", ["A"])]);
      return [C.isCovered(unknown, "dentist jobs", "EXACT", "Account", []), C.isCovered(unknown, "nyc dentist jobs", "EXACT", "Account", []),
              C.isCovered(camp, "dentist jobs", "EXACT", "Campaign", ["A"]), C.isCovered(camp, "dentist jobs", "EXACT", "Account", ["A"]), C.isCovered(camp, "dentist jobs", "EXACT", "Campaign", ["A", "B"])];""")
    assert out == [True, False, True, False, False]


def test_a_keyword_goes_where_the_term_converted_not_just_where_it_was_clicked_most():
    out = js("""
      const rows = [R("core x", {adGroup: "G1", clicks: 2, impressions: 20, cost: 10, conversions: 1}), R("core x", {adGroup: "G2", clicks: 9, impressions: 90, cost: 30})];
      const r = await C.analyze(STUB, rows, {});
      return r.allKeywords[0].whereToAdd;""")
    assert out == "C1 / G1"


def test_a_term_nobody_clicked_is_never_sent_to_the_model_however_large_the_limit():
    out = js("""
      const asked = [];
      await C.analyze(STUB, [R("a", {clicks: 2, cost: 3}), R("quiet", {clicks: 0, cost: 0})], {classify: async terms => { asked.push(...terms); return model({})(terms); }});
      return asked;""")
    assert out == ["a"]


def test_client_review_is_ordered_by_money_not_by_how_many_rows():
    out = js("""
      const rs = Object.assign({}, STUB, {classifyDeterministic: t => ({status: "Client Review", subtype: t.startsWith("big") ? "Big" : "Many"})});
      const rows = [R("big 1", {cost: 100}), R("many 1", {cost: 1}), R("many 2", {cost: 1}), R("many 3", {cost: 1})];
      return (await C.analyze(rs, rows, {})).clientReview.map(x => [x.subtype, x.count]);""")
    assert out == [["Big", 1], ["Many", 3]]


def test_a_competitor_the_account_bids_on_is_held_back_and_a_negative_without_waste_is_not_a_priority():
    out = js("""
      const rows = [R("rival pump price", {clicks: 4, cost: 20}), R("rival other", {clicks: 2, cost: 9, campaign: "C2"}), R("jobs board", {clicks: 0, cost: 0, impressions: 50}), R("faraway x", {clicks: 3, cost: 5})];
      const r = await C.analyze(STUB, rows, {keywords: [{text: "Rival Pump", match: "PHRASE", campaign: "C1"}]});
      return {pri: r.priorityNegatives.map(n => n.text), rev: r.reviewNegatives.map(n => [n.text, n.risks]), all: r.allNegatives.map(n => n.text)};""")
    assert out["rev"] == [["rival pump price", ["you bid on this competitor"]], ["rival other", ["you bid on this competitor"]]]   # the keyword names the competitor, so every one of its searches
    assert out["pri"] == ["faraway x"]                                       # "jobs" spent nothing: in the reference list, not a priority
    assert "jobs" in out["all"]


def test_an_account_with_a_competitor_campaign_keeps_its_account_wide_competitor_negatives_for_review():
    out = js("""
      const mk = camp => [R("rival x", {clicks: 4, cost: 20}), R("faraway y", {clicks: 3, cost: 5, campaign: camp})];
      const plain = await C.analyze(STUB, mk("Generic"), {});
      const conq = await C.analyze(STUB, mk("Generic"), {keywords: [{text: "something", campaign: "Competitor Campaign"}]});
      const conq2 = await C.analyze(STUB, [R("rival x", {clicks: 4, cost: 20, campaign: "Conquesting - US"})], {});
      const campaignWide = Object.assign({}, STUB, {classifyDeterministic: t => ({status: "Competitor", subtype: "x", negMatchType: "Exact", negLevel: "Campaign"})});
      const conq3 = await C.analyze(campaignWide, [R("rival z", {clicks: 4, cost: 20})], {keywords: [{text: "something", campaign: "Competitor Campaign"}]});
      return {plain: plain.priorityNegatives.map(n => n.text), conq: conq.reviewNegatives.map(n => [n.text, n.risks]), conqPri: conq.priorityNegatives.map(n => n.text),
              conq2: conq2.reviewNegatives.map(n => n.risks), conq3: conq3.priorityNegatives.map(n => [n.text, n.level])};""")
    assert out["plain"] == ["rival x", "faraway y"]
    assert out["conq"] == [["rival x", ["the account runs a competitor campaign"]]] and out["conqPri"] == ["faraway y"]     # a campaign-level negative is not held
    assert out["conq2"] == [["the account runs a competitor campaign"]]
    assert out["conq3"] == [["rival z", "Campaign"]]


# ── What a rulebook can ask of the negatives ────────────────────────────────

def test_a_rule_names_the_word_that_fired_and_a_partner_product_is_never_a_negative():
    out = js("""
      const rs = {id: "n", label: "N", note: "", forbiddenNegatives: ["pump"], classifyDeterministic(t) {
        if (/^free /.test(t)) return {status: "Not Relevant", subtype: "Freebie", negMatchType: "Phrase", negText: t.split(" ").slice(0, 2).join(" "), negLevel: "Account"};
        if (/partner/.test(t)) return {status: "Not Relevant", subtype: "Partner product only", noNeg: true};
        if (/canada/.test(t)) return {status: "Not Relevant", subtype: "Out of market", negMatchType: "Phrase", negText: "canada", negLevel: "Account"};
        return null; }};
      const rows = [R("free pump trial", {clicks: 3, cost: 12}), R("pump in canada", {clicks: 2, cost: 7}), R("partner sensor price", {clicks: 5, cost: 40}), R("partner sensor 3", {clicks: 4, cost: 30})];
      const r = await C.analyze(rs, rows, {});
      return [r.allNegatives.map(n => [n.text, n.matchType, n.level, n.wasted]), r.rows.filter(x => /partner/.test(x.term)).map(x => x._det.subtype)];""")
    assert out[0] == [["free pump", "Phrase", "Account", 12], ["canada", "Phrase", "Account", 7]]     # a scoped phrase, never the bare word
    assert out[1] == ["Partner product only", "Partner product only"]                                  # spent, and still never a negative


def test_a_forbidden_word_is_never_the_negative_even_when_a_rule_asks_for_it():
    out = js("""
      const rs = Object.assign({}, STUB, {forbiddenNegatives: ["pump"], classifyDeterministic: t => ({status: "Not Relevant", subtype: "x", negMatchType: "Phrase", negText: "pump", negLevel: "Account"})});
      const r = await C.analyze(rs, [R("pump", {clicks: 3, cost: 10}), R("a pump for sale", {clicks: 3, cost: 9})], {});
      return r.allNegatives.map(n => [n.text, n.matchType]);""")
    assert out == [["a pump for sale", "Exact"]]                              # the whole search, as an exact negative; a lone forbidden word gets nothing


def test_brand_searches_in_a_nonbrand_campaign_get_a_routing_negative_and_nothing_else_does():
    out = js("""
      const rs = {id: "route", label: "R", note: "", routeCampaignRe: /non[\\s_-]?brand/i, competitors: ["summit dental"], classifyDeterministic(t) {
        const m = /(^|[^a-z0-9])(acme\\s+dental|acme)(?![a-z0-9])/.exec(t.toLowerCase());
        if (m) return C.has(this, "competitors", t) ? {status: "Relevant", subtype: "Brand: comparison"} : {status: "Relevant", subtype: "Brand", routeNeg: m[2]};
        if (/implant/.test(t)) return {status: "Relevant", subtype: "Core"};
        return null; }};
      const rows = [R("acme implants", {campaign: "Acme_NonBrand_Implants", clicks: 4, cost: 20, conversions: 2}), R("acme implants", {campaign: "Acme_Brand", clicks: 9, cost: 30, conversions: 3}),
                    R("acme vs summit dental", {campaign: "Acme_NonBrand_Implants", clicks: 2, cost: 8}), R("acme implants", {campaign: "Acme_NonBrand_Pmax", campaignType: "PERFORMANCE_MAX", clicks: 2, cost: 5}),
                    R("acme dental", {campaign: "Acme_NonBrand_Kids", clicks: 3, cost: 9}), R("dental implants", {campaign: "Acme_NonBrand_Implants", clicks: 6, cost: 40})];
      const r = await C.analyze(rs, rows, {});
      const again = await C.analyze(rs, rows, {negatives: [{text: "acme", match: "PHRASE", level: "campaign", campaigns: ["Acme_NonBrand_Implants"]}]});
      const bids = await C.analyze(rs, rows, {keywords: [{text: "acme implants", match: "EXACT", campaign: "Acme_NonBrand_Implants"}]});
      return {bids: bids.priorityNegatives.map(n => [n.text, n.risks, n.conflicts]), all: r.allNegatives.map(n => [n.text, n.level, n.campaign, n.matchType, n.risks, n.routing, n.wasted]), pri: r.priorityNegatives.map(n => n.text), again: again.allNegatives.map(n => n.text)};""")
    assert sorted(out["all"]) == [["acme", "Campaign", "Acme_NonBrand_Implants", "Phrase", [], True, 20], ["acme dental", "Campaign", "Acme_NonBrand_Kids", "Phrase", [], True, 9]]
    assert sorted(out["pri"]) == ["acme", "acme dental"]                     # even with conversions: stopping the brand here is the point
    assert out["again"] == ["acme dental"]                                   # already blocked there
    assert sorted(b[0] for b in out["bids"]) == ["acme", "acme dental"] and all(b[1] == [] and b[2] == [] for b in out["bids"])   # a keyword of the same name does not hold it back


# ── Automatic: any account, from its own data ───────────────────────────────

@pytest.mark.parametrize("name,expected", [
    ("AU - Larkspur Products", ["larkspur"]),
    ("Brightwell-Digital-Ads", ["brightwell"]),
    ("Quillfeather - ENG - NAM", ["quillfeather"]),
    ("K&M Precision Machine LLC", ["km precision machine", "kmprecisionmachine", "km precision", "kmprecision"]),
    ("4815162 B.C. LTD. (RX Engine Brake)", ["rx engine brake", "rxenginebrake", "rx engine", "rxengine"]),
    ("Colin Mabery Racing", ["colin mabery racing", "colinmaberyracing", "colin mabery", "colinmabery"]),
    ("Radiant Dental", ["radiant dental", "radiantdental"]),            # "radiant" alone is an ordinary word: not a brand
    ("Willow Health for Women", ["willow health women", "willowhealthwomen", "willow health", "willowhealth"]),
    ("ZQX", []), ("ABC", []), ("", []),
])
def test_an_accounts_brand_words_come_from_its_name(name, expected):
    assert js("return C.brandPhrases(%s);" % json.dumps(name)) == expected


def test_the_automatic_rules_settle_only_the_brand_and_the_exact_keywords():
    out = js("""
      const rs = C.autoRuleset({name: "K&M Precision Machine LLC", keywords: [{text: "cnc machining"}, "Metal Fabrication"]});
      const v = t => { const x = rs.classifyDeterministic(t); return x ? [x.status, x.subtype] : null; };
      return {brand: v("k&m precision machine near me"), brand2: v("km precision"), kw: v("cnc machining"), kw2: v("metal fabrication"), careers: v("km precision careers"),
              generic: v("precision machine shop"), near: v("cnc machining near me"), label: rs.label, id: rs.id, shared: C.RULESETS.generic.classifyDeterministic("x")};""")
    assert out["brand"] == ["Relevant", "Brand"] and out["brand2"] == ["Relevant", "Brand"]
    assert out["kw"] == ["Relevant", "A keyword the account bids on"] and out["kw2"] == ["Relevant", "A keyword the account bids on"]
    assert out["careers"] is None and out["generic"] is None and out["near"] is None      # the model reads these
    assert out["label"] == "Automatic" and out["id"] == "generic" and out["shared"] is None


def test_automatic_asks_the_model_about_everything_the_brand_and_keywords_did_not_settle():
    out = js("""
      const rs = C.autoRuleset({name: "Acme Widgets Inc", keywords: ["blue widgets"]});
      const rows = [R("acme widgets reviews", {clicks: 3, cost: 9}), R("blue widgets", {clicks: 2, cost: 4}), R("widget jobs", {clicks: 4, cost: 12}), R("red gadgets", {clicks: 1, cost: 2})];
      const asked = [];
      const r = await C.analyze(rs, rows, {keywords: [{text: "blue widgets"}], classify: async terms => { asked.push(terms); return model({"widget jobs": M("Not Relevant", "Jobs"), "red gadgets": M("Not Relevant", "Other product")})(terms); }});
      return {asked: asked[0], by: r.rows.map(x => [x.term, x._det.by, x._det.status]), neg: r.allNegatives.map(n => n.text)};""")
    assert sorted(out["asked"]) == ["red gadgets", "widget jobs"]
    assert out["by"] == [["acme widgets reviews", "rule", "Relevant"], ["blue widgets", "rule", "Relevant"], ["widget jobs", "model", "Not Relevant"], ["red gadgets", "model", "Not Relevant"]]
    assert out["neg"] == ["widget jobs", "red gadgets"]


def test_the_only_shipped_ruleset_is_automatic_and_it_has_a_label_and_a_note():
    out = js("return Object.values(C.RULESETS).map(r => [r.id, !!r.label, r.note.length > 80, typeof r.classifyDeterministic]);")
    assert out == [["generic", True, True, "function"]]


def test_the_page_and_the_model_step_know_the_same_rulesets():
    from tracker import paid_sqr
    assert js("return Object.keys(C.RULESETS);") == list(paid_sqr.RULESETS)


def test_the_hint_patterns_are_whole_words_and_leave_affordable_and_offer_alone():
    out = js("""
      const h = C.hint(...Object.values(C.HINTS));
      return ["dentist jobs", "dental school", "home remedy for tooth pain", "cheap braces", "what is a crown", "dog teeth cleaning", "buy floss", "volunteer dental",
              "affordable dentist", "dentists that offer payment plans", "jobsite", "freedom dental"].map(t => h.test(t));""")
    assert out == [True, True, True, True, True, True, True, True, False, False, False, False]


# ── The account's own brand, as it says it itself ───────────────────────────

def test_a_keyword_of_a_brand_campaign_makes_its_searches_brand_searches():
    out = js("""
      const kw = [{text: "acme widgets", campaign: "Acme_Brand_E"}, {text: "acme", campaign: "Acme_Brand_P"}, {text: "blue widgets", campaign: "Acme_NonBrand_Widgets"},
                  {text: "rival widgets", campaign: "Acme_Competitor_Brand"}, {text: "bid on me", campaign: "Acme_NonBrand_X"}];
      const rows = ["acme widgets near me", "acme", "acme near me", "acme widgets careers", "acme widgets partners", "blue widgets near me", "rival widgets near me", "bid on me", "acme widgets reviews"].map(t => R(t, {clicks: 1, cost: 2}));
      const r = await C.analyze({id: "t", label: "T", note: "", classifyDeterministic: () => null}, rows, {keywords: kw, classify: model({})});
      return r.rows.map(x => [x.term, x._det.status, x._det.by, x._det.subtype]);""")
    by = {t: (s, b, sub) for t, s, b, sub in out}
    assert by["acme widgets near me"] == ("Relevant", "rule", "Brand (a keyword of the account's Brand campaign)")
    assert by["acme"] == ("Relevant", "rule", "A keyword the account bids on")              # a one-word brand keyword is trusted only as the whole search
    assert by["acme near me"][1] == "model"
    assert by["acme widgets careers"][1] == "model" and by["acme widgets partners"][1] == "model" and by["acme widgets reviews"][1] == "model"
    assert by["blue widgets near me"][1] == "model" and by["rival widgets near me"][1] == "model"      # a non-brand or competitor campaign's keyword is not the brand
    assert by["bid on me"] == ("Relevant", "rule", "A keyword the account bids on")


def test_a_rule_still_beats_the_brand_keywords_and_the_account_name_counts_when_it_is_more_than_one_word():
    out = js("""
      const rs = {id: "t", label: "T", note: "", classifyDeterministic: t => /jobs/.test(t) ? {status: "Not Relevant", subtype: "Jobs"} : null};
      const kw = [{text: "maple grove dental", campaign: "Springfield_Brand"}];
      const rows = ["maple grove dental jobs", "maple grove springfield", "maple grove partners", "summit dental"].map(t => R(t, {clicks: 1, cost: 2}));
      const named = await C.analyze(rs, rows, {keywords: kw, accountName: "Maple Grove Dental", classify: model({})});
      const single = await C.analyze(rs, [R("summit dental", {clicks: 1, cost: 2}), R("summit imaging", {clicks: 1, cost: 2})], {accountName: "Summit", classify: model({})});
      return {named: named.rows.map(x => [x.term, x._det.status, x._det.by, x._det.subtype]), single: single.rows.map(x => [x.term, x._det.by])};""")
    by = {t: (s, b, sub) for t, s, b, sub in out["named"]}
    assert by["maple grove dental jobs"][0] == "Not Relevant" and by["maple grove dental jobs"][2] == "Jobs"
    assert by["maple grove springfield"] == ("Relevant", "rule", "Brand (the account's name)")
    assert by["maple grove partners"][1] == "model" and by["summit dental"][1] == "model"      # a firm, and another business
    assert out["single"] == [["summit dental", "model"], ["summit imaging", "model"]]          # "Summit" is also other businesses' name


def test_keywords_are_ranked_by_tier_then_conversions_then_click_rate_as_the_written_logic_says():
    out = js("""
      const rows = [R("a many clicks", {clicks: 40, impressions: 400, cost: 20, conversions: 2}), R("b high rate", {clicks: 9, impressions: 20, cost: 9, conversions: 2}),
                    R("c one conversion", {clicks: 2, impressions: 100, cost: 3, conversions: 1}), R("d tier two", {clicks: 30, impressions: 300, cost: 10}), R("e tier two better rate", {clicks: 5, impressions: 20, cost: 4})];
      const r = await C.analyze({id: "t", label: "T", note: "", classifyDeterministic: () => ({status: "Relevant", subtype: "x"})}, rows, {});
      return r.allKeywords.map(k => [k.term, k.tier]);""")
    assert out == [["b high rate", 1], ["a many clicks", 1], ["c one conversion", 1], ["e tier two better rate", 2], ["d tier two", 2]]


def test_a_search_a_rulebook_would_send_to_the_model_stays_with_the_model_even_with_a_brand_keyword_in_it():
    out = js("""
      const rs = {id: "t", label: "T", note: "", modelHint: /\\bcheap\\b/i, classifyDeterministic: () => null};
      const kw = [{text: "acme widgets", campaign: "Acme_Brand_E"}];
      const r = await C.analyze(rs, [R("acme widgets cheap", {clicks: 1, cost: 2}), R("acme widgets store", {clicks: 1, cost: 2})], {keywords: kw, classify: model({})});
      return r.rows.map(x => [x.term, x._det.by]);""")
    assert out == [["acme widgets cheap", "model"], ["acme widgets store", "rule"]]


def test_terms_a_failed_model_batch_never_judged_are_not_counted_as_wasted_spend():
    out = js("""
      const rows = [R("brand core", {clicks: 10, cost: 100, conversions: 5}), R("faraway town", {clicks: 4, cost: 40}), R("mystery one", {clicks: 30, cost: 300}),
                    R("mystery two", {clicks: 20, cost: 200})];
      const classify = async (terms) => { const o = {}; terms.forEach(t => { o[t] = {status: "Not Relevant", subtype: "No Clear Intent", by: "fallback"}; });
                                          return {results: o, fallback: terms.length, failures: ["classify answered 502"]}; };
      const r = await C.analyze(STUB, rows, {classify, status: () => {}});
      return {s: r.summary};""")
    s = out["s"]
    assert s["fallback"] == 2 and s["notJudgedSpend"] == 500
    assert s["wastedSpend"] == 40                                   # only the term a rule judged ("faraway") is waste


# ── Reading the CSVs, line by line ──────────────────────────────────────────

def _csv(text):
    return js("return C.rowsFromCsv(%s);" % json.dumps(text))


HEADER = "Search term,Campaign,Ad group,Campaign type,Clicks,Impr.,Cost,Conversions"


def test_csv_title_and_date_lines_above_the_header_are_skipped_and_total_rows_dropped():
    r = _csv("Search terms report\nOctober 1, 2026 - October 15, 2026\n" + HEADER + '\ndentist near me,C1,A1,Search,5,50,12.50,1\n"Total: Search terms",,,,5,50,12.50,1\nTotal: Account,,,,5,50,12.50,1\n')
    assert [x["term"] for x in r["rows"]] == ["dentist near me", "Total: Search terms", "Total: Account"]      # dropped later, by prepareRows (the next test)
    assert r["rows"][0]["clicks"] == 5 and r["rows"][0]["impressions"] == 50 and r["rows"][0]["cost"] == 12.5 and r["rows"][0]["conversions"] == 1


def test_csv_delimiters_bom_null_bytes_and_alternate_column_names():
    base = ["dentist near me", "C1", "A1", "Search", "5", "50", "12.50", "1"]
    for delim in [",", ";", "\t"]:
        hdr = delim.join(["Search term", "Campaign", "Ad group", "Campaign type", "Clicks", "Impressions", "Cost", "Conv."])
        r = _csv("﻿" + hdr + "\n" + delim.join(base) + "\n")
        assert r.get("rows") and r["rows"][0]["term"] == "dentist near me" and r["rows"][0]["impressions"] == 50 and r["rows"][0]["conversions"] == 1, delim
    # a UTF-16 export read as UTF-8 puts a null byte between every character
    nul = "\u0000".join(HEADER + "\n" + ",".join(base) + "\n")
    r = _csv(nul)
    assert r.get("rows") and r["rows"][0]["term"] == "dentist near me"
    # zero-width characters inside a cell
    r = _csv(HEADER + "\ndent​ist near me,C1,A1,Search,5,50,12.50,1\n")
    assert r["rows"][0]["term"] == "dentist near me"
    # a quoted field with a comma, and an error that says what it did see when there is no header
    r = _csv(HEADER + '\n"dentist, near me",C1,A1,Search,5,50,12.50,1\n')
    assert r["rows"][0]["term"] == "dentist, near me"
    r = _csv("nothing,useful\n1,2\n")
    assert r["rows"] == [] and "Search term" in r["error"] and "nothing" in r["error"]


def test_google_subtotal_rows_and_empty_terms_never_reach_the_analysis():
    out = js("return C.prepareRows([{term: 'dentist', clicks: 1}, {term: 'Total: Account'}, {term: 'total: search terms'}, {term: '  '}, {term: 'Other search terms'}, {term: '--'}, {term: 'tooth'}]).map(r => r.term);")
    assert out == ["dentist", "tooth"]
