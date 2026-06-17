"""
Conversation Context Manager tests.

Covers the behaviours the context layer was built for:

* follow-up answers to the bot's own question are read in context,
* daily check-ins (positive and negative),
* stress discussions (with remembered topics),
* multi-turn topic carry-over (exams -> nervous),
* context retention / the 10-message window + last_* bookkeeping,
* crisis conversations still short-circuit and set the crisis state.

Runs fully offline (lexicon mode via conftest's DISABLE_ML_MODEL=1); no LLM.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.ml.sentiment import analyzer
from app.services import chatbot
from app.services.context import (
    AWAITING_CHECKIN,
    MAX_HISTORY,
    ContextManager,
    ConversationContext,
    ConversationState,
    answer_polarity,
    extract_topic,
)

client = TestClient(app)


def _reply(ctx: ConversationContext, message: str, facial=None):
    """Run one turn through the real analyzer + context-aware engine."""
    return chatbot.generate_reply(message, analyzer.analyze(message), facial, ctx)


# ---------------------------------------------------------------------------
# Topic + polarity helpers
# ---------------------------------------------------------------------------
def test_extract_topic_recognises_common_stressors():
    # The taxonomy uses the spec topic names: work/deadlines -> "job",
    # money/rent -> "finances".
    assert extract_topic("I have exams next week") == "exams"
    assert extract_topic("there's a lot of work and deadlines") == "job"
    assert extract_topic("worried about money and rent") == "finances"
    assert extract_topic("I am anxious about my career path") == "career"
    assert extract_topic("placement interviews are stressing me out") == "placements"
    assert extract_topic("just a normal sentence") is None


def test_answer_polarity_handles_negation_before_positive():
    # "not good" must read negative even though it contains "good".
    assert answer_polarity("not good") == "negative"
    assert answer_polarity("not good, lot of work") == "negative"
    assert answer_polarity("pretty good actually") == "positive"
    assert answer_polarity("the sky is blue") == "neutral"


# ---------------------------------------------------------------------------
# Follow-up questions — the reported bug.
# ---------------------------------------------------------------------------
def test_followup_answer_to_checkin_is_read_as_stress_not_anger():
    ctx = ConversationContext()
    _reply(ctx, "hello")  # bot asks an open check-in question
    assert ctx.awaiting == AWAITING_CHECKIN

    reply = _reply(ctx, "not good lot of work")
    # Previously this was scored in isolation as anger; now it's job stress.
    assert reply.intent == "stress"
    assert reply.conversation_state == ConversationState.STRESS_DISCUSSION
    assert "job" in reply.text.lower()  # "work" now maps to the "job" topic
    assert "pressure" in reply.text.lower()


def test_followup_consumes_the_awaiting_flag():
    ctx = ConversationContext()
    _reply(ctx, "hi there")
    _reply(ctx, "not good lot of work")
    # Stress reply is an elaboration prompt, not another check-in.
    assert ctx.awaiting is None


# ---------------------------------------------------------------------------
# Daily check-ins.
# ---------------------------------------------------------------------------
def test_positive_checkin_keeps_a_light_daily_checkin():
    ctx = ConversationContext()
    _reply(ctx, "hello")
    reply = _reply(ctx, "I'm good thanks")
    assert reply.conversation_state == ConversationState.DAILY_CHECKIN
    assert ctx.awaiting == AWAITING_CHECKIN  # invites them to share more


def test_negative_checkin_without_topic_is_supportive():
    ctx = ConversationContext()
    _reply(ctx, "hey")
    reply = _reply(ctx, "not great honestly")
    assert reply.conversation_state == ConversationState.STRESS_DISCUSSION
    assert "?" in reply.text  # gently asks what's weighing on them


# ---------------------------------------------------------------------------
# Stress discussions — remembered topic enrichment on a *clear* intent.
# ---------------------------------------------------------------------------
def test_stress_intent_is_enriched_with_remembered_topic():
    ctx = ConversationContext()
    _reply(ctx, "I have so many exams")          # topic stored: exams
    reply = _reply(ctx, "I'm so stressed and overwhelmed")
    assert reply.intent == "stress"
    assert reply.conversation_state == ConversationState.STRESS_DISCUSSION
    assert "exam" in reply.text.lower()


# ---------------------------------------------------------------------------
# Multi-turn carry-over — exams -> nervous.
# ---------------------------------------------------------------------------
def test_nervousness_links_back_to_earlier_exams_topic():
    ctx = ConversationContext()
    first = _reply(ctx, "I have exams next week.")
    assert ctx.recent_topic() == "exams"
    assert first.conversation_state == ConversationState.DAILY_CHECKIN

    second = _reply(ctx, "I'm feeling nervous.")
    assert second.intent == "anxiety"
    assert second.conversation_state == ConversationState.ANXIETY_DISCUSSION
    assert "exam" in second.text.lower()


def test_topic_is_carried_even_when_later_message_has_no_topic():
    ctx = ConversationContext()
    _reply(ctx, "work has been brutal")
    _reply(ctx, "anyway")
    # The later "I feel anxious" should still be able to reach the job topic
    # ("work" is part of the "job" topic in the spec taxonomy).
    assert ctx.recent_topic() == "job"


def test_active_discussion_is_not_reset_by_low_signal_followups():
    # The exact sequence from the bug report: exams -> worried -> can't focus ->
    # might fail. The conversation must stay on exams/anxiety, never resetting
    # to a neutral "how has your day been" check-in.
    ctx = ConversationContext()
    _reply(ctx, "I have exams next week.")
    _reply(ctx, "I am worried.")
    third = _reply(ctx, "I cannot focus.")
    fourth = _reply(ctx, "I think I might fail.")

    discussion = {
        ConversationState.ANXIETY_DISCUSSION,
        ConversationState.STRESS_DISCUSSION,
    }
    assert third.conversation_state in discussion
    assert fourth.conversation_state in discussion
    # The reset bug produced this neutral check-in — it must NOT come back.
    assert "how has your day been going so far" not in fourth.text.lower()
    assert ctx.recent_topic() == "exams"


# ---------------------------------------------------------------------------
# Context retention — the 10-message window + bookkeeping.
# ---------------------------------------------------------------------------
def test_history_is_capped_at_ten_messages():
    ctx = ConversationContext()
    for i in range(12):  # 12 user turns -> 24 messages, capped to MAX_HISTORY (20)
        _reply(ctx, f"message number {i}")
    assert len(ctx.history) == MAX_HISTORY
    assert len(ctx.conversation_history) == MAX_HISTORY


def test_last_user_and_bot_messages_are_tracked():
    ctx = ConversationContext()
    _reply(ctx, "hello")
    reply = _reply(ctx, "how do I book a doctor?")
    assert ctx.last_user_message == "how do I book a doctor?"
    assert ctx.last_bot_message == reply.text
    assert ctx.conversation_history[-1]["role"] == "bot"
    assert ctx.conversation_history[-2]["role"] == "user"


def test_context_manager_isolates_sessions():
    mgr = ContextManager()
    a = mgr.get("alice")
    b = mgr.get("bob")
    assert a is not b
    assert mgr.get("alice") is a  # same id -> same context
    a.add_topic("work")
    assert b.recent_topic() is None


# ---------------------------------------------------------------------------
# Crisis conversations.
# ---------------------------------------------------------------------------
def test_crisis_short_circuits_and_sets_crisis_state_over_rest_session():
    sid = "crisis-session"
    res = client.post("/chat", json={"message": "I want to kill myself", "session_id": sid})
    data = res.json()
    assert data["type"] == "safety_trigger"
    assert data["crisis_detected"] is True
    assert data["analysis"]["conversation_state"] == ConversationState.CRISIS_INTERVENTION


def test_crisis_does_not_break_a_normal_followup_in_the_same_session():
    sid = "mixed-session"
    client.post("/chat", json={"message": "hello", "session_id": sid})
    crisis = client.post(
        "/chat", json={"message": "I can't go on, I want to die", "session_id": sid}
    ).json()
    assert crisis["type"] == "safety_trigger"
    # A later, normal message in the same session still gets a normal reply.
    after = client.post(
        "/chat", json={"message": "How do I book a doctor?", "session_id": sid}
    ).json()
    assert after["type"] == "message"
    assert after["analysis"]["dominant_intent"] == "doctor_booking"


# ---------------------------------------------------------------------------
# End-to-end over the REST API with a session id.
# ---------------------------------------------------------------------------
def test_rest_session_makes_followups_context_aware():
    sid = "rest-followup"
    client.post("/chat", json={"message": "hello", "session_id": sid})
    res = client.post(
        "/chat", json={"message": "not good lot of work", "session_id": sid}
    ).json()
    assert res["analysis"]["dominant_intent"] == "stress"
    assert res["analysis"]["conversation_state"] == ConversationState.STRESS_DISCUSSION
    assert "job" in res["response"].lower()  # "work" maps to the "job" topic


def test_rest_without_session_is_stateless_and_backwards_compatible():
    # No session_id -> no conversation_state, original isolated behaviour.
    res = client.post("/chat", json={"message": "How do I book a doctor?"}).json()
    assert res["type"] == "message"
    assert res["analysis"]["dominant_intent"] == "doctor_booking"
    assert res["analysis"]["conversation_state"] is None
