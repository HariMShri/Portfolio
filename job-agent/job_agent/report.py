import html
import json
import os
from datetime import datetime
from typing import Optional
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
.resume-preview { border-top: 1px solid #ddd; margin-top: 16px; padding-top: 12px; }
.resume-preview h5 { margin: 12px 0 4px; font-size: 0.85rem; }
.resume-preview ul { margin: 4px 0 8px; padding-left: 20px; }
.resume-contact { color: #666; font-size: 0.8rem; }
"""


def _score_class(score: float) -> str:
    if score >= 65:
        return ""
    return "mid"


def _resume_content(job: Job, profile: dict) -> str:
    plan = job.draft_resume
    if not plan or not (job.resume_review and job.resume_review.get("passed")):
        return ""

    contact = " | ".join(
        value for value in (
            profile.get("email", ""),
            profile.get("phone", ""),
            profile.get("location", ""),
            profile.get("linkedin_url", ""),
        ) if value
    )
    experience_html = []
    for selection in plan.get("experience", []):
        experience = profile["experience"][selection["experience_index"]]
        highlights = "".join(
            f"<li>{html.escape(experience['highlights'][index])}</li>"
            for index in selection["highlight_indices"]
        )
        company = html.escape(experience.get("company", ""))
        title = html.escape(experience.get("title", ""))
        dates = html.escape(experience.get("dates", ""))
        client = html.escape(experience.get("client", ""))
        experience_html.append(
            f"<h5>{title} | {company}</h5><p>{dates}"
            f"{' | Client: ' + client if client else ''}</p><ul>{highlights}</ul>"
        )

    skills = " | ".join(html.escape(skill) for skill in plan["skills"])
    education = "".join(
        f"<li>{html.escape(item.get('degree', ''))} - "
        f"{html.escape(item.get('institution', ''))} ({html.escape(item.get('year', ''))})</li>"
        for item in profile.get("education", [])
    )
    certifications = "".join(f"<li>{html.escape(item)}</li>" for item in profile.get("certifications", []))
    return f"""<header><h1>{html.escape(profile.get('name', ''))}</h1>
      <p class="resume-contact">{html.escape(contact)}</p>
      <h2>{html.escape(job.title)} | Resume draft for {html.escape(job.company)}</h2></header>
      <section><h3>Professional Summary</h3><p>{html.escape(profile.get('summary', ''))}</p></section>
      <section><h3>Core Skills</h3><p>{skills}</p></section>
      <section><h3>Professional Experience</h3>{''.join(experience_html)}</section>
      <section><h3>Education</h3><ul>{education}</ul></section>
      <section><h3>Certifications</h3><ul>{certifications}</ul></section>
      <footer>Draft tailored by selecting and reordering verified profile facts. Review before use; the source PDF is unchanged.</footer>"""


def render_resume_html(job: Job, profile: dict) -> str:
    content = _resume_content(job, profile)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Resume Draft - {html.escape(profile.get('name', ''))}</title>
<style>body{{font-family:Arial,sans-serif;max-width:850px;margin:36px auto;padding:0 24px;color:#202124;line-height:1.5}}
h1{{font-size:26px;margin-bottom:0}}h2{{font-size:17px}}h3{{font-size:14px;text-transform:uppercase;border-bottom:1px solid #bbb;padding-bottom:4px}}
h5{{font-size:13px;margin-bottom:0}}p,li{{font-size:12px}}ul{{padding-left:20px}}.resume-contact,footer{{color:#555;font-size:10px}}
@media print{{body{{margin:0 auto;padding:0}}}}</style></head><body>{content}</body></html>"""


def _slug(text: str, limit: int = 40) -> str:
    """Filename-safe fragment: letters and digits joined by hyphens."""
    words = "".join(ch if ch.isalnum() else " " for ch in (text or "")).split()
    return "-".join(words)[:limit].strip("-") or "role"


def render_resume_pdf(job: Job, profile: dict, out_path: str) -> None:
    """A standalone, send-ready resume PDF for one job: the same verified
    facts as the HTML draft, laid out as a conventional single-column resume."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable, KeepTogether

    plan = job.draft_resume
    doc = SimpleDocTemplate(
        out_path, pagesize=A4, leftMargin=48, rightMargin=48, topMargin=42, bottomMargin=42,
        title=f"{profile.get('name', '')} - Resume", author=profile.get("name", ""),
    )
    ink = colors.HexColor("#202124")
    dim = colors.HexColor("#555555")
    name_style = ParagraphStyle("Name", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=ink)
    contact_style = ParagraphStyle("Contact", fontName="Helvetica", fontSize=9, leading=12, textColor=dim, spaceAfter=4)
    heading_style = ParagraphStyle("Heading", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=ink,
                                   spaceBefore=10, spaceAfter=2)
    body_style = ParagraphStyle("Body", fontName="Helvetica", fontSize=9.6, leading=13.2, textColor=ink)
    role_style = ParagraphStyle("Role", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=ink, spaceBefore=6)
    dates_style = ParagraphStyle("Dates", fontName="Helvetica-Oblique", fontSize=8.8, leading=11.5, textColor=dim, spaceAfter=2)
    bullet_style = ParagraphStyle("Bullet", parent=body_style, leftIndent=12, bulletIndent=2, spaceAfter=1.5)

    def esc(s: str) -> str:
        return html.escape(s or "")

    def section(title: str) -> list:
        return [Paragraph(title.upper(), heading_style),
                HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#bbbbbb"), spaceAfter=4)]

    contact = " | ".join(esc(v) for v in (
        profile.get("email", ""), profile.get("phone", ""), profile.get("location", ""), profile.get("linkedin_url", ""),
    ) if v)
    story = [Paragraph(esc(profile.get("name", "")), name_style), Paragraph(contact, contact_style)]
    story += section("Professional Summary")
    story.append(Paragraph(esc(profile.get("summary", "")), body_style))
    story += section("Core Skills")
    story.append(Paragraph(esc(" | ".join(plan["skills"])), body_style))
    story += section("Professional Experience")
    for selection in plan.get("experience", []):
        experience = profile["experience"][selection["experience_index"]]
        client = experience.get("client", "")
        block = [
            Paragraph(f"{esc(experience.get('title', ''))} &mdash; {esc(experience.get('company', ''))}", role_style),
            Paragraph(esc(experience.get("dates", "")) + (f" &middot; Client: {esc(client)}" if client else ""), dates_style),
        ]
        block += [Paragraph(esc(experience["highlights"][index]), bullet_style, bulletText="•")
                  for index in selection["highlight_indices"]]
        story.append(KeepTogether(block))
    if profile.get("education"):
        story += section("Education")
        for item in profile["education"]:
            story.append(Paragraph(
                f"{esc(item.get('degree', ''))} &mdash; {esc(item.get('institution', ''))} ({esc(item.get('year', ''))})",
                body_style,
            ))
    if profile.get("certifications"):
        story += section("Certifications")
        story += [Paragraph(esc(item), bullet_style, bulletText="•") for item in profile["certifications"]]
    doc.build(story)


def render_html(jobs: list[Job], profile: dict, resume_files: Optional[dict[int, str]] = None) -> str:
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")
    job_blocks = []
    resume_files = resume_files or {}
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
        resume_content = _resume_content(job, profile)
        resume_html = ""
        if resume_content:
            resume_link = resume_files.get(id(job))
            link_html = (
                f'<p><a class="applylink" href="{html.escape(resume_link)}">Open standalone resume draft</a></p>'
                if resume_link else ""
            )
            resume_html = f'<div class="draft resume-preview"><h4>Tailored Resume Draft (review before using)</h4>{resume_content}{link_html}</div>'
        job_blocks.append(f"""
        <div class="job">
          <h2>{html.escape(job.title)}</h2>
          <div class="company">{html.escape(job.company)}</div>
          <div class="sub">{html.escape(job.location)} &middot; source: {html.escape(job.source)}
            &middot; <span class="score {_score_class(job.match_score)}">{job.match_score:.0f} match</span></div>
          <ul class="reasons">{reasons_html}</ul>
          {draft_html}
          {resume_html}
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

        if _resume_content(job, profile):
            story.append(Paragraph("TAILORED RESUME DRAFT (review before using)", draft_label_style))
            story.append(Paragraph(esc(profile.get("name", "")), job_title_style))
            story.append(Paragraph(
                f"{esc(job.title)} &mdash; tailored for {esc(job.company)}", job_sub_style
            ))
            story.append(Paragraph(esc(profile.get("email", "")) + " | " + esc(profile.get("phone", ""))
                                   + " | " + esc(profile.get("location", "")), meta_style))
            story.append(Paragraph("PROFESSIONAL SUMMARY", draft_label_style))
            story.append(Paragraph(esc(profile.get("summary", "")), draft_body_style))
            story.append(Paragraph("CORE SKILLS: " + esc(" | ".join(job.draft_resume["skills"])), draft_body_style))
            story.append(Paragraph("PROFESSIONAL EXPERIENCE", draft_label_style))
            for selection in job.draft_resume["experience"]:
                experience = profile["experience"][selection["experience_index"]]
                story.append(Paragraph(
                    f"{esc(experience.get('title', ''))} &mdash; {esc(experience.get('company', ''))}",
                    qa_q_style,
                ))
                story.append(Paragraph(
                    f"{esc(experience.get('dates', ''))} &middot; {esc(experience.get('location', ''))}",
                    meta_style,
                ))
                for highlight_index in selection["highlight_indices"]:
                    story.append(Paragraph(
                        f"&bull; {esc(experience['highlights'][highlight_index])}", reason_style
                    ))
            story.append(Paragraph("EDUCATION & CERTIFICATIONS", draft_label_style))
            for education in profile.get("education", []):
                story.append(Paragraph(
                    f"{esc(education.get('degree', ''))} &mdash; {esc(education.get('institution', ''))} ({esc(education.get('year', ''))})",
                    draft_body_style,
                ))
            for certification in profile.get("certifications", []):
                story.append(Paragraph(f"&bull; {esc(certification)}", reason_style))

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

    resume_files = {}
    for index, job in enumerate(jobs, start=1):
        if _resume_content(job, profile):
            filename = f"resume_{timestamp}_{index}.html"
            with open(os.path.join(out_dir, filename), "w", encoding="utf-8") as resume_file:
                resume_file.write(render_resume_html(job, profile))
            resume_files[id(job)] = filename
            # A send-ready PDF beside it; the digest email attaches these.
            pdf_name = f"resume_{timestamp}_{index}_{_slug(job.company, 24)}_{_slug(job.title)}.pdf"
            render_resume_pdf(job, profile, os.path.join(out_dir, pdf_name))

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(render_html(jobs, profile, resume_files))
    render_pdf(jobs, profile, pdf_path)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump([j.to_dict() for j in jobs], f, indent=2)

    return html_path, pdf_path, json_path
