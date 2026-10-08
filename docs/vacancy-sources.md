# Vacancy sources

A search needs at least one source. All of them are set in **Settings → Search preferences** (and employer pages in **Sources & imports**). Only your role search terms and your search area are sent to a source; your CV is not.

First fill in **Search area** (your town or region), **Country code** (two letters: `us`, `gb`, `de`, `nl`, …) and, if you like, up to six role searches. Without role searches the app derives them from your CV.

## JSearch (Google for Jobs)

Reads Google for Jobs, which gathers postings from LinkedIn, Indeed, Glassdoor and employers' own sites. Postings arrive with their full text, which is what screening and the CV features work best with.

1. Create an account at <https://www.openwebninja.com/api/jsearch>.
2. Subscribe to the JSearch API. There is a free plan with a monthly number of requests.
3. Copy your API key.
4. In the app: Search preferences → **Google for Jobs · JSearch** → paste the key, set the country code and a monthly request limit at or below your plan's, and save.

Each role search is one request and returns up to ten postings. The app counts requests and stops at your limit. It is used when you press Find jobs, and at most once a day by the hourly check.

## Adzuna

1. Create a developer account at <https://developer.adzuna.com/overview>.
2. Create an application; you get an **app ID** and an **API key**.
3. In the app: Search preferences → **Where you search · Adzuna** → enter both and save.

Adzuna only has listings for some countries (see their site for the list). If yours is not among them, leave both fields empty and use JSearch.

## Employer career pages

In **Sources & imports** you can list career pages of employers you want watched, one per line as `URL | employer name`. Pages hosted on the common applicant-tracking systems (Greenhouse, Lever, Ashby and similar) can be read without any key. This is optional.

## Pasting a vacancy yourself

On Today, **Import vacancies** takes a vacancy you paste in: for a posting from a site none of the sources cover, or one somebody sent you.

## The hourly check

When you enable it in Search preferences, the app repeats the search once an hour while it is running. The hourly check never starts a paid AI request by itself; screening by the model only runs when you start a search or a screening yourself.
