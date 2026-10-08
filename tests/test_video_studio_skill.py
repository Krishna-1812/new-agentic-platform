"""The video-studio Claude Code skill (claude-plugins/video-studio): a plugin teammates install.

It must stay installable (manifest, marketplace, SKILL.md frontmatter, every file it points to),
its music library must match its maps, and its music cutter must land cuts on the bar and end the
bed exactly at the video's length.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, "claude-plugins", "video-studio")
SKILL = os.path.join(PLUGIN, "skills", "video-studio")
sys.path.insert(0, os.path.join(SKILL, "scripts"))

import fit_music  # noqa: E402


def _read(*parts):
    with open(os.path.join(SKILL, *parts), encoding="utf-8") as fh:
        return fh.read()


def _library():
    return json.loads(_read("assets", "music", "library.json"))


def _map(tid):
    return json.loads(_read("assets", "music", "analysis", tid + ".music.json"))


# ── Installable ──────────────────────────────────────────────────────────────
def test_the_marketplace_lists_the_plugin_and_the_plugin_has_the_skill():
    with open(os.path.join(ROOT, ".claude-plugin", "marketplace.json"), encoding="utf-8") as fh:
        market = json.load(fh)
    entry = [p for p in market["plugins"] if p["name"] == "video-studio"]
    assert market["name"] and entry and entry[0]["source"] == "./claude-plugins/video-studio"
    with open(os.path.join(PLUGIN, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
        assert json.load(fh)["name"] == "video-studio"


def test_skill_md_has_frontmatter_a_trigger_description_and_every_link_exists():
    text = _read("SKILL.md")
    head = re.match(r"^---\nname: (.+)\ndescription: (.+)\n---\n", text)
    assert head and head.group(1) == "video-studio"
    assert "/video-studio" in head.group(2) and len(head.group(2)) < 1024
    docs = [os.path.join(SKILL, "SKILL.md")] + [os.path.join(SKILL, "references", f)
                                               for f in os.listdir(os.path.join(SKILL, "references"))]
    for doc in docs:
        for link in re.findall(r"\]\((references/[\w.-]+\.md|[\w.-]+\.md)\)", open(doc, encoding="utf-8").read()):
            base = SKILL if link.startswith("references/") else os.path.dirname(doc)
            assert os.path.exists(os.path.join(base, link)), (doc, link)


def test_every_script_the_docs_name_ships():
    text = "".join(open(os.path.join(SKILL, "references", f), encoding="utf-8").read()
                   for f in os.listdir(os.path.join(SKILL, "references"))) + _read("SKILL.md")
    for name in set(re.findall(r"scripts/(\w+\.py)", text)):
        assert os.path.exists(os.path.join(SKILL, "scripts", name)), name


def test_the_zip_holds_the_installers_and_the_skill_in_one_folder(tmp_path):
    sys.path.insert(0, os.path.join(ROOT, "scripts"))
    import zip_video_studio_skill
    out = tmp_path / "setup.zip"
    zip_video_studio_skill.build(str(out))
    z = zipfile.ZipFile(out)
    names = z.namelist()
    top = "video-studio-setup/"
    assert all(n.startswith(top) for n in names)
    for f in ("START HERE.txt", "setup-video-studio.bat", "setup-video-studio.ps1", "setup-video-studio.sh",
              "setup-video-studio.command", "video-studio/SKILL.md", "video-studio/scripts/doctor.py"):
        assert top + f in names, f
    assert not any(".venv" in n or "__pycache__" in n for n in names)
    for f in ("setup-video-studio.sh", "setup-video-studio.command"):
        assert (z.getinfo(top + f).external_attr >> 16) & 0o111, "double-clickable scripts stay executable"


# ── One-click setup ──────────────────────────────────────────────────────────
INSTALL = os.path.join(PLUGIN, "install")


def test_the_windows_launcher_has_windows_line_endings_and_runs_the_script_beside_it():
    raw = open(os.path.join(INSTALL, "setup-video-studio.bat"), "rb").read()
    assert b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    assert b'-ExecutionPolicy Bypass -File "%~dp0setup-video-studio.ps1"' in raw


def test_the_powershell_installer_is_plain_ascii_and_covers_every_step():
    ps = open(os.path.join(INSTALL, "setup-video-studio.ps1"), "rb").read()
    assert all(b < 128 for b in ps), "Windows PowerShell 5.1 misreads non-ASCII in a BOM-less script"
    text = ps.decode()
    for needle in ("Git.Git", "OpenJS.NodeJS.LTS", "Gyan.FFmpeg", "Python.Python.3.12", "claude.ai/install.ps1",
                   "hyperframes skills", "hyperframes browser ensure", ".claude\\skills\\video-studio", "doctor.py"):
        assert needle in text, needle
    assert "$env:Path" not in text, "use $env:PATH, which works on every OS"


@pytest.mark.skipif(not shutil.which("bash"), reason="needs bash")
def test_the_mac_and_linux_installers_parse():
    for f in ("setup-video-studio.sh", "setup-video-studio.command"):
        subprocess.run(["bash", "-n", os.path.join(INSTALL, f)], check=True)


def test_the_repo_turns_the_plugin_on_for_everyone_who_trusts_it():
    with open(os.path.join(ROOT, ".claude", "settings.json"), encoding="utf-8") as fh:
        settings = json.load(fh)
    src = settings["extraKnownMarketplaces"]["markify-tools"]["source"]
    assert src == {"source": "github", "repo": "Krishna-1812/new-agentic-platform"}
    assert settings["enabledPlugins"]["video-studio@markify-tools"] is True


def test_the_plugin_version_moved_so_installed_copies_update():
    with open(os.path.join(PLUGIN, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
        version = json.load(fh)["version"]
    assert tuple(int(x) for x in version.split(".")) >= (1, 1, 0)


def test_the_setup_check_knows_how_to_fix_everything_on_every_os():
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import doctor
    for key in ("node", "ffmpeg", "hyperframes", "skills", "browser", "uv"):
        assert set(doctor.FIX[key]) == {"windows", "mac", "linux"}, key
    assert "--quick" in open(os.path.join(SKILL, "SKILL.md"), encoding="utf-8").read()


def test_the_quick_check_trusts_a_recent_pass_only(tmp_path, monkeypatch):
    sys.path.insert(0, os.path.join(SKILL, "scripts"))
    import doctor
    monkeypatch.setattr(doctor, "READY", str(tmp_path / "ready.json"))
    assert doctor.cached() is None
    doctor.remember({"ready": True, "checkedAt": 10 ** 12, "items": []})
    assert doctor.cached() is None, "a check stamped in the future (a wrong clock) is not trusted"
    import time
    doctor.remember({"ready": True, "checkedAt": int(time.time()) - 15 * 86400, "items": []})
    assert doctor.cached() is None, "nor one older than 14 days"
    doctor.remember({"ready": True, "checkedAt": int(time.time()), "items": []})
    assert doctor.cached()["cached"] is True
    doctor.remember({"ready": False, "checkedAt": int(time.time()), "items": []})
    assert doctor.cached() is None, "a failing check forgets the old pass"


# ── The music library ────────────────────────────────────────────────────────
def test_every_library_track_has_its_file_its_map_and_a_credit():
    lib = _library()
    assert len(lib["tracks"]) == 13 and "CC BY 4.0" in lib["license"]
    for t in lib["tracks"]:
        assert os.path.getsize(os.path.join(SKILL, t["file"])) > 500_000, t["id"]
        m = _map(t["id"])
        assert m["beatSource"] == "madmom" and m["downbeats"] and m["sections"], t["id"]
        assert t["credit"] == 'Music: "%s" by Sascha Ende (ende.app), CC BY 4.0' % t["title"]
        assert os.path.exists(os.path.join(SKILL, t["mapSummary"]))


def test_maps_are_musically_sane():
    for t in _library()["tracks"]:
        m = _map(t["id"])
        assert 60 <= m["tempo"] <= 140, t["id"]
        bars = m["downbeats"]
        gaps = [b - a for a, b in zip(bars, bars[1:])]
        assert abs(sorted(gaps)[len(gaps) // 2] - m["barSeconds"]) < 0.05, t["id"]
        assert m["ending"]["finalHit"] <= m["ending"]["lastSound"] <= m["duration"] + 0.01
        assert all(s["start"] < s["end"] for s in m["sections"])


# ── Cutting the bed ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("tid", ["upbeat-business-1", "cinematic-brave", "warm-acoustic", "punchy-business-10"])
@pytest.mark.parametrize("seconds", [15, 20, 30])
def test_button_cuts_start_on_a_bar_and_stop_on_a_bar_about_a_second_before_the_end(tid, seconds):
    m = _map(tid)
    p = fit_music.plan_cut(m, seconds, "button")
    assert any(abs(p["start"] - d) < 0.01 for d in m["downbeats"])
    assert 0.3 <= seconds - p["lastDownbeat"] <= 2.6
    assert p["musicEnd"] <= seconds and p["bars"][0] == 0.0


@pytest.mark.parametrize("tid", ["upbeat-business-1", "cinematic-brave", "corporate-imagefilm"])
def test_natural_cuts_land_the_tracks_own_ending_on_the_last_frame(tid):
    m = _map(tid)
    p = fit_music.plan_cut(m, 20, "natural")
    end_in_video = m["ending"]["lastSound"] - p["start"]
    assert abs(end_in_video - 20) <= 1.7
    assert p["lastDownbeat"] == pytest.approx(m["ending"]["finalHit"] - p["start"], abs=0.01)


def test_an_anchor_puts_the_lift_exactly_where_the_reveal_is():
    m = _map("cinematic-brave")
    p = fit_music.plan_cut(m, 20, "button", anchor=(95.25, 6.4))
    assert p["start"] == pytest.approx(88.85, abs=0.01) and 6.4 in [round(x, 2) for x in p["lifts"]]


def test_a_video_longer_than_the_track_is_refused_for_a_natural_ending():
    with pytest.raises(fit_music.CutError):
        fit_music.plan_cut(_map("punchy-business-10"), 90, "natural")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="needs ffmpeg")
def test_the_bed_file_is_exactly_the_video_length(tmp_path):
    out = tmp_path / "bed.wav"
    subprocess.run([sys.executable, os.path.join(SKILL, "scripts", "fit_music.py"),
                    os.path.join(SKILL, "assets", "music", "punchy-business-10.mp3"),
                    "--map", os.path.join(SKILL, "assets", "music", "analysis", "punchy-business-10.music.json"),
                    "--duration", "6", "--mode", "button", "--out", str(out)], check=True, capture_output=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
                                str(out)], capture_output=True, text=True).stdout)
    assert dur == pytest.approx(6.0, abs=0.01)
    timing = json.loads((tmp_path / "bed.timing.json").read_text())
    assert timing["bars"][0] == 0.0 and timing["mode"] == "button"
