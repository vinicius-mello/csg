#!/usr/bin/env python3
"""Trilha sonora dos tutoriais: renderiza peças MIDI com um piano SoundFont e reverb de sala.

    python3 tools/trilha.py --sf2 ~/Músicas/salamander/.../SalamanderGrandPiano-V3+20200602.sf2 \\
        --saida demo/trilha/licao01.wav --duracao 176 scn15_7.mid scn15_1.mid

1. Cada MIDI é renderizado a seco pelo fluidsynth (reverb e chorus internos desligados).
2. As peças são encadeadas com uma pausa entre elas.
3. O reverb é uma convolução com uma resposta de impulso de sala gerada aqui mesmo:
   pré-atraso, reflexões iniciais e uma cauda estéreo descorrelacionada que decai mais
   depressa nos agudos (como numa sala real).
4. Com --duracao, a trilha é cortada nesse tempo com fade-out.
Precisa de fluidsynth e numpy.
"""
import argparse
import os
import subprocess
import tempfile
import wave

import numpy as np

RATE = 48000


def read_wav(path):
    with wave.open(path, 'rb') as w:
        assert w.getsampwidth() == 2, 'esperava WAV de 16 bits'
        data = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768
        return data.reshape(-1, w.getnchannels())


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((x * 32767).astype('<i2').tobytes())


def render(sf2, midi, gain):
    with tempfile.TemporaryDirectory() as d:
        out = os.path.join(d, 'peca.wav')
        subprocess.run(['fluidsynth', '-ni', '-q', '-F', out, '-r', str(RATE), '-g', str(gain),
                        '-R', '0', '-C', '0', '-o', 'synth.polyphony=512', sf2, midi],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        x = read_wav(out)
    # remove o silêncio do começo; no fim, deixa o último acorde soar 3 s e se extinguir suavemente
    level = np.abs(x).max(axis=1)
    on = np.nonzero(level > 1e-3)[0]
    if not len(on):
        return x
    x = x[max(0, on[0] - RATE // 50): min(len(x), on[-1] + 3 * RATE)].copy()
    fade = min(len(x), int(1.5 * RATE))
    x[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    return x


def lowpass(x, cutoff):
    """Passa-baixas suave (por FFT) em cada canal."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / RATE)
    h = 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(np.fft.rfft(x, axis=0) * h[:, None], n=n, axis=0)


def room_ir(rt60=2.1, length=3.2, predelay=0.018, seed=3):
    rng = np.random.default_rng(seed)
    n = int(length * RATE)
    t = np.arange(n) / RATE
    ir = np.zeros((n, 2))
    # cauda difusa: brilhante e curta + escura e longa
    bright = rng.standard_normal((n, 2)) * np.exp(-6.91 * t / (rt60 * 0.55))[:, None]
    dark = lowpass(rng.standard_normal((n, 2)), 2200) * np.exp(-6.91 * t / rt60)[:, None]
    tail = 0.45 * lowpass(bright, 9000) + dark
    onset = np.clip((t - predelay - 0.012) / 0.06, 0, 1)[:, None]  # a cauda cresce depois das reflexões iniciais
    ir += tail * onset
    # reflexões iniciais: ecos discretos entre 8 e 70 ms, alternando os lados
    for k in range(14):
        delay = predelay + rng.uniform(0.008, 0.07)
        i = int(delay * RATE)
        g = rng.uniform(0.25, 0.7) * np.exp(-delay * 18)
        ir[i, k % 2] += g * 6
        ir[i + rng.integers(5, 40), 1 - k % 2] += g * 4
    return ir / np.sqrt((ir ** 2).sum(axis=0)).max()


def convolve(x, ir):
    n = len(x) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, size, axis=0)
    H = np.fft.rfft(ir, size, axis=0)
    return np.fft.irfft(X * H, size, axis=0)[:n]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('midis', nargs='+')
    ap.add_argument('--sf2', required=True)
    ap.add_argument('--saida', required=True)
    ap.add_argument('--duracao', type=float, help='segundos; corta com fade-out')
    ap.add_argument('--pausa', type=float, default=1.2, help='silêncio entre as peças (s)')
    ap.add_argument('--molhado', type=float, default=0.32, help='proporção do reverb (0–1)')
    ap.add_argument('--rt60', type=float, default=2.1, help='tempo de reverberação da sala (s)')
    ap.add_argument('--ganho', type=float, default=0.5, help='ganho do fluidsynth')
    a = ap.parse_args()

    parts = []
    for m in a.midis:
        print(f'  renderizando {os.path.basename(m)}…')
        parts.append(render(os.path.expanduser(a.sf2), m, a.ganho))
        parts.append(np.zeros((int(a.pausa * RATE), 2), np.float32))
    dry = np.concatenate(parts[:-1])

    wet = convolve(dry, room_ir(a.rt60))
    dry = np.pad(dry, ((0, len(wet) - len(dry)), (0, 0)))
    # mesma energia para seco e molhado antes de misturar
    wet *= np.sqrt((dry ** 2).mean() / max((wet ** 2).mean(), 1e-12))
    mix = (1 - a.molhado) * dry + a.molhado * wet

    if a.duracao:
        n = int(a.duracao * RATE)
        mix = np.pad(mix, ((0, max(0, n - len(mix))), (0, 0)))[:n]
        fade = int(3 * RATE)
        mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
    fade_in = int(0.5 * RATE)
    mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    mix *= 0.89 / np.abs(mix).max()  # pico em -1 dBFS; o volume final é ajustado na mixagem do vídeo

    os.makedirs(os.path.dirname(os.path.abspath(a.saida)), exist_ok=True)
    write_wav(a.saida, mix.astype(np.float32))
    print(f'✓ {a.saida}: {len(mix) / RATE:.1f} s')


if __name__ == '__main__':
    main()
