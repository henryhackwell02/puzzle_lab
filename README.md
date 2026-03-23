# Puzzle Lab

Build, share, and solve custom word puzzles with friends. Four games in one app:

- **Connections** — Group 16 words into 4 colour-coded categories
- **Wordle** — Guess a secret 5-letter word in 6 tries
- **Strands** — Find themed words hidden in a letter grid (NYT-style, no filler letters)
- **Threads** — Deduce missing words in a linked chain

## Features

- Create an account and sign in
- Build custom puzzles for all four game types
- Add friends and share puzzles with them
- Play puzzles shared by friends
- Leaderboard tracking wins, perfect games, and stats
- Runtime dictionary loading for comprehensive word validation
- Touch-optimised Strands with drag-to-select
- Works offline in demo mode (in-memory) or with Supabase for full persistence

## Quick Start (Local Dev)

```bash
npm install
npm run dev
```

Opens at `http://localhost:3000`. Without Supabase configured, it runs in demo mode with in-memory storage.

## Deploy to Vercel with Supabase

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a free project
2. Go to **SQL Editor** → **New Query**
3. Paste the contents of `supabase-schema.sql` and run it
4. Go to **Authentication** → **Providers** → **Email** and:
   - Ensure email provider is enabled
   - **Disable "Confirm email"** (for easier testing)
5. Go to **Settings** → **API** and copy:
   - Project URL
   - `anon` public key

### 2. Configure Environment Variables

Create `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Import Project** → select your repo
3. Add the two environment variables in Vercel's project settings
4. Deploy!

## Project Structure

```
puzzle-lab/
├── app/
│   ├── globals.css          # Tailwind + custom animations
│   ├── layout.js            # Root layout
│   └── page.js              # Main page
├── components/
│   └── PuzzleLab.jsx        # Full game app (1600+ lines)
├── lib/
│   └── supabase.js          # Supabase client + all DB operations
├── supabase-schema.sql      # Database schema (run in Supabase SQL Editor)
├── .env.local.example       # Environment variables template
├── package.json
├── next.config.js
├── tailwind.config.js
└── postcss.config.js
```

## How It Works

The app has a **dual-mode architecture**:

- **With Supabase**: Full persistence — accounts, puzzles, friends, shared puzzles, and results are stored in PostgreSQL via Supabase. Authentication uses Supabase Auth (email + password).
- **Without Supabase**: In-memory demo mode — everything works within a single session using React state. A demo account (`demo` / `demo`) is pre-loaded with sample puzzles.

The game logic (all four games) runs entirely client-side. Supabase is only used for data persistence and auth.

## Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (auto-created on signup) |
| `puzzles` | All created puzzles (type, title, JSON data) |
| `shared_puzzles` | Puzzle sharing between users |
| `friend_requests` | Pending/accepted/declined friend requests |
| `friendships` | Bidirectional friend relationships |
| `results` | Game results (solved, mistakes) |

All tables have Row Level Security (RLS) policies so users can only access their own data.
