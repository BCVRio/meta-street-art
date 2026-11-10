# Builds the promo: segments (clip, start, len, captions[(png, in, out)], optional phone=True for screen
# recordings shown in a phone frame over a blurred copy) + end card, beat bed, SFX and voice-over.
import json, subprocess, sys
cfg = json.load(open(sys.argv[1])); out = sys.argv[2]; music = sys.argv[3] == '1'
segs = cfg['segments']
vf, af, vlabels, alabels = [], [], [], []
idx = 0; args = []
def add_input(path, pre=()):
    global idx
    args.extend(list(pre) + ['-i', path]); idx += 1; return idx - 1
t = 0.0
for n, s in enumerate(segs):
    i = add_input(s['clip'])
    if s.get('phone'):
        # screen recording: drop the status bar, blurred copy as background, sharp copy in a phone frame
        bz = add_input(cfg['bezel'], ('-loop', '1', '-t', str(s['len'])))
        bar = s.get('bar', 48)
        vf.append(f"[{i}:v]trim=start={s['start']}:duration={s['len']},setpts=PTS-STARTPTS,fps=30,crop=in_w:in_h-{bar}:0:{bar},split[p{n}a][p{n}b]")
        vf.append(f"[p{n}a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=28,eq=brightness=-0.22:saturation=1.3[p{n}bg]")
        vf.append(f"[p{n}b]scale={cfg['phone_w']}:-2:flags=lanczos,eq=saturation=1.05:contrast=1.03[p{n}fg]")
        vf.append(f"[p{n}bg][p{n}fg]overlay={cfg['phone_x']}:{cfg['phone_y']}[p{n}c]")
        vf.append(f"[p{n}c][{bz}:v]overlay=0:0,format=yuv420p[v{n}b]")
    else:
        vf.append(f"[{i}:v]trim=start={s['start']}:duration={s['len']},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,eq=saturation=1.08:contrast=1.04[v{n}b]")
    cur = f"v{n}b"
    for k, (png, a, b) in enumerate(s.get('caps', [])):
        j = add_input(png, ('-loop', '1', '-t', str(s['len'])))
        vf.append(f"[{j}:v]format=rgba,fade=t=in:st={a}:d=0.25:alpha=1,fade=t=out:st={b-0.25}:d=0.25:alpha=1[c{n}_{k}]")
        vf.append(f"[{cur}][c{n}_{k}]overlay=0:0:enable='between(t,{a},{b})'[v{n}c{k}]"); cur = f"v{n}c{k}"
    vlabels.append(f"[{cur}]")
    if s.get('audio', True):
        af.append(f"[{i}:a]atrim=start={s['start']}:duration={s['len']},asetpts=PTS-STARTPTS,aresample=44100,aformat=channel_layouts=stereo,volume={s.get('vol', 0.55)},afade=t=in:d=0.05,afade=t=out:st={s['len']-0.15}:d=0.15[a{n}]")
    else:
        af.append(f"anullsrc=r=44100:cl=stereo,atrim=duration={s['len']}[a{n}]")
    alabels.append(f"[a{n}]"); t += s['len']
total = t
vf.append(''.join(vlabels) + f"concat=n={len(segs)}:v=1:a=0[vout]")
af.append(''.join(alabels) + f"concat=n={len(segs)}:v=0:a=1[sfx]")
mix = ['[sfx]']
for extra in cfg.get('audio', []):
    if extra.get('music') and not music: continue
    j = add_input(extra['file'])
    d = int(extra['at'] * 1000)
    af.append(f"[{j}:a]aresample=44100,aformat=channel_layouts=stereo,volume={extra['vol']},adelay={d}|{d}[x{j}]"); mix.append(f"[x{j}]")
af.append(''.join(mix) + f"amix=inputs={len(mix)}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.2:LRA=9,aresample=44100,alimiter=limit=0.89,afade=t=out:st={total-0.8}:d=0.8[aout]")
cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args + ['-filter_complex', ';'.join(vf + af), '-map', '[vout]', '-map', '[aout]',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', str(total), out]
subprocess.run(cmd, check=True); print('ok', round(total, 2), 's')
