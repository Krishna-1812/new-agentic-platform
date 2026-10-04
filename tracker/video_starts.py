"""Video Studio: starting points and choices (plan section 2.1).

The person defines the video. A starting point only pre-fills suggestions
(a scene outline, a shape, a length and a style), and every one of them can
be changed; Custom, the default, suggests nothing beyond a sensible shape.

choices() checks what the person chose and fills in the rest from the
starting point, so the plan call always gets a complete set.
"""

from __future__ import annotations

from tracker import video_config as cfg

STYLES = ("Polished", "Calm", "Bold", "Playful", "Cinematic", "Minimal", "Corporate")
WORDS_MODES = ("write", "exact")
MAX_STYLE = 160
MAX_BRIEF = 3000

# key: (label, typical use, shape, seconds, style, outline)
STARTS = {
    "launch": ("Launch / announcement", "A new product, site, feature or office", "landscape", 20, "Polished",
               ["A hook that names what is new", "What it is, in one line", "Two or three highlights",
                "Where to see it, and when"]),
    "explainer": ("Explainer", "What a service is and how it works", "landscape", 40, "Calm",
                  ["The problem, as the viewer feels it", "What the service is", "How it works, in steps",
                   "The result for the viewer", "How to start"]),
    "demo": ("Product demo", "Walk through a product's key screens", "landscape", 30, "Polished",
             ["The job the product does", "The key screens, one at a time", "The moment it pays off",
              "How to try it"]),
    "feature": ("Feature highlight", "One feature, one benefit", "square", 15, "Bold",
                ["The feature, named", "It working", "The benefit", "Where to find it"]),
    "promo": ("Promotion / ad", "An offer, a sale, a call to action", "vertical", 15, "Bold",
              ["The offer in the first seconds", "What you get", "The deadline or the catch", "The action"]),
    "results": ("Results / numbers", "Figures, charts, a report's highlights", "square", 25, "Corporate",
                ["The headline number", "The trend, as a chart", "What drove it", "What comes next"]),
    "howto": ("How-to / tips", "Steps or a short list of tips", "vertical", 30, "Playful",
              ["What you will be able to do", "Step or tip 1", "Step or tip 2", "Step or tip 3", "Recap"]),
    "event": ("Event / webinar", "Date, speakers, sign-up", "square", 15, "Polished",
              ["What the event is", "When and where", "Who is speaking", "How to sign up"]),
    "hiring": ("Hiring", "A role, the team, how to apply", "vertical", 20, "Playful",
               ["The role", "Why this team", "What you will do", "How to apply"]),
    "testimonial": ("Testimonial / case study", "A client quote, the problem and the result", "landscape", 30,
                    "Calm", ["Who the client is", "The problem they had", "What changed",
                             "The result, with a number", "Their words"]),
    "recap": ("Recap / update", "A month, a project, a campaign in review", "landscape", 30, "Corporate",
              ["What period this covers", "The highlights", "The numbers", "What is next"]),
    "custom": ("Custom", "Anything else, defined by the brief", "landscape", 20, "", []),
}
DEFAULT = "custom"


class Bad(ValueError):
    def __init__(self, message, field=None):
        super().__init__(message)
        self.field = field


def starting_points():
    """For the page: every starting point with its suggestions."""
    return [{"key": k, "label": v[0], "use": v[1], "shape": v[2], "seconds": v[3], "style": v[4], "outline": v[5]}
            for k, v in STARTS.items()]


def choices(kind=None, *, shape=None, seconds=None, style=None, words="write", script=""):
    """A complete, checked set of choices: {"kind", "shape", "seconds", "style", "words", "script"}."""
    kind = kind or DEFAULT
    if kind not in STARTS:
        raise Bad("Pick a starting point from the list, or Custom.", "kind")
    _, _, s_shape, s_seconds, s_style, _ = STARTS[kind]
    shape = shape or s_shape
    if shape not in cfg.SHAPES:
        raise Bad("Pick a shape: %s." % ", ".join(cfg.SHAPE_LABELS.values()), "shape")
    try:
        seconds = float(seconds if seconds not in (None, "") else s_seconds)
    except (TypeError, ValueError):
        raise Bad("The length must be a number of seconds.", "seconds")
    if not (cfg.MIN_SECONDS <= seconds <= cfg.MAX_SECONDS):
        raise Bad("The length must be %d to %d seconds." % (cfg.MIN_SECONDS, cfg.MAX_SECONDS), "seconds")
    style = " ".join(str(style or s_style or "").split())[:MAX_STYLE]
    if words not in WORDS_MODES:
        raise Bad("Choose whether to write the words or use your script.", "words")
    script = str(script or "").strip()
    if words == "exact" and not script:
        raise Bad("Paste the script to use exactly, or choose 'Write them for me'.", "script")
    return {"kind": kind, "shape": shape, "seconds": round(seconds, 1), "style": style, "words": words,
            "script": script if words == "exact" else ""}


def brief(text):
    t = " ".join(str(text or "").split())
    if len(t) < 8:
        raise Bad("Say what video you want in a sentence or two.", "brief")
    if len(t) > MAX_BRIEF:
        raise Bad("Keep the brief under %d characters; put longer text in the sources." % MAX_BRIEF, "brief")
    return t
