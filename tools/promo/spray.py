# Spray-can sound logo bed: can rattle, a long "psssht" spray, and a rising neon chime. Writes 44.1 kHz mono WAV.
import math, random, struct, sys, wave
SR = 44100; DUR = 4.6
random.seed(7)
buf = [0.0] * int(SR * DUR)
def add(t0, samples, gain=1.0):
    i0 = int(t0 * SR)
    for k, v in enumerate(samples):
        if 0 <= i0 + k < len(buf): buf[i0 + k] += v * gain
def bandnoise(n, f_lo, f_hi):
    a_hp = math.exp(-2 * math.pi * f_lo / SR); a_lp = math.exp(-2 * math.pi * f_hi / SR)
    out = []; hp_prev_in = hp = lp = 0.0
    for _ in range(n):
        x = random.uniform(-1, 1)
        hp = a_hp * (hp + x - hp_prev_in); hp_prev_in = x
        lp = (1 - a_lp) * hp + a_lp * lp
        out.append(lp)
    return out
def clack(pitch):
    n = int(0.06 * SR); nz = bandnoise(n, 1800, 7000); out = []
    for k in range(n):
        t = k / SR; env = math.exp(-t / 0.012)
        ring = math.sin(2 * math.pi * pitch * t) * math.exp(-t / 0.02) + 0.5 * math.sin(2 * math.pi * pitch * 2.76 * t) * math.exp(-t / 0.01)
        out.append(0.9 * nz[k] * env * 3 + 0.35 * ring)
    return out
for t, p in [(0.00, 3100), (0.10, 3350), (0.19, 2950), (0.42, 3200), (0.52, 3400), (0.61, 3000)]:
    add(t + random.uniform(-0.005, 0.005), clack(p), 0.8)
n = int(1.15 * SR); hiss = bandnoise(n, 3500, 12000); out = []
for k in range(n):
    t = k / SR
    env = min(1, t / 0.035) * (1 if t < 0.85 else max(0, 1 - (t - 0.85) / 0.3))
    flutter = 1 + 0.08 * math.sin(2 * math.pi * 11 * t)
    out.append(hiss[k] * env * flutter * 2.6)
add(0.85, out, 0.55)
def bell(f, length=1.8):
    n = int(length * SR); out = []
    for k in range(n):
        t = k / SR; a = min(1, t / 0.004)
        v = (math.sin(2 * math.pi * f * t) * math.exp(-t / 0.7) + 0.35 * math.sin(2 * math.pi * f * 2.01 * t) * math.exp(-t / 0.3)
             + 0.12 * math.sin(2 * math.pi * f * 3.98 * t) * math.exp(-t / 0.12))
        out.append(a * v)
    return out
for t, f in [(1.55, 880.0), (1.67, 1108.73), (1.79, 1318.51)]:
    add(t, bell(f), 0.16)
peak = max(abs(v) for v in buf) or 1
w = wave.open(sys.argv[1], 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v / peak * 0.89)) * 32767)) for v in buf)); w.close()
