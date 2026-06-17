"""
Clinical PDF report generation (reportlab).

`build_clinical_pdf` renders a structured, single-document clinical report —
patient & doctor identity, timestamp, session notes, diagnosis, prescriptions,
and a signature block — and returns the raw PDF bytes. Those bytes are what the
backend then SHA-256-hashes and RSA-signs, so the signature covers the exact
file the patient later verifies.

Integrity note: reportlab embeds a random document id, so two builds of the same
report are NOT byte-identical. That's fine — we persist the *exact* signed bytes
and serve those back, so the signature always matches the stored PDF. We never
re-render to verify.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_ACCENT = colors.HexColor("#0d9488")  # teal — matches the MindEase palette
_MUTED = colors.HexColor("#475569")


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ME_Title", parent=base["Title"], fontSize=20, textColor=_ACCENT,
            spaceAfter=2, alignment=TA_CENTER,
        ),
        "subtitle": ParagraphStyle(
            "ME_Subtitle", parent=base["Normal"], fontSize=9, textColor=_MUTED,
            alignment=TA_CENTER, spaceAfter=10,
        ),
        "section": ParagraphStyle(
            "ME_Section", parent=base["Heading2"], fontSize=12, textColor=_ACCENT,
            spaceBefore=12, spaceAfter=4,
        ),
        "label": ParagraphStyle(
            "ME_Label", parent=base["Normal"], fontSize=9, textColor=_MUTED,
        ),
        "body": ParagraphStyle(
            "ME_Body", parent=base["Normal"], fontSize=10.5, leading=15,
        ),
        "mono": ParagraphStyle(
            "ME_Mono", parent=base["Code"], fontSize=7.5, textColor=_MUTED,
            wordWrap="CJK",
        ),
    }


def _para(text: str, style) -> Paragraph:
    """Paragraph that preserves line breaks and is XML-safe."""
    safe = (
        (text or "—")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\n", "<br/>")
    )
    return Paragraph(safe, style)


def build_clinical_pdf(
    *,
    appointment_id: str,
    patient_name: str,
    doctor_name: str,
    session_datetime: str | None,
    completed_at: datetime,
    session_notes: str,
    diagnosis: str,
    prescriptions: str,
    public_key_fingerprint: str = "",
    emotion_summary: dict | None = None,
) -> bytes:
    """
    Render the clinical report and return PDF bytes.

    ``completed_at`` is also stamped into the PDF metadata so output is stable.
    ``emotion_summary`` (optional) adds an "Emotional Analysis" section built
    from the patient's on-device mood history — keys: ``facial_summary``,
    ``patterns``, ``risk_summary``, ``text_summary`` (any subset).
    """
    styles = _styles()
    buf = io.BytesIO()

    stamp = completed_at.astimezone(timezone.utc)
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        title=f"Clinical Report — {appointment_id}",
        author=doctor_name,
        subject="MindEase Clinical Session Report",
        creator="MindEase",
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    flow = []
    flow.append(_para("MindEase Clinical Report", styles["title"]))
    flow.append(
        _para("Confidential — Telehealth Session Summary", styles["subtitle"])
    )
    flow.append(HRFlowable(width="100%", color=_ACCENT, thickness=1.2))
    flow.append(Spacer(1, 8))

    # ---- Identity / metadata table ----
    meta_rows = [
        [_para("Patient", styles["label"]), _para(patient_name, styles["body"])],
        [_para("Attending Doctor", styles["label"]), _para(f"Dr. {doctor_name}", styles["body"])],
        [
            _para("Session Date", styles["label"]),
            _para(_fmt_dt(session_datetime) or "—", styles["body"]),
        ],
        [
            _para("Report Generated", styles["label"]),
            _para(stamp.strftime("%Y-%m-%d %H:%M UTC"), styles["body"]),
        ],
        [_para("Appointment ID", styles["label"]), _para(appointment_id, styles["body"])],
    ]
    table = Table(meta_rows, colWidths=[40 * mm, None])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LINEBELOW", (0, 0), (-1, -2), 0.4, colors.HexColor("#e2e8f0")),
            ]
        )
    )
    flow.append(table)

    # ---- Clinical sections ----
    for heading, content in (
        ("Session Notes", session_notes),
        ("Diagnosis", diagnosis),
        ("Prescriptions", prescriptions),
    ):
        flow.append(_para(heading, styles["section"]))
        flow.append(_para(content, styles["body"]))

    # ---- Emotional analysis (from on-device mood history) ----
    if emotion_summary:
        flow.append(_para("Emotional Analysis", styles["section"]))
        flow.append(
            _para(
                "Derived from the patient's on-device facial-emotion tracking and "
                "chat sentiment. Indicative only — not a diagnostic instrument.",
                styles["label"],
            )
        )
        rows = (
            ("Text sentiment", emotion_summary.get("text_summary")),
            ("Facial emotion", emotion_summary.get("facial_summary")),
            ("Dominant patterns", emotion_summary.get("patterns")),
            ("Risk indicator", emotion_summary.get("risk_summary")),
        )
        for label, value in rows:
            if value:
                flow.append(_para(f"{label}: {value}", styles["body"]))

    # ---- Wellness & habits (Phase 2) ----
    has_wellness = emotion_summary and any(
        emotion_summary.get(k)
        for k in ("wellness_summary", "habit_summary", "habit_breakdown")
    )
    if has_wellness:
        flow.append(_para("Wellness & Habits", styles["section"]))
        flow.append(
            _para(
                "Derived from the patient's habit tracking, wellness plan activity, "
                "journaling and CBT engagement. Indicative only.",
                styles["label"],
            )
        )
        for label, key in (
            ("Wellness score", "wellness_summary"),
            ("Habit adherence", "habit_summary"),
            ("Habit breakdown", "habit_breakdown"),
        ):
            value = emotion_summary.get(key)
            if value:
                flow.append(_para(f"{label}: {value}", styles["body"]))

    # ---- Signature block ----
    flow.append(Spacer(1, 18))
    flow.append(HRFlowable(width="100%", color=colors.HexColor("#cbd5e1"), thickness=0.6))
    flow.append(_para("Digital Signature", styles["section"]))
    flow.append(
        _para(
            "This report is cryptographically signed by the attending doctor "
            "using an RSA-2048 private key. The patient can verify its "
            "authenticity and integrity from their dashboard. Any alteration to "
            "this document after signing will cause verification to fail.",
            styles["body"],
        )
    )
    flow.append(Spacer(1, 6))
    flow.append(_para(f"Signed by: Dr. {doctor_name}", styles["body"]))
    if public_key_fingerprint:
        flow.append(
            _para(f"Public key fingerprint (SHA-256): {public_key_fingerprint}", styles["mono"])
        )

    doc.build(flow)
    return buf.getvalue()


def _fmt_dt(value: str | None) -> str | None:
    """Best-effort pretty-print of an ISO datetime; falls back to the raw value."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, AttributeError):
        return value
