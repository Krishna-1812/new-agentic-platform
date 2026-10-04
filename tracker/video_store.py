"""Video Studio: storage.

Postgres when DATABASE_URL is set (Railway has no persistent disk, so the
videos themselves are kept here too), an in-process store otherwise, so tests
and local runs need no database. Both backends expose the same functions and
return the same shapes, as tracker/watch_store.py does.

Tables
  video_projects  one row per video someone asked for: the owner, client,
                  brief, kind and choices.
  video_versions  one row per version of a project: the plan, the
                  composition files, the change asked for, the finished MP4
                  and its cover, what it cost and how long each step took.
  video_jobs      the queue: one row per piece of work for the worker
                  (Phase 1: "render"). A worker claims a job with a lease,
                  renews it while it works, and finishes it or hands it back.

Composition files are kept as {path: {"text": str}} or {path: {"b64": str}}.

Every read a user can reach takes their email and scopes the query to it in
SQL (a version or job is reached through its project's row). The worker
passes email=None.
"""

from __future__ import annotations

import contextlib
import copy
import json
import os
import threading
from datetime import datetime, timedelta, timezone

from tracker import video_config as cfg

PROJECT_FIELDS = ("client", "title", "brief", "kind", "choices", "status")
PROJECT_JSON = ("choices",)
VERSION_FIELDS = ("plan", "files", "change_request", "status", "error", "shape", "duration_s", "cover_at",
                  "cost_usd", "timings", "mp4", "cover", "mp4_bytes", "finished_at")
VERSION_JSON = ("plan", "files", "timings")
VERSION_STATES = ("draft", "queued", "making", "ready", "failed")
JOB_KINDS = ("render",)
JOB_STATES = ("queued", "running", "done", "failed")
# A worker row's job log is cut to this many entries.
MAX_LOG = 60


def backend():
    return "postgres" if os.environ.get("DATABASE_URL") else "memory"


def _now():
    return datetime.now(timezone.utc)


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _dt(v):
    if v is None or isinstance(v, datetime):
        return v
    return datetime.fromisoformat(v)


def _norm_email(email):
    return (email or "").strip().lower()


def _j(v):
    return json.dumps(v) if v is not None else None


# ── Postgres ─────────────────────────────────────────────────────────────────
_READY = False
_READY_LOCK = threading.Lock()


@contextlib.contextmanager
def _pg():
    import psycopg2
    conn = psycopg2.connect(os.environ["DATABASE_URL"], connect_timeout=8)
    try:
        _ensure(conn)
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _ensure(conn):
    global _READY
    if _READY:
        return
    with _READY_LOCK:
        if _READY:
            return
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS video_projects (
                    id SERIAL PRIMARY KEY,
                    email TEXT NOT NULL,
                    client TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    brief TEXT NOT NULL DEFAULT '',
                    kind TEXT NOT NULL DEFAULT 'custom',
                    choices JSONB NOT NULL DEFAULT '{}'::jsonb,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            cur.execute("CREATE INDEX IF NOT EXISTS video_projects_email ON video_projects (email, created_at DESC)")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS video_versions (
                    id SERIAL PRIMARY KEY,
                    project_id INTEGER NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
                    number INTEGER NOT NULL,
                    plan JSONB NOT NULL DEFAULT '{}'::jsonb,
                    files JSONB NOT NULL DEFAULT '{}'::jsonb,
                    change_request TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'draft',
                    error TEXT NOT NULL DEFAULT '',
                    shape TEXT NOT NULL DEFAULT 'landscape',
                    duration_s REAL NOT NULL DEFAULT 0,
                    cover_at REAL,
                    cost_usd REAL NOT NULL DEFAULT 0,
                    timings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    mp4 BYTEA,
                    cover BYTEA,
                    mp4_bytes INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    finished_at TIMESTAMPTZ,
                    UNIQUE (project_id, number))""")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS video_jobs (
                    id SERIAL PRIMARY KEY,
                    version_id INTEGER NOT NULL REFERENCES video_versions(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL DEFAULT 'render',
                    status TEXT NOT NULL DEFAULT 'queued',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
                    log JSONB NOT NULL DEFAULT '[]'::jsonb,
                    error TEXT NOT NULL DEFAULT '',
                    lease_owner TEXT,
                    lease_until TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    started_at TIMESTAMPTZ,
                    finished_at TIMESTAMPTZ)""")
            cur.execute("CREATE INDEX IF NOT EXISTS video_jobs_open ON video_jobs (id) "
                        "WHERE status IN ('queued', 'running')")
            cur.execute("CREATE INDEX IF NOT EXISTS video_jobs_version ON video_jobs (version_id, id DESC)")
        conn.commit()
        _READY = True


def _rows(cur):
    cols = [d[0] for d in cur.description]
    out = []
    for row in cur.fetchall():
        rec = dict(zip(cols, row))
        for k, v in list(rec.items()):
            if isinstance(v, datetime):
                rec[k] = v.isoformat()
            elif isinstance(v, memoryview):
                rec[k] = bytes(v)
        out.append(rec)
    return out


# ── In-process ───────────────────────────────────────────────────────────────
_MEM = {}
_MEM_LOCK = threading.RLock()


def reset_memory():
    """Empty the in-process store (tests)."""
    with _MEM_LOCK:
        _MEM.clear()
        _MEM.update(projects={}, versions={}, jobs={}, ids={"projects": 0, "versions": 0, "jobs": 0})


reset_memory()


def _mem_id(table):
    _MEM["ids"][table] += 1
    return _MEM["ids"][table]


def _mem_project(project_id, email):
    p = _MEM["projects"].get(project_id)
    if not p or (email is not None and p["email"] != _norm_email(email)):
        return None
    return p


def _mem_version(version_id, email):
    v = _MEM["versions"].get(version_id)
    if not v or not _mem_project(v["project_id"], email):
        return None
    return v


# Big columns are left out of lists and plain reads.
_MEDIA = ("mp4", "cover")
_VERSION_LIST_COLS = ("v.id, v.project_id, v.number, v.plan, v.change_request, v.status, v.error, v.shape, "
                      "v.duration_s, v.cover_at, v.cost_usd, v.timings, v.mp4_bytes, v.created_at, v.finished_at, "
                      "(v.cover IS NOT NULL) AS has_cover")


def _public_version(v, files=False):
    out = {k: copy.deepcopy(val) for k, val in v.items() if k not in _MEDIA and (files or k != "files")}
    out["has_cover"] = v.get("cover") is not None
    return out


# ── Projects ─────────────────────────────────────────────────────────────────
PROJECT_DEFAULTS = {"client": "", "title": "", "brief": "", "kind": "custom", "choices": {}, "status": "active"}


def create_project(email, **fields):
    bad = set(fields) - set(PROJECT_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    row = dict(PROJECT_DEFAULTS, **fields)
    email = _norm_email(email)
    if backend() == "memory":
        with _MEM_LOCK:
            pid = _mem_id("projects")
            now = _now().isoformat()
            _MEM["projects"][pid] = dict(copy.deepcopy(row), id=pid, email=email, created_at=now, updated_at=now)
            return pid
    cols = ["email"] + list(row)
    vals = [email] + [_j(row[k]) if k in PROJECT_JSON else row[k] for k in row]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO video_projects (%s) VALUES (%s) RETURNING id"
                    % (", ".join(cols), ", ".join(["%s"] * len(cols))), vals)
        return cur.fetchone()[0]


def get_project(project_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            p = _mem_project(project_id, email)
            return copy.deepcopy(p) if p else None
    q, args = "SELECT * FROM video_projects WHERE id = %s", [project_id]
    if email is not None:
        q += " AND email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def list_projects(email, limit=50, kind=None):
    if backend() == "memory":
        with _MEM_LOCK:
            rows = [copy.deepcopy(p) for p in _MEM["projects"].values() if p["email"] == _norm_email(email)
                    and (kind is None or p["kind"] == kind)]
        return sorted(rows, key=lambda p: p["id"], reverse=True)[:limit]
    q, args = "SELECT * FROM video_projects WHERE email = %s", [_norm_email(email)]
    if kind is not None:
        q += " AND kind = %s"
        args.append(kind)
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY id DESC LIMIT %s", args + [int(limit)])
        return _rows(cur)


# ── Versions ─────────────────────────────────────────────────────────────────
VERSION_DEFAULTS = {"plan": {}, "files": {}, "change_request": "", "status": "draft", "error": "",
                    "shape": "landscape", "duration_s": 0.0, "cover_at": None, "cost_usd": 0.0, "timings": {},
                    "mp4": None, "cover": None, "mp4_bytes": 0, "finished_at": None}


def create_version(project_id, **fields):
    """A new version of a project, numbered after its latest. Returns its id."""
    bad = set(fields) - set(VERSION_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    row = dict(VERSION_DEFAULTS, **fields)
    if backend() == "memory":
        with _MEM_LOCK:
            if project_id not in _MEM["projects"]:
                raise KeyError(project_id)
            number = 1 + max([v["number"] for v in _MEM["versions"].values() if v["project_id"] == project_id],
                             default=0)
            vid = _mem_id("versions")
            _MEM["versions"][vid] = dict(copy.deepcopy(row), id=vid, project_id=project_id, number=number,
                                         created_at=_now().isoformat())
            return vid
    cols = list(row)
    vals = [_j(row[k]) if k in VERSION_JSON else row[k] for k in cols]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM video_projects WHERE id = %s FOR UPDATE", (project_id,))
        if not cur.fetchone():
            raise KeyError(project_id)
        cur.execute("INSERT INTO video_versions (project_id, number, %s) "
                    "SELECT %%s, COALESCE(max(number), 0) + 1, %s FROM video_versions WHERE project_id = %%s "
                    "RETURNING id" % (", ".join(cols), ", ".join(["%s"] * len(cols))),
                    [project_id] + vals + [project_id])
        return cur.fetchone()[0]


def get_version(version_id, email=None, files=False):
    """A version without its MP4 and cover bytes (`files` adds the composition)."""
    if backend() == "memory":
        with _MEM_LOCK:
            v = _mem_version(version_id, email)
            return _public_version(v, files) if v else None
    cols = _VERSION_LIST_COLS + (", v.files" if files else "")
    q, args = ("SELECT %s FROM video_versions v JOIN video_projects p ON p.id = v.project_id WHERE v.id = %%s"
               % cols, [version_id])
    if email is not None:
        q += " AND p.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def list_versions(project_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            if not _mem_project(project_id, email):
                return []
            rows = [_public_version(v) for v in _MEM["versions"].values() if v["project_id"] == project_id]
        return sorted(rows, key=lambda v: v["number"], reverse=True)
    q, args = ("SELECT %s FROM video_versions v JOIN video_projects p ON p.id = v.project_id "
               "WHERE v.project_id = %%s" % _VERSION_LIST_COLS, [project_id])
    if email is not None:
        q += " AND p.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY v.number DESC", args)
        return _rows(cur)


def update_version(version_id, **fields):
    bad = set(fields) - set(VERSION_FIELDS)
    if bad:
        raise ValueError("unknown fields: %s" % ", ".join(sorted(bad)))
    if not fields:
        return False
    if backend() == "memory":
        with _MEM_LOCK:
            v = _MEM["versions"].get(version_id)
            if not v:
                return False
            for k, val in fields.items():
                v[k] = _iso(val) if k == "finished_at" else copy.deepcopy(val)
            return True
    sets = ", ".join("%s = %%s" % k for k in fields)
    vals = [_j(fields[k]) if k in VERSION_JSON else fields[k] for k in fields]
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE video_versions SET %s WHERE id = %%s" % sets, vals + [version_id])
        return cur.rowcount > 0


def get_media(version_id, kind, email=None):
    """The MP4 or cover bytes of a version, or None."""
    if kind not in _MEDIA:
        raise ValueError(kind)
    if backend() == "memory":
        with _MEM_LOCK:
            v = _mem_version(version_id, email)
            return v.get(kind) if v else None
    q, args = ("SELECT v.%s FROM video_versions v JOIN video_projects p ON p.id = v.project_id WHERE v.id = %%s"
               % kind, [version_id])
    if email is not None:
        q += " AND p.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        row = cur.fetchone()
        return bytes(row[0]) if row and row[0] is not None else None


# ── The queue ────────────────────────────────────────────────────────────────
def enqueue(version_id, kind="render", settings=None):
    """Queue work on a version. Returns the job id."""
    if kind not in JOB_KINDS:
        raise ValueError(kind)
    settings = settings or {}
    if backend() == "memory":
        with _MEM_LOCK:
            if version_id not in _MEM["versions"]:
                raise KeyError(version_id)
            jid = _mem_id("jobs")
            _MEM["jobs"][jid] = {"id": jid, "version_id": version_id, "kind": kind, "status": "queued",
                                 "attempts": 0, "settings": copy.deepcopy(settings), "log": [], "error": "",
                                 "lease_owner": None, "lease_until": None, "created_at": _now().isoformat(),
                                 "started_at": None, "finished_at": None}
            return jid
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO video_jobs (version_id, kind, settings) VALUES (%s, %s, %s) RETURNING id",
                    (version_id, kind, _j(settings)))
        return cur.fetchone()[0]


def _claimable_mem(j, now):
    lease = _dt(j["lease_until"])
    return j["status"] == "queued" or (j["status"] == "running" and (lease is None or lease <= now))


def claim_job(owner, *, now=None, lease_s=cfg.JOB_LEASE_S, max_attempts=cfg.MAX_ATTEMPTS):
    """Take the oldest open job for `owner`, or None.

    Open means queued, or running with a lease that has run out (its worker
    died mid-job: the job runs again). A job that has already been started
    `max_attempts` times is failed instead of taken again."""
    now = now or _now()
    until = now + timedelta(seconds=lease_s)
    while True:
        if backend() == "memory":
            with _MEM_LOCK:
                open_ = sorted((j for j in _MEM["jobs"].values() if _claimable_mem(j, now)), key=lambda j: j["id"])
                if not open_:
                    return None
                j = open_[0]
                j.update(status="running", lease_owner=owner, lease_until=until.isoformat(),
                         attempts=j["attempts"] + 1, started_at=j["started_at"] or now.isoformat())
                job = copy.deepcopy(j)
        else:
            with _pg() as conn, conn.cursor() as cur:
                cur.execute("""
                    UPDATE video_jobs SET status = 'running', lease_owner = %(owner)s, lease_until = %(until)s,
                        attempts = attempts + 1, started_at = COALESCE(started_at, %(now)s)
                    WHERE id = (
                        SELECT id FROM video_jobs
                        WHERE status = 'queued' OR (status = 'running' AND (lease_until IS NULL OR lease_until <= %(now)s))
                        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
                    RETURNING *""", {"owner": owner, "until": until, "now": now})
                rows = _rows(cur)
                if not rows:
                    return None
                job = rows[0]
        if job["attempts"] <= max_attempts:
            return job
        finish_job(job["id"], owner, "failed",
                   error="The render was interrupted %d times (the worker restarted), so it was stopped."
                   % (job["attempts"] - 1))
        update_version(job["version_id"], status="failed", error="The render was interrupted; try again.",
                       finished_at=now)


def renew_job(job_id, owner, *, now=None, lease_s=cfg.JOB_LEASE_S):
    """Extend a held lease. False when it was lost."""
    until = (now or _now()) + timedelta(seconds=lease_s)
    if backend() == "memory":
        with _MEM_LOCK:
            j = _MEM["jobs"].get(job_id)
            if not j or j["lease_owner"] != owner or j["status"] != "running":
                return False
            j["lease_until"] = until.isoformat()
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE video_jobs SET lease_until = %s WHERE id = %s AND lease_owner = %s AND status = 'running'",
                    (until, job_id, owner))
        return cur.rowcount > 0


def finish_job(job_id, owner, status, error="", now=None):
    """Close a held job as done or failed. False when not held by owner."""
    if status not in ("done", "failed"):
        raise ValueError(status)
    now = now or _now()
    if backend() == "memory":
        with _MEM_LOCK:
            j = _MEM["jobs"].get(job_id)
            if not j or j["lease_owner"] != owner:
                return False
            j.update(status=status, error=(error or "")[:1000], lease_owner=None, lease_until=None,
                     finished_at=now.isoformat())
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE video_jobs SET status = %s, error = %s, lease_owner = NULL, lease_until = NULL, "
                    "finished_at = %s WHERE id = %s AND lease_owner = %s",
                    (status, (error or "")[:1000], now, job_id, owner))
        return cur.rowcount > 0


def hand_back(job_id, owner):
    """A stopping worker returns a job it could not finish. It is taken again
    at once, and the stop does not count as one of its attempts."""
    if backend() == "memory":
        with _MEM_LOCK:
            j = _MEM["jobs"].get(job_id)
            if not j or j["lease_owner"] != owner or j["status"] != "running":
                return False
            j.update(status="queued", lease_owner=None, lease_until=None, attempts=max(0, j["attempts"] - 1))
            return True
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE video_jobs SET status = 'queued', lease_owner = NULL, lease_until = NULL, "
                    "attempts = GREATEST(attempts - 1, 0) WHERE id = %s AND lease_owner = %s AND status = 'running'",
                    (job_id, owner))
        return cur.rowcount > 0


def add_log(job_id, step, detail="", *, now=None, **extra):
    """Append one line to a job's log: a step started, finished, or failed."""
    entry = dict(extra, step=step, detail=str(detail or "")[:500], at=(now or _now()).isoformat())
    if backend() == "memory":
        with _MEM_LOCK:
            j = _MEM["jobs"].get(job_id)
            if j:
                j["log"] = (j["log"] + [entry])[-MAX_LOG:]
            return
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            UPDATE video_jobs SET log = (
                SELECT COALESCE(jsonb_agg(e ORDER BY n), '[]'::jsonb) FROM (
                    SELECT e, n FROM jsonb_array_elements(log || jsonb_build_array(%s::jsonb))
                        WITH ORDINALITY AS t(e, n)
                    ORDER BY n DESC LIMIT %s) x)
            WHERE id = %s""", (_j(entry), MAX_LOG, job_id))


def get_job(job_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            j = _MEM["jobs"].get(job_id)
            if not j or not _mem_version(j["version_id"], email):
                return None
            return copy.deepcopy(j)
    q, args = ("SELECT j.* FROM video_jobs j JOIN video_versions v ON v.id = j.version_id "
               "JOIN video_projects p ON p.id = v.project_id WHERE j.id = %s", [job_id])
    if email is not None:
        q += " AND p.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q, args)
        rows = _rows(cur)
        return rows[0] if rows else None


def jobs_for_version(version_id, email=None):
    if backend() == "memory":
        with _MEM_LOCK:
            if not _mem_version(version_id, email):
                return []
            rows = [copy.deepcopy(j) for j in _MEM["jobs"].values() if j["version_id"] == version_id]
        return sorted(rows, key=lambda j: j["id"], reverse=True)
    q, args = ("SELECT j.* FROM video_jobs j JOIN video_versions v ON v.id = j.version_id "
               "JOIN video_projects p ON p.id = v.project_id WHERE j.version_id = %s", [version_id])
    if email is not None:
        q += " AND p.email = %s"
        args.append(_norm_email(email))
    with _pg() as conn, conn.cursor() as cur:
        cur.execute(q + " ORDER BY j.id DESC", args)
        return _rows(cur)


def queue_stats(*, now=None):
    """{"queued", "running", "stalled"}: stalled is running with a lapsed lease."""
    now = now or _now()
    if backend() == "memory":
        with _MEM_LOCK:
            jobs = list(_MEM["jobs"].values())
        running = [j for j in jobs if j["status"] == "running"]
        return {"queued": sum(j["status"] == "queued" for j in jobs),
                "running": sum(bool(_dt(j["lease_until"]) and _dt(j["lease_until"]) > now) for j in running),
                "stalled": sum(not (_dt(j["lease_until"]) and _dt(j["lease_until"]) > now) for j in running)}
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("""
            SELECT count(*) FILTER (WHERE status = 'queued'),
                   count(*) FILTER (WHERE status = 'running' AND lease_until > %(now)s),
                   count(*) FILTER (WHERE status = 'running' AND (lease_until IS NULL OR lease_until <= %(now)s))
            FROM video_jobs WHERE status IN ('queued', 'running')""", {"now": now})
        q, r, s = cur.fetchone()
        return {"queued": q, "running": r, "stalled": s}
