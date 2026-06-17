"""
Offline TF-IDF + cosine-similarity retrieval engine for MindEase.

This is the heart of the upgrade from a template-only chatbot to a true
**retrieval-based** one. It indexes a structured knowledge base
(:mod:`app.data.mindease_kb`) of empathetic, MindEase-grounded responses and,
for any incoming user message, ranks the best-matching entry by lexical
similarity — then lets the caller bias that ranking by the conversation's
**active topic** and **emotional state** so replies stay on-thread.

Everything here is pure Python with **no external dependencies** (no
scikit-learn, no numpy) — matching the dependency-free, fully-offline,
privacy-first design of :mod:`app.services.intents`. No LLM, no network.

Pipeline
--------
1. **Tokenize** — lowercase, split on word boundaries, drop stop-words, and
   apply light suffix stemming so "worried"/"worry"/"worries" collide.
2. **TF-IDF** — term frequency (sub-linear, ``1 + log(count)``) times inverse
   document frequency (smoothed ``log((1 + N) / (1 + df)) + 1``) over the KB,
   built once at import and cached.
3. **Cosine similarity** — L2-normalised sparse dot product between the query
   vector and every document vector.
4. **Topic + emotion ranking** — a multiplicative boost for entries whose topic
   matches the active conversation topic, plus a smaller boost for a matching
   emotion, so career anxiety retrieves career answers rather than generic ones.

The result is a :class:`Retrieval` (best entry + score) the chatbot composes a
final, conversational reply from. When the top score is below
``MIN_SIMILARITY`` the caller falls back to its templates — retrieval never
forces a bad match.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# Knowledge base location (sits beside the code, ships with the package).
_KB_PATH = Path(__file__).resolve().parent.parent / "data" / "mindease_kb.json"

# A cosine score at/above this is a "real" match; below it the caller should
# prefer its own templated fallback rather than surface a weak retrieval.
MIN_SIMILARITY = 0.12

# Ranking boosts (multiplicative on the cosine score).
TOPIC_BOOST = 1.6      # entry topic == active conversation topic
EMOTION_BOOST = 1.25   # entry emotion == user's dominant emotion
# When the user message itself names a topic that disagrees with an entry's
# topic, gently penalise it so an off-topic-but-wordy entry can't win.
TOPIC_MISMATCH_PENALTY = 0.6


# ---------------------------------------------------------------------------
# Tokenization
# ---------------------------------------------------------------------------
# Compact English stop-word list — enough to strip the high-frequency function
# words that would otherwise dominate TF-IDF, without needing nltk.
_STOPWORDS: frozenset[str] = frozenset(
    """
    a an and are as at be been being but by for from had has have he her here him
    his how i if in into is it its just me my of on or our so that the their them
    then there these they this to was we were what when where which who will with
    you your yours am does did do done having had not no nor too very can could
    would should may might must shall about over under again more most some such
    only own same than once because while during each few other up out off down
    get got also any all both
    """.split()
)

# Light suffix stemmer: collapse common inflections so "worried", "worrying"
# and "worries" share a stem. Order matters — longest suffix first.
_SUFFIXES: tuple[str, ...] = ("ically", "ation", "ing", "ies", "ied", "ment", "ness", "ly", "ed", "es", "s")

_TOKEN_RE = re.compile(r"[a-z']+")


_SYNONYMS: dict[str, str] = {
    "anxious": "anxiety",
    "nervous": "anxiety",
    "panicked": "anxiety",
    "panic": "anxiety",
    "worried": "anxiety",
    "worry": "anxiety",
    "scared": "fear",
    "frightened": "fear",
    "afraid": "fear",
    "sad": "sadness",
    "depressed": "depression",
    "down": "sadness",
    "low": "sadness",
    "angry": "anger",
    "mad": "anger",
    "furious": "anger",
    "frustrated": "anger",
    "annoyed": "anger",
    "irritated": "anger",
    "exhausted": "burnout",
    "tired": "burnout",
    "drained": "burnout",
    "fatigued": "burnout",
    "lonely": "loneliness",
    "alone": "loneliness",
    "grieving": "grief",
    "grief": "grief",
    "mourning": "grief",
    "placement": "placements",
    "interview": "placements",
    "exam": "exams",
    "test": "exams",
    "finals": "exams",
    "study": "studies",
    "homework": "studies",
    "assignment": "studies",
    "money": "finances",
    "financial": "finances",
    "cash": "finances",
    "bills": "finances",
    "sleep": "sleep",
    "insomnia": "sleep",
    "nightmare": "sleep",
    "relationship": "relationships",
    "partner": "relationships",
    "motivation": "motivation",
    "lazy": "motivation",
    "procrastinating": "motivation",
    "career": "career",
    "vocation": "career",
    "job": "job",
    "work": "job",
    "office": "job",
    "boss": "job",
    "family": "family",
    "parents": "family",
    "conflict": "conflict",
    "fight": "conflict"
}


def _stem(token: str) -> str:
    """Crude but stable suffix stripping. Never shortens below 3 chars."""
    # Map "ies"/"ied" -> "y" (worries -> worry, studied -> study).
    if token.endswith(("ies", "ied")) and len(token) > 4:
        return token[:-3] + "y"
    for suf in _SUFFIXES:
        if token.endswith(suf) and len(token) - len(suf) >= 3:
            return token[: -len(suf)]
    return token


def tokenize(text: str) -> list[str]:
    """Lowercase, split to word tokens, drop stop-words, map synonyms, and light-stem."""
    tokens = _TOKEN_RE.findall((text or "").lower())
    out: list[str] = []
    for tok in tokens:
        tok = tok.strip("'")
        if len(tok) < 2 or tok in _STOPWORDS:
            continue
        canonical = _SYNONYMS.get(tok, tok)
        out.append(_stem(canonical))
    return out


# ---------------------------------------------------------------------------
# TF-IDF vectors
# ---------------------------------------------------------------------------
def _term_freq(tokens: list[str]) -> dict[str, float]:
    """Sub-linear term frequency: ``1 + log(count)`` per distinct term."""
    counts: dict[str, int] = {}
    for tok in tokens:
        counts[tok] = counts.get(tok, 0) + 1
    return {term: 1.0 + math.log(c) for term, c in counts.items()}


@dataclass(frozen=True)
class KBEntry:
    """One knowledge-base row plus its (lazily filled) TF-IDF vector."""

    question: str
    response: str
    topic: str
    emotion: str
    intent: str
    vector: dict[str, float] = field(default_factory=dict)
    norm: float = 0.0


@dataclass(frozen=True)
class Retrieval:
    """The best KB match for a query, after topic/emotion-aware ranking."""

    entry: KBEntry
    score: float            # final ranked score (cosine * boosts)
    cosine: float           # raw cosine similarity before boosts
    matched_topic: bool     # whether the entry's topic was actively boosted


class RetrievalEngine:
    """Builds the TF-IDF index once and answers ranked similarity queries."""

    def __init__(self, entries: list[dict]) -> None:
        self._idf: dict[str, float] = {}
        self.entries: list[KBEntry] = []
        self.topics: set[str] = set()
        self._build(entries)

    # -- index construction -------------------------------------------------
    def _build(self, rows: list[dict]) -> None:
        # 1. Tokenize every document (question + response give richer context
        #    for matching paraphrases than the question alone).
        doc_tokens: list[list[str]] = []
        for row in rows:
            text = f"{row.get('question', '')} {row.get('response', '')}"
            doc_tokens.append(tokenize(text))

        n_docs = len(rows) or 1

        # 2. Document frequency -> smoothed IDF.
        df: dict[str, int] = {}
        for tokens in doc_tokens:
            for term in set(tokens):
                df[term] = df.get(term, 0) + 1
        self._idf = {
            term: math.log((1 + n_docs) / (1 + d)) + 1.0 for term, d in df.items()
        }

        # 3. Per-document TF-IDF vector + L2 norm.
        for row, tokens in zip(rows, doc_tokens):
            vec = self._vectorize(tokens)
            norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
            self.entries.append(
                KBEntry(
                    question=row.get("question", ""),
                    response=row.get("response", ""),
                    topic=row.get("topic", "general"),
                    emotion=row.get("emotion", "neutral"),
                    intent=row.get("intent", ""),
                    vector=vec,
                    norm=norm,
                )
            )
            self.topics.add(row.get("topic", "general"))

    def _vectorize(self, tokens: list[str]) -> dict[str, float]:
        """TF-IDF weight per term (unknown-at-build terms get a neutral IDF)."""
        tf = _term_freq(tokens)
        return {term: w * self._idf.get(term, 1.0) for term, w in tf.items()}

    # -- query --------------------------------------------------------------
    def _cosine(self, query_vec: dict[str, float], q_norm: float, entry: KBEntry) -> float:
        """Cosine similarity between a query vector and a KB entry vector."""
        # Iterate the smaller vector for the sparse dot product.
        if len(query_vec) <= len(entry.vector):
            small, large = query_vec, entry.vector
        else:
            small, large = entry.vector, query_vec
        dot = sum(w * large.get(term, 0.0) for term, w in small.items())
        denom = q_norm * entry.norm
        return dot / denom if denom else 0.0

    def search(
        self,
        message: str,
        *,
        topic: str | None = None,
        emotion: str | None = None,
        message_topic: str | None = None,
        top_k: int = 1,
    ) -> list[Retrieval]:
        """
        Rank KB entries for *message*, biased by conversation *topic*/*emotion*.

        * ``topic`` — the active conversation topic (career, exams, …). Entries
          on this topic get :data:`TOPIC_BOOST`.
        * ``emotion`` — the user's dominant emotion bucket; matching entries get
          :data:`EMOTION_BOOST`.
        * ``message_topic`` — a topic detected *in this very message*. When an
          entry's topic disagrees with it, the entry is penalised so a wordy
          off-topic row can't out-rank an on-topic one.

        Returns up to ``top_k`` :class:`Retrieval` results, best first.
        """
        q_tokens = tokenize(message)
        if not q_tokens:
            return []
        query_vec = self._vectorize(q_tokens)
        q_norm = math.sqrt(sum(v * v for v in query_vec.values())) or 1.0

        scored: list[Retrieval] = []
        for entry in self.entries:
            cosine = self._cosine(query_vec, q_norm, entry)
            if cosine <= 0.0:
                continue
            score = cosine
            matched_topic = False
            if topic and entry.topic == topic:
                score *= TOPIC_BOOST
                matched_topic = True
            if emotion and entry.emotion == emotion:
                score *= EMOTION_BOOST
            # A topic named in the message that disagrees with this entry: damp it.
            if message_topic and entry.topic not in (message_topic, "general"):
                score *= TOPIC_MISMATCH_PENALTY
            scored.append(
                Retrieval(entry=entry, score=score, cosine=cosine, matched_topic=matched_topic)
            )

        scored.sort(key=lambda r: r.score, reverse=True)
        return scored[: max(1, top_k)]

    def best(
        self,
        message: str,
        *,
        topic: str | None = None,
        emotion: str | None = None,
        message_topic: str | None = None,
    ) -> Retrieval | None:
        """Single best match, or ``None`` when nothing clears MIN_SIMILARITY."""
        results = self.search(
            message, topic=topic, emotion=emotion, message_topic=message_topic, top_k=1
        )
        if not results:
            return None
        top = results[0]
        # Gate on the *raw* cosine so a boost can't smuggle a weak match through.
        if top.cosine < MIN_SIMILARITY:
            return None
        return top

    def pick_by_topic(self, topic: str, emotion: str | None = None) -> KBEntry | None:
        """
        Structured (non-lexical) selector for **topic continuity**.

        When a follow-up like *"I feel anxiety"* has too little lexical overlap
        to retrieve the active topic by cosine alone, this returns the best
        in-topic entry — preferring one whose emotion matches *emotion* — so the
        conversation stays on, say, career rather than drifting to whichever
        entry happens to share a rare word. Returns ``None`` if the topic is
        absent from the KB.
        """
        candidates = [e for e in self.entries if e.topic == topic]
        if not candidates:
            return None
        if emotion:
            matches = [e for e in candidates if e.emotion == emotion]
            if matches:
                return matches[0]
        return candidates[0]


# ---------------------------------------------------------------------------
# Module-level singleton (index built once, on first import).
# ---------------------------------------------------------------------------
@lru_cache(maxsize=1)
def _load_entries() -> list[dict]:
    try:
        with _KB_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return list(data.get("entries", []))
    except (OSError, json.JSONDecodeError):  # pragma: no cover - defensive
        return []


@lru_cache(maxsize=1)
def get_engine() -> RetrievalEngine:
    """Return the process-wide retrieval engine (lazily built, then cached)."""
    return RetrievalEngine(_load_entries())


# Convenience top-level helpers ------------------------------------------------
def retrieve(
    message: str,
    *,
    topic: str | None = None,
    emotion: str | None = None,
    message_topic: str | None = None,
) -> Retrieval | None:
    """Best topic/emotion-aware KB match for *message* (or ``None``)."""
    return get_engine().best(
        message, topic=topic, emotion=emotion, message_topic=message_topic
    )


def pick_by_topic(topic: str, emotion: str | None = None) -> KBEntry | None:
    """Best in-topic KB entry for topic continuity (see :meth:`pick_by_topic`)."""
    return get_engine().pick_by_topic(topic, emotion)


def kb_size() -> int:
    """Number of indexed knowledge-base entries (for /health + reports)."""
    return len(get_engine().entries)


def kb_topics() -> tuple[str, ...]:
    """Sorted tuple of topics present in the knowledge base."""
    return tuple(sorted(get_engine().topics))
