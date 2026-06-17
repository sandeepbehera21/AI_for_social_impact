"""
Topic-continuity tests for the MindEase retrieval chatbot.
"""
from app.ml.sentiment import analyzer
from app.services import chatbot
from app.services.context import ConversationContext


def _reply(ctx: ConversationContext, message: str):
    return chatbot.generate_reply(message, analyzer.analyze(message), None, ctx)


def test_career_flow_stays_on_career():
    ctx = ConversationContext()
    first = _reply(ctx, "I am worried about my career.")
    second = _reply(ctx, "I feel anxiety.")
    assert ctx.recent_topic() == "career"
    assert "career" in first.text.lower() or "career" in second.text.lower()
    assert "anxiety" in second.text.lower() or "career" in second.text.lower()


def test_exams_flow_stays_on_exams():
    ctx = ConversationContext()
    _reply(ctx, "My exams are next week.")
    second = _reply(ctx, "I can't focus.")
    assert ctx.recent_topic() == "exams"
    assert "exam" in second.text.lower()


def test_placements_flow_is_placement_specific():
    ctx = ConversationContext()
    reply = _reply(ctx, "I am scared about placements.")
    assert ctx.recent_topic() == "placements"
    assert "placement" in reply.text.lower()


def test_relationship_flow_is_relationship_specific():
    ctx = ConversationContext()
    reply = _reply(ctx, "My relationship is causing stress.")
    assert ctx.recent_topic() == "relationships"
    assert "relationship" in reply.text.lower()


def test_financial_flow_is_finance_specific():
    ctx = ConversationContext()
    reply = _reply(ctx, "I am worried about money.")
    assert ctx.recent_topic() == "finances"
    assert "money" in reply.text.lower() or "financial" in reply.text.lower()