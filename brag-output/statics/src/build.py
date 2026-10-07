"""Write the six static concept pages (editable HTML), one theme each.

    python3 build.py        -> writes 0N-*.html next to this file
Copy is the brief's final copy, unchanged.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CHECK = '<svg width="{s}" height="{s}" viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.2"/></svg>'
ARROW = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="M4 12h15M13 6l6 6-6 6"/></svg>'

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>{title}</title>
<link rel="stylesheet" href="../../composition/base.css">
<link rel="stylesheet" href="statics.css">
<style>{css}</style></head>
<body><div id="stage">
  <div class="logo"><span id="lg"></span><div><div class="name">Outcomes</div><div class="sub">Digital</div></div></div>
  <div class="url">edu.outcomes.digital</div>
  <div class="hook">{hook}</div>
  {vis}
  <div class="bottom">
    <div class="reveal">{reveal}</div>
    <div class="pos">{pos}</div>
    <div class="row"><div class="cta">{cta} {arrow}</div><div class="free">Free strategy call<br>No pitch. No obligation.</div></div>
  </div>
  {extra}
</div>
<script src="../../composition/gsap.min.js"></script>
<script src="../../composition/lib.js"></script>
<script>window.__size = [1080, 1350]; document.getElementById('lg').innerHTML = LOGO(40); {js} boot(gsap.timeline(), 0.1);</script>
</body></html>
"""

C = []

# 1 -- light bone, price tags --------------------------------------------------
C.append(dict(slug='01-cost-per-admission', title='Cost per admission', css="""
#stage { background: var(--bone); color: var(--ink); }
.glow { position: absolute; width: 1100px; height: 1100px; right: -380px; top: 240px; border-radius: 50%; background: radial-gradient(closest-side, oklch(92% .045 40 / .95), transparent); }
.hook { font-size: 72px; }
.pos { color: var(--muted); }
.tag { position: absolute; width: 470px; height: 230px; padding: 40px 40px 0 104px; clip-path: polygon(64px 0, 100% 0, 100% 100%, 64px 100%, 0 50%); }
.tag::before { content: ""; position: absolute; left: 38px; top: 98px; width: 34px; height: 34px; border-radius: 50%; background: var(--bone); box-shadow: inset 0 2px 4px oklch(0% 0 0 / .25); }
.tw { position: absolute; filter: drop-shadow(0 26px 34px oklch(14% .005 285 / .18)); }
.lab { font-family: var(--mono); font-size: 18px; letter-spacing: .22em; text-transform: uppercase; }
.val { font-family: var(--display); font-weight: 600; font-size: 66px; letter-spacing: -.03em; margin-top: 26px; display: flex; align-items: center; gap: 18px; }
#t1 { background: var(--card); } #t1 .lab { color: var(--muted); }
#t1 .ck { width: 58px; height: 58px; background: var(--ink); color: white; display: grid; place-items: center; }
#t2 { background: var(--ink); color: var(--bone); } #t2 .lab { color: oklch(75% .01 285); }
.red b { display: inline-block; height: 50px; background: var(--bone); margin-right: 14px; }
.qm { position: absolute; width: 130px; height: 130px; border-radius: 50%; background: var(--orange); color: white; font-family: var(--display); font-weight: 700; font-size: 92px; display: grid; place-items: center; box-shadow: 0 18px 40px oklch(68.5% .223 39.5 / .45); }
.rk { background: var(--orange); color: white; margin-right: 14px; position: relative; top: -4px; }
""",
    hook='You know what a lead costs.<br>Do you know what an<br>admission costs?',
    vis="""<div class="glow"></div>
  <div class="tw" style="left:64px;top:520px;transform:rotate(-4deg)"><div class="tag" id="t1"><div class="lab">Cost per lead</div><div class="val"><span class="ck">""" + CHECK.format(s=34) + """</span>Tracked</div></div></div>
  <div class="tw" style="left:530px;top:560px;transform:rotate(3deg)"><div class="tag" id="t2"><div class="lab">Cost per admission</div><div class="val red blur"><span style="font-size:66px">₹</span><b style="width:90px"></b><b style="width:140px"></b><b style="width:60px"></b></div></div></div>
  <div class="qm" style="left:900px;top:500px">?</div>""",
    reveal='<span class="chip rk">Cost per admission</span>Most track the first. The second one pays the bills.',
    pos='We run campaigns to cost per admission, not cost per form fill.',
    cta='Get Your Free Enrolment Review'))

# 2 -- ink split screen ------------------------------------------------------
C.append(dict(slug='02-dashboard-vs-reality', title='Dashboard vs reality', css="""
#stage { background: var(--ink); color: var(--bone); }
.hook { font-size: 62px; }
.hook .dim { color: oklch(70% .01 285); }
.pos { color: oklch(80% .01 285); }
.free { color: oklch(70% .01 285); }
.pane { position: absolute; top: 470px; height: 440px; width: 462px; overflow: hidden; }
#dash { left: 64px; background: var(--ink-2); border: 1px solid oklch(100% 0 0 / .1); box-shadow: 0 0 80px oklch(68.5% .223 39.5 / .35); padding: 22px; }
#reg { left: 554px; background: var(--card); color: var(--ink); }
.ph { font-family: var(--mono); font-size: 14px; letter-spacing: .2em; text-transform: uppercase; display: flex; align-items: center; gap: 10px; }
.live { width: 10px; height: 10px; border-radius: 50%; background: var(--orange); box-shadow: 0 0 12px var(--orange); }
.tiles { display: flex; gap: 10px; margin-top: 16px; }
.tile { flex: 1; background: oklch(100% 0 0 / .05); padding: 10px 12px; }
.tile .k { font-family: var(--mono); font-size: 11px; letter-spacing: .16em; color: oklch(70% .01 285); text-transform: uppercase; }
.tile .v { font-family: var(--display); font-weight: 600; font-size: 22px; margin-top: 4px; } .tile .v b { color: var(--orange); }
.lead { height: 34px; display: flex; align-items: center; gap: 10px; font-size: 15px; color: oklch(88% .01 285); border-bottom: 1px solid oklch(100% 0 0 / .06); }
.lead i { width: 8px; height: 8px; background: var(--orange); }
.rbar { height: 50px; display: flex; align-items: center; padding: 0 20px; border-bottom: 2px solid var(--ink); font-family: var(--mono); font-size: 14px; letter-spacing: .2em; text-transform: uppercase; }
.rr { height: 42px; border-bottom: 1px solid var(--border); display: grid; grid-template-columns: 1.3fr 1fr; align-items: center; padding: 0 20px; font-size: 17px; color: oklch(80% .008 60); }
.rr.hit { color: var(--ink); background: oklch(92% .045 40 / .35); }
.rr .st { font-family: var(--mono); font-size: 12px; letter-spacing: .16em; color: var(--orange); border: 2px solid var(--orange); padding: 3px 8px; justify-self: start; font-weight: 600; }
.seam { position: absolute; left: 538px; top: 450px; width: 4px; height: 480px; margin-left: -2px; background: var(--orange); box-shadow: 0 0 30px var(--orange); }
.cap { position: absolute; top: 924px; font-family: var(--mono); font-size: 14px; letter-spacing: .2em; color: oklch(70% .01 285); text-transform: uppercase; }
""",
    hook='Your ad dashboard says hundreds of leads.<br><span class="dim">Your admissions office says a handful enrolled.</span>',
    vis="""<div class="pane" id="dash"><div class="ph"><span class="live"></span>Ad dashboard · Live</div>
    <div class="tiles"><div class="tile"><div class="k">Leads</div><div class="v"><b>▲</b> Climbing</div></div><div class="tile"><div class="k">Clicks</div><div class="v"><b>▲</b> Climbing</div></div></div>
    <svg width="418" height="110" viewBox="0 0 418 110" style="margin-top:14px"><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="oklch(68.5% .223 39.5)" stop-opacity=".6"/><stop offset="1" stop-color="oklch(68.5% .223 39.5)" stop-opacity="0"/></linearGradient></defs>
      <path d="M0 100 C60 96 90 88 140 80 S220 70 260 52 S340 34 418 8 L418 110 L0 110Z" fill="url(#g)"/><path d="M0 100 C60 96 90 88 140 80 S220 70 260 52 S340 34 418 8" fill="none" stroke="oklch(80% .15 45)" stroke-width="3"/></svg>
    """ + ''.join(f'<div class="lead"><i></i>New lead · {s}</div>' for s in ['Instagram form', 'Search ad', 'Facebook form', 'YouTube', 'Landing page']) + """</div>
  <div class="pane" id="reg"><div class="rbar">Admissions register</div>
    """ + ''.join(('<div class="rr hit"><span>' + r + '</span><span class="st">Enrolled</span></div>') if r else '<div class="rr"><span>—</span><span>—</span></div>' for r in [None, 'Applicant A.', None, None, None, 'Applicant R.', None, None, None]) + """</div>
  <div class="seam"></div>
  <div class="cap" style="left:64px">What the dashboard counts</div><div class="cap" style="left:554px">What admissions counts</div>""",
    reveal='That gap comes from campaigns optimised for clicks, not seats.',
    pos='We feed admissions data back into Google and Meta, so they learn which students actually enrol.',
    cta='See Where Your Gap Is'))

# 3 -- peach, lead cards through a filter ---------------------------------------
C.append(dict(slug='03-cheapest-lead-trap', title='The cheapest-lead trap', css="""
#stage { background: var(--peach); color: var(--ink); }
.hook { font-size: 86px; }
.pos { color: oklch(40% .02 40); }
.card { position: absolute; width: 230px; height: 96px; background: var(--card); padding: 16px 18px; box-shadow: 0 12px 24px oklch(40% .1 40 / .12); }
.card .n { font-weight: 700; font-size: 19px; } .card .m { font-family: var(--mono); font-size: 12px; letter-spacing: .14em; color: var(--muted); margin-top: 8px; text-transform: uppercase; }
.card.fade { opacity: .45; filter: grayscale(1) blur(1.5px); }
.card.lit { background: var(--orange); color: white; box-shadow: 0 16px 36px oklch(68.5% .223 39.5 / .45); } .card.lit .m { color: oklch(100% 0 0 / .85); }
.filter { position: absolute; left: 652px; top: 470px; width: 3px; height: 440px; background: var(--ink); }
.filter::before { content: ""; position: absolute; left: -9px; top: -10px; width: 21px; height: 21px; border: 3px solid var(--ink); border-radius: 50%; background: var(--peach); }
.flab { position: absolute; left: 680px; top: 460px; font-family: var(--mono); font-size: 14px; letter-spacing: .2em; text-transform: uppercase; }
""",
    hook='Your cheapest leads are probably your emptiest seats.',
    vis='\n'.join(
        f'<div class="card fade" style="left:{x}px;top:{y}px;transform:rotate({r}deg)"><div class="n">New lead</div><div class="m">Low-cost · Broad targeting</div></div>'
        for x, y, r in [(70, 520, -8), (250, 500, 6), (120, 610, 4), (330, 600, -5), (60, 700, 7), (260, 700, -3), (400, 690, 9), (150, 800, -6), (340, 790, 4)])
        + '<div class="filter"></div><div class="flab">Can realistically enrol</div>'
        + '\n'.join(f'<div class="card lit" style="left:{x}px;top:{y}px"><div class="n">Serious enquiry</div><div class="m">Near campus · Right program</div></div>'
                    for x, y in [(700, 560), (760, 700)]),
    reveal='Low-cost leads usually mean broad targeting that never visits your campus.',
    pos='We target families who can realistically enrol, and pay for the right ones.',
    cta='Get Your Free Enrolment Review'))

# 4 -- full orange, campus rings, ink base -------------------------------------
C.append(dict(slug='04-budget-by-distance', title='Budget by distance', css="""
#stage { background: var(--orange); color: white; }
.logo { color: var(--ink); } .logo .lg-head, .logo .lg-shaft { stroke: white; }
.url { color: var(--ink); }
.hook { font-size: 70px; }
.streets { position: absolute; inset: 0; opacity: .18; }
.ring { position: absolute; left: 540px; top: 700px; border-radius: 50%; transform: translate(-50%, -50%); }
.r1 { width: 160px; height: 160px; background: white; box-shadow: 0 0 60px oklch(100% 0 0 / .7); }
.r2 { width: 330px; height: 330px; border: 5px solid white; background: oklch(100% 0 0 / .14); }
.r3 { width: 520px; height: 520px; border: 3px dashed oklch(100% 0 0 / .45); filter: blur(2px); }
.r4 { width: 740px; height: 740px; border: 2px dashed oklch(100% 0 0 / .25); filter: blur(4px); }
.pin { position: absolute; left: 540px; top: 700px; transform: translate(-50%, -50%); color: var(--orange); }
.rl { position: absolute; font-family: var(--mono); font-size: 16px; letter-spacing: .2em; text-transform: uppercase; white-space: nowrap; }
.base { position: absolute; left: 0; right: 0; bottom: 0; height: 430px; background: var(--ink); }
.pos { color: oklch(80% .01 285); } .free { color: oklch(70% .01 285); }
""",
    hook='A family near your campus and one across the city are not the same lead.',
    vis="""<svg class="streets" width="1080" height="1350"><g stroke="white" stroke-width="2" fill="none">
    <path d="M0 520 L1080 600"/><path d="M0 760 L1080 690"/><path d="M200 400 L320 920"/><path d="M760 400 L700 920"/><path d="M0 640 C300 600 600 820 1080 780"/><path d="M460 400 L560 920"/><path d="M900 420 L1000 900"/></g></svg>
  <div class="ring r4"></div><div class="ring r3"></div><div class="ring r2"></div><div class="ring r1"></div>
  <svg class="pin" width="70" height="70" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z"/><circle cx="12" cy="10" r="2.6" fill="white"/></svg>
  <div class="rl" style="left:600px;top:500px;color:white">Near campus</div>
  <div class="rl" style="left:790px;top:470px;color:oklch(100% 0 0 / .7);filter:blur(1.5px)">Across the city</div>
  <div class="base"></div>""",
    reveal='Most campaigns spend on both as if they were.',
    pos='We split budget by how far families realistically travel, so spend goes where admissions happen.',
    cta='Book A Free Enrolment Review'))

# 5 -- stark white editorial, two phones ---------------------------------------
PHONE_POST = """<div class="post {cls}"><div class="ph"><div class="av"></div><div><div class="pn">{who}</div><div class="ps">Sponsored</div></div></div>
  <div class="img"><div class="lab">{lab}</div><div class="big">{big}</div></div><div class="ctab">{cta} <span>→</span></div></div>"""
GEN = PHONE_POST.format(cls='gen', who='Your Institution', lab='All programs', big='Admissions open.', cta='Apply now')
C.append(dict(slug='05-one-campaign-every-course', title='One campaign for every course', css="""
#stage { background: oklch(99.5% 0 0); color: var(--ink); }
.rule { position: absolute; left: 64px; right: 64px; height: 6px; background: var(--ink); }
.hook { font-size: 74px; top: 158px; }
.pos { color: var(--muted); }
.phone { position: absolute; top: 452px; width: 330px; height: 470px; border-radius: 44px 44px 0 0; background: var(--ink); padding: 11px 11px 0; }
.scr { width: 100%; height: 100%; border-radius: 34px 34px 0 0; background: var(--card); overflow: hidden; padding-top: 40px; position: relative; }
.scr::before { content: ""; position: absolute; left: 50%; top: 10px; width: 90px; height: 24px; margin-left: -45px; border-radius: 14px; background: var(--ink); }
.post { padding: 12px 14px 16px; border-bottom: 6px solid oklch(94% .006 60); }
.ph { display: flex; align-items: center; gap: 8px; } .av { width: 30px; height: 30px; border-radius: 50%; background: oklch(85% .01 285); }
.pn { font-weight: 700; font-size: 14px; } .ps { font-size: 11px; color: var(--muted); }
.img { margin-top: 10px; height: 110px; display: flex; flex-direction: column; justify-content: flex-end; padding: 12px; }
.img .lab { font-family: var(--mono); font-size: 10px; letter-spacing: .16em; text-transform: uppercase; }
.img .big { font-family: var(--display); font-weight: 700; font-size: 22px; line-height: 1.05; margin-top: 4px; }
.ctab { margin-top: 8px; height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-weight: 700; font-size: 13px; }
.gen .img { background: linear-gradient(160deg, oklch(86% .01 285), oklch(74% .01 285)); color: white; } .gen .ctab { background: oklch(93% .006 285); color: oklch(45% .01 285); }
.gen { filter: grayscale(1); opacity: .8; }
.tA .img { background: linear-gradient(150deg, oklch(80% .12 50), var(--orange)); color: white; } .tA .ctab { background: var(--orange); color: white; } .tA .av, .tB .av { background: var(--orange); }
.tB .img { background: var(--ink); color: white; } .tB .img .big { color: var(--orange); } .tB .ctab { background: var(--ink); color: white; }
.plab { position: absolute; top: 418px; font-family: var(--mono); font-size: 15px; letter-spacing: .2em; text-transform: uppercase; }
.vs { position: absolute; left: 540px; top: 640px; transform: translate(-50%, -50%); font-family: var(--display); font-weight: 700; font-size: 34px; width: 74px; height: 74px; border-radius: 50%; border: 3px solid var(--ink); display: grid; place-items: center; background: white; }
.bottom { background: oklch(99.5% 0 0); padding-top: 26px; border-top: 6px solid var(--ink); }
""",
    hook='Nursery parents and MBA applicants shouldn\'t see the same ad.',
    vis='<div class="rule" style="top:130px"></div>'
        + '<div class="plab" style="left:120px">One campaign</div><div class="plab" style="left:640px;color:var(--orange)">Built by program</div>'
        + f'<div class="phone" style="left:110px"><div class="scr">{GEN}{GEN}</div></div>'
        + '<div class="phone" style="left:640px"><div class="scr">'
        + PHONE_POST.format(cls='tA', who='Your School', lab='For parents', big='See the campus before you shortlist.', cta='Book a campus visit')
        + PHONE_POST.format(cls='tB', who='Your College', lab='For working professionals', big='Comparing MBA programs?', cta='Book a counselling session')
        + '</div></div><div class="vs">vs</div>',
    reveal='Most institutions run one campaign for everything they offer.',
    pos='We build campaigns by program, audience and intent, so every course gets the message that fits.',
    cta='Talk To Us Directly'))

# 6 -- midnight, grain, season spike -------------------------------------------
bars = []
for i in range(36):
    if i < 6: v = 0.07 + 0.01 * i
    elif i < 21: v = 0.1 + 0.27 * ((i - 6) / 15) ** 1.6
    elif i <= 26: v = [0.72, 1.0, 0.92, 0.8, 0.6, 0.44][i - 21]
    else: v = 0.3 * 2.718 ** (-(i - 27) / 3.5) + 0.06
    cls = 's' if 21 <= i <= 26 else ('pre' if 6 <= i < 21 else '')
    bars.append(f'<div class="bar {cls}" style="left:{64 + i * 26.4 + 5:.1f}px;height:{v * 330:.0f}px"></div>')
C.append(dict(slug='06-admission-season-window', title='The admission-season window', css="""
#stage { background: oklch(11% .006 285); color: var(--bone); }
.glow { position: absolute; width: 1200px; height: 900px; left: -60px; top: 380px; border-radius: 50%; background: radial-gradient(closest-side, oklch(68.5% .223 39.5 / .3), transparent 72%); }
.grain { position: absolute; inset: 0; opacity: .16; mix-blend-mode: screen; pointer-events: none; z-index: 20;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>"); }
.vig { position: absolute; inset: 0; background: radial-gradient(110% 80% at 50% 45%, transparent 55%, oklch(0% 0 0 / .55)); z-index: 19; pointer-events: none; }
.hook { font-size: 68px; }
.hook .dim { color: oklch(70% .01 285); }
.pos { color: oklch(80% .01 285); } .free { color: oklch(70% .01 285); }
.bar { position: absolute; bottom: 440px; width: 16px; background: oklch(96% .006 60 / .2); }
.bar.pre { background: oklch(85% .1 50 / .65); }
.bar.s { background: linear-gradient(to top, var(--orange), oklch(80% .15 50)); box-shadow: 0 0 20px oklch(68.5% .223 39.5 / .7); }
.hatch { position: absolute; bottom: 440px; left: 222px; width: 396px; height: 200px; background: repeating-linear-gradient(135deg, oklch(68.5% .223 39.5 / .25) 0 6px, transparent 6px 15px); border-top: 2px solid var(--orange); }
.band { position: absolute; bottom: 440px; left: 616px; width: 162px; height: 360px; background: linear-gradient(to top, oklch(68.5% .223 39.5 / .2), transparent); border-left: 1px dashed oklch(68.5% .223 39.5 / .6); border-right: 1px dashed oklch(68.5% .223 39.5 / .6); }
.note { position: absolute; font-family: var(--mono); font-size: 15px; letter-spacing: .18em; text-transform: uppercase; white-space: nowrap; line-height: 1.5; }
.base { position: absolute; left: 64px; width: 952px; bottom: 438px; height: 2px; background: oklch(100% 0 0 / .25); }
""",
    hook='Admissions season is only a few weeks long.<br><span class="dim">Is your campaign built for it?</span>',
    vis='<div class="glow"></div><div class="hatch"></div><div class="band"></div>' + ''.join(bars)
        + '<div class="base"></div>'
        + '<div class="note" style="left:232px;top:618px;color:var(--orange)">The quiet build-up<br><span style="color:oklch(80% .01 285)">The part most institutions miss</span></div>'
        + '<div class="note" style="left:620px;top:532px;color:var(--orange)">Admissions season</div>'
        + '<div class="note" style="left:64px;top:924px;color:oklch(70% .01 285)">Pre-season</div><div class="note" style="left:890px;top:924px;color:oklch(70% .01 285)">After</div>',
    reveal='Most start late, spend evenly and stop when applications close.',
    pos='We ramp up before the season and stay in front of undecided families after.',
    cta='Get Your Free Enrolment Review',
    extra='<div class="vig"></div><div class="grain"></div>'))

for c in C:
    html = PAGE.format(title=c['title'], css=c['css'], hook=c['hook'], vis=c['vis'], reveal=c['reveal'], pos=c['pos'],
                       cta=c['cta'], arrow=ARROW, extra=c.get('extra', ''), js=c.get('js', ''))
    with open(os.path.join(HERE, c['slug'] + '.html'), 'w') as f:
        f.write(html)
    print('wrote', c['slug'])
