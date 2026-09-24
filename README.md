# Lemonly Marketing Planner

A static planner app with Monthly Calendar and Timeline views. It's hosted on GitHub Pages, stores its data in Firebase Firestore, and requires a Google sign-in.

- **Who can view:** anyone signed in with a verified `@lemonly.com` or `@clickrain.com` Google account
- **Who can edit:** `nick@lemonly.com` only
- **Where things are stored:** all planner data (categories, items, blackout dates) is one Firestore document, `planners/main`. Each viewer's preferences (active view, year, sidebar, hidden categories) stay in that viewer's own browser.

## Files

| File | Purpose |
|---|---|
| `index.html` | Markup, the sign-in screen, and noindex meta tags |
| `styles.css` | All styles |
| `js/main.js` | Sign-in gate, domain check, Firestore load, live sync, and debounced saves |
| `js/planner.js` | The planner UI (calendar, timeline, sidebar, modal) |
| `js/firebase-config.js` | Firebase project config, plus the allowed domains and the editor list |
| `firestore.rules` | Server-side access rules. These are what actually enforce who can read and write. |

## Firebase setup (one time)

1. **Create the project.** Go to <https://console.firebase.google.com> and choose **Create a project**. Name it something like `lemonly-marketing-planner`. You can turn Google Analytics off. The free Spark plan is plenty.
2. **Register a web app.** On the project overview page, click the **Web** (`</>`) icon. Give it a nickname and leave "Firebase Hosting" unchecked. Copy the `firebaseConfig` values it shows into `js/firebase-config.js`. You can find them again later under ⚙️ **Project settings → General → Your apps**.
3. **Turn on Google sign-in.** Go to **Build → Authentication → Get started → Sign-in method → Google**. Enable it, pick a support email, and save.
   Then limit sign-in to the company Workspace. Both lemonly.com and clickrain.com are in the same Workspace. In [Google Cloud Console](https://console.cloud.google.com), select this project and go to **Google Auth Platform → Audience**. Set **User type** to **Internal**. After that, Google itself turns away accounts from outside the Workspace before they ever reach the app. If "Internal" is grayed out, the project was created outside the Workspace organization: move it under the organization in **IAM & Admin → Settings**, or recreate it while signed in as nick@lemonly.com. Keep the domain check in `firestore.rules` either way, as a second layer.
4. **Authorize the site's domain.** Go to **Authentication → Settings → Authorized domains → Add domain** and add `nick-lemonly.github.io`. `localhost` is already on the list for local testing.
5. **Create the database.** Go to **Build → Firestore Database → Create database**. Choose a US location (for example `nam5`). You can't change the location later. Start in **production mode**.
6. **Publish the rules.** In **Firestore Database → Rules**, replace the contents with `firestore.rules` from this repo and click **Publish**.
7. **(Optional) Restrict the API key.** In Google Cloud Console, go to **APIs & Services → Credentials** and open the "Browser key". Under **Website restrictions**, add:
   - `https://nick-lemonly.github.io/*`
   - `http://localhost:8000/*`
   - `https://<project-id>.firebaseapp.com/*` (the sign-in popup runs on this domain)

   This keeps other sites from using your key. The data is still protected by the rules either way.

The first time Nick signs in, the app creates the planner document and fills it with the example items. You can remove them with **Clear example items**.

## Run locally

Sign-in doesn't work from a `file://` URL, so serve the folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Create a repo in the `nick-lemonly` account, for example `marketing-planner`, and push these files to `main`.
2. In the repo, go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, select `main` and `/ (root)`, and save.
3. The site will be at `https://nick-lemonly.github.io/marketing-planner/`.

On a free GitHub plan, the repo has to be public for Pages to work. That's fine: the code and Firebase config aren't secret. The planner data lives only in Firestore, behind sign-in and the rules.

## Changing who has access

Update both `js/firebase-config.js` (`ALLOWED_DOMAINS`, `EDITOR_EMAILS`) and `firestore.rules`, then re-publish the rules. The config file only controls the UI. The rules are what the server enforces.
