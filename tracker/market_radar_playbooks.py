"""Market Radar: what to watch for each kind of business.

One table answers, for every business type the profile can name: how to recognise it, what its rivals
do that matters, how its rivals are found, which specialist readers run for it, and which scans look
around it. The profile's prompt, the rival search, the collection and the radar all read this table, so a
new kind of business is added in one place (and tests/test_market_radar_playbooks.py checks every other
place agrees).

Fields:
    label       the name shown on the page
    describe    how the profile prompt tells the model to recognise it
    watch       what a rival's moves look like for this kind of business (shown on the page, and given
                to the move-reading model so that, for a law firm, a partner joining is a real move)
    rivals      how its competitors are found (given to the rival search)
    specialists the optional readers that run for it: subdomains, headcount, linkedin
    awards      awards, rankings and accreditations are moves for this kind of business
    entrants    a scan for new rivals entering the category (launch news, funding news) runs for it
    domains     ...and so does the list of shop domains registered yesterday (physical products only)
    local       its rivals are the businesses near its sites (the map scan)
"""
from __future__ import annotations

GATED = ("subdomains", "headcount", "linkedin", "apps", "buzz", "facts")

PLAYBOOKS = {
    "local_single": {
        "label": "Local business, one site",
        "describe": "one physical location (or a few in one town) serving people nearby, e.g. a dental "
                    "practice, a restaurant, a gym.",
        "watch": ["Openings and closures nearby", "Prices, offers and new services", "Review counts and ratings",
                  "Opening hours and staff hires"],
        "rivals": "Rivals are the same kind of business within a few kilometres: search by neighbourhood and "
                  "category, and weigh distance.",
        "specialists": (), "awards": False, "entrants": False, "domains": False, "local": True,
    },
    "multi_location": {
        "label": "Several locations or a chain",
        "describe": "physical locations in more than one town: a practice with clinics in two or three towns, "
                    "or a chain or franchise with many.",
        "watch": ["New and closed locations", "Prices and offers", "Hiring in new places", "Expansion into new regions"],
        "rivals": "For a few sites, rivals are the businesses near each site; for a large chain, other chains in "
                  "its country.",
        "specialists": (), "awards": False, "entrants": False, "domains": False, "local": True,
    },
    "ecommerce": {
        "label": "Online shop",
        "describe": "sells its own products online to consumers as its main channel (it may also have stores or "
                    "stockists).",
        "watch": ["New products and collections", "Price changes and sales", "New countries and stockists",
                  "Collaborations and campaigns", "New brands entering the category"],
        "rivals": "Search by product category and by 'brands like / alternatives to' the brand, in each market it "
                  "sells to.",
        "specialists": ("subdomains", "apps", "buzz", "facts"), "awards": False, "entrants": True, "domains": True, "local": False,
    },
    "b2b_services": {
        "label": "Business services",
        "describe": "sells services to businesses (agency, consultancy, IT services).",
        "watch": ["New services and industries served", "Leadership and senior hires", "Offices and acquisitions",
                  "Case studies and big client wins", "Hiring"],
        "rivals": "Search by the service and the industry served ('best X agencies for Y'), and by 'alternatives "
                  "to' the company.",
        "specialists": GATED[:3] + ("buzz", "facts"), "awards": True, "entrants": False, "domains": False, "local": False,
    },
    "b2b_product": {
        "label": "Business software or products",
        "describe": "sells software or products to businesses.",
        "watch": ["Product launches and new features", "Pricing and packaging changes", "Funding and acquisitions",
                  "New integrations and partners", "Hiring and new offices"],
        "rivals": "Search by the problem it solves and by 'alternatives to / vs' the product; software review "
                  "sites list rivals.",
        "specialists": GATED, "awards": False, "entrants": True, "domains": False, "local": False,
    },
    "manufacturer": {
        "label": "Manufacturer",
        "describe": "makes physical goods, mostly sold through others.",
        "watch": ["New products and plants", "Acquisitions and partnerships", "Recalls and regulator actions",
                  "Results and guidance", "Hiring"],
        "rivals": "Search by the product category, and for the industry's leading makers by market.",
        "specialists": ("headcount", "linkedin", "facts"), "awards": False, "entrants": False, "domains": False, "local": False,
    },
    "marketplace": {
        "label": "Marketplace or platform",
        "describe": "connects buyers and sellers, hosts or books others' goods, services or listings, and earns "
                    "from fees or commission (e.g. an online marketplace, a booking platform, a gig platform, "
                    "an app store).",
        "watch": ["New categories and verticals", "Fee and policy changes for sellers", "New countries",
                  "Partnerships and acquisitions", "Trust, safety and regulatory actions", "Seller and buyer growth"],
        "rivals": "Rivals are marketplaces serving the same side of the market or the same category, and "
                  "specialist platforms taking a niche; search 'alternatives to X' and 'best platforms for Y'.",
        "specialists": GATED, "awards": False, "entrants": True, "domains": False, "local": False,
    },
    "professional_services": {
        "label": "Professional services (law, accounting, consulting)",
        "describe": "a firm of professionals selling expertise to clients: a law firm, accountancy, consultancy, "
                    "architecture, engineering, recruitment or advisory practice.",
        "watch": ["Partners and senior people joining or leaving", "New offices and mergers",
                  "New practice areas and industries", "Big mandates and client wins", "Rankings and awards",
                  "Thought leadership and reports"],
        "rivals": "Rivals are firms in the same specialism and city or region, and the larger firms measured "
                  "against; search 'top X firms in Y' and ranking lists.",
        "specialists": ("headcount", "linkedin", "facts"), "awards": True, "entrants": False, "domains": False, "local": False,
    },
    "hospitality_travel": {
        "label": "Hotels, travel and airlines",
        "describe": "hotels and resorts groups, airlines, cruise lines, tour operators and travel brands.",
        "watch": ["New properties, routes and destinations", "Rates, packages and loyalty changes",
                  "Renovations and rebrands", "Awards and ratings", "Partnerships", "Results and guidance"],
        "rivals": "Rivals are the brands competing for the same guests, route or destination; search by "
                  "destination and category ('best luxury hotels in Y', 'airlines flying X to Y').",
        "specialists": ("apps", "facts"), "awards": True, "entrants": False, "domains": False, "local": False,
    },
    "education": {
        "label": "Education and training",
        "describe": "a school, university, college, online course provider, bootcamp or training company.",
        "watch": ["New programmes and courses", "Fees and scholarships", "Accreditation and rankings",
                  "New campuses and partnerships", "Leadership changes", "Enrolment news"],
        "rivals": "Rivals are institutions offering the same programmes to the same students; search by "
                  "programme and region ('best X courses in Y').",
        "specialists": ("linkedin", "apps", "buzz", "facts"), "awards": True, "entrants": True, "domains": False, "local": False,
    },
    "health_system": {
        "label": "Hospital or health system",
        "describe": "a hospital, hospital group, large clinic network, health insurer or health-services company "
                    "with many sites and services.",
        "watch": ["New facilities and service lines", "Doctor and executive hires", "Mergers and affiliations",
                  "Prices and insurance changes", "Ratings and accreditation", "Regulatory actions"],
        "rivals": "Rivals are the other systems and hospitals serving the same region and specialties; search "
                  "'top hospitals for X in Y'.",
        "specialists": ("apps", "facts"), "awards": True, "entrants": False, "domains": False, "local": False,
    },
    "real_estate": {
        "label": "Real estate",
        "describe": "an estate agency, property developer, property portal or property-management company.",
        "watch": ["New developments and listings", "New markets and offices", "Agent hiring and team moves",
                  "Mergers and fee changes", "Market reports"],
        "rivals": "Rivals are agencies and developers working the same area and price band; search by area "
                  "and property type.",
        "specialists": ("linkedin", "facts"), "awards": True, "entrants": False, "domains": False, "local": False,
    },
    "financial_services": {
        "label": "Banking, insurance and fintech",
        "describe": "a bank, insurer, lender, wealth or asset manager, payments or fintech company.",
        "watch": ["New products, rates and fees", "Licences and regulatory actions", "Funding and acquisitions",
                  "Partnerships and integrations", "New countries", "Leadership changes"],
        "rivals": "Rivals are providers of the same product in the same markets; search 'best X providers in Y' "
                  "and 'alternatives to'.",
        "specialists": GATED, "awards": False, "entrants": True, "domains": False, "local": False,
    },
    "nonprofit": {
        "label": "Nonprofit or association",
        "describe": "a charity, NGO, foundation, association, public body or other organisation that does not "
                    "sell for profit.",
        "watch": ["Campaigns and appeals", "Funding and grants", "Leadership changes", "New programmes",
                  "Partnerships", "Reports and rankings"],
        "rivals": "Rivals are organisations competing for the same donors, members or cause; search by cause "
                  "and region.",
        "specialists": ("linkedin", "facts"), "awards": True, "entrants": False, "domains": False, "local": False,
    },
    "personal_brand": {
        "label": "Creator, consultant or personal brand",
        "describe": "a business built around one person: a creator, coach, author, speaker, freelancer or "
                    "solo consultant.",
        "watch": ["New content, books and courses", "Speaking and media appearances", "Products and prices",
                  "Partnerships and sponsors", "Audience growth"],
        "rivals": "Rivals are other people who teach, advise or entertain the same audience; search by topic, "
                  "format and platform.",
        "specialists": ("buzz",), "awards": True, "entrants": True, "domains": False, "local": False,
    },
    "other": {
        "label": "Other",
        "describe": "none of these fits; say why in archetype_reason.",
        "watch": ["News", "Pricing and products", "Hiring", "New places"],
        "rivals": "Search by what it sells and to whom, and by 'alternatives to'.",
        "specialists": (), "awards": False, "entrants": False, "domains": False, "local": False,
    },
}
ARCHETYPES = tuple(PLAYBOOKS)
LABELS = {k: v["label"] for k, v in PLAYBOOKS.items()}


def get(archetype):
    return PLAYBOOKS.get(archetype) or PLAYBOOKS["other"]


def specialist(name, archetype):
    """May the optional reader `name` (subdomains, headcount, linkedin) run for this kind of business?"""
    return name not in GATED or name in get(archetype)["specialists"] and archetype in PLAYBOOKS


def entrant_types():
    return {k for k, v in PLAYBOOKS.items() if v["entrants"]}


def prompt_lines():
    """The profile prompt's list of business types, one per line."""
    return "\n".join("- %s: %s" % (k, v["describe"]) for k, v in PLAYBOOKS.items())


def sector_note(archetype):
    """What the move-reading model is told about this kind of business ('' when nothing special)."""
    pb = get(archetype)
    if archetype not in PLAYBOOKS or archetype == "other":
        return ""
    lines = ["The client is a %s. Moves that matter for it: %s." % (pb["label"].lower(), "; ".join(pb["watch"]).lower())]
    if pb["awards"]:
        lines.append("For this kind of business an award, ranking or accreditation IS a move: report it as "
                     "award_ranking or licence_accreditation, not as left out.")
    return " ".join(lines)
