"""Mix the music bed, SFX and synthesised whooshes for one video.

    python3 mix.py v1|v2 <out.wav>

Music is from the repo's Video Studio kit (Sascha Ende, CC BY 4.0); SFX are
Kenney (CC0). Effects sit under the music; the master goes to -14 LUFS later.
"""
import os, subprocess, sys
import numpy as np

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, '..', '..', 'tracker', 'video_kit', 'music')


def load(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def whoosh(dur=0.55, peak=0.62, lo=300, hi=5200, seed=1, rise=True):
    """Filtered noise with a sweeping cutoff, soft and dark."""
    n = int(dur * SR)
    noise = np.random.default_rng(seed).standard_normal((n, 2))
    pos = np.linspace(0, 1, n)
    env = np.sin(np.pi * np.clip(pos / peak, 0, 1) / 2) ** 2 if rise else np.ones(n)
    env *= np.where(pos > peak, np.cos(np.pi / 2 * (pos - peak) / (1 - peak)) ** 2, 1)
    cut = lo + (hi - lo) * np.sin(np.pi * pos) ** 1.5
    a = 1 - np.exp(-2 * np.pi * cut / SR)
    y = np.zeros_like(noise); s = np.zeros(2)
    for i in range(n):  # one-pole low-pass, twice for a smoother slope
        s += a[i] * (noise[i] - s); y[i] = s
    z = np.zeros_like(y); s = np.zeros(2)
    for i in range(n):
        s += a[i] * (y[i] - s); z[i] = s
    z /= np.abs(z).max() + 1e-9
    return z * env[:, None]


def sfx(name):
    return load(os.path.join(HERE, 'sfx', name))


CUES = {
    'v1': dict(music='upbeat.mp3', dur=23.5, cues=[
        (0.30, 'W', 0.16), (0.42, 'impactSoft_medium_001.ogg', 0.30),
        (3.45, 'W', 0.12), (3.95, 'W', 0.15), (4.05, 'impactSoft_medium_003.ogg', 0.28),
        (4.72, 'bong_001.ogg', 0.30),
        (6.95, 'W', 0.15), (7.42, 'impactSoft_heavy_001.ogg', 0.42), (8.50, 'switch_002.ogg', 0.16),
        (10.75, 'W', 0.22), (11.30, 'impactSoft_medium_001.ogg', 0.32),
        (11.62, 'click_003.ogg', 0.16), (11.72, 'click_003.ogg', 0.14), (11.82, 'click_003.ogg', 0.14), (11.92, 'click_003.ogg', 0.14),
        (13.20, 'switch_002.ogg', 0.14), (13.95, 'bong_001.ogg', 0.34), (14.90, 'bong_001.ogg', 0.22),
        (15.55, 'W', 0.22), (16.05, 'impactSoft_heavy_001.ogg', 0.40),
        (16.90, 'switch3.ogg', 0.16), (18.15, 'switch3.ogg', 0.16), (19.15, 'switch3.ogg', 0.18),
        (19.85, 'W', 0.16), (20.80, 'impactSoft_heavy_001.ogg', 0.38), (22.10, 'mouseclick1.ogg', 0.40), (22.14, 'bong_001.ogg', 0.20),
    ]),
    'v2': dict(music='corporate.mp3', dur=24.8, cues=[
        (0.05, 'impactSoft_medium_001.ogg', 0.30),
        (3.95, 'W', 0.15), (4.40, 'W', 0.12),
        (5.50, 'impactWood_light_002.ogg', 0.30), (6.10, 'impactWood_light_002.ogg', 0.30), (6.70, 'impactWood_light_002.ogg', 0.34),
        (8.20, 'W', 0.15), (8.55, 'impactSoft_heavy_001.ogg', 0.42), (9.70, 'switch_002.ogg', 0.16),
        (11.40, 'W', 0.24), (12.55, 'W', 0.12), (13.25, 'impactSoft_medium_003.ogg', 0.24), (13.40, 'impactSoft_medium_003.ogg', 0.20),
        (14.20, 'bong_001.ogg', 0.18), (15.40, 'bong_001.ogg', 0.14), (16.60, 'bong_001.ogg', 0.12),
        (18.20, 'W', 0.15),
        (18.78, 'click_003.ogg', 0.14), (18.86, 'click_003.ogg', 0.13), (18.94, 'click_003.ogg', 0.13), (19.02, 'click_003.ogg', 0.13), (19.10, 'click_003.ogg', 0.13),
        (19.60, 'bong_001.ogg', 0.22),
        (20.95, 'W', 0.20), (21.90, 'impactSoft_heavy_001.ogg', 0.38), (23.30, 'mouseclick1.ogg', 0.40), (23.34, 'bong_001.ogg', 0.20),
    ]),
}

if __name__ == '__main__':
    key, out = sys.argv[1], sys.argv[2]
    c = CUES[key]
    n = int(c['dur'] * SR)
    music = load(os.path.join(KIT, c['music']))[:n].copy()
    fade = int(1.4 * SR); music[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    music[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
    fx = np.zeros((n, 2))
    for k, (t, name, g) in enumerate(c['cues']):
        clip = whoosh(seed=k + 3) if name == 'W' else sfx(name)
        if name == 'W':  # land the whoosh peak just before the cue time
            t -= 0.55 * 0.62
        i = max(0, int(t * SR)); j = min(n, i + len(clip))
        fx[i:j] += clip[:j - i] * g
    mix = music * 0.9 + fx
    mix /= max(1.0, np.abs(mix).max() / 0.95)
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', out],
                   input=mix.astype(np.float32).tobytes(), check=True)
    print('mixed', out)
