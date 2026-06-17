"""
Retrieval-engine tests for the MindEase KB.
"""
from app.services.retrieval import kb_size, retrieve, pick_by_topic, get_engine


def test_knowledge_base_is_non_trivial():
    assert kb_size() >= 30


def test_retrieve_returns_career_entry_for_career_query():
    result = retrieve("I am worried about my career.", topic="career", emotion="fear", message_topic="career")
    assert result is not None
    assert result.entry.topic == "career"
    assert result.cosine > 0
    assert result.score >= result.cosine
    assert "career" in result.entry.question.lower() or "career" in result.entry.response.lower()


def test_topic_bias_prefers_in_topic_entry_for_short_followup():
    result = retrieve("I am worried about my career.", topic="career", emotion="fear", message_topic="career")
    assert result is not None
    assert result.entry.topic == "career"


def test_pick_by_topic_returns_topic_entry():
    entry = pick_by_topic("exams", emotion="fear")
    assert entry is not None
    assert entry.topic == "exams"


def test_engine_topics_include_core_student_stressors():
    topics = get_engine().topics
    for topic in {"career", "exams", "placements", "relationships", "finances"}:
        assert topic in topics