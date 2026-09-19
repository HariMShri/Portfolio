import html
import json
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


def write_report(jobs: list[Job], profile: dict, out_dir: str = "output") -> tuple[str, str]:
    import os
    os.makedirs(out_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    html_path = os.path.join(out_dir, f"report_{timestamp}.html")
    json_path = os.path.join(out_dir, f"report_{timestamp}.json")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(render_html(jobs, profile))
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump([j.to_dict() for j in jobs], f, indent=2)

    return html_path, json_path
