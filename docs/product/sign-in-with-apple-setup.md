# Sign in with Apple: setup

Built on branch `sign-in-with-apple` (14 Oct 2026). Nothing changes on the site until the four Railway settings in step 6 are present: until then the Apple routes return "not found" and no Apple buttons appear.

Apple renames menu items from time to time; if a label below doesn't match exactly, look for the nearest equivalent.

## 1. Join the Apple Developer Program

developer.apple.com/programs → Enroll. The membership costs US$99 a year.

- **Individual** enrollment is quickest (usually same day).
- **Organization** enrollment needs a D-U-N-S number and takes longer, but the developer name Apple shows is the company's rather than a person's.

Before going live, check that the name people see in Apple's sign-in sheet is "Discriminantly" and not your own.

## 2. Make an App ID

In the Apple Developer site: **Certificates, Identifiers & Profiles → Identifiers → +**

1. Choose **App IDs**, then **App**, then Continue.
2. Description: `Discriminantly`. Bundle ID: **Explicit**, `com.discriminantly.app`.
3. Under Capabilities, tick **Sign In with Apple**.
4. Continue → Register.

## 3. Make a Services ID (this is the website's identity)

**Identifiers → +**

1. Choose **Services IDs**, then Continue.
2. Description: `Discriminantly`. Identifier: `com.discriminantly.web`.
3. Continue → Register.
4. Open the new Services ID, tick **Sign In with Apple**, then click **Configure**:
   - Primary App ID: the `com.discriminantly.app` one from step 2.
   - Domains and Subdomains: `www.discriminantly.com`
   - Return URLs: `https://www.discriminantly.com/auth/apple/callback`
5. Next → Done → Continue → Save.

## 4. Make a key

**Keys → +**

1. Key name: `Discriminantly Sign in with Apple`.
2. Tick **Sign in with Apple**, click **Configure**, choose the primary App ID from step 2, then Save.
3. Continue → Register.
4. **Download** the key file (`AuthKey_XXXXXXXXXX.p8`). Apple lets you download it only once, so keep it somewhere safe.
5. Note the **Key ID** shown on that page (10 characters).

## 5. Find your Team ID

It's in the top-right corner of the developer site, or under **Membership details**: 10 characters.

## 6. Add four settings in Railway

In Railway, open the Discriminantly service, go to **Variables**, and add:

| Name | Value |
|---|---|
| `APPLE_CLIENT_ID` | `com.discriminantly.web` |
| `APPLE_TEAM_ID` | your Team ID (step 5) |
| `APPLE_KEY_ID` | the Key ID (step 4) |
| `APPLE_PRIVATE_KEY` | the whole contents of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines (open it in TextEdit and copy everything) |

Railway redeploys after you save. The buttons then appear on Sign in, Join and Settings.

## 7. Optional, only when Discriminantly starts sending email: Hide My Email relay

Discriminantly doesn't send email today. If it does later, or if you write to a member from support@discriminantly.com, Apple's relay only passes messages on from registered senders:

**Certificates, Identifiers & Profiles → Services → Sign in with Apple for Email Communication → Configure**

Add `discriminantly.com` and `support@discriminantly.com`. Apple then asks for an SPF record in GoDaddy's DNS.

## How it behaves

- **New person:** Apple → a short "Create your account" step (name prefilled when Apple shares it, Terms checkbox) → signed in. Arriving from a share link, they land on their own copy of the plan. Arriving mid-connection with ChatGPT or Claude, they go back to that connection.
- **Returning person:** Apple → signed straight in.
- **Email already has an account:** Apple is *not* linked on Apple's word alone, because Discriminantly never verified that account's email. The person signs in once with their password, which links Apple; after that, Apple signs them straight in.
- **Settings › Sign in with Apple:** connect or disconnect Apple. An account made with Apple has no password, so it can't disconnect Apple, and it deletes itself with the handle alone.
- **Logs:** codes, tokens, the client secret, state and nonces are never logged.

## Rollback

Remove `APPLE_CLIENT_ID` (or any of the four settings) in Railway: the buttons disappear and the Apple routes return "not found". Accounts already made with Apple keep working only through Apple, so prefer leaving it on once people use it.
