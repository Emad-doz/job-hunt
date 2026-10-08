# The AI model

Optional. Without it the app still searches, tracks and builds your CV as a PDF; screening then uses keyword rules.

With it:

- **Screening** judges new vacancies against your CV and says why.
- **Assessment** gives a fuller reading of one vacancy.
- **Motivation** researches the employer on the public web (your CV is not part of that request) and drafts a short text.
- **Fill from my CV** copies your uploaded CV into the editable fields.
- **Adapt my CV** selects and orders what is in your details for one vacancy. It cannot add anything that is not there: its answer is checked against your saved details.

## Setting it up

Only Anthropic's Claude models are supported for now.

1. Create an account at <https://platform.claude.com/> and add credit.
2. Create an API key.
3. In the app: Settings → Search preferences → **CV screening & assessments** → paste the key, choose the model, set a daily request limit, read what is sent, and tick the consent.

The key is stored in your encrypted settings and never shown again.

## What it costs

You pay Anthropic directly for what you use; the app adds nothing. It shows an estimate after each request and counts requests against the daily limit you set. Screening handles up to sixty vacancies per request. Nothing is sent on a schedule: every request is started by you.

## What is sent

Your CV text or details, and the text of the vacancy in question. For "Fill from my CV" and "Adapt my CV" that includes your name and contact details, which is why each of those asks for a confirming click every time. Anthropic's own terms govern what they do with API requests.

## Checking the answers

The model can be wrong. Screening verdicts are advice, the filled-in CV fields are a proposal you check before saving, and on an adapted CV the headline and profile text are written by the model, so read those two before you send the CV to anyone.
