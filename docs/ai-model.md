# The AI model

Optional. Without it the app still searches, tracks and builds your CV as a PDF; screening then uses keyword rules.

With it:

- **Screening** judges new vacancies against your CV and says why.
- **Assessment** gives a fuller reading of one vacancy.
- **Motivation** researches the employer on the public web (your CV is not part of that request) and drafts a short text. The web research needs Anthropic; with another provider the text is drafted without it.
- **Fill from my CV** copies your uploaded CV into the editable fields.
- **Adapt my CV** selects and orders what is in your details for one vacancy. It cannot add anything that is not there: its answer is checked against your saved details.

## Setting it up

In the app: Settings → Search preferences → **CV screening & assessments**. Choose a provider, enter its key and model, set a daily request limit, read what is sent, and tick the consent. The key is stored in your encrypted settings and never shown again.

| Provider | Key | Model |
| --- | --- | --- |
| **Anthropic (Claude)** | Create an account at <https://platform.claude.com/>, add credit, create an API key. | Chosen from a list. |
| **OpenAI** | An API key from your OpenAI platform account. | Type the model name as OpenAI lists it. |
| **Google Gemini** | An API key from Google AI Studio. | Type the model name as Google lists it. |
| **Another OpenAI-compatible service** | Whatever the service asks for; none for a local one. | Type the model name the service uses. |

The last option takes the address of any service that speaks the OpenAI chat format, the part before `/chat/completions`. For [Ollama](https://ollama.com/) on your own computer that is `http://localhost:11434/v1`, and then nothing leaves your machine. The address must be `https`, or `http` on this machine only.

A key belongs to one provider: when you change the provider or the address you enter a key again, name the model again, and give your consent again, because your CV would go to someone else.

### What was checked

The app was built and used with Claude. The other providers go through one shared request format that is checked with made-up answers in the tests; no request to OpenAI, Google or a local model was made while building it. Expect differences between models: the app asks for an answer in a fixed form, and a small local model may not manage that. A request that fails records nothing, and you see the reason.

## What it costs

You pay your provider directly for what you use; the app adds nothing. For Claude models it shows an estimate after each request; for other providers it shows no estimate, because it does not know their prices. Requests count against the daily limit you set. Screening handles up to sixty vacancies per request. Nothing is sent on a schedule: every request is started by you.

## What is sent

Your CV text or details, and the text of the vacancy in question. For "Fill from my CV" and "Adapt my CV" that includes your name and contact details, which is why each of those asks for a confirming click every time. Your provider's own terms govern what they do with API requests.

## Checking the answers

The model can be wrong. Screening verdicts are advice, the filled-in CV fields are a proposal you check before saving, and on an adapted CV the headline and profile text are written by the model, so read those two before you send the CV to anyone.
