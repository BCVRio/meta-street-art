# 120 BPM dark electronic bed for the promo: pad + hats intro, drop at DROP, breakdown at BREAK. Stereo WAV 44.1k.
import math, random, struct, sys, wave
SR = 44100; BPM = 120; BEAT = 60 / BPM
DUR, DROP, BREAK = float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
N = int(SR * DUR); L = [0.0] * N; R = [0.0] * N
random.seed(3)
def add(t, s, g=1.0, pan=0.0):
    i0 = int(t * SR); gl = g * (1 - max(0, pan)); gr = g * (1 + min(0, pan))
    for k, v in enumerate(s):
        i = i0 + k
        if 0 <= i < N: L[i] += v * gl; R[i] += v * gr
def kick():
    n = int(.35 * SR); out = []; ph = 0
    for k in range(n):
        t = k / SR; f = 45 + 110 * math.exp(-t / .03); ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-t / .16) + (random.uniform(-1, 1) * math.exp(-t / .003) * .3))
    return out
def clap():
    n = int(.25 * SR); out = []; lp = 0
    for k in range(n):
        t = k / SR; x = random.uniform(-1, 1); lp = .55 * x + .45 * lp
        env = sum(math.exp(-(t - d) / .008) for d in (0, .01, .02) if t >= d) * .5 + .6 * math.exp(-t / .09)
        out.append((x - lp) * env)
    return out
def hat(open_=False):
    n = int((.18 if open_ else .05) * SR); out = []; prev = 0
    for k in range(n):
        t = k / SR; x = random.uniform(-1, 1); hp = x - prev; prev = x
        out.append(hp * math.exp(-t / (.06 if open_ else .012)))
    return out
def note(f, length, kind):
    n = int(length * SR); out = []
    for k in range(n):
        t = k / SR
        if kind == 'bass':
            v = math.tanh(2.2 * (math.sin(2 * math.pi * f * t) + .3 * math.sin(4 * math.pi * f * t))) * min(1, t / .005) * math.exp(-t / (length * .9))
        elif kind == 'pluck':
            v = (2 * ((f * t) % 1) - 1) * math.exp(-t / .12) * .6 + math.sin(2 * math.pi * f * 2 * t) * math.exp(-t / .2) * .3
        else:  # pad
            a = min(1, t / .6) * min(1, (length - t) / .6)
            v = a * sum(math.sin(2 * math.pi * f * d * t + d) for d in (0.995, 1.0, 1.005)) / 3
        out.append(v)
    return out
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
prog = [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [64, 67, 72]), (55, [62, 67, 71])]   # Am F C G
KICK, CLAP, HC, HO = kick(), clap(), hat(), hat(True)
bars = int(DUR / (4 * BEAT)) + 1
for b in range(bars):
    t0 = b * 4 * BEAT; root, chord = prog[b % 4]
    full = DROP <= t0 < BREAK
    for m in chord: add(t0, note(hz(m - 12), 4 * BEAT, 'pad'), .07 if full else .11, pan=random.uniform(-.4, .4))
    for i in range(8):
        t = t0 + i * BEAT / 2
        if t >= DUR: break
        add(t, HO if i % 2 else HC, .10 if full else .06, pan=.3)
        if full:
            if i % 2 == 0: add(t, KICK, .9)
            if i in (2, 6): add(t, CLAP, .45, pan=-.1)
            add(t, note(hz(root - 24 + (12 if i % 4 == 3 else 0)), BEAT / 2 * .9, 'bass'), .32)
            arp = chord[(i * 2) % 3] + (12 if i >= 4 else 0)
            add(t, note(hz(arp), .3, 'pluck'), .08, pan=(-.5 if i % 2 else .5))
n = int(2 * SR); r = []
for k in range(n):
    t = k / SR; r.append(random.uniform(-1, 1) * (t / 2) ** 2 * .25 + math.sin(2 * math.pi * (200 + 900 * t / 2) * t) * (t / 2) * .05)
add(DROP - 2, r, 1.0)
peak = max(max(abs(x) for x in L), max(abs(x) for x in R)) or 1
w = wave.open(sys.argv[1], 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(b''.join(struct.pack('<hh', int(L[i] / peak * .85 * 32767), int(R[i] / peak * .85 * 32767)) for i in range(N))); w.close()
