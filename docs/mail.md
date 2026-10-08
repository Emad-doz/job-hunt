# Reading replies from your mailbox

Optional. Works with **Outlook and Hotmail** accounts. Gmail is not supported yet.

The app asks for read-only access (`Mail.Read`). It cannot send, move or delete mail. It reads only when you press **Check for replies** or check one vacancy, never on a schedule.

## Why you register an app yourself

Microsoft gives mailbox access to registered applications. Because this app runs on your machine and belongs to nobody else, you register your own, free, once. It takes about five minutes.

## Steps

1. Go to <https://portal.azure.com> → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name: anything, for example `Job Hunt`.
3. Supported account types: **Personal Microsoft accounts** (or "any organizational directory and personal Microsoft accounts" if you use a work or school mailbox).
4. Redirect URI: platform **Web**, and the address the app shows you on its mail card. On your own machine that is `http://localhost:3000/api/mail/callback`. It has to match exactly, including the port.
5. Register. Copy the **Application (client) ID**.
6. **Certificates & secrets** → **New client secret**. Copy its **Value** (not the ID). It is shown only once.
7. **API permissions** → **Add a permission** → Microsoft Graph → Delegated → `Mail.Read` and `offline_access`.
8. In the app: Settings → Setup → the mail card → paste the client ID and the secret value, save, then **Connect** and sign in on Microsoft's page.

The secret and the tokens are stored in your encrypted settings and never shown again.

## What happens with your mail

A check reads your newest messages from the last 45 days and links one to an application when the employer's name appears in it or in the sender's address. Words in the message decide what is proposed: a rejection, an interview invitation, an offer, or a note that your profile is kept. The wording rules know English and Dutch.

A proposal is a guess. You read the email, and the status only changes when you press the button and confirm. Short previews of proposed replies are kept in your encrypted settings; full messages are not stored, and no mail is sent to the AI model.

## Disconnecting

**Disconnect** on the mail card removes the tokens from the app. You can also remove the app's access in your Microsoft account under Privacy → Apps and services.

## Not tested everywhere

The sign-in on `http://localhost` relies on Microsoft accepting localhost redirect addresses and on your browser accepting the sign-in cookie there. Both are standard behaviour, but this path has been tested with stand-ins and on one hosted HTTPS setup only. If it fails, the card says why.
