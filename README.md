# SpendPilot — Netlify deployment

This version is adapted for Netlify:
- Static frontend is served from `public/`
- Express API runs as a Netlify Function
- PostgreSQL remains the persistent database
- Sessions are stored in PostgreSQL
- Excel export runs through the function

## Recommended deployment path

GitHub → Netlify → PostgreSQL.

### 1. Create a PostgreSQL database

Use a hosted PostgreSQL provider. Netlify also documents its integrated production-grade serverless Postgres offering. You need a PostgreSQL connection string available as `DATABASE_URL`.

Make sure the connection uses SSL when required by the provider, e.g.:

DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require

### 2. Push this project to GitHub

Do not commit `.env` or passwords.

Commands:

git init
git add .
git commit -m "Initial SpendPilot Netlify deployment"
git branch -M main
git remote add origin YOUR_REPOSITORY_URL
git push -u origin main

### 3. Import into Netlify

Netlify:
Add new project → Import an existing project → GitHub → select the repository.

Build settings are already in `netlify.toml`:

Publish directory:
public

Functions directory:
netlify/functions

No frontend build command is required.

### 4. Add environment variables

Netlify:
Project configuration → Environment variables

Add:

DATABASE_URL = your PostgreSQL connection string
SESSION_SECRET = a long random secret
NODE_ENV = production

Do not put production secrets into the Git repository.

### 5. Deploy

Trigger the first deploy.

After deployment, open your Netlify URL.

The first visit automatically creates the database tables because `schema.sql` is initialized by the function.

Then create your account using First-time setup.

## Local Netlify test

Install dependencies:

npm install

Install Netlify CLI if needed:

npm install -g netlify-cli

Run:

netlify dev

The local site will normally be available at the URL shown by Netlify CLI.

## Important architecture note

Netlify Functions are serverless. This project therefore does NOT run `node server.js` as a permanent server. `server.js` exports the Express app and `netlify/functions/api.js` exposes it as a Netlify Function.

## Reminder limitation

The existing daily reminder works while the app/browser is active and can use browser notifications after permission is granted. A website cannot guarantee an audible alarm when the browser/OS has completely suspended or closed the site.

For a reliable scheduled notification, add Web Push/FCM or another push service.

## Financial data

Use PostgreSQL as the source of truth. Keep database backups enabled. Excel export is an export feature and should not be treated as the only backup.
