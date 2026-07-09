import math
import random
import wave
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIO_ROOT = ROOT / "public" / "audio"
SAMPLE_RATE = 22050


def clamp(value: float) -> float:
    return max(-1.0, min(1.0, value))


def write_wav(path: Path, samples: list[float], sample_rate: int = SAMPLE_RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for sample in samples:
            value = int(clamp(sample) * 32767)
            frames += value.to_bytes(2, byteorder="little", signed=True)
        wav.writeframes(frames)


def envelope(index: int, total: int, attack: float = 0.08, release: float = 0.18) -> float:
    t = index / max(total - 1, 1)
    if t < attack:
        return t / attack
    if t > 1 - release:
        return max(0.0, (1 - t) / release)
    return 1.0


def tone(freq: float, t: float, phase: float = 0.0) -> float:
    return math.sin((math.tau * freq * t) + phase)


def make_loop(seconds: float, renderer) -> list[float]:
    total = int(seconds * SAMPLE_RATE)
    rng = random.Random(47)
    samples: list[float] = []
    for i in range(total):
        t = i / SAMPLE_RATE
        tail_t = (i + total // 2) % total / SAMPLE_RATE
        sample = (renderer(t, rng) + renderer(tail_t, rng)) * 0.5
        samples.append(sample * envelope(i, total, 0.04, 0.04))
    return samples


def night_renderer(t: float, rng: random.Random) -> float:
    drone = 0.32 * tone(38.0, t) + 0.18 * tone(57.0, t, 0.9)
    pulse = 0.09 * tone(76.0 + math.sin(t * 0.17) * 2.5, t)
    air = (rng.random() - 0.5) * 0.055
    distant = 0.08 * tone(146.0, t, math.sin(t * 0.05)) * (0.5 + 0.5 * math.sin(t * 0.23))
    return (drone + pulse + distant + air) * 0.34


def low_sanity_renderer(t: float, rng: random.Random) -> float:
    wobble = 0.42 * tone(28.0 + math.sin(t * 0.33) * 3.2, t)
    pressure = 0.18 * tone(91.0, t, math.sin(t * 0.21) * 1.8)
    grit = (rng.random() - 0.5) * 0.08
    heartbeat = 0.22 * math.exp(-((t % 1.18) * 9.0)) * tone(54.0, t)
    return (wobble + pressure + grit + heartbeat) * 0.35


def ending_renderer(t: float, rng: random.Random) -> float:
    chord = 0.26 * tone(49.0, t) + 0.18 * tone(73.5, t, 0.2) + 0.13 * tone(98.0, t, 0.7)
    shimmer = 0.06 * tone(392.0 + math.sin(t * 0.4) * 6.0, t)
    air = (rng.random() - 0.5) * 0.035
    return (chord + shimmer + air) * 0.33


def wind_renderer(t: float, rng: random.Random) -> float:
    gust = 0.14 * tone(117.0 + math.sin(t * 0.19) * 15.0, t)
    noise = (rng.random() - 0.5) * (0.11 + 0.04 * math.sin(t * 0.31))
    return (gust + noise) * 0.45


def electric_renderer(t: float, rng: random.Random) -> float:
    hum = 0.28 * tone(50.0, t) + 0.13 * tone(100.0, t)
    flicker = 0.12 * tone(811.0, t) * (1 if int(t * 9) % 7 == 0 else 0.2)
    noise = (rng.random() - 0.5) * 0.035
    return (hum + flicker + noise) * 0.28


def lake_renderer(t: float, rng: random.Random) -> float:
    ripple = 0.13 * tone(166.0 + math.sin(t * 0.28) * 9.0, t)
    low = 0.22 * tone(43.0, t)
    noise = (rng.random() - 0.5) * 0.065
    return (ripple + low + noise) * 0.34


def sfx(seconds: float, renderer) -> list[float]:
    total = int(seconds * SAMPLE_RATE)
    rng = random.Random(113)
    return [renderer(i / SAMPLE_RATE, i, total, rng) * envelope(i, total, 0.015, 0.2) for i in range(total)]


def whisper(t: float, _i: int, _total: int, rng: random.Random) -> float:
    breath = (rng.random() - 0.5) * 0.28
    formant = 0.13 * tone(420.0 + math.sin(t * 19.0) * 60.0, t)
    return (breath + formant) * (0.4 + 0.6 * math.sin(t * 13.0) ** 2)


def shake(t: float, _i: int, _total: int, rng: random.Random) -> float:
    hit = math.exp(-t * 5.5) * tone(74.0 - min(t * 54.0, 45.0), t)
    grit = (rng.random() - 0.5) * math.exp(-t * 4.2)
    return 0.62 * hit + 0.22 * grit


def jumpscare(t: float, _i: int, _total: int, rng: random.Random) -> float:
    drop = tone(112.0 * math.exp(-t * 1.9) + 31.0, t)
    scrape = (rng.random() - 0.5) * math.exp(-t * 2.7)
    sting = tone(740.0 - t * 320.0, t) * math.exp(-t * 7.0)
    return 0.55 * drop + 0.3 * scrape + 0.23 * sting


def reveal(t: float, _i: int, _total: int, rng: random.Random) -> float:
    swell = (1 - math.exp(-t * 4.0)) * math.exp(-t * 1.4)
    return swell * (0.35 * tone(196.0, t) + 0.22 * tone(392.0, t, 0.4)) + (rng.random() - 0.5) * 0.025


def ending_stinger(t: float, _i: int, _total: int, _rng: random.Random) -> float:
    return math.exp(-t * 0.9) * (0.38 * tone(98.0, t) + 0.22 * tone(147.0, t, 0.7) + 0.16 * tone(294.0, t, 0.2))


def choice(t: float, _i: int, _total: int, _rng: random.Random) -> float:
    return math.exp(-t * 18.0) * (0.35 * tone(530.0, t) + 0.2 * tone(795.0, t))


def hover(t: float, _i: int, _total: int, _rng: random.Random) -> float:
    sweep = 360.0 + t * 740.0
    return math.exp(-t * 24.0) * (0.2 * tone(sweep, t) + 0.1 * tone(sweep * 1.5, t, 0.3))


def item(t: float, _i: int, _total: int, _rng: random.Random) -> float:
    return math.exp(-t * 6.0) * (0.28 * tone(330.0 + t * 90.0, t) + 0.14 * tone(660.0 + t * 120.0, t))


def ghost_hit(t: float, _i: int, _total: int, rng: random.Random) -> float:
    thud = math.exp(-t * 9.0) * tone(62.0 - min(t * 34.0, 28.0), t)
    scrape = (rng.random() - 0.5) * math.exp(-t * 5.0)
    sting = tone(510.0 - t * 260.0, t) * math.exp(-t * 13.0)
    return 0.7 * thud + 0.24 * scrape + 0.18 * sting


def death(t: float, _i: int, _total: int, rng: random.Random) -> float:
    fall = 0.52 * tone(82.0 * math.exp(-t * 0.85) + 18.0, t) * math.exp(-t * 0.72)
    hiss = (rng.random() - 0.5) * 0.17 * math.exp(-t * 1.1)
    return fall + hiss


ASSETS = {
    "sfx/shake.wav": sfx(0.95, shake),
    "sfx/jumpscare.wav": sfx(1.05, jumpscare),
    "sfx/reveal.wav": sfx(1.4, reveal),
    "sfx/ending.wav": sfx(2.8, ending_stinger),
    "sfx/hover.wav": sfx(0.12, hover),
    "sfx/item.wav": sfx(0.42, item),
    "sfx/ghost-hit.wav": sfx(0.68, ghost_hit),
    "sfx/death.wav": sfx(2.3, death),
}


def main() -> None:
    for relative_path, samples in ASSETS.items():
        write_wav(AUDIO_ROOT / relative_path, samples)
        print(f"wrote public/audio/{relative_path}")


if __name__ == "__main__":
    main()
