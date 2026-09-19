import html
import json
import os
from datetime import datetime
from .models import Job

CSS = """
:root { color-scheme: light dark; }
body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 880px; margin: 0 auto;
       padding: 32px 20px 80px; line-height: 1.55; color: #1a1a1a; background: #fafafa; }
h1 { font-size: 1.5rem; margin-bottom: 4px; }
.meta { color: #666; font-size: 0.85rem; margin-bottom: 28px; }
.banner { background: #fff3cd; border: 1px solid #ffe69c; border-radius: 8px; padding: 14px 18px;
          font-size: 0.88rem; margin-bottom: 28px; }
.job { background: #fff; border: 1px solid #e2e2e2; border-radius: 10px; padding: 22px 24px; margin-bottom: 20px; }
.job h2 { font-size: 1.1rem; margin: 0 0 4px; }
.job .company { color: #444; font-weight: 600; font-size: 0.95rem; }
.job .sub { color: #777; font-size: 0.82rem; margin-bottom: 12px; }
.score { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 700;
         background: #e7f5e9; color: #1e7d32; }
.score.mid { background: #fff4e0; color: #a35c00; }
.reasons { font-size: 0.82rem; color: #555; margin: 10px 0; }
.reasons li { margin-bottom: 2px; }
.draft { background: #f6f7f9; border-radius: 8px; padding: 14px 16px; margin-top: 12px; font-size: 0.88rem; }
.draft h4 { margin: 0 0 6px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.03em; color: #666; }
.qa-item { margin-bottom: 10px; }
.qa-item .q { font-weight: 600; font-size: 0.85rem; }
a.applylink { display: inline-block; margin-top: 12px; font-size: 0.85rem; font-weight: 600; }
"""


def _score_class(score: float) -> str:
    if score >= 65:
        return ""
    return "mid"


def render_html(jobs: list[Job], profile: dict) -> str:
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    job_blocks = []
    for job in jobs:
        reasons_html = "".join(f"<li>{html.escape(r)}</li>" for r in job.match_reasons)
        draft_html = ""
        if job.draft_cover_note:
            qa_html = "".join(
                f'<div class="qa-item"><div class="q">{html.escape(qa.get("question", ""))}</div>'
                f'<div class="a">{html.escape(qa.get("answer", ""))}</div></div>'
                for qa in (job.draft_qa or [])
            )
            draft_html = f"""
            <div class="draft">
              <h4>Drafted Cover Note (review before using)</h4>
              <p>{html.escape(job.draft_cover_note)}</p>
              {'<h4>Drafted Q&amp;A</h4>' + qa_html if qa_html else ''}
            </div>
            """
        job_blocks.append(f"""
        <div class="job">
          <h2>{html.escape(job.title)}</h2>
          <div class="company">{html.escape(job.company)}</div>
          <div class="sub">{html.escape(job.location)} &middot; source: {html.escape(job.source)}
            &middot; <span class="score {_score_class(job.match_score)}">{job.match_score:.0f} match</span></div>
          <ul class="reasons">{reasons_html}</ul>
          {draft_html}
          {'<a class="applylink" href="' + html.escape(job.url) + '" target="_blank">Open original listing &rarr;</a>' if job.url else ''}
        </div>
        """)

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Job Search Shortlist &mdash; {html.escape(profile.get('name', ''))}</title>
<style>{CSS}</style></head>
<body>
<h1>Job Search Shortlist</h1>
<div class="meta">Generated {generated} &middot; {len(jobs)} matches for {html.escape(profile.get('name', ''))}</div>
<div class="banner">
  This is a shortlist with drafted materials for your review. Nothing here has been submitted anywhere &mdash;
  read each draft, edit it to sound like you, and submit manually on the original listing.
</div>
{''.join(job_blocks)}
</body></html>"""


def render_pdf(jobs: list[Job], profile: dict, out_path: str) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.enums import TA_LEFT, TA_JUSTIFY
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable

    MARGIN = 46.8
    doc = SimpleDocTemplate(
        out_path, pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN, topMargin=40, bottomMargin=40,
        title="Job Search Shortlist",
    )

    title_style = ParagraphStyle("Title", fontName="Helvetica-Bold", fontSize=16, leading=19, spaceAfter=4)
    meta_style = ParagraphStyle("Meta", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.grey, spaceAfter=10)
    banner_style = ParagraphStyle("Banner", fontName="Helvetica-Oblique", fontSize=9, leading=13,
                                   textColor=colors.HexColor("#7a5a00"), backColor=colors.HexColor("#fff3cd"),
                                   borderPadding=8, spaceAfter=16)
    job_title_style = ParagraphStyle("JobTitle", fontName="Helvetica-Bold", fontSize=12.5, leading=15, spaceAfter=2)
    job_sub_style = ParagraphStyle("JobSub", fontName="Helvetica", fontSize=9.5, leading=13,
                                    textColor=colors.HexColor("#444444"), spaceAfter=6)
    score_style = ParagraphStyle("Score", fontName="Helvetica-Bold", fontSize=9, leading=12,
                                  textColor=colors.HexColor("#1e7d32"), spaceAfter=6)
    reason_style = ParagraphStyle("Reason", fontName="Helvetica", fontSize=8.7, leading=11.5,
                                   textColor=colors.HexColor("#555555"), leftIndent=12, spaceAfter=2)
    draft_label_style = ParagraphStyle("DraftLabel", fontName="Helvetica-Bold", fontSize=8.5, leading=11,
                                        textColor=colors.HexColor("#666666"), spaceBefore=6, spaceAfter=3)
    draft_body_style = ParagraphStyle("DraftBody", fontName="Helvetica", fontSize=9.5, leading=13,
                                       alignment=TA_JUSTIFY, spaceAfter=4)
    qa_q_style = ParagraphStyle("QAQ", fontName="Helvetica-Bold", fontSize=9, leading=12, spaceAfter=1)
    qa_a_style = ParagraphStyle("QAA", fontName="Helvetica", fontSize=9, leading=12.5, spaceAfter=6)
    link_style = ParagraphStyle("Link", fontName="Helvetica-Bold", fontSize=9, leading=12,
                                 textColor=colors.HexColor("#1a56db"), spaceBefore=6)

    def esc(s: str) -> str:
        return html.escape(s or "")

    story = []
    story.append(Paragraph("Job Search Shortlist", title_style))
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    story.append(Paragraph(f"Generated {generated} &mdash; {len(jobs)} matches for {esc(profile.get('name', ''))}", meta_style))
    story.append(Paragraph(
        "This is a shortlist with drafted materials for your review. Nothing here has been submitted "
        "anywhere &mdash; read each draft, edit it to sound like you, and submit manually on the original listing.",
        banner_style
    ))

    for i, job in enumerate(jobs):
        if i > 0:
            story.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#dddddd"), spaceBefore=10, spaceAfter=12))

        story.append(Paragraph(esc(job.title), job_title_style))
        story.append(Paragraph(f"{esc(job.company)} &mdash; {esc(job.location)} &middot; source: {esc(job.source)}", job_sub_style))
        story.append(Paragraph(f"{job.match_score:.0f} match", score_style))

        for reason in job.match_reasons:
            story.append(Paragraph(f"&bull; {esc(reason)}", reason_style))

        if job.draft_cover_note:
            story.append(Paragraph("DRAFTED COVER NOTE (review before using)", draft_label_style))
            story.append(Paragraph(esc(job.draft_cover_note), draft_body_style))

        if job.draft_qa:
            story.append(Paragraph("DRAFTED Q&amp;A", draft_label_style))
            for qa in job.draft_qa:
                story.append(Paragraph(esc(qa.get("question", "")), qa_q_style))
                story.append(Paragraph(esc(qa.get("answer", "")), qa_a_style))

        if job.url:
            story.append(Paragraph(f'<link href="{esc(job.url)}">Open original listing &rarr;</link>', link_style))

    if not jobs:
        story.append(Paragraph(
            "No jobs cleared the match threshold today. The agent ran fine -- there just wasn't a "
            "QA/test-engineering role today that scored well against your profile.",
            draft_body_style
        ))

    doc.build(story)


def write_report(jobs: list[Job], profile: dict, out_dir: str = "output") -> tuple[str, str, str]:
    os.makedirs(out_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    html_path = os.path.join(out_dir, f"report_{timestamp}.html")
    pdf_path = os.path.join(out_dir, f"report_{timestamp}.pdf")
    json_path = os.path.join(out_dir, f"report_{timestamp}.json")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(render_html(jobs, profile))
    render_pdf(jobs, profile, pdf_path)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump([j.to_dict() for j in jobs], f, indent=2)

    return html_path, pdf_path, json_path
