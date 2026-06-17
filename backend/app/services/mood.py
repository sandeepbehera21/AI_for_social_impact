"""
Mood-history aggregation.

Pure, dependency-free functions that turn a list of facial-emotion samples
(recorded on-device while the patient chats with the camera on) into daily /
weekly / monthly summaries, a dominant emotion, an average confidence, and an
emotional-risk indicator.

Kept free of any Firestore/IO so it is trivially unit-testable; the API layer
(:mod:`app.api.mood`) reads the raw samples via the Admin SDK and hands them
here, and the clinical report builder reuses the same summariser.

A sample is a plain dict:
    {"dominantEmotion": "Sad", "confidence": 0.78, "ts": 1718000000000}
``ts`` is client epoch-milliseconds (so ordering/windowing needs no server
clock). Unknown/short samples are ignored defensively.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# The five buckets the whole product speaks in (display casing).
EMOTIONS: tuple[str, ...] = ("Happy", "Sad", "Angry", "Fear", "Neutral")
# Negative-affect buckets and their weight in the risk score (anger lower —
# frustration is not the same as distress).
_DISTRESS_WEIGHTS: dict[str, float] = {"Sad": 1.0, "Fear": 1.0, "Angry": 0.5}

_DAY_MS = 24 * 60 * 60 * 1000
WINDOWS: dict[str, int] = {"daily": _DAY_MS, "weekly": 7 * _DAY_MS, "monthly": 30 * _DAY_MS}


def _canon(label: str | None) -> str | None:
    """Normalise a label to one of EMOTIONS (accepts NLP-style spellings too)."""
    if not label:
        return None
    key = str(label).strip().lower()
    mapping = {
        "happy": "Happy", "joy": "Happy",
        "sad": "Sad", "sadness": "Sad",
        "angry": "Angry", "anger": "Angry",
        "fear": "Fear", "fearful": "Fear",
        "neutral": "Neutral",
    }
    return mapping.get(key)


def risk_level(risk_score: float) -> str:
    """Bucket a [0,1] risk score into a human label."""
    if risk_score >= 0.6:
        return "high"
    if risk_score >= 0.4:
        return "elevated"
    if risk_score >= 0.2:
        return "moderate"
    return "low"


@dataclass
class PeriodSummary:
    period: str
    samples: int = 0
    dominant: str | None = None
    distribution: dict[str, float] = field(default_factory=lambda: {e: 0.0 for e in EMOTIONS})
    avg_confidence: float = 0.0
    risk_score: float = 0.0
    risk_level: str = "low"

    def as_dict(self) -> dict:
        return {
            "period": self.period,
            "samples": self.samples,
            "dominant": self.dominant,
            "distribution": self.distribution,
            "avg_confidence": self.avg_confidence,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level,
        }


def _summarise_window(period: str, samples: list[dict]) -> PeriodSummary:
    counts = {e: 0 for e in EMOTIONS}
    conf_total = 0.0
    n = 0
    for s in samples:
        emo = _canon(s.get("dominantEmotion"))
        if emo is None:
            continue
        counts[emo] += 1
        try:
            conf_total += max(0.0, min(1.0, float(s.get("confidence", 0.0))))
        except (TypeError, ValueError):
            pass
        n += 1

    if n == 0:
        return PeriodSummary(period=period)

    distribution = {e: round(counts[e] / n, 4) for e in EMOTIONS}
    dominant = max(EMOTIONS, key=lambda e: counts[e])
    # Distress mass over the window, weighted by how strongly each bucket counts.
    risk = round(
        min(1.0, sum(distribution[e] * w for e, w in _DISTRESS_WEIGHTS.items())), 4
    )
    return PeriodSummary(
        period=period,
        samples=n,
        dominant=dominant,
        distribution=distribution,
        avg_confidence=round(conf_total / n, 4),
        risk_score=risk,
        risk_level=risk_level(risk),
    )


def summarize(entries: list[dict], *, now_ms: int) -> dict:
    """
    Build the full mood summary from raw samples.

    Returns:
        {
          "total_samples": int,
          "latest": {dominantEmotion, confidence, ts} | None,
          "periods": [ {daily…}, {weekly…}, {monthly…} ],
        }
    """
    clean = [e for e in entries if _canon(e.get("dominantEmotion")) is not None]
    clean.sort(key=lambda e: e.get("ts", 0))
    latest = clean[-1] if clean else None

    periods = []
    for name, span in WINDOWS.items():
        cutoff = now_ms - span
        window = [e for e in clean if e.get("ts", 0) >= cutoff]
        periods.append(_summarise_window(name, window).as_dict())

    return {
        "total_samples": len(clean),
        "latest": (
            {
                "dominantEmotion": _canon(latest.get("dominantEmotion")),
                "confidence": round(float(latest.get("confidence", 0.0)), 4),
                "ts": latest.get("ts", 0),
            }
            if latest
            else None
        ),
        "periods": periods,
    }


def report_emotion_summary(entries: list[dict], *, now_ms: int) -> dict | None:
    """
    Condense mood history into the three short prose blocks the clinical PDF
    surfaces: a text-sentiment line, a facial-emotion line, and the dominant
    emotional patterns. Returns ``None`` when there's nothing to report.
    """
    summary = summarize(entries, now_ms=now_ms)
    if summary["total_samples"] == 0:
        return None

    monthly = next((p for p in summary["periods"] if p["period"] == "monthly"), None)
    weekly = next((p for p in summary["periods"] if p["period"] == "weekly"), None)
    base = monthly if monthly and monthly["samples"] else weekly
    if not base or not base["samples"]:
        return None

    dist = base["distribution"]
    top = sorted(EMOTIONS, key=lambda e: dist[e], reverse=True)
    pct = {e: round(dist[e] * 100) for e in EMOTIONS}
    patterns = ", ".join(f"{e} {pct[e]}%" for e in top if pct[e] > 0) or "Neutral"

    return {
        "facial_summary": (
            f"Across {base['samples']} on-device facial-emotion samples, the patient's "
            f"dominant expression was {base['dominant']} "
            f"(average confidence {round(base['avg_confidence'] * 100)}%)."
        ),
        "patterns": patterns,
        "risk_summary": (
            f"Emotional-risk indicator: {base['risk_level'].upper()} "
            f"(score {base['risk_score']:.2f})."
        ),
    }
