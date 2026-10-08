# Your database

## The default: a file on your machine

Out of the box your records are kept in `data/job-hunt.db`, a SQLite database file. Nothing is installed or configured; the file is created the first time the app needs it. It holds:

- your jobs and their history,
- the review receipts of saved discoveries,
- your CV file, the text read from it, your photo and your CV details.

**Backup:** stop the app and copy the `data` folder. That folder is your whole installation: the database and your encrypted settings. To move to another computer, copy the folder there. The settings file can only be opened with the same `HQ_ACCESS_PASSWORD`.

**Another place:** set `HQ_DATA_DIR` in `.env` to keep the folder somewhere else.

The file is not encrypted. It is protected by your computer's own access rights, like your other documents.

## The option: MySQL

For running the app on a server with the records in a database there.

1. Create a database and a user with all privileges on it.
2. In the app: Settings → Setup → the database card → **Use a MySQL database instead** → host, port, database name, user, password → save, and confirm.
3. Press **Test the database**. A saved connection is not used until it has passed a test.

Switching does not copy records: the file and the MySQL database each have their own. Going back to the file is one confirmed click.

## How records change

There is no free editing of the database from the page. A record changes only through a small set of fixed operations, each confirmed by you and each one transaction: save a reviewed discovery, record an application, change a status with a reason, attach evidence, delete a job. Job and history IDs (`JOB-…`, `EVT-…`) are issued by the app and never reused, also not after a job was deleted.

Deleting a job removes it and its history. For a job you applied to, one line is kept (employer, role, link, date) as a record that you applied; for a job you never applied to, nothing is kept.
