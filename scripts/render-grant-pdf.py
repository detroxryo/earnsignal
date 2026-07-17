from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "GRANT_RESPONSE.md"
OUTPUT = ROOT / "output" / "pdf" / "earnsignal-superteam-agentic-engineering-grant.pdf"

INK = colors.HexColor("#14201A")
MUTED = colors.HexColor("#58675E")
GREEN = colors.HexColor("#15803D")
PALE = colors.HexColor("#EAF6EE")
LINE = colors.HexColor("#D9E4DC")


def inline_markup(value: str) -> str:
    escaped = html.escape(value)
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^)]+)\)",
        r'<link href="\2" color="#15803D"><u>\1</u></link>',
        escaped,
    )
    escaped = re.sub(
        r"(?<![\w/])(https?://[^\s<]+)",
        r'<link href="\1" color="#15803D"><u>\1</u></link>',
        escaped,
    )
    escaped = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    return escaped


def render_page(canvas, doc) -> None:
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(PALE)
    canvas.rect(0, height - 18 * mm, width, 18 * mm, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.setFont("Helvetica-Bold", 8.5)
    canvas.drawString(18 * mm, height - 11 * mm, "EARNSIGNAL / SUPERTEAM AGENTIC ENGINEERING GRANT")
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 15 * mm, width - 18 * mm, 15 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(18 * mm, 10 * mm, "Public proof: earnsignal.detroxryo.workers.dev")
    canvas.drawRightString(width - 18 * mm, 10 * mm, f"Page {doc.page}")
    canvas.restoreState()


def build_story(markdown: str):
    styles = getSampleStyleSheet()
    title = ParagraphStyle(
        "GrantTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=26,
        leading=31,
        textColor=INK,
        alignment=TA_LEFT,
        spaceAfter=12,
    )
    heading = ParagraphStyle(
        "GrantHeading",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=GREEN,
        spaceBefore=9,
        spaceAfter=5,
        keepWithNext=True,
    )
    body = ParagraphStyle(
        "GrantBody",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.1,
        leading=12.8,
        textColor=INK,
        spaceAfter=5,
    )
    bullet = ParagraphStyle(
        "GrantBullet",
        parent=body,
        leftIndent=13,
        firstLineIndent=-8,
        bulletIndent=3,
        spaceAfter=3,
    )
    metadata = ParagraphStyle(
        "GrantMeta",
        parent=body,
        fontSize=9,
        leading=13,
        textColor=MUTED,
        backColor=PALE,
        borderColor=LINE,
        borderWidth=0.5,
        borderPadding=7,
        spaceAfter=8,
    )

    story = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_lines:
            story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), body))
            paragraph_lines.clear()

    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            flush_paragraph()
            continue
        if line.startswith("# "):
            flush_paragraph()
            story.append(Spacer(1, 5 * mm))
            story.append(Paragraph(inline_markup(line[2:]), title))
            continue
        if line.startswith("## "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[3:]), heading))
            continue
        if line.startswith("- "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line[2:]), bullet, bulletText="-"))
            continue
        if line.startswith(("Application date:", "Applicant:", "Official prompt used")):
            flush_paragraph()
            story.append(Paragraph(inline_markup(line), metadata))
            continue
        paragraph_lines.append(line)
    flush_paragraph()
    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=24 * mm,
        bottomMargin=20 * mm,
        title="EarnSignal - Superteam Agentic Engineering Grant response",
        author="detroxryo",
        subject="Generated in Codex from the official Superteam grant prompt",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="main")
    doc.addPageTemplates([PageTemplate(id="grant", frames=[frame], onPage=render_page)])
    doc.build(build_story(SOURCE.read_text(encoding="utf-8")))
    print(OUTPUT)


if __name__ == "__main__":
    main()
