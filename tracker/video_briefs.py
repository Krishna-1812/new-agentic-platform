"""Video Studio: the 15 test briefs (Phase 2's finish line).

Each brief is one kind of request, with the sources a person would give. The
set covers all 12 starting points (Launch, Promotion and Custom twice), every kind of source
(website only, uploads only, script only, numbers only, brief only, and
mixes), and two sites that blocked robots when this was written (g2.com
answers 'forbidden', indeed.com shows a security check), where the plan must go on
without the site and say so.

The staff page /strategic-agents/video-studio/plans runs all 15 on the live
worker with the real Claude, and shows each plan with its checks. Tests run
them against a stand-in Claude (tests/test_video_plan.py).

The companies, people and figures here are made up for testing. Pictures are
drawn by code (no files or licences): app screens, a speaker, a team, logos.
"""

from __future__ import annotations

import io

PLAN_TEST_KIND = "plan_test"


# ── Pictures, drawn ──────────────────────────────────────────────────────────
def _png(im):
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def app_screen(title, accent=(47, 91, 234), variant=0):
    """A made-up dashboard screen, 1440x900."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1440, 900), (246, 247, 250))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 240, 900], fill=(22, 27, 45))
    for i in range(6):
        d.rounded_rectangle([28, 120 + i * 56, 212, 152 + i * 56], 8,
                            fill=accent if i == variant % 6 else (40, 46, 68))
    d.text((300, 48), title, fill=(22, 27, 45))
    for i in range(3):
        x = 300 + i * 370
        d.rounded_rectangle([x, 110, x + 340, 250], 16, fill=(255, 255, 255), outline=(225, 228, 236))
        d.rectangle([x + 24, 140, x + 24 + 90 + 40 * ((i + variant) % 3), 156], fill=(200, 205, 218))
        d.rectangle([x + 24, 186, x + 24 + 150, 220], fill=accent if i == 0 else (60, 66, 90))
    d.rounded_rectangle([300, 290, 1380, 840], 16, fill=(255, 255, 255), outline=(225, 228, 236))
    vals = [3, 5, 4, 7, 6, 9, 8, 11][variant % 3:] + [12, 10, 13]
    for i, v in enumerate(vals[:9]):
        x = 360 + i * 112
        d.rounded_rectangle([x, 780 - v * 38, x + 64, 780], 8, fill=accent if i == len(vals[:9]) - 1 else (190, 198, 222))
    return _png(im)


def person(colour=(201, 137, 43), bg=(232, 226, 214)):
    """A plain portrait silhouette, 800x800."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (800, 800), bg)
    d = ImageDraw.Draw(im)
    d.ellipse([280, 150, 520, 390], fill=colour)
    d.rounded_rectangle([170, 420, 630, 820], 200, fill=colour)
    return _png(im)


def team():
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1600, 1000), (226, 233, 228))
    d = ImageDraw.Draw(im)
    cols = [(24, 58, 44), (201, 137, 43), (60, 90, 160), (150, 70, 80), (90, 120, 90)]
    for i, c in enumerate(cols):
        x = 140 + i * 280
        d.ellipse([x + 40, 300, x + 200, 460], fill=c)
        d.rounded_rectangle([x, 480, x + 240, 900], 110, fill=c)
    return _png(im)


def text_logo(word, fg=(22, 27, 45), bg=(255, 255, 255)):
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (520, 160), bg)
    d = ImageDraw.Draw(im)
    d.ellipse([20, 40, 100, 120], fill=fg)
    d.text((124, 64), word.upper(), fill=fg)
    return _png(im)


# ── The briefs ───────────────────────────────────────────────────────────────
# Each: key, label, the request (new_project's arguments), and what the
# checks look for beyond the rules: "must_note" (a word the notes must hold,
# for blocked sites) and "exact" (the script must appear word for word).
HOWTO_SCRIPT = ("Three ways to cut your cloud bill this month. One: switch off test servers every night. "
                "Two: move old files to cold storage. Three: buy reserved capacity for steady workloads. "
                "Start with one this week.")
COUNTDOWN_SCRIPT = "Doors open in ten seconds. Grab a coffee. Find a seat. The keynote starts now."

LEADS_CSV = """Month,Leads,Cost per lead (USD)
Jan,120,48
Feb,164,44
Mar,151,45
Apr,208,39
May,247,35
Jun,290,31
"""

RECAP_CSV = """Metric,Q2,Q3
Website visits,41200,58900
Demo requests,310,452
New customers,22,31
"""

CASE_CSV = """Measure,Before,After
Month-end close (days),12,5
Manual journal entries,840,190
"""


def briefs():
    return [
        {"key": "site_launch", "label": "Launch, website only (python.org)", "request": {
            "brief": "A 20-second launch-style video announcing the Python website's downloads and docs to new "
                     "developers, ending on where to download it.",
            "kind": "launch", "website": "https://www.python.org/"}},
        {"key": "site_explainer", "label": "Explainer, website only (djangoproject.com)", "request": {
            "brief": "A calm 35-second explainer of what Django is and why teams use it, for non-technical managers.",
            "kind": "explainer", "website": "https://www.djangoproject.com/", "style": "Calm"}},
        {"key": "uploads_demo", "label": "Product demo, uploads only", "request": {
            "brief": "A 30-second product demo of Brightdesk, our support inbox: the shared inbox, the reports "
                     "screen and the automations screen. End on 'Start a free trial at brightdesk.example'.",
            "kind": "demo", "client": "Brightdesk",
            "images": [("Inbox screen", app_screen("Shared inbox", variant=0)),
                       ("Reports screen", app_screen("Reports", variant=1)),
                       ("Automations screen", app_screen("Automations", variant=2))]}},
        {"key": "brief_feature", "label": "Feature highlight, brief only", "request": {
            "brief": "A 15-second square video for our new Export to PDF button in Ledgerly invoices: one click "
                     "turns any invoice into a PDF your client can open anywhere.",
            "kind": "feature"}},
        {"key": "brief_promo", "label": "Promotion / ad, brief only with an offer", "request": {
            "brief": "A vertical ad for the Diwali sale at Northwind Analytics: 20% off all annual plans until "
                     "5 November. Bold and quick. End on 'Claim the offer'.",
            "kind": "promo", "style": "Bold"}},
        {"key": "numbers_results", "label": "Results / numbers, numbers only", "request": {
            "brief": "Show six months of lead results for our paid search programme: leads rising and cost per "
                     "lead falling. Square, 25 seconds, for LinkedIn.",
            "kind": "results", "tables": [("Leads by month", LEADS_CSV)]}},
        {"key": "script_howto", "label": "How-to / tips, script only (exact)", "request": {
            "brief": "A vertical tips video from our script, for Instagram.",
            "kind": "howto", "words": "exact", "script": HOWTO_SCRIPT, "seconds": 24}},
        {"key": "mix_event", "label": "Event / webinar, text and a photo", "request": {
            "brief": "A 15-second square promo for our webinar, with the speaker and how to sign up.",
            "kind": "event",
            "texts": [("Webinar details", "Webinar: Budgeting for AI in 2027. Thursday 12 November 2026, "
                                          "4 pm IST, online on Zoom. Speaker: Priya Raman, CFO of Ledgerly. "
                                          "Sign up at ledgerly.example/webinar. Free, 45 minutes, with Q&A.")],
            "images": [("Priya Raman", person())]}},
        {"key": "mix_hiring", "label": "Hiring, text and a team photo", "request": {
            "brief": "A vertical hiring video for our Senior Designer role, playful but clear.",
            "kind": "hiring",
            "texts": [("Job post", "Senior Product Designer at Brightdesk. Remote within India. You will own the "
                                   "design of our reports and automations, work with 4 engineers and our head of "
                                   "product, and talk to customers every week. Apply at brightdesk.example/jobs "
                                   "by 30 November.")],
            "images": [("The design team", team())]}},
        {"key": "mix_testimonial", "label": "Testimonial / case study, text and numbers", "request": {
            "brief": "A 30-second case study: how Kestrel Foods closed its books faster with Ledgerly. Use the "
                     "client's own words.",
            "kind": "testimonial",
            "texts": [("Client email", "From Anita Shah, Finance Director, Kestrel Foods: \"We used to dread "
                                       "month-end. With Ledgerly our close went from twelve days to five, and my "
                                       "team finally gets weekends back.\"")],
            "tables": [("Before and after", CASE_CSV)]}},
        {"key": "mix_recap", "label": "Recap / update, numbers and notes", "request": {
            "brief": "A 30-second quarterly recap for our board: Q3 against Q2, and what we focus on next.",
            "kind": "recap", "tables": [("Q2 and Q3", RECAP_CSV)],
            "texts": [("Next quarter", "Next quarter we focus on two things: launching the partner programme "
                                       "and opening the Bengaluru office.")]}},
        {"key": "script_custom", "label": "Custom, script only (exact)", "request": {
            "brief": "A 10-second countdown card to play on the screens before our keynote. Landscape.",
            "kind": "custom", "shape": "landscape", "seconds": 10, "words": "exact", "script": COUNTDOWN_SCRIPT}},
        {"key": "mix_custom", "label": "Custom, website, logo and notes", "request": {
            "brief": "A 20-second portrait video for a conference booth loop: who the Python Software Foundation is "
                     "and how to get involved.",
            "kind": "custom", "shape": "portrait", "seconds": 20, "website": "https://www.python.org/psf-landing/",
            "texts": [("Booth notes", "Booth 14. Ask us about membership and grants.")],
            "logo": ("Our logo", text_logo("PSF booth"))}},
        {"key": "blocked_one", "label": "Launch, a site that blocks robots (g2.com)", "must_note": "robot",
         "request": {"brief": "A 20-second launch video for our new listing on G2, ending on 'Read our reviews'.",
                     "kind": "launch", "website": "https://www.g2.com/"}},
        {"key": "blocked_two", "label": "Promotion, a site that blocks robots (indeed.com)", "must_note": "robot",
         "request": {"brief": "A 15-second vertical ad inviting employers to post their first job free, ending on "
                              "'Post a job'.",
                     "kind": "promo", "website": "https://www.indeed.com/"}},
    ]


def run_all(email):
    """Queue all 15 briefs as plan-test projects. Returns their version ids."""
    from tracker import video_web
    out = []
    for b in briefs():
        req = dict(b["request"])
        pid, vid = video_web.new_project(email, title=b["label"], project_kind=PLAN_TEST_KIND, **req)
        out.append(vid)
    return out
