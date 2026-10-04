"""Video Studio: what the website shows (the website never renders).

Phase 1 has one staff page, the engine page: what the worker's engine has,
the queue, and the engine tests (the two test videos and the two sandbox
drills), each with its log, its cover and its MP4 to download.

A person's engine tests live in one project of theirs, kind "engine_test".
"""

from __future__ import annotations

from tracker import video_samples, video_store, video_worker

TEST_KIND = "engine_test"
TESTS = ("samples", "outside_drill", "hang_drill")


def _test_project(email, create=False):
    for p in video_store.list_projects(email, limit=5, kind=TEST_KIND):
        return p["id"]
    if not create:
        return None
    return video_store.create_project(email, title="Engine tests", kind=TEST_KIND)


def start_test(email, which):
    """Queue an engine test; returns the new version ids."""
    if which not in TESTS:
        raise ValueError("Unknown test.")
    names = list(video_samples.SAMPLES) if which == "samples" else [which]
    pid = _test_project(email, create=True)
    out = []
    for name in names:
        s = (video_samples.SAMPLES.get(name) or video_samples.DRILLS[name])()
        vid = video_store.create_version(pid, files=s["files"], shape=s["shape"], duration_s=s["duration_s"],
                                         cover_at=s["cover_at"], status="queued",
                                         plan={"title": s["title"], "test": name})
        video_store.enqueue(vid, settings=video_samples.DRILL_SETTINGS.get(name, {}))
        out.append(vid)
    return out


def engine_page(email, limit=12):
    """Everything the engine page shows, as JSON-ready data."""
    pid = _test_project(email)
    runs = []
    for v in (video_store.list_versions(pid, email) if pid else [])[:limit]:
        jobs = video_store.jobs_for_version(v["id"], email)
        job = jobs[0] if jobs else {}
        runs.append({
            "id": v["id"], "title": (v.get("plan") or {}).get("title") or "Version %d" % v["number"],
            "test": (v.get("plan") or {}).get("test"), "status": v["status"], "error": v.get("error") or "",
            "shape": v.get("shape"), "seconds": v.get("duration_s"), "mb": round((v.get("mp4_bytes") or 0) / 1e6, 1),
            "timings": v.get("timings") or {}, "has_cover": v.get("has_cover"), "created_at": v.get("created_at"),
            "finished_at": v.get("finished_at"), "attempts": job.get("attempts"),
            "log": [{"step": e.get("step"), "detail": e.get("detail"), "at": e.get("at")} for e in job.get("log") or []],
        })
    try:
        engine = video_worker.engine_status()
    except Exception:
        engine = None
    return {"engine": engine, "queue": video_store.queue_stats(), "runs": runs,
            "busy": any(r["status"] in ("queued", "making") for r in runs)}


# ── New projects (Phase 2: used by the plan tests; Phase 4: by the start page) ──
MAX_TEXTS = 6
MAX_TABLES = 3


def new_project(email, *, brief, kind=None, shape=None, seconds=None, style=None, words="write", script="",
                website="", brand=None, client="", texts=(), tables=(), images=(), logo=None, title="",
                project_kind=None, hold=False):
    """Check a request, store it with its sources, and queue its plan.

    texts:  [(name, text)]; tables: [(name, csv or pasted text)];
    images: [(name, bytes)]; logo: (name, bytes) or None.
    Returns (project id, version id). Raises video_starts.Bad or
    video_uploads.Bad with a sentence for the person.

    hold: store the project as a draft and queue nothing (version id None);
    the start page then uploads the pictures one by one and starts it
    (video_app.start).
    """
    from tracker import video_brand, video_starts, video_uploads, watch_safety
    brief = video_starts.brief(brief)
    choices = video_starts.choices(kind, shape=shape, seconds=seconds, style=style, words=words, script=script)
    if website:
        try:
            choices["website"] = watch_safety.normalise(website)
        except watch_safety.BadURL as exc:
            raise video_starts.Bad(str(exc), "website")
    else:
        choices["website"] = ""
    clean_brand = {}
    for k in ("background", "text", "accent"):
        if (brand or {}).get(k):
            c = video_brand.hex_colour(brand[k])
            if not c:
                raise video_starts.Bad("%s is not a colour like #1A2B3C." % brand[k], "brand")
            clean_brand[k] = c
    for k in ("heading_font", "body_font"):
        if (brand or {}).get(k):
            clean_brand[k] = " ".join(str(brand[k]).split())[:80]
    choices["brand"] = clean_brand
    if len(texts) > MAX_TEXTS or len(tables) > MAX_TABLES or len(images) > video_uploads.MAX_IMAGES:
        raise video_starts.Bad("Too many sources: at most %d texts, %d tables and %d images."
                               % (MAX_TEXTS, MAX_TABLES, video_uploads.MAX_IMAGES), "sources")
    # Check every source before storing anything.
    ready_texts = [(n, video_uploads.text(t, "text")) for n, t in texts]
    ready_tables = [(n, video_uploads.numbers(t)) for n, t in tables]
    ready_images = [video_uploads.image(b, n) for n, b in images]
    ready_logo = video_uploads.image(logo[1], logo[0]) if logo else None
    pid = video_store.create_project(email, client=" ".join((client or "").split())[:120],
                                     title=(title or brief)[:120], brief=brief,
                                     kind=project_kind or choices["kind"], choices=choices,
                                     status="draft" if hold else "active")
    for n, t in ready_texts:
        video_store.add_asset(pid, "text", name=n, data={"text": t})
    for n, t in ready_tables:
        video_store.add_asset(pid, "numbers", name=n, data=t)
    for im in ready_images:
        video_store.add_asset(pid, "image", name=im["name"], mime=im["mime"], width=im["width"],
                              height=im["height"], data={"from": "upload"}, blob=im["bytes"])
    if ready_logo:
        video_store.add_asset(pid, "logo", name=ready_logo["name"], mime=ready_logo["mime"],
                              width=ready_logo["width"], height=ready_logo["height"], data={"from": "upload"},
                              blob=ready_logo["bytes"])
    if hold:
        return pid, None
    return pid, queue_plan(pid, choices)


def queue_plan(project_id, choices, settings=None):
    """A new version of the project, with its plan job queued. Returns its id."""
    vid = video_store.create_version(project_id, status="queued", shape=choices["shape"],
                                     duration_s=choices["seconds"])
    video_store.enqueue(vid, kind="plan", settings=settings or {})
    return vid


# ── The plan tests (Phase 2's finish line) ────────────────────────────────────
REVIEWS = ("matches", "misses")


def _sources_summary(assets):
    count = {}
    for a in assets:
        k = a["kind"]
        if k in ("screenshot", "crop", "site") or (a.get("data") or {}).get("from") == "website":
            k = "website"
        count[k] = count.get(k, 0) + 1
    return count


def plan_view(version, project, email):
    plan = version.get("plan") or {}
    jobs = video_store.jobs_for_version(version["id"], email)
    job = jobs[0] if jobs else {}
    assets = video_store.list_assets(project["id"], email)
    pictures = {a["id"]: {"kind": a["kind"], "name": a["name"]} for a in assets
                if a["kind"] in ("image", "logo", "screenshot", "crop")}
    return {"version": version["id"], "project": project["id"], "label": project.get("title"),
            "brief": project.get("brief"), "choices": {k: v for k, v in (project.get("choices") or {}).items()
                                                       if k != "brand"},
            "status": version["status"], "error": version.get("error") or "",
            "cost_usd": version.get("cost_usd") or 0, "sources": _sources_summary(assets), "pictures": pictures,
            "idea": plan.get("idea"), "audience": plan.get("audience"), "hook": plan.get("hook"),
            "scenes": plan.get("scenes") or [], "ending": plan.get("ending"),
            "cover_scene": plan.get("cover_scene"), "share_copy": plan.get("share_copy") or {},
            "notes": plan.get("notes") or [], "problems": plan.get("problems") or [],
            "attempts": plan.get("attempts"), "seconds_taken": plan.get("seconds_taken"),
            "brand": plan.get("brand"), "review": plan.get("review"), "model": plan.get("model"),
            "log": [{"step": e.get("step"), "detail": e.get("detail")} for e in job.get("log") or []]}


def plan_tests_page(email):
    """The newest run of each test brief, in the briefs' order, with totals."""
    from tracker import video_briefs, video_plan
    order = {b["label"]: i for i, b in enumerate(video_briefs.briefs())}
    newest = {}
    for p in video_store.list_projects(email, limit=200, kind=video_briefs.PLAN_TEST_KIND):
        if p.get("title") in order and p["title"] not in newest:
            newest[p["title"]] = p
    runs = []
    for label, p in sorted(newest.items(), key=lambda kv: order[kv[0]]):
        versions = video_store.list_versions(p["id"], email)
        if versions:
            plan_version = next((v for v in reversed(versions) if v["number"] == 1), versions[-1])
            view = plan_view(plan_version, p, email)
            view["versions"] = version_views(p["id"], email) if len(versions) > 1 or \
                plan_version["status"] not in ("queued", "planning", "planned", "failed") else []
            runs.append(view)
    done = [r for r in runs if r["status"] not in ("queued", "planning")]
    making = any(x["status"] not in ("ready", "failed", "planned") for r in runs for x in r["versions"])
    return {"runs": runs, "claude": video_plan.status(), "videos": video_totals(runs),
            "totals": {"briefs": len(video_briefs.briefs()), "run": len(runs), "done": len(done),
                       "valid": sum(r["status"] != "failed" and bool(r["scenes"]) and not r["problems"] for r in runs),
                       "with_problems": sum(bool(r["scenes"]) and bool(r["problems"]) for r in runs),
                       "failed": sum(r["status"] == "failed" for r in runs),
                       "matches": sum((r["review"] or {}).get("verdict") == "matches" for r in runs),
                       "cost_usd": round(sum(r["cost_usd"] for r in runs), 3)},
            "busy": making or any(r["status"] in ("queued", "planning") for r in runs)}


def review_plan(email, version_id, verdict, note=""):
    """A person's judgement of a test plan: does it do what the brief asked?"""
    if verdict not in REVIEWS:
        raise ValueError("Choose matches or misses.")
    v = video_store.get_version(version_id, email)
    if not v or not v.get("plan"):
        return False
    plan = dict(v["plan"], review={"verdict": verdict, "note": " ".join(str(note or "").split())[:500],
                                   "by": email})
    return video_store.update_version(version_id, plan=plan)


def export_plan_tests(email):
    """Every test brief with its sources and plan, for keeping as test fixtures."""
    out = []
    for r in plan_tests_page(email)["runs"]:
        out.append({k: r[k] for k in ("label", "brief", "choices", "sources", "status", "idea", "hook", "scenes",
                                      "share_copy", "notes", "problems", "attempts", "cost_usd", "review")})
    return out


# ── Videos from the test plans (Phase 3's finish line) ────────────────────────
SCORE_KEYS = ("does_the_brief", "readable_on_brand", "strong_start", "numbers_right", "good_to_post")


def version_views(project_id, email):
    out = []
    for v in video_store.list_versions(project_id, email):
        plan = v.get("plan") or {}
        jobs = video_store.jobs_for_version(v["id"], email)
        out.append({"id": v["id"], "number": v["number"], "status": v["status"], "error": v.get("error") or "",
                    "shape": v["shape"], "seconds": v.get("duration_s"), "change": v.get("change_request") or "",
                    "mb": round((v.get("mp4_bytes") or 0) / 1e6, 1), "has_cover": v.get("has_cover"),
                    "cost_usd": round(float(v.get("cost_usd") or 0), 4), "timings": v.get("timings") or {},
                    "build": plan.get("build"), "score": plan.get("score"),
                    "log": [{"step": e.get("step"), "detail": e.get("detail")}
                            for j in reversed(jobs) for e in (j.get("log") or [])][-40:]})
    return out


def build_all_tests(email):
    """Queue the video of every test plan that is valid and not yet made. Returns how many."""
    from tracker import video_builder
    n = 0
    for r in plan_tests_page(email)["runs"]:
        if r["status"] == "planned" and not r["problems"]:
            try:
                video_builder.approve(email, r["version"])
                n += 1
            except video_builder.Refused:
                continue
    return n


def score_video(email, version_id, scores, note=""):
    """A person's score of a finished video, on the Phase 3 questions."""
    v = video_store.get_version(version_id, email)
    if not v or v["status"] != "ready":
        return False
    clean = {k: bool((scores or {}).get(k)) for k in SCORE_KEYS}
    plan = dict(v.get("plan") or {}, score=dict(clean, note=" ".join(str(note or "").split())[:500], by=email))
    return video_store.update_version(version_id, plan=plan)


def video_totals(runs):
    ready = [x for r in runs for x in r.get("versions", []) if x["status"] == "ready"]
    good = [x for x in ready if (x.get("score") or {}).get("good_to_post")]
    kinds = {r["choices"].get("kind") for r in runs
             if any((x.get("score") or {}).get("good_to_post") for x in r.get("versions", []))}
    made = [x for x in ready if x["timings"].get("build_s")]
    return {"ready": len(ready), "good_to_post": len(good), "kinds_with_a_good_video": len(kinds),
            "scored": sum(bool(x.get("score")) for x in ready),
            "avg_cost_usd": round(sum(x["cost_usd"] for x in made) / len(made), 3) if made else 0,
            "avg_minutes": round(sum((x["timings"].get("build_s") or 0) + (x["timings"].get("render_s") or 0)
                                     for x in made) / len(made) / 60, 1) if made else 0}
