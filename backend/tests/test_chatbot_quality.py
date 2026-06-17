"""
Quality tests for the upgraded offline MindEase chatbot engine.
Verifies multi-turn topic memory, single focused question constraint,
varied lead-in pools, and patient database personalization.
"""
from app.services import chatbot
from app.services.context import ConversationContext
from app.ml.sentiment import AnalysisResult

class MockAnalysis(AnalysisResult):
    def __init__(self, sentiment=None):
        self.sentiment = sentiment or {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "neutral": 1.0}
        self.score = 0.0
        self.crisis_score = 0.0
        self.raw_text = ""

def test_multi_turn_topic_retention_cheating():
    # Initialize a clean context
    ctx = ConversationContext(session_id="test_session")
    
    # User mentions relationship cheating
    msg1 = "I think my girlfriend is cheating on me"
    analysis1 = MockAnalysis(sentiment={"sadness": 0.5, "neutral": 0.5})
    
    reply1 = chatbot.generate_reply(msg1, analysis1, context=ctx)
    
    # The active topic should resolve to 'relationships'
    assert ctx.recent_topic() == "relationships"
    assert any(keyword in reply1.text.lower() for keyword in ["relationship", "cheating", "trust", "betray"])
    
    # Follow-up: User sends a terse message with no topic keywords
    msg2 = "I feel so anxious and lost"
    analysis2 = MockAnalysis(sentiment={"fear": 0.8})
    
    reply2 = chatbot.generate_reply(msg2, analysis2, context=ctx)
    
    # The active topic should STILL be 'relationships'
    assert ctx.recent_topic() == "relationships"
    # The response should carry the relationship context (lead-in contains relationship topic phrase)
    assert any(phrase in reply2.text.lower() for phrase in ["relationship", "strains", "cheating"])

def test_single_focused_question_constraint():
    # Every generated reply from greetings, fallback, intents, mismatch, etc. should have at most ONE question mark.
    ctx = ConversationContext(session_id="test_session_q")
    
    messages = [
        ("hello", MockAnalysis()),
        ("I'm feeling really stressed about work", MockAnalysis(sentiment={"anger": 0.8})),
        ("Can you help me with meditation?", MockAnalysis()),
        ("I want to book a doctor", MockAnalysis()),
        ("How do I view my clinical reports?", MockAnalysis()),
        ("Is my data private?", MockAnalysis()),
    ]
    
    for msg, analysis in messages:
        reply = chatbot.generate_reply(msg, analysis, context=ctx)
        # Count the number of question marks in the response
        q_count = reply.text.count("?")
        assert q_count <= 1, f"Response has {q_count} questions: {reply.text}"

def test_custom_lead_in_variations():
    # If the user is feeling sad, it should prepend one of the custom lead-ins.
    msg = "Is my data private?"
    analysis = MockAnalysis(sentiment={"sadness": 0.9})
    
    # Generate multiple times to get a feel of random variations
    replies = [chatbot.generate_reply(msg, analysis).text for _ in range(20)]
    
    # Let's assert we get at least some of our custom sadness lead-ins
    sadness_lead_in_keywords = [
        "heavy weight", "feeling so dark", "feeling down", "sadness in what",
        "incredibly hard", "okay to feel sad", "close attention", "quiet strength"
    ]
    matches = [
        any(keyword in reply for keyword in sadness_lead_in_keywords)
        for reply in replies
    ]
    # At least some of the replies should prepend a sadness lead-in
    assert any(matches)

def test_personalization_injections():
    # Case 1: Proactive wellness observation (sleep)
    signals_sleep = {
        "habit_summary": {
            "logged_days": 5,
            "metrics": [
                {"key": "sleepHours", "logged_days": 5, "adherence": 0.5, "avg": 5.2}
            ]
        },
        "mood_summary": {"periods": []},
        "active_plan": True
    }
    
    reply1 = chatbot.inject_patient_context(
        text="How has your day been going so far?",
        recent_journals=[],
        recent_cbt=[],
        intent="greetings",
        signals=signals_sleep
    )
    assert "averaged about 5 hours of sleep" in reply1
    assert "wellness plan" in reply1
    
    # Case 2: Matching journal entry to active topic
    recent_journals = [
        {"topic": "career stress", "title": "Job interview prep", "ts": 123456}
    ]
    reply2 = chatbot.inject_patient_context(
        text="Neutral response",
        recent_journals=recent_journals,
        recent_cbt=[],
        intent="greetings",
        active_topic="career"
    )
    assert "Job interview prep" in reply2
    assert "explore those feelings" in reply2
