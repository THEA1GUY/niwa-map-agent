# 🌊 NIWA Map Agent

A web app for the **National Inland Waterways Authority**. Log in, upload a map
(scan, photo, chart, or PDF), **chat with an AI assistant** about it, and
**download a Word or PDF report** of the findings.

- **Vision (looking at maps):** Llama 4 Scout, via **Groq**
- **Reasoning / writing:** gpt-oss-120b, via **OpenRouter**
- **Hosting:** Netlify · **Database:** Netlify DB (Neon Postgres) · **File storage:** Netlify Blobs

> This is **Phase 1**: images, photos, and PDFs. Survey spreadsheets (Phase 2) and
> full GIS files like shapefiles/GeoTIFF (Phase 3) come later.

---

## 🟢 Plain-English setup (first time)

You need a free **Netlify** account and your two AI keys (**Groq** and **OpenRouter**).

### 1. Get the project running locally (optional but recommended)

```bash
npm install
cp .env.example .env.local      # then open .env.local and fill in the values
npm run dev                     # open http://localhost:3000
```

Fill these into `.env.local`:

| Setting | Where to get it |
|---|---|
| `DATABASE_URL` | Netlify dashboard → your site → **Storage** → create a Neon database → copy connection string |
| `AUTH_SECRET` | Run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and paste the result |
| `GROQ_API_KEY` | https://console.groq.com → API Keys |
| `OPENROUTER_API_KEY` | https://openrouter.ai → Keys |

### 2. Create the database tables (one time)

```bash
npm run db:push
```

This reads `src/lib/schema.ts` and creates the `users`, `maps`, and `messages`
tables in your Neon database.

### 3. Deploy to Netlify

1. Push to GitHub (already done — see the repo).
2. In Netlify: **Add new site → Import from GitHub →** pick this repo.
3. Under **Storage**, add a **Neon** database (this fills `DATABASE_URL` automatically).
4. Under **Site settings → Environment variables**, add: `AUTH_SECRET`,
   `GROQ_API_KEY`, `OPENROUTER_API_KEY` (and optionally the model names).
5. Deploy. Your site goes live at `https://<your-site>.netlify.app`.
6. Visit the site, click **Create an account**, and you're in.

---

## 🧑‍💻 Day-to-day operations

- **Add a user:** there's no admin panel yet — anyone can self-register on the
  `/register` page. (Locking this down to NIWA staff is a good Phase-2 task.)
- **Change an API key:** update it in Netlify → Environment variables, then
  redeploy (or trigger a deploy).
- **Costs:** you pay Groq + OpenRouter per use; both have dashboards showing usage.
- **If something breaks:** check Netlify → **Deploys** (build errors) and
  **Functions / Logs** (runtime errors). The most common cause is a missing or
  wrong environment variable.

## 🔒 Security notes

- Passwords are hashed (bcrypt); login sessions are signed cookies (`AUTH_SECRET`).
- API keys live only in environment variables — **never** in the code or git.
- Uploaded maps are private to the user who uploaded them.
- ⚠️ Maps are sent to Groq/OpenRouter (cloud) for analysis. Don't upload
  classified material until an in-house option is added.

## 🗂️ Project layout

```
src/
  app/
    login, register, dashboard, maps/[id]   # pages
    api/auth/...                             # register / login / logout
    api/maps/...                             # upload, file, chat, report
  components/                                # AuthForm, Header, UploadForm, MapChat
  lib/
    db.ts, schema.ts        # database
    auth.ts                 # passwords + sessions
    storage.ts              # file storage (Netlify Blobs / local)
    ai.ts                   # Groq vision + OpenRouter reasoning
    reports.ts              # Word + PDF generation
```
