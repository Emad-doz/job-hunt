# Reading replies from your mailbox

Optional. Works with **Outlook and Hotmail** accounts and with **Gmail**, one mailbox at a time. You choose which on the mail card.

The app asks for read-only access (`Mail.Read` at Microsoft, `gmail.readonly` at Google). If the sign-in hands back any wider permission, the app refuses the connection. It cannot send, move or delete mail. It reads only when you press **Check for replies** or check one vacancy, never on a schedule.

## Why you register an app yourself

Microsoft and Google give mailbox access to registered applications. Because this app runs on your machine and belongs to nobody else, you register your own, free, once. It takes about five minutes.

## Steps for Outlook and Hotmail

1. Go to <https://portal.azure.com> → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name: anything, for example `Job Hunt`.
3. Supported account types: **Personal Microsoft accounts** (or "any organizational directory and personal Microsoft accounts" if you use a work or school mailbox).
4. Redirect URI: platform **Web**, and the address the app shows you on its mail card. On your own machine that is `http://localhost:3000/api/mail/callback`. It has to match exactly, including the port.
5. Register. Copy the **Application (client) ID**.
6. **Certificates & secrets** → **New client secret**. Copy its **Value** (not the ID). It is shown only once.
7. **API permissions** → **Add a permission** → Microsoft Graph → Delegated → `Mail.Read` and `offline_access`.
8. In the app: Settings → Setup → the mail card → paste the client ID and the secret value, save, then **Connect** and sign in on Microsoft's page.

The secret and the tokens are stored in your encrypted settings and never shown again.

## Steps for Gmail

1. Go to <https://console.cloud.google.com/>, create a project (any name) and enable the **Gmail API** for it (APIs & Services → Library).
2. **Google Auth Platform** → **Audience**: user type **External**, and add your own Gmail address under **Test users**.
3. **Data access** → add the scope `https://www.googleapis.com/auth/gmail.readonly`. Add no other Gmail scope.
4. **Clients** → **Create client** → application type **Web application**. Under **Authorised redirect URIs** add the address the app shows on its mail card. On your own machine that is `http://localhost:3000/api/mail/callback`.
5. Copy the **Client ID** (it ends with `.apps.googleusercontent.com`) and the **Client secret**.
6. In the app: Settings → Setup → the mail card → choose **Gmail**, paste both, save, then **Connect Gmail** and sign in on Google's page.

Two things to expect from Google:

- A screen saying the app is not verified. That is normal for an app only you use; continue with your own account.
- While your Google project is in **Testing**, Google ends the sign-in after seven days, and you press **Reconnect Gmail**. Moving the project to production avoids that, but for this permission Google then asks for a verification meant for public apps.

The menus in Google's console change from time to time; the names above are the ones to look for.

## What happens with your mail

A check reads your newest messages from the last 45 days and links one to an application when the employer's name appears in it or in the sender's address. Words in the message decide what is proposed: a rejection, an interview invitation, an offer, or a note that your profile is kept. The wording rules know English, Dutch, German, French, Spanish, Italian and Portuguese. A reply in another language is still listed for its job, without a proposed status.

A proposal is a guess. You read the email, and the status only changes when you press the button and confirm. Short previews of proposed replies are kept in your encrypted settings; full messages are not stored, and no mail is sent to the AI model.

## Disconnecting

**Disconnect** on the mail card removes the tokens from the app. You can also remove the app's access in your Microsoft account under Privacy → Apps and services, or in your Google account under Security → Third-party apps and services.

## Not tested everywhere

The sign-in on `http://localhost` relies on Microsoft accepting localhost redirect addresses and on your browser accepting the sign-in cookie there. Both are standard behaviour, but this path has been tested with stand-ins and on one hosted HTTPS setup only. If it fails, the card says why.

The Gmail connection was built against Google's published sign-in and Gmail API formats and checked with a stand-in for Google. No real Gmail account was connected while building it, so treat the first connection as the real test.
