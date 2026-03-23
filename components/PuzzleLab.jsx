"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase,
  signUp, signIn, signOut, getSession, getUser, getProfile,
  searchProfiles, createPuzzle as sbCreatePuzzle, getMyPuzzles,
  deletePuzzle as sbDeletePuzzle, sharePuzzle as sbSharePuzzle,
  getSharedWithMe, sendFriendRequest as sbSendFriendRequest,
  getFriendRequests, acceptFriendRequest as sbAcceptFriendRequest,
  declineFriendRequest as sbDeclineFriendRequest, getFriends,
  removeFriend as sbRemoveFriend, saveResult as sbSaveResult,
  getMyResults, getLeaderboardStats, getFriendsPuzzles
} from "@/lib/supabase";

/* ═══════════════════════════════════════════════════
   PUZZLE LAB — Build & Share Word Games
   Connections · Wordle · Strands · Threads
   
   Uses Supabase for persistent storage when configured.
   Falls back to in-memory state for local dev / demo.
   ═══════════════════════════════════════════════════ */

const SB = typeof window !== "undefined" && !!process.env.NEXT_PUBLIC_SUPABASE_URL;

const GAME_TYPES = {
  connections: { name: "Connections", icon: "▦", desc: "Group 16 words into 4 categories", color: "#F9DF6D" },
  wordle: { name: "Wordle", icon: "⊞", desc: "Guess a secret word in 6 tries", color: "#6AAA64" },
  strands: { name: "Strands", icon: "◎", desc: "Find themed words in a letter grid", color: "#97C1F7" },
  threads: { name: "Threads", icon: "◇", desc: "Deduce missing words in a chain", color: "#C4A0E8" },
};

const CONN_COLORS = {
  yellow: { bg: "#F9DF6D", text: "#1a1a1a", label: "Straightforward" },
  green: { bg: "#6AAA64", text: "#fff", label: "Moderate" },
  blue: { bg: "#97C1F7", text: "#1a1a1a", label: "Tricky" },
  purple: { bg: "#C4A0E8", text: "#1a1a1a", label: "Devious" },
};
const CONN_ORDER = ["yellow", "green", "blue", "purple"];

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const shuffle = a => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

// ═══ SEED DATA (used when Supabase is not configured) ═══
const SEED = {
  demo: {
    username: "demo", displayName: "Demo Player", password: "demo",
    friends: [], friendRequests: [], sharedWithMe: [], results: {},
    puzzles: [
      {
        id: "s1", type: "connections", title: "Music Genres", creator: "demo", creatorName: "Demo Player", createdAt: Date.now() - 86400000,
        data: { groups: [
          { color: "yellow", category: "Rock Subgenres", words: ["PUNK", "GRUNGE", "METAL", "INDIE"] },
          { color: "green", category: "Jazz Styles", words: ["BEBOP", "SWING", "FUSION", "COOL"] },
          { color: "blue", category: "Electronic", words: ["HOUSE", "TECHNO", "TRANCE", "DUBSTEP"] },
          { color: "purple", category: "Also a Dance", words: ["SALSA", "BLUES", "COUNTRY", "DISCO"] },
        ]},
      },
      {
        id: "s2", type: "wordle", title: "Tricky Five", creator: "demo", creatorName: "Demo Player", createdAt: Date.now() - 50000000,
        data: { word: "CRANE", hint: "Construction site bird" },
      },
      {
        id: "s3", type: "threads", title: "Kitchen Chain", creator: "demo", creatorName: "Demo Player", createdAt: Date.now() - 30000000,
        data: { chain: [
          { word: "BREAD", visible: true },
          { word: "BUTTER", visible: false, linkHint: "Goes on toast together" },
          { word: "CUP", visible: false, linkHint: "___cup (compound word)" },
          { word: "CAKE", visible: true },
          { word: "WALK", visible: false, linkHint: "Piece of ___" },
          { word: "WAY", visible: true },
        ]},
      },
    ],
    createdAt: Date.now() - 200000000,
  },
};

// ═══════════════════════════════════════
// SUPABASE DATA LOADER
// ═══════════════════════════════════════
async function loadUserFromSupabase(authUser) {
  const profile = await getProfile(authUser.id);
  if (!profile) return null;
  const username = profile.email;
  const [puzzles, sharedData, friendsData, requestsData, results] = await Promise.all([
    getMyPuzzles(authUser.id),
    getSharedWithMe(authUser.id),
    getFriends(authUser.id),
    getFriendRequests(authUser.id),
    getMyResults(authUser.id),
  ]);

  const friends = friendsData.map(f => ({ username: f.friend?.email, displayName: f.friend?.display_name, id: f.friend?.id })).filter(f => f.username);

  // Fetch friends' puzzles
  const friendIds = friends.map(f => f.id).filter(Boolean);
  const friendsPuzzlesData = friendIds.length > 0 ? await getFriendsPuzzles(friendIds) : [];

  // Build shared puzzle list from joined data
  const sharedPuzzlesList = sharedData
    .filter(s => s.puzzles)
    .map(s => ({
      id: s.puzzles.id, type: s.puzzles.type, title: s.puzzles.title, data: s.puzzles.data,
      creator: s.from?.display_name || "Unknown", creatorName: s.puzzles.profiles?.display_name || "Unknown",
      createdAt: new Date(s.puzzles.created_at).getTime(),
      sharedBy: s.from?.display_name, sharedByName: s.from?.display_name,
    }));

  return {
    username,
    supaId: authUser.id,
    displayName: profile.display_name || username,
    friends,
    friendRequests: requestsData.map(r => ({ from: r.from?.email, fromDisplay: r.from?.display_name, fromId: r.from?.id, requestId: r.id })),
    puzzles: puzzles.map(p => ({
      id: p.id, type: p.type, title: p.title, data: p.data,
      creator: username, creatorName: profile.display_name,
      createdAt: new Date(p.created_at).getTime(),
    })),
    friendsPuzzles: friendsPuzzlesData.map(p => ({
      id: p.id, type: p.type, title: p.title, data: p.data,
      creator: p.profiles?.email || "Unknown", creatorName: p.profiles?.display_name || "Unknown",
      createdAt: new Date(p.created_at).getTime(),
    })),
    sharedPuzzles: sharedPuzzlesList,
    results,
    createdAt: new Date(profile.created_at).getTime(),
  };
}

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function PuzzleLab() {
  const [db, setDb] = useState(SEED);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [supaUser, setSupaUser] = useState(null);
  const [screen, setScreen] = useState("auth");
  const [activeGame, setActiveGame] = useState(null);
  const [activePuzzle, setActivePuzzle] = useState(null);
  const [notification, setNotification] = useState(null);
  const [appLoading, setAppLoading] = useState(true);

  const notify = useCallback((msg, type = "info") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const user = currentUsername ? db[currentUsername] : null;

  const updateUser = useCallback((username, fn) => {
    setDb(prev => {
      const u = prev[username];
      if (!u) return prev;
      return { ...prev, [username]: fn({ ...u }) };
    });
  }, []);

  // Reload current user data from Supabase
  const reloadUser = useCallback(async () => {
    if (!SB || !supaUser) return;
    const userData = await loadUserFromSupabase(supaUser);
    if (userData) {
      setDb(prev => ({ ...prev, [userData.username]: userData }));
    }
  }, [supaUser]);

  // Check session on mount
  useEffect(() => {
    (async () => {
      if (SB) {
        try {
          const session = await getSession();
          if (session?.user) {
            const userData = await loadUserFromSupabase(session.user);
            if (userData) {
              setDb(prev => ({ ...prev, [userData.username]: userData }));
              setCurrentUsername(userData.username);
              setSupaUser(session.user);
              setScreen("home");
            }
          }
        } catch (e) { console.error("Session check:", e); }
      }
      setAppLoading(false);
    })();
  }, []);

  // ── Auth ──
  const login = async (emailOrUn, pw) => {
    if (SB) {
      const email = emailOrUn.includes("@") ? emailOrUn : emailOrUn;
      const { user: au, error } = await signIn(email, pw);
      if (error) return error;
      const userData = await loadUserFromSupabase(au);
      if (!userData) return "Could not load profile";
      setDb(prev => ({ ...prev, [userData.username]: userData }));
      setCurrentUsername(userData.username);
      setSupaUser(au);
      setScreen("home");
      return null;
    }
    const u = db[emailOrUn]; if (!u) return "User not found"; if (u.password !== pw) return "Wrong password";
    setCurrentUsername(emailOrUn); setScreen("home"); return null;
  };

  const register = async (emailOrUn, dn, pw) => {
    if (emailOrUn.length < 3) return "Must be 3+ chars";
    if (pw.length < (SB ? 6 : 4)) return `Password must be ${SB ? 6 : 4}+ chars`;
    if (SB) {
      const email = emailOrUn.includes("@") ? emailOrUn : emailOrUn;
      const { error } = await signUp(email, pw, dn || emailOrUn);
      if (error) return error;
      const { user: au, error: siErr } = await signIn(email, pw);
      if (siErr) return "Account created! Check email or sign in.";
      const userData = await loadUserFromSupabase(au);
      if (!userData) return "Account created! Please sign in.";
      setDb(prev => ({ ...prev, [userData.username]: userData }));
      setCurrentUsername(userData.username);
      setSupaUser(au);
      setScreen("home");
      return null;
    }
    if (db[emailOrUn]) return "Already taken";
    setDb(p => ({ ...p, [emailOrUn]: { username: emailOrUn, displayName: dn || emailOrUn, password: pw, friends: [], friendRequests: [], puzzles: [], sharedWithMe: [], sharedPuzzles: [], results: {}, createdAt: Date.now() } }));
    setCurrentUsername(emailOrUn); setScreen("home"); return null;
  };

  const logout = async () => {
    if (SB) await signOut();
    setCurrentUsername(null); setSupaUser(null); setScreen("auth");
  };

  const nav = (s, game, puzzle) => { setScreen(s); setActiveGame(game || null); setActivePuzzle(puzzle || null); };

  if (appLoading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0b", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#F9DF6D", fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 800 }}>Puzzle Lab</p>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0b", color: "#e8e8e8", fontFamily: "'DM Sans', 'Segoe UI', sans-serif" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", background: "radial-gradient(ellipse at 30% 0%, rgba(249,223,109,0.04) 0%, transparent 50%), radial-gradient(ellipse at 70% 100%, rgba(151,193,247,0.04) 0%, transparent 50%)" }} />
      {notification && (
        <div style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 1000, padding: "10px 22px", borderRadius: 10, background: notification.type === "error" ? "#c0392b" : notification.type === "success" ? "#27ae60" : "#34495e", color: "#fff", fontSize: 13, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,0.5)", animation: "slideD .3s ease", maxWidth: "90vw" }}>
          {notification.msg}
        </div>
      )}
      <div style={{ position: "relative", zIndex: 1 }}>
        {screen === "auth" && <Auth onLogin={login} onRegister={register} isSupabase={SB} />}
        {screen === "home" && user && <Home user={user} db={db} nav={nav} logout={logout} notify={notify} updateUser={updateUser} supaUser={supaUser} reloadUser={reloadUser} />}
        {screen === "create" && user && <Creator user={user} db={db} gameType={activeGame} onBack={() => nav("home")} notify={notify} updateUser={updateUser} supaUser={supaUser} reloadUser={reloadUser} />}
        {screen === "play" && user && activePuzzle && <Player user={user} puzzle={activePuzzle} onBack={() => nav("home")} notify={notify} updateUser={updateUser} supaUser={supaUser} />}
        {screen === "friends" && user && <Friends user={user} db={db} onBack={() => nav("home")} updateUser={updateUser} notify={notify} supaUser={supaUser} reloadUser={reloadUser} />}
        {screen === "leaderboard" && user && <Leaderboard user={user} db={db} onBack={() => nav("home")} supaUser={supaUser} />}
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:wght@700;800;900&display=swap');
        @keyframes slideD{from{opacity:0;transform:translateX(-50%) translateY(-16px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pop{0%{transform:scale(1)}50%{transform:scale(1.06)}100%{transform:scale(1)}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
        @keyframes reveal{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}
        @keyframes flip{0%{transform:rotateX(0)}50%{transform:rotateX(90deg)}100%{transform:rotateX(0)}}
        *{box-sizing:border-box;margin:0;padding:0}
        input,textarea{font-family:inherit}
        button{cursor:pointer;font-family:inherit;border:none;transition:all .15s ease}
        button:hover{filter:brightness(1.08);transform:translateY(-1px)}
        button:active{transform:translateY(0)}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
      `}</style>
    </div>
  );
}

const inp = { padding: "12px 14px", borderRadius: 9, border: "1px solid #2a2a2a", background: "#111", color: "#e8e8e8", fontSize: 14, outline: "none", width: "100%" };
const BackBtn = ({ onClick }) => <button onClick={onClick} style={{ background: "none", color: "#666", fontSize: 13, marginBottom: 18, padding: "4px 0" }}>← Back</button>;
const Title = ({ children, color }) => <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 24, color: color || "#e8e8e8", marginBottom: 24 }}>{children}</h2>;

// ═══ AUTH (supports both email/password for Supabase and username/password for local) ═══
function Auth({ onLogin, onRegister, isSupabase }) {
  const [mode, setMode] = useState("login");
  const [un, setUn] = useState(""); const [dn, setDn] = useState(""); const [pw, setPw] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setErr(null); setBusy(true);
    const e = mode === "login"
      ? await onLogin(un.trim(), pw)
      : await onRegister(un.trim(), dn.trim() || un.trim(), pw);
    if (e) setErr(e);
    setBusy(false);
  };
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 380, animation: "fadeUp .5s ease" }}>
        <div style={{ textAlign: "center", marginBottom: 44 }}>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: 38, color: "#F9DF6D", marginBottom: 6 }}>Puzzle Lab</h1>
          <p style={{ color: "#666", fontSize: 13, letterSpacing: 3, textTransform: "uppercase" }}>Build · Share · Solve</p>
        </div>
        <div style={{ background: "#141415", borderRadius: 18, padding: 28, border: "1px solid #1e1e1e" }}>
          <div style={{ display: "flex", background: "#0a0a0b", borderRadius: 10, padding: 3, marginBottom: 24 }}>
            {["login", "register"].map(m => <button key={m} onClick={() => { setMode(m); setErr(null); }} style={{ flex: 1, padding: "9px 0", borderRadius: 8, fontSize: 13, fontWeight: 600, background: mode === m ? "#1e1e1e" : "transparent", color: mode === m ? "#F9DF6D" : "#555" }}>{m === "login" ? "Sign In" : "Create Account"}</button>)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input placeholder={isSupabase ? "Email address" : "Username"} value={un} onChange={e => setUn(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} style={inp} />
            {mode === "register" && <input placeholder="Display name (optional)" value={dn} onChange={e => setDn(e.target.value)} style={inp} />}
            <input type="password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} style={inp} />
          </div>
          {err && <p style={{ color: "#e74c3c", fontSize: 12, marginTop: 10, textAlign: "center" }}>{err}</p>}
          <button onClick={go} disabled={busy} style={{ width: "100%", marginTop: 20, padding: "13px 0", borderRadius: 10, background: "#F9DF6D", color: "#0a0a0b", fontSize: 14, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>{busy ? "..." : mode === "login" ? "Sign In" : "Create Account"}</button>
          {!isSupabase && <p style={{ color: "#444", fontSize: 11, textAlign: "center", marginTop: 14 }}>Demo: <span style={{ color: "#666" }}>demo / demo</span></p>}
          {isSupabase && <p style={{ color: "#444", fontSize: 11, textAlign: "center", marginTop: 14 }}>Use your email to create an account</p>}
        </div>
      </div>
    </div>
  );
}

function Home({ user, db, nav, logout, notify, updateUser }) {
  const [puzzleTab, setPuzzleTab] = useState("mine");
  const [myFilter, setMyFilter] = useState("current");
  const [confirmDelete, setConfirmDelete] = useState(null);

  const allPuzzles = [...(user.puzzles || [])].sort((a, b) => b.createdAt - a.createdAt);
  const currentPuzzles = allPuzzles.filter(p => !p.archived);
  const archivedPuzzles = allPuzzles.filter(p => p.archived);
  const shownPuzzles = myFilter === "current" ? currentPuzzles : archivedPuzzles;

  // Friends' puzzles — only non-archived (current) ones
  const friendsPuzzles = (() => {
    if (user.friendsPuzzles && user.friendsPuzzles.length > 0) {
      return user.friendsPuzzles.filter(p => !p.archived);
    }
    const fps = [];
    for (const f of (user.friends || [])) {
      const fKey = typeof f === "object" ? f.username : f;
      const fDisplay = typeof f === "object" ? (f.displayName || f.username) : f;
      const fData = db[fKey];
      if (fData) {
        for (const p of (fData.puzzles || [])) {
          if (!p.archived) fps.push({ ...p, creatorName: fData.displayName || fDisplay });
        }
      }
    }
    return fps.sort((a, b) => b.createdAt - a.createdAt);
  })();

  const shared = (user.sharedWithMe || []).map(ref => {
    const c = db[ref.from]; if (!c) return null;
    const p = (c.puzzles || []).find(x => x.id === ref.puzzleId);
    return p ? { ...p, sharedBy: ref.from, sharedByName: c.displayName } : null;
  }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  const supaShared = (user.sharedPuzzles || []);
  const allShared = [...shared, ...supaShared.filter(sp => !shared.some(s => s.id === sp.id))];

  const del = (id) => {
    updateUser(user.username, u => { u.puzzles = u.puzzles.filter(p => p.id !== id); delete u.results[id]; return u; });
    if (SB && user.supaId) sbDeletePuzzle(id, user.supaId);
    notify("Deleted", "success");
    setConfirmDelete(null);
  };

  const toggleArchive = (id) => {
    updateUser(user.username, u => {
      u.puzzles = u.puzzles.map(p => p.id === id ? { ...p, archived: !p.archived } : p);
      return u;
    });
  };

  const req = (user.friendRequests || []).length;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 900, fontSize: 26, color: "#F9DF6D" }}>Puzzle Lab</h1>
          <p style={{ color: "#666", fontSize: 12, marginTop: 3 }}>Welcome, {user.displayName}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => nav("friends")} style={{ padding: "7px 14px", borderRadius: 8, background: "#1a1a1b", color: "#97C1F7", fontSize: 12, fontWeight: 600 }}>Friends{req > 0 ? ` (${req})` : ""}</button>
          <button onClick={() => nav("leaderboard")} style={{ padding: "7px 14px", borderRadius: 8, background: "#1a1a1b", color: "#C4A0E8", fontSize: 12, fontWeight: 600 }}>Leaderboard</button>
          <button onClick={logout} style={{ padding: "7px 14px", borderRadius: 8, background: "#1a1a1b", color: "#555", fontSize: 12, fontWeight: 600 }}>Sign Out</button>
        </div>
      </div>

      {/* Create buttons */}
      <p style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 }}>Create a Puzzle</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 36 }}>
        {Object.entries(GAME_TYPES).map(([key, g]) => (
          <button key={key} onClick={() => nav("create", key)} style={{ padding: "18px 14px", borderRadius: 14, background: "#141415", border: "1px solid #1e1e1e", textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 20, color: g.color }}>{g.icon}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: g.color }}>{g.name}</span>
            </div>
            <p style={{ fontSize: 11, color: "#666", lineHeight: 1.4 }}>{g.desc}</p>
          </button>
        ))}
      </div>

      {/* Shared */}
      {allShared.length > 0 && (
        <Sec title="Shared With You" color="#6AAA64">
          {allShared.map(p => <PCard key={p.id + (p.sharedBy || "")} p={p} sub={`from ${p.sharedByName || p.sharedBy || p.creatorName}`} res={user.results} onPlay={() => nav("play", null, p)} />)}
        </Sec>
      )}

      {/* Puzzle tabs: My Puzzles / Friends' Puzzles */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setPuzzleTab("mine")} style={{
          padding: "8px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
          background: puzzleTab === "mine" ? "#F9DF6D" : "#1a1a1b",
          color: puzzleTab === "mine" ? "#0a0a0b" : "#666",
        }}>My Puzzles</button>
        <button onClick={() => setPuzzleTab("friends")} style={{
          padding: "8px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1,
          background: puzzleTab === "friends" ? "#97C1F7" : "#1a1a1b",
          color: puzzleTab === "friends" ? "#0a0a0b" : "#666",
        }}>Friends' Puzzles{friendsPuzzles.length > 0 ? ` (${friendsPuzzles.length})` : ""}</button>

        {/* Current / Archived filter for My Puzzles */}
        {puzzleTab === "mine" && (
          <select
            value={myFilter}
            onChange={e => setMyFilter(e.target.value)}
            style={{
              marginLeft: "auto", padding: "6px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
              background: "#1a1a1b", color: "#888", border: "1px solid #2a2a2a", outline: "none",
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <option value="current">Current ({currentPuzzles.length})</option>
            <option value="archived">Archived ({archivedPuzzles.length})</option>
          </select>
        )}
      </div>

      {puzzleTab === "mine" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
          {shownPuzzles.length === 0
            ? <p style={{ color: "#555", fontSize: 13, padding: "16px 0" }}>
                {myFilter === "current" ? "No current puzzles — create one above or unarchive an older one!" : "No archived puzzles."}
              </p>
            : shownPuzzles.map(p => (
                <PCard key={p.id} p={p} res={user.results} onPlay={() => nav("play", null, p)}
                  onDel={() => setConfirmDelete(p.id)}
                  onArchive={() => toggleArchive(p.id)}
                  archived={p.archived}
                  owner />
              ))}
        </div>
      )}

      {puzzleTab === "friends" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
          {friendsPuzzles.length === 0 ? <p style={{ color: "#555", fontSize: 13, padding: "16px 0" }}>No friends' puzzles yet — add friends to see their creations!</p>
            : friendsPuzzles.map(p => <PCard key={p.id} p={p} sub={`by ${p.creatorName}`} res={user.results} onPlay={() => nav("play", null, p)} />)}
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => setConfirmDelete(null)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#141415", borderRadius: 16, padding: 28, maxWidth: 340, width: "100%", border: "1px solid #2a2a2a", textAlign: "center", animation: "fadeUp .2s ease" }}>
            <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Delete puzzle?</p>
            <p style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>This can't be undone.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={() => setConfirmDelete(null)} style={{ padding: "10px 24px", borderRadius: 8, background: "#1e1e1e", color: "#888", fontSize: 13, fontWeight: 600 }}>Cancel</button>
              <button onClick={() => del(confirmDelete)} style={{ padding: "10px 24px", borderRadius: 8, background: "#e74c3c", color: "#fff", fontSize: 13, fontWeight: 700 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const Sec = ({ title, color, children }) => (
  <div style={{ marginBottom: 28 }}>
    <p style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 2, marginBottom: 10 }}>{title}</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
  </div>
);

const PCard = ({ p, sub, res, onPlay, onDel, onArchive, archived, owner }) => {
  const r = res?.[p.id]; const g = GAME_TYPES[p.type];
  return (
    <div style={{ background: "#141415", borderRadius: 12, padding: "14px 16px", border: "1px solid #1e1e1e", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 14, color: g?.color || "#888" }}>{g?.icon}</span>
          <span style={{ fontWeight: 600, fontSize: 14, color: "#e8e8e8" }}>{p.title}</span>
        </div>
        <p style={{ color: "#555", fontSize: 11 }}>
          {g?.name}{sub ? ` · ${sub}` : ""}
          {r && <span style={{ marginLeft: 6, color: r.solved ? "#6AAA64" : "#e74c3c" }}>{r.solved ? `✓ (${r.mistakes}m)` : "✗"}</span>}
        </p>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
        <button onClick={onPlay} style={{ padding: "7px 16px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: r ? "#1e1e1e" : g?.color || "#F9DF6D", color: r ? (g?.color || "#F9DF6D") : "#0a0a0b" }}>{r ? "Replay" : "Play"}</button>
        {owner && onArchive && <button onClick={onArchive} title={archived ? "Unarchive" : "Archive"} style={{ padding: "7px 10px", borderRadius: 7, fontSize: 12, background: "#1a1a1b", color: archived ? "#6AAA64" : "#555" }}>{archived ? "↑" : "↓"}</button>}
        {owner && onDel && <button onClick={onDel} style={{ padding: "7px 10px", borderRadius: 7, fontSize: 12, background: "#1a1a1b", color: "#555" }}>✕</button>}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════
// CREATOR — routes to the right game creator
// ═══════════════════════════════════════
function Creator({ user, db, gameType, onBack, notify, updateUser }) {
  const props = { user, db, onBack, notify, updateUser };
  if (gameType === "connections") return <CreateConnections {...props} />;
  if (gameType === "wordle") return <CreateWordle {...props} />;
  if (gameType === "strands") return <CreateStrands {...props} />;
  if (gameType === "threads") return <CreateThreads {...props} />;
  return null;
}

function savePuzzle(user, updateUser, notify, type, title, data, shareWith, onBack) {
  if (!title.trim()) { notify("Give your puzzle a title", "error"); return; }
  const id = uid();
  const puzzle = { id, type, title: title.trim(), creator: user.username, creatorName: user.displayName, data, createdAt: Date.now(), archived: false };
  
  // Save locally
  updateUser(user.username, u => { u.puzzles = [...u.puzzles, puzzle]; return u; });
  for (const f of shareWith) {
    updateUser(f, u => { u.sharedWithMe = [...(u.sharedWithMe || []), { puzzleId: id, from: user.username, sharedAt: Date.now() }]; return u; });
  }
  
  // Sync to Supabase
  if (SB && user.supaId) {
    (async () => {
      const sbPuzzle = await sbCreatePuzzle(user.supaId, { type, title: title.trim(), data });
      if (sbPuzzle) {
        for (const f of shareWith) {
          const friendId = typeof f === "object" ? f.id : null;
          const friendEmail = typeof f === "object" ? f.username : f;
          if (friendId) {
            await sbSharePuzzle(sbPuzzle.id, user.supaId, friendId);
          } else if (friendEmail) {
            // Look up friend ID by email from user's friends list
            const friendObj = (user.friends || []).find(fr => (typeof fr === "object" ? fr.username : fr) === friendEmail);
            if (friendObj?.id) await sbSharePuzzle(sbPuzzle.id, user.supaId, friendObj.id);
          }
        }
      }
    })();
  }
  
  notify(shareWith.length > 0 ? `Created & shared with ${shareWith.length}!` : "Puzzle created!", "success");
  onBack();
}

function SharePicker({ friends, shareWith, setShareWith }) {
  if (friends.length === 0) return null;
  const getKey = (f) => typeof f === "object" ? (f.id || f.username) : f;
  const getDisplay = (f) => typeof f === "object" ? (f.displayName || f.username) : f;
  const isSelected = (f) => shareWith.some(s => getKey(s) === getKey(f));
  const toggle = (f) => setShareWith(p => isSelected(f) ? p.filter(s => getKey(s) !== getKey(f)) : [...p, f]);
  return (
    <div style={{ background: "#141415", borderRadius: 14, padding: 16, marginBottom: 20, border: "1px solid #1e1e1e" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#97C1F7", marginBottom: 10 }}>Share with friends</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {friends.map(f => <button key={getKey(f)} onClick={() => toggle(f)} style={{ padding: "6px 12px", borderRadius: 16, fontSize: 12, fontWeight: 600, background: isSelected(f) ? "#97C1F7" : "#1e1e1e", color: isSelected(f) ? "#0a0a0b" : "#666" }}>{getDisplay(f)}</button>)}
      </div>
    </div>
  );
}

// ─── Connections Creator ───
function CreateConnections({ user, db, onBack, notify, updateUser }) {
  const [title, setTitle] = useState("");
  const [groups, setGroups] = useState(CONN_ORDER.map(c => ({ color: c, category: "", words: ["", "", "", ""] })));
  const [shareWith, setShareWith] = useState([]);
  const updG = (i, f, v) => setGroups(p => p.map((g, idx) => idx === i ? { ...g, [f]: v } : g));
  const updW = (gi, wi, v) => setGroups(p => p.map((g, idx) => idx === gi ? { ...g, words: g.words.map((w, j) => j === wi ? v : w) } : g));

  const save = () => {
    for (let i = 0; i < 4; i++) {
      if (!groups[i].category.trim()) return notify(`Fill in category for ${CONN_COLORS[groups[i].color].label}`, "error");
      for (let j = 0; j < 4; j++) if (!groups[i].words[j].trim()) return notify("Fill in all words", "error");
    }
    const all = groups.flatMap(g => g.words.map(w => w.trim().toUpperCase()));
    const dup = all.find((w, i) => all.indexOf(w) !== i);
    if (dup) return notify(`Duplicate: "${dup}"`, "error");
    savePuzzle(user, updateUser, notify, "connections", title, { groups: groups.map(g => ({ color: g.color, category: g.category.trim(), words: g.words.map(w => w.trim().toUpperCase()) })) }, shareWith, onBack);
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <Title color="#F9DF6D">Create Connections</Title>
      <input placeholder="Puzzle title..." value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, marginBottom: 24, fontSize: 16, fontWeight: 600 }} />
      {groups.map((g, i) => (
        <div key={g.color} style={{ background: "#141415", borderRadius: 14, padding: 16, marginBottom: 12, border: `1px solid ${CONN_COLORS[g.color].bg}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: CONN_COLORS[g.color].bg }} />
            <span style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>{CONN_COLORS[g.color].label}</span>
          </div>
          <input placeholder="Category name..." value={g.category} onChange={e => updG(i, "category", e.target.value)} style={{ ...inp, marginBottom: 10, fontWeight: 600 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {g.words.map((w, j) => <input key={j} placeholder={`Word ${j + 1}`} value={w} onChange={e => updW(i, j, e.target.value)} style={{ ...inp, fontSize: 13 }} />)}
          </div>
        </div>
      ))}
      <SharePicker friends={user.friends || []} shareWith={shareWith} setShareWith={setShareWith} />
      <button onClick={save} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "#F9DF6D", color: "#0a0a0b", fontSize: 15, fontWeight: 700 }}>Create Puzzle</button>
    </div>
  );
}

// ─── Wordle Creator ───
function CreateWordle({ user, db, onBack, notify, updateUser }) {
  const [title, setTitle] = useState("");
  const [word, setWord] = useState("");
  const [hint, setHint] = useState("");
  const [shareWith, setShareWith] = useState([]);

  const save = () => {
    const w = word.trim().toUpperCase();
    if (w.length !== 5 || !/^[A-Z]+$/.test(w)) return notify("Word must be exactly 5 letters", "error");
    savePuzzle(user, updateUser, notify, "wordle", title, { word: w, hint: hint.trim() }, shareWith, onBack);
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <Title color="#6AAA64">Create Wordle</Title>
      <input placeholder="Puzzle title..." value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, marginBottom: 16, fontSize: 16, fontWeight: 600 }} />
      <input placeholder="Secret 5-letter word..." value={word} onChange={e => setWord(e.target.value.slice(0, 5))} maxLength={5} style={{ ...inp, marginBottom: 12, fontSize: 20, fontWeight: 700, textTransform: "uppercase", letterSpacing: 6, textAlign: "center" }} />
      <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 16 }}>
        {[0,1,2,3,4].map(i => <div key={i} style={{ width: 44, height: 44, borderRadius: 8, background: word.trim().toUpperCase()[i] ? "#6AAA64" : "#1e1e1e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff" }}>{(word.trim().toUpperCase()[i]) || ""}</div>)}
      </div>
      <input placeholder="Hint (optional)..." value={hint} onChange={e => setHint(e.target.value)} style={{ ...inp, marginBottom: 20 }} />
      <SharePicker friends={user.friends || []} shareWith={shareWith} setShareWith={setShareWith} />
      <button onClick={save} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "#6AAA64", color: "#fff", fontSize: 15, fontWeight: 700 }}>Create Puzzle</button>
    </div>
  );
}

// ─── Strands Grid Generator ───
// Backtracking algorithm: places words as snaking paths through adjacent cells.
// Every cell must be used by exactly one word — no filler letters.
// The spangram (allWords[0]) MUST span from one edge to the OPPOSITE edge.
function generateStrandsGrid(allWords) {
  const totalLetters = allWords.reduce((s, w) => s + w.length, 0);

  // Try column widths 5–8, pick the first that produces a valid grid
  const validWidths = [6, 7, 5, 8].filter(c => totalLetters % c === 0 && Math.ceil(totalLetters / c) >= 3);
  if (validWidths.length === 0) return null;

  for (const tryCol of validWidths) {
    const result = _generateStrandsGridWithCols(allWords, totalLetters, tryCol);
    if (result) return result;
  }
  return null;
}

function _generateStrandsGridWithCols(allWords, totalLetters, cols) {
  const rows = totalLetters / cols;
  const spangram = allWords[0];
  const otherWords = allWords.slice(1);
  const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const deadline = Date.now() + 8000; // 8-second time budget

  // Precompute neighbor table (numeric, no string alloc)
  const neighborTable = new Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const n = [];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) n.push(nr * cols + nc);
    }
    neighborTable[r * cols + c] = n;
  }

  const isEdge = (r, c) => r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
  const getEdgeBits = (r, c) => {
    let b = 0;
    if (r === 0) b |= 1;           // top
    if (r === rows - 1) b |= 2;    // bottom
    if (c === 0) b |= 4;           // left
    if (c === cols - 1) b |= 8;    // right
    return b;
  };
  // Opposite: top(1)↔bottom(2), left(4)↔right(8)
  const onOppositeEdges = (r1, c1, r2, c2) => {
    const b1 = getEdgeBits(r1, c1), b2 = getEdgeBits(r2, c2);
    if (!b1 || !b2) return false;
    return ((b1 & 1) && (b2 & 2)) || ((b1 & 2) && (b2 & 1)) || ((b1 & 4) && (b2 & 8)) || ((b1 & 8) && (b2 & 4));
  };

  // Fast connectivity check using flat numeric arrays
  const gridFlat = new Int8Array(rows * cols); // 0 = empty, 1 = filled
  const visited = new Uint8Array(rows * cols);
  let visitGen = 0;

  function emptyConnected() {
    let firstEmpty = -1, emptyCount = 0;
    for (let i = 0; i < rows * cols; i++) {
      if (!gridFlat[i]) { emptyCount++; if (firstEmpty < 0) firstEmpty = i; }
    }
    if (emptyCount <= 1) return true;
    visitGen++;
    const queue = [firstEmpty];
    visited[firstEmpty] = visitGen;
    let reached = 1;
    let qi = 0;
    while (qi < queue.length) {
      const cur = queue[qi++];
      for (const nb of neighborTable[cur]) {
        if (!gridFlat[nb] && visited[nb] !== visitGen) {
          visited[nb] = visitGen;
          queue.push(nb);
          reached++;
        }
      }
    }
    return reached === emptyCount;
  }

  // Grid letter storage
  const gridLetters = new Array(rows * cols).fill(null);

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  let placements = {};

  function placeWord(wi, charIdx, path, sortedWords) {
    if (Date.now() > deadline) return false;
    const word = sortedWords[wi];
    if (charIdx === word.length) {
      if (wi === 0) {
        const s = path[0], e = path[path.length - 1];
        const sr = Math.floor(s / cols), sc = s % cols, er = Math.floor(e / cols), ec = e % cols;
        if (!isEdge(sr, sc) || !isEdge(er, ec) || !onOppositeEdges(sr, sc, er, ec)) return false;
      }
      placements[word] = path.map(p => [Math.floor(p / cols), p % cols]);
      return tryNextWord(wi + 1, sortedWords);
    }

    const letter = word[charIdx];
    let candidates;

    if (charIdx === 0) {
      candidates = [];
      if (wi === 0) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          if (!gridFlat[r * cols + c] && isEdge(r, c)) candidates.push(r * cols + c);
        }
      } else {
        for (let i = 0; i < rows * cols; i++) { if (!gridFlat[i]) candidates.push(i); }
      }
      shuffle(candidates);
    } else {
      const prev = path[path.length - 1];
      candidates = neighborTable[prev].filter(i => !gridFlat[i]);
      // Bias spangram toward opposite edge
      if (wi === 0 && charIdx > word.length * 0.4) {
        const startCell = path[0];
        const sr = Math.floor(startCell / cols), sc = startCell % cols;
        const startBits = getEdgeBits(sr, sc);
        // Score candidates: prefer cells closer to opposite edge
        candidates.sort((a, b) => {
          const ar = Math.floor(a / cols), ac = a % cols;
          const br = Math.floor(b / cols), bc = b % cols;
          let aScore = 0, bScore = 0;
          if (startBits & 1) { aScore += ar; bScore += br; } // start top → prefer high row
          if (startBits & 2) { aScore += (rows - 1 - ar); bScore += (rows - 1 - br); } // start bottom → prefer low row
          if (startBits & 4) { aScore += ac; bScore += bc; } // start left → prefer high col
          if (startBits & 8) { aScore += (cols - 1 - ac); bScore += (cols - 1 - bc); } // start right → prefer low col
          return bScore - aScore;
        });
        // Shuffle within top half to maintain variety
        const half = Math.ceil(candidates.length / 2);
        const top = candidates.slice(0, half);
        const bot = candidates.slice(half);
        shuffle(top); shuffle(bot);
        candidates = [...top, ...bot];
      } else {
        shuffle(candidates);
      }
    }

    for (const idx of candidates) {
      gridLetters[idx] = letter;
      gridFlat[idx] = 1;
      path.push(idx);

      const shouldCheck = charIdx > 0 && (charIdx % 4 === 0 || charIdx === word.length - 1);
      if (!shouldCheck || emptyConnected()) {
        if (placeWord(wi, charIdx + 1, path, sortedWords)) return true;
      }

      path.pop();
      gridLetters[idx] = null;
      gridFlat[idx] = 0;
    }
    return false;
  }

  function tryNextWord(wi, sortedWords) {
    if (wi >= sortedWords.length) {
      for (let i = 0; i < rows * cols; i++) if (!gridFlat[i]) return false;
      return true;
    }
    return placeWord(wi, 0, [], sortedWords);
  }

  // Verify each word has exactly one path in the grid
  function hasUniquePlacements(finalPlacements) {
    for (const word of allWords) {
      if (countWordPaths(word) > 1) return false;
    }
    return true;
  }

  function countWordPaths(word) {
    let count = 0;
    const vis = new Uint8Array(rows * cols);

    function dfs(ci, lastIdx) {
      if (count >= 2) return;
      if (ci === word.length) { count++; return; }
      const targets = ci === 0
        ? Array.from({ length: rows * cols }, (_, i) => i).filter(i => gridLetters[i] === word[0])
        : neighborTable[lastIdx].filter(i => !vis[i] && gridLetters[i] === word[ci]);
      for (const idx of targets) {
        vis[idx] = 1;
        dfs(ci + 1, idx);
        vis[idx] = 0;
        if (count >= 2) return;
      }
    }
    dfs(0, -1);
    return count;
  }

  // Main loop: try different word orderings with a time budget
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    // Reset grid
    gridFlat.fill(0);
    gridLetters.fill(null);
    placements = {};

    // Vary word ordering: always spangram first, then shuffle others
    const shuffledOthers = [...otherWords];
    shuffle(shuffledOthers);
    // Alternate between longest-first and random ordering
    const sortedWords = attempt % 3 === 0
      ? [spangram, ...shuffledOthers]
      : [spangram, ...shuffledOthers.sort((a, b) => b.length - a.length)];

    if (tryNextWord(0, sortedWords)) {
      const finalPlacements = {};
      for (const w of allWords) finalPlacements[w] = placements[w];
      if (hasUniquePlacements(finalPlacements)) {
        // Convert to 2D grid
        const grid2D = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => gridLetters[r * cols + c]));
        return { grid: grid2D, rows, cols, placements: finalPlacements };
      }
    }
  }
  return null;
}

// ─── Strands Creator ───
function CreateStrands({ user, db, onBack, notify, updateUser }) {
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState("");
  const [wordsInput, setWordsInput] = useState("");
  const [spangramInput, setSpangramInput] = useState("");
  const [shareWith, setShareWith] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState(null);

  const generate = () => {
    const spangram = spangramInput.trim().toUpperCase();
    const words = wordsInput.split(",").map(w => w.trim().toUpperCase()).filter(Boolean);
    if (!spangram) return notify("Enter a spangram (theme word)", "error");
    if (words.length < 3) return notify("Enter at least 3 words (comma separated)", "error");
    if (words.length > 7) return notify("Maximum 7 words", "error");
    for (const w of [spangram, ...words]) { if (!/^[A-Z]+$/.test(w) || w.length < 3) return notify(`"${w}" must be 3+ letters, A-Z only`, "error"); }

    const allWords = [spangram, ...words];
    const totalLetters = allWords.reduce((s, w) => s + w.length, 0);
    const hasValidWidth = [5, 6, 7, 8].some(c => totalLetters % c === 0 && Math.ceil(totalLetters / c) >= 3);
    if (!hasValidWidth) return notify(`Total letters (${totalLetters}) must be divisible by 5, 6, 7, or 8 for the grid. Adjust word lengths.`, "error");

    setGenerating(true);
    setPreview(null);
    // Use setTimeout to allow UI to update
    setTimeout(() => {
      const result = generateStrandsGrid(allWords);
      setGenerating(false);
      if (!result) {
        notify("Couldn't fit all words into the grid — try different words or adjust letter counts", "error");
      } else {
        setPreview({ ...result, spangram, words, allWords });
        notify("Grid generated! Review below and save.", "success");
      }
    }, 50);
  };

  const save = () => {
    if (!preview) return notify("Generate a grid first", "error");
    if (!title.trim()) return notify("Give your puzzle a title", "error");
    const spangram = spangramInput.trim().toUpperCase();
    const words = wordsInput.split(",").map(w => w.trim().toUpperCase()).filter(Boolean);
    savePuzzle(user, updateUser, notify, "strands", title, {
      theme: theme.trim() || title.trim(), spangram, words,
      grid: preview.grid, rows: preview.rows, cols: preview.cols, placements: preview.placements
    }, shareWith, onBack);
  };

  const totalLetters = (() => {
    const sp = spangramInput.trim().toUpperCase();
    const ws = wordsInput.split(",").map(w => w.trim().toUpperCase()).filter(Boolean);
    return (sp ? sp.length : 0) + ws.reduce((s, w) => s + w.length, 0);
  })();
  const validWidths = [5, 6, 7, 8].filter(c => totalLetters % c === 0 && Math.ceil(totalLetters / c) >= 3);
  const isValid = totalLetters > 0 && validWidths.length > 0;
  const nearestValid = isValid ? totalLetters : [5, 6, 7, 8].map(c => Math.ceil(totalLetters / c) * c).sort((a, b) => a - b).find(n => n >= totalLetters) || Math.ceil(totalLetters / 6) * 6;

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <Title color="#97C1F7">Create Strands</Title>
      <p style={{ color: "#666", fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
        Enter a theme, a spangram (the key theme word that captures the theme), and words to hide. Every cell in the grid will be used by exactly one word — no filler. Total letters must be divisible by 5, 6, 7, or 8 (the system picks the best grid width).
      </p>
      <input placeholder="Puzzle title..." value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, marginBottom: 12, fontSize: 16, fontWeight: 600 }} />
      <input placeholder="Theme hint (shown to player)..." value={theme} onChange={e => setTheme(e.target.value)} style={{ ...inp, marginBottom: 12 }} />
      <input placeholder="Spangram (key theme word)..." value={spangramInput} onChange={e => { setSpangramInput(e.target.value); setPreview(null); }} style={{ ...inp, marginBottom: 12, fontWeight: 600, textTransform: "uppercase" }} />
      <textarea placeholder="Words to hide (comma separated)..." value={wordsInput} onChange={e => { setWordsInput(e.target.value); setPreview(null); }} rows={3} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
      <p style={{ color: isValid ? "#6AAA64" : "#C9B458", fontSize: 11, marginTop: 6, marginBottom: 6 }}>
        Letters: {totalLetters}{totalLetters > 0 && !isValid && ` → need ${nearestValid} (${nearestValid - totalLetters} more)`}{isValid && ` ✓ (grid widths: ${validWidths.join(", ")} cols)`}
      </p>
      <p style={{ color: "#555", fontSize: 11, marginBottom: 16 }}>3–7 words, each 3+ letters. Words snake through adjacent cells (including diagonals).</p>

      <button onClick={generate} disabled={generating} style={{ width: "100%", padding: "12px 0", borderRadius: 10, background: "#1e1e1e", color: "#97C1F7", fontSize: 14, fontWeight: 700, marginBottom: 16, border: "1px solid #97C1F744", opacity: generating ? 0.5 : 1 }}>
        {generating ? "Generating..." : preview ? "Regenerate Grid" : "Generate Grid"}
      </button>

      {/* Preview */}
      {preview && (
        <div style={{ background: "#141415", borderRadius: 14, padding: 16, marginBottom: 20, border: "1px solid #97C1F733" }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#97C1F7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12, textAlign: "center" }}>Grid Preview</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
            {Array.from({ length: preview.rows }, (_, r) => (
              <div key={r} style={{ display: "flex", gap: 3 }}>
                {Array.from({ length: preview.cols }, (_, c) => {
                  const isSpan = preview.placements[preview.spangram]?.some(([pr, pc]) => pr === r && pc === c);
                  return (
                    <div key={c} style={{ width: Math.min(36, Math.floor(280 / preview.cols)), height: Math.min(36, Math.floor(280 / preview.cols)), borderRadius: "50%", background: isSpan ? "#F9DF6D33" : "#1e1e1e", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.min(14, Math.floor(200 / preview.cols)), fontWeight: 700, color: isSpan ? "#F9DF6D" : "#bbb" }}>
                      {preview.grid[r][c]}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <SharePicker friends={user.friends || []} shareWith={shareWith} setShareWith={setShareWith} />
      <button onClick={save} disabled={!preview} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: preview ? "#97C1F7" : "#1e1e1e", color: preview ? "#0a0a0b" : "#555", fontSize: 15, fontWeight: 700 }}>Create Puzzle</button>
    </div>
  );
}

// ─── Threads Creator ───
function CreateThreads({ user, db, onBack, notify, updateUser }) {
  const [title, setTitle] = useState("");
  const [chain, setChain] = useState([
    { word: "", visible: true, linkHint: "" },
    { word: "", visible: false, linkHint: "" },
    { word: "", visible: false, linkHint: "" },
    { word: "", visible: true, linkHint: "" },
    { word: "", visible: false, linkHint: "" },
    { word: "", visible: true, linkHint: "" },
  ]);
  const [shareWith, setShareWith] = useState([]);

  const updChain = (i, field, val) => setChain(p => p.map((c, idx) => idx === i ? { ...c, [field]: val } : c));

  const save = () => {
    for (let i = 0; i < chain.length; i++) { if (!chain[i].word.trim()) return notify("Fill in all words", "error"); }
    for (let i = 0; i < chain.length; i++) { if (!chain[i].visible && !chain[i].linkHint.trim()) return notify("Hidden words need a link hint", "error"); }
    const data = { chain: chain.map(c => ({ word: c.word.trim().toUpperCase(), visible: c.visible, linkHint: c.linkHint.trim() })) };
    savePuzzle(user, updateUser, notify, "threads", title, data, shareWith, onBack);
  };

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <Title color="#C4A0E8">Create Threads</Title>
      <p style={{ color: "#666", fontSize: 12, marginBottom: 20, lineHeight: 1.6 }}>
        Build a chain of 6 linked words. Mark 3 as visible (given to the player) and 3 as hidden (to guess). For each hidden word, write a hint describing how it links to its neighbours.
      </p>
      <input placeholder="Puzzle title..." value={title} onChange={e => setTitle(e.target.value)} style={{ ...inp, marginBottom: 20, fontSize: 16, fontWeight: 600 }} />
      {chain.map((c, i) => (
        <div key={i} style={{ background: "#141415", borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${c.visible ? "#C4A0E822" : "#C4A0E844"}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#C4A0E8", fontWeight: 700 }}>#{i + 1}</span>
            <button onClick={() => updChain(i, "visible", !c.visible)} style={{ padding: "3px 10px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: c.visible ? "#C4A0E8" : "#1e1e1e", color: c.visible ? "#0a0a0b" : "#666" }}>
              {c.visible ? "Visible" : "Hidden"}
            </button>
          </div>
          <input placeholder="Word..." value={c.word} onChange={e => updChain(i, "word", e.target.value)} style={{ ...inp, marginBottom: c.visible ? 0 : 8, fontWeight: 600, textTransform: "uppercase" }} />
          {!c.visible && <input placeholder="Link hint (how it connects to neighbours)..." value={c.linkHint} onChange={e => updChain(i, "linkHint", e.target.value)} style={{ ...inp, fontSize: 12 }} />}
        </div>
      ))}
      <SharePicker friends={user.friends || []} shareWith={shareWith} setShareWith={setShareWith} />
      <button onClick={save} style={{ width: "100%", padding: "14px 0", borderRadius: 12, background: "#C4A0E8", color: "#0a0a0b", fontSize: 15, fontWeight: 700, marginTop: 8 }}>Create Puzzle</button>
    </div>
  );
}

// ═══════════════════════════════════════
// PLAYER — routes to the right game player
// ═══════════════════════════════════════
function Player({ user, puzzle, onBack, notify, updateUser }) {
  const props = { user, puzzle, onBack, notify, updateUser };
  if (puzzle.type === "connections") return <PlayConnections {...props} />;
  if (puzzle.type === "wordle") return <PlayWordle {...props} />;
  if (puzzle.type === "strands") return <PlayStrands {...props} />;
  if (puzzle.type === "threads") return <PlayThreads {...props} />;
  return null;
}

const saveResult = (updateUser, username, puzzleId, solved, mistakes, supaUserId) => {
  updateUser(username, u => { u.results = { ...u.results, [puzzleId]: { solved, mistakes, completedAt: Date.now() } }; return u; });
  if (SB && supaUserId) {
    sbSaveResult(supaUserId, puzzleId, solved, mistakes);
  }
};

// ─── Play Connections ───
function PlayConnections({ user, puzzle, onBack, notify, updateUser }) {
  const { groups } = puzzle.data;
  const [board, setBoard] = useState([]);
  const [sel, setSel] = useState([]);
  const [solved, setSolved] = useState([]);
  const [mistakes, setMistakes] = useState(0);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [revI, setRevI] = useState(-1);

  useEffect(() => {
    setBoard(shuffle(groups.flatMap(g => g.words.map(w => ({ word: w, color: g.color, category: g.category })))));
    setSolved([]); setSel([]); setMistakes(0); setOver(false); setWon(false);
  }, [puzzle]);

  const toggle = w => { if (over) return; setSel(p => p.includes(w) ? p.filter(x => x !== w) : p.length < 4 ? [...p, w] : p); };

  const submit = () => {
    if (sel.length !== 4 || over) return;
    const cols = sel.map(w => board.find(b => b.word === w).color);
    if (cols.every(c => c === cols[0])) {
      const g = groups.find(g => g.color === cols[0]);
      const ns = [...solved, g]; setSolved(ns); setRevI(ns.length - 1); setTimeout(() => setRevI(-1), 500);
      setBoard(p => p.filter(b => !sel.includes(b.word))); setSel([]);
      if (ns.length === 4) { setWon(true); setOver(true); saveResult(updateUser, user.username, puzzle.id, true, mistakes); }
    } else {
      const cc = {}; cols.forEach(c => cc[c] = (cc[c] || 0) + 1);
      if (Math.max(...Object.values(cc)) === 3) notify("One away!", "info");
      setShaking(true); setTimeout(() => setShaking(false), 400);
      const nm = mistakes + 1; setMistakes(nm); setSel([]);
      if (nm >= 4) {
        setOver(true); setWon(false);
        setSolved(p => [...p, ...groups.filter(g => !p.find(s => s.color === g.color))]);
        setBoard([]); setSel([]);
        saveResult(updateUser, user.username, puzzle.id, false, nm);
      }
    }
  };

  const dots = Array.from({ length: 4 }, (_, i) => i < (4 - mistakes));
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 22, marginBottom: 3 }}>{puzzle.title}</h2>
        <p style={{ color: "#555", fontSize: 12 }}>by {puzzle.creatorName}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: solved.length ? 6 : 0 }}>
        {solved.map((g, i) => (
          <div key={g.color} style={{ background: CONN_COLORS[g.color].bg, borderRadius: 10, padding: "12px 14px", textAlign: "center", animation: revI === i ? "reveal .4s ease" : undefined }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: CONN_COLORS[g.color].text }}>{g.category}</p>
            <p style={{ fontSize: 12, color: CONN_COLORS[g.color].text, opacity: 0.8 }}>{g.words.join(", ")}</p>
          </div>
        ))}
      </div>
      {board.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16, animation: shaking ? "shake .35s ease" : undefined }}>
          {board.map(b => {
            const s = sel.includes(b.word);
            return <button key={b.word} onClick={() => toggle(b.word)} style={{ padding: "clamp(10px, 3vw, 14px) 4px", borderRadius: 8, fontSize: "clamp(10px, 3vw, 13px)", fontWeight: 700, background: s ? "#e8e8e8" : "#1e1e1e", color: s ? "#0a0a0b" : "#bbb", textTransform: "uppercase", letterSpacing: .3, lineHeight: 1.2, minHeight: 48, wordBreak: "break-word", animation: s ? "pop .2s ease" : undefined }}>{b.word}</button>;
          })}
        </div>
      )}
      {!over && <>
        <div style={{ textAlign: "center", marginBottom: 14 }}>
          <p style={{ fontSize: 11, color: "#555", marginBottom: 5 }}>Mistakes remaining</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 5 }}>{dots.map((a, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: a ? "#e8e8e8" : "#333" }} />)}</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setBoard(shuffle(board))} style={cBtn}>Shuffle</button>
          <button onClick={() => setSel([])} style={{ ...cBtn, opacity: sel.length ? 1 : .4 }}>Deselect</button>
          <button onClick={submit} style={{ padding: "10px 24px", borderRadius: 24, background: sel.length === 4 ? "#e8e8e8" : "#1e1e1e", color: sel.length === 4 ? "#0a0a0b" : "#555", fontSize: 13, fontWeight: 700 }}>Submit</button>
        </div>
      </>}
      {over && <GameOver won={won} mistakes={mistakes} onBack={onBack} color="#F9DF6D" />}
    </div>
  );
}

const cBtn = { padding: "10px 20px", borderRadius: 24, background: "#1e1e1e", color: "#bbb", fontSize: 13, fontWeight: 600, border: "1px solid #2a2a2a" };
const GameOver = ({ won, mistakes, onBack, color, winMessage }) => (
  <div style={{ textAlign: "center", marginTop: 20, animation: "fadeUp .4s ease" }}>
    <p style={{ fontSize: 26, fontFamily: "'Fraunces', serif", fontWeight: 800, color: won ? "#6AAA64" : "#e74c3c", marginBottom: 6 }}>{won ? "Brilliant!" : "Next time!"}</p>
    <p style={{ color: "#555", fontSize: 13, marginBottom: 18 }}>{won ? (winMessage || `${mistakes} mistake${mistakes !== 1 ? "s" : ""}`) : ""}</p>
    <button onClick={onBack} style={{ padding: "10px 28px", borderRadius: 24, background: color, color: "#0a0a0b", fontSize: 13, fontWeight: 700 }}>Back to Home</button>
  </div>
);

// ─── Play Wordle ───
function PlayWordle({ user, puzzle, onBack, notify, updateUser }) {
  const { word, hint } = puzzle.data;
  const [guesses, setGuesses] = useState([]);
  const [current, setCurrent] = useState("");
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [validWords, setValidWords] = useState(null);
  const [dictLoading, setDictLoading] = useState(true);
  const maxGuesses = 6;

  // Load comprehensive word list at runtime from public sources
  useEffect(() => {
    let cancelled = false;
    const loadDict = async () => {
      const sources = [
        "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words",
        "https://raw.githubusercontent.com/charlesreid1/five-letter-words/master/sgb-words.txt",
        "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt",
      ];
      for (const url of sources) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const text = await res.text();
          const words = new Set();
          text.split(/[\r\n,]+/).forEach(w => {
            w = w.trim().toUpperCase();
            if (w.length === 5 && /^[A-Z]+$/.test(w)) words.add(w);
          });
          if (words.size > 100) {
            words.add(word); // always allow the puzzle's answer
            if (!cancelled) {
              setValidWords(words);
              setDictLoading(false);
            }
            return;
          }
        } catch (e) { /* try next source */ }
      }
      // Fallback: use embedded list + accept the puzzle word
      const fallback = new Set(FIVE_LETTER_WORDS.split(","));
      fallback.add(word);
      if (!cancelled) {
        setValidWords(fallback);
        setDictLoading(false);
      }
    };
    loadDict();
    return () => { cancelled = true; };
  }, [word]);

  const getColors = (guess, answer) => {
    const result = Array(5).fill("absent");
    const ansArr = answer.split("");
    const used = Array(5).fill(false);
    for (let i = 0; i < 5; i++) { if (guess[i] === ansArr[i]) { result[i] = "correct"; used[i] = true; } }
    for (let i = 0; i < 5; i++) {
      if (result[i] === "correct") continue;
      for (let j = 0; j < 5; j++) { if (!used[j] && guess[i] === ansArr[j]) { result[i] = "present"; used[j] = true; break; } }
    }
    return result;
  };

  const submit = () => {
    if (over || dictLoading) return;
    const g = current.toUpperCase();
    if (g.length !== 5) return;
    if (!/^[A-Z]+$/.test(g)) return notify("Letters only", "error");

    // Validate against word list
    if (validWords && !validWords.has(g)) {
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      notify("Not in word list", "error");
      return;
    }

    const colors = getColors(g, word);
    const newGuesses = [...guesses, { word: g, colors }];
    setGuesses(newGuesses);
    setCurrent("");
    if (g === word) { setWon(true); setOver(true); saveResult(updateUser, user.username, puzzle.id, true, newGuesses.length - 1); }
    else if (newGuesses.length >= maxGuesses) { setOver(true); setWon(false); saveResult(updateUser, user.username, puzzle.id, false, maxGuesses); }
  };

  // Handle physical keyboard
  useEffect(() => {
    const handler = (e) => {
      if (over || dictLoading) return;
      if (e.key === "Enter") { submit(); return; }
      if (e.key === "Backspace") { setCurrent(p => p.slice(0, -1)); return; }
      if (/^[a-zA-Z]$/.test(e.key) && current.length < 5) { setCurrent(p => p + e.key.toUpperCase()); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, over, dictLoading, validWords, guesses]);

  const colorMap = { correct: "#6AAA64", present: "#C9B458", absent: "#3a3a3c" };

  // Keyboard — build key states with priority: correct > present > absent > unused
  const kbRows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const keyStates = {};
  for (const g of guesses) {
    for (let i = 0; i < 5; i++) {
      const l = g.word[i]; const c = g.colors[i];
      if (c === "correct") keyStates[l] = "correct";
      else if (c === "present" && keyStates[l] !== "correct") keyStates[l] = "present";
      else if (!keyStates[l]) keyStates[l] = "absent";
    }
  }

  const getKeyStyle = (l) => {
    const state = keyStates[l];
    if (state === "correct") return {
      background: "#6AAA64", color: "#fff",
      boxShadow: "0 0 8px rgba(106,170,100,0.5), inset 0 1px 0 rgba(255,255,255,0.2)",
      border: "2px solid #7dbd77",
      fontWeight: 800, transform: "scale(1.02)",
    };
    if (state === "present") return {
      background: "#C9B458", color: "#fff",
      boxShadow: "0 0 6px rgba(201,180,88,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",
      border: "2px solid #d4c46e",
      fontWeight: 800,
    };
    if (state === "absent") return {
      background: "#1a1a1a", color: "#444",
      border: "2px solid #1a1a1a",
      fontWeight: 600, opacity: 0.5,
    };
    return {
      background: "#2a2a2a", color: "#ddd",
      border: "2px solid #333",
      fontWeight: 700,
    };
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 22, marginBottom: 3 }}>{puzzle.title}</h2>
        <p style={{ color: "#555", fontSize: 12 }}>by {puzzle.creatorName}</p>
        {hint && <p style={{ color: "#6AAA64", fontSize: 12, marginTop: 6, fontStyle: "italic" }}>Hint: {hint}</p>}
        {dictLoading && <p style={{ color: "#555", fontSize: 11, marginTop: 6 }}>Loading dictionary...</p>}
        {!dictLoading && validWords && <p style={{ color: "#333", fontSize: 10, marginTop: 4 }}>{validWords.size.toLocaleString()} words loaded</p>}
      </div>

      {/* Grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", marginBottom: 20, animation: shaking ? "shake .4s ease" : undefined }}>
        {Array.from({ length: maxGuesses }, (_, ri) => {
          const g = guesses[ri];
          const isCurrent = ri === guesses.length && !over;
          return (
            <div key={ri} style={{ display: "flex", gap: 6 }}>
              {Array.from({ length: 5 }, (_, ci) => {
                const letter = g ? g.word[ci] : (isCurrent ? (current.toUpperCase()[ci] || "") : "");
                const bg = g ? colorMap[g.colors[ci]] : (letter ? "#3a3a3c" : "#1a1a1b");
                return <div key={ci} style={{ width: "clamp(44px, 13vw, 56px)", height: "clamp(44px, 13vw, 56px)", borderRadius: 6, background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(18px, 5vw, 22px)", fontWeight: 800, color: "#fff", border: isCurrent && !letter ? "2px solid #3a3a3c" : isCurrent && letter ? "2px solid #555" : "2px solid transparent", animation: g ? "reveal .3s ease" : undefined, animationDelay: g ? `${ci * 0.1}s` : undefined }}>{letter}</div>;
              })}
            </div>
          );
        })}
      </div>

      {/* Keyboard */}
      {!over && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
          {kbRows.map((row, ri) => (
            <div key={ri} style={{ display: "flex", gap: "clamp(3px, 1vw, 5px)", justifyContent: "center", width: "100%" }}>
              {ri === 2 && <button onClick={submit} style={{ padding: "10px 8px", borderRadius: 8, background: "#444", color: "#fff", fontSize: 11, fontWeight: 700, minWidth: "clamp(44px, 12vw, 58px)", border: "2px solid #555" }}>ENTER</button>}
              {row.split("").map(l => (
                <button key={l} onClick={() => current.length < 5 && setCurrent(p => p + l)} style={{
                  width: "clamp(26px, 8vw, 36px)", height: 48, borderRadius: 8, fontSize: "clamp(12px, 3.5vw, 14px)",
                  transition: "all 0.2s ease",
                  ...getKeyStyle(l),
                }}>{l}</button>
              ))}
              {ri === 2 && <button onClick={() => setCurrent(p => p.slice(0, -1))} style={{ padding: "10px 8px", borderRadius: 8, background: "#444", color: "#fff", fontSize: 13, fontWeight: 700, minWidth: "clamp(44px, 12vw, 58px)", border: "2px solid #555" }}>⌫</button>}
            </div>
          ))}
        </div>
      )}

      {over && (
        <div style={{ textAlign: "center" }}>
          {!won && <p style={{ color: "#C9B458", fontSize: 14, marginBottom: 8 }}>The word was: <strong>{word}</strong></p>}
          <GameOver won={won} mistakes={won ? guesses.length : maxGuesses} onBack={onBack} color="#6AAA64" winMessage={won ? `You got it in ${guesses.length}!` : undefined} />
        </div>
      )}
    </div>
  );
}

// ─── Word dictionary for game validation ───
// 2400+ valid 5-letter English words
const FIVE_LETTER_WORDS = "AAHED,AALII,ABACI,ABACK,ABAFT,ABASE,ABASH,ABATE,ABBEY,ABBOT,ABEAM,ABELE,ABLER,ABODE,ABORT,ABOUT,ABOVE,ABUSE,ACHED,ACHES,ACIDS,ACIDY,ACMES,ACNED,ACNES,ACORN,ACRES,ACTED,ACTIN,ACTOR,ACUTE,ADAGE,ADDED,ADDER,ADDLE,ADEPT,ADIEU,ADIOS,ADMIT,ADOBE,ADOPT,ADULT,AFOOT,AFOUL,AFTER,AGAIN,AGAPE,AGATE,AGAVE,AGENT,AGGRO,AGILE,AGING,AGLOW,AGONE,AGONY,AGREE,AHEAD,AIDED,AIDER,AIDES,AILED,AIMED,AIMER,AIRED,AISLE,ALARM,ALBUM,ALDER,ALERT,ALGAE,ALGAL,ALIAS,ALIBI,ALIEN,ALIGN,ALIKE,ALIVE,ALLAY,ALLEY,ALLOT,ALLOW,ALLOY,ALOFT,ALOHA,ALONE,ALONG,ALOOF,ALOUD,ALPHA,ALTAR,ALTER,AMASS,AMAZE,AMBER,AMBLE,AMEND,AMINE,AMINO,AMISS,AMITY,AMONG,AMOUR,AMPLE,AMPLY,AMUSE,ANGEL,ANGER,ANGLE,ANGRY,ANGST,ANIME,ANKLE,ANNEX,ANNOY,ANTIC,ANVIL,AORTA,APACE,APART,APHID,APPLE,APPLY,APRON,APTLY,ARBOR,AREAL,AREAS,ARENA,ARGUE,ARISE,ARMED,ARMOR,AROMA,AROSE,ARRAY,ARROW,ARSON,ASIDE,ASKED,ASKER,ASPEN,ASSET,ATTIC,AUDIO,AUDIT,AUGUR,AUNTS,AUNTY,AUTOS,AVAIL,AVERT,AVIAN,AVOID,AWAIT,AWAKE,AWARD,AWARE,AWASH,AWFUL,AWOKE,AXIAL,AXING,AXIOM,AXLES,AZTEC,AZURE,BABEL,BACON,BADGE,BADLY,BAGEL,BAGGY,BAKED,BAKER,BALLS,BALMS,BALMY,BANDS,BANGS,BANJO,BANKS,BARKS,BARNS,BARON,BASAL,BASED,BASES,BASIC,BASIL,BASIN,BASIS,BASKS,BATCH,BATHE,BATON,BATTY,BEACH,BEADS,BEADY,BEAKS,BEAMS,BEANS,BEARD,BEARS,BEAST,BEATS,BEAUS,BEECH,BEEFS,BEEFY,BEEPS,BEERS,BEETS,BEGAN,BEGIN,BEGUN,BEIGE,BEING,BELCH,BELLE,BELLS,BELLY,BELOW,BELTS,BENCH,BENDS,BERRY,BERTH,BIBLE,BIKED,BIKES,BILLS,BILLY,BINDS,BINGO,BIRCH,BIRDS,BIRTH,BITES,BLACK,BLADE,BLAME,BLAND,BLANK,BLARE,BLAST,BLAZE,BLEAK,BLEAT,BLEED,BLEEP,BLEND,BLESS,BLIMP,BLIND,BLINI,BLINK,BLISS,BLITZ,BLOAT,BLOCK,BLOKE,BLOND,BLOOD,BLOOM,BLOWN,BLOWS,BLUES,BLUFF,BLUNT,BLURB,BLURS,BLURT,BLUSH,BOARD,BOAST,BOATS,BOGEY,BOGGY,BOGUS,BOILS,BOLTS,BOMBS,BONDS,BONED,BONES,BONUS,BOOKS,BOOST,BOOTH,BOOTS,BOOZE,BOOZY,BORED,BORER,BORES,BOUND,BOWED,BOWEL,BOWER,BOWLS,BOXED,BOXER,BOXES,BRACE,BRAGS,BRAID,BRAIN,BRAKE,BRAND,BRASS,BRAVE,BRAVO,BRAWL,BRAWN,BREAD,BREAK,BREED,BREWS,BRICK,BRIDE,BRIEF,BRINE,BRING,BRINK,BRINY,BRISK,BROAD,BROIL,BROKE,BROOD,BROOK,BROOM,BROTH,BROWN,BRUNT,BRUSH,BRUTE,BUDDY,BUDGE,BUGGY,BUGLE,BUILD,BUILT,BULBS,BULGE,BULKY,BULLS,BULLY,BUMPS,BUMPY,BUNCH,BUNKS,BUNNY,BUOYS,BURNS,BURNT,BURST,BUSES,BUSHY,BUSTS,BUSTY,BUTCH,BUYER,BYTES,CABAL,CABIN,CABLE,CADET,CAGED,CAGES,CAKES,CALLS,CALMS,CAMEL,CAMPS,CANAL,CANDY,CANES,CANOE,CANON,CAPER,CAPES,CARDS,CARED,CARER,CARES,CARGO,CAROL,CARPS,CARRY,CARVE,CASES,CATCH,CATER,CAUSE,CAVES,CEASE,CEDAR,CELLS,CENTS,CHAIN,CHAIR,CHALK,CHAMP,CHANT,CHAOS,CHAPS,CHARM,CHART,CHASE,CHEAP,CHEAT,CHECK,CHEEK,CHEER,CHEFS,CHESS,CHEST,CHICK,CHIEF,CHILD,CHILI,CHILL,CHIME,CHINA,CHIPS,CHOIR,CHOKE,CHORD,CHORE,CHOSE,CHUNK,CIDER,CIGAR,CINCH,CITED,CITES,CIVIC,CIVIL,CLAIM,CLAMP,CLAMS,CLANG,CLANK,CLAPS,CLASH,CLASP,CLASS,CLAWS,CLAYS,CLEAN,CLEAR,CLEAT,CLERK,CLICK,CLIFF,CLIMB,CLING,CLINK,CLIPS,CLOAK,CLOCK,CLONE,CLOSE,CLOTH,CLOTS,CLOUD,CLOUT,CLOWN,CLUBS,CLUCK,CLUED,CLUES,CLUMP,CLUNG,CLUNK,COACH,COALS,COAST,COATS,COCOA,CODED,CODES,COILS,COINS,COLOR,COMBO,COMES,COMET,COMIC,COMMA,CONCH,CONDO,CONES,COOKS,COOPS,CORAL,CORDS,CORES,CORNY,COSTS,COUCH,COULD,COUNT,COUPE,COUPS,COURT,COVER,COVET,CRABS,CRACK,CRAFT,CRAMP,CRANE,CRASH,CRATE,CRAVE,CRAWL,CRAZE,CRAZY,CREAK,CREAM,CREED,CREEK,CREEP,CREST,CREWS,CRIME,CRISP,CROCK,CROPS,CROSS,CROWD,CROWN,CRUDE,CRUEL,CRUSH,CRUST,CRYPT,CUBES,CUBIC,CUFFS,CURBS,CURED,CURES,CURLS,CURLY,CURRY,CURSE,CURVE,CURVY,CYCLE,CYNIC,DADDY,DAILY,DAIRY,DAISY,DANCE,DARED,DARES,DATED,DATES,DATUM,DAWNS,DEALS,DEALT,DEATH,DEBIT,DEBUT,DECAY,DECKS,DECOR,DECOY,DECRY,DEEDS,DEITY,DELAY,DELTA,DELVE,DEMON,DEMUR,DENIM,DENSE,DEPOT,DEPTH,DERBY,DESKS,DETER,DETOX,DEUCE,DEVIL,DIALS,DIARY,DICED,DIETS,DIGIT,DIMLY,DINED,DINER,DINES,DINGY,DIRTY,DISCO,DISCS,DITCH,DITTY,DIVAS,DIVER,DIVES,DIZZY,DOCKS,DODGE,DODGY,DOGMA,DOING,DOLLS,DOMED,DONOR,DONUT,DOORS,DOSES,DOTTY,DOUBT,DOUGH,DOUSE,DOWNS,DOZEN,DRAFT,DRAGS,DRAIN,DRAKE,DRAMA,DRANK,DRAPE,DRAWN,DRAWS,DREAD,DREAM,DRESS,DRIED,DRIER,DRIFT,DRILL,DRINK,DRIPS,DRIVE,DRONE,DROOL,DROOP,DROPS,DROSS,DROVE,DROWN,DRUGS,DRUMS,DRUNK,DRYER,DRYLY,DUALS,DUCTS,DUDES,DULLY,DUMMY,DUMPS,DUMPY,DUNCE,DUNES,DUNKS,DUPED,DUPLE,DUSTY,DUTCH,DWARF,DWELL,DWELT,DYERS,DYING,EAGER,EAGLE,EARLY,EARNS,EARTH,EASED,EASEL,EATEN,EATER,EAVES,EBBED,EBONY,EDGED,EDGES,EDICT,EDITS,EERIE,EIGHT,EJECT,ELBOW,ELDER,ELECT,ELITE,ELOPE,ELUDE,ELVES,EMAIL,EMBED,EMBER,EMCEE,EMILY,EMITS,EMPTY,ENDED,ENEMY,ENJOY,ENNUI,ENSUE,ENTER,ENTRY,ENVOY,EPOCH,EQUAL,EQUIP,ERASE,ERODE,ERROR,ESSAY,ETHER,ETHIC,EVADE,EVENT,EVERY,EVICT,EVOKE,EXACT,EXALT,EXAMS,EXCEL,EXERT,EXILE,EXIST,EXPAT,EXPEL,EXTRA,EXUDE,EXULT,EYING,FABLE,FACED,FACES,FACTS,FADED,FADES,FAILS,FAINT,FAIRY,FAITH,FAKED,FAKES,FALLS,FALSE,FAMED,FANCY,FANGS,FARCE,FARED,FARES,FARMS,FATAL,FATTY,FAULT,FAUNA,FAVOR,FEARS,FEAST,FEATS,FEEDS,FEELS,FEIGN,FEINT,FELLA,FELON,FENCE,FERAL,FERNS,FERRY,FETAL,FETCH,FETID,FETUS,FEVER,FEWER,FIBER,FIBRE,FIELD,FIEND,FIERY,FIFTH,FIFTY,FIGHT,FILCH,FILED,FILES,FILLS,FILMS,FILTH,FINAL,FINDS,FINED,FINER,FINES,FIRED,FIRES,FIRMS,FIRST,FISHY,FIXED,FIXER,FIXES,FLAGS,FLAIR,FLAKE,FLAKY,FLAME,FLANK,FLAPS,FLARE,FLASH,FLASK,FLATS,FLAWS,FLEAS,FLEET,FLESH,FLICK,FLIER,FLIES,FLING,FLINT,FLIPS,FLIRT,FLOAT,FLOCK,FLOOD,FLOOR,FLOPS,FLORA,FLOSS,FLOUR,FLOWN,FLOWS,FLUID,FLUKE,FLUNG,FLUNK,FLUSH,FLUTE,FOAMY,FOCAL,FOCUS,FOGGY,FOILS,FOLDS,FOLKS,FOLLY,FONTS,FOODS,FOOLS,FORAY,FORCE,FORGE,FORGO,FORMS,FORTE,FORTH,FORTY,FORUM,FOUND,FOXES,FOYER,FRAIL,FRAME,FRANK,FRAUD,FREAK,FREED,FRESH,FRIAR,FRIED,FRIES,FRISK,FROGS,FRONT,FROST,FROZE,FRUIT,FRUMP,FUDGE,FUELS,FULLY,FUMES,FUNDS,FUNGI,FUNKY,FUNNY,FURRY,FUSED,FUSES,FUSSY,FUZZY,GAINS,GALAS,GAMES,GAMMA,GANGS,GAPES,GARBS,GASES,GASPS,GATES,GAUGE,GAUNT,GAUZE,GAZER,GAZES,GEARS,GEEKS,GENES,GENRE,GENTS,GENUS,GERMS,GHOST,GIANT,GIFTS,GIRLS,GIRLY,GIRTH,GIVEN,GIVES,GIZMO,GLADS,GLAND,GLARE,GLASS,GLAZE,GLEAM,GLEAN,GLOBE,GLOOM,GLORY,GLOSS,GLOVE,GLOWS,GLUED,GLUES,GLYPH,GNOME,GOATS,GOING,GOLFS,GONER,GOODS,GOOFY,GOOSE,GORGE,GRACE,GRADE,GRAFT,GRAIL,GRAIN,GRAMS,GRAND,GRANT,GRAPE,GRAPH,GRASP,GRASS,GRATE,GRAVE,GRAVY,GRAZE,GREAT,GREED,GREEK,GREEN,GREET,GREYS,GRIEF,GRILL,GRIME,GRIMY,GRIND,GRINS,GRIPE,GRIPS,GRITS,GROAN,GROIN,GROOM,GROPE,GROSS,GROUP,GROUT,GROVE,GROWL,GROWN,GROWS,GRUBS,GRUEL,GRUFF,GRUNT,GUARD,GUAVA,GUESS,GUEST,GUIDE,GUILD,GUILT,GUISE,GULCH,GULLS,GULPS,GUMMY,GURUS,GUSTO,GUSTY,HABIT,HACKS,HAIRS,HAIRY,HALLS,HALTS,HANDS,HANDY,HANGS,HAPPY,HARDY,HAREM,HARKS,HARMS,HARPS,HARRY,HARSH,HASTE,HASTY,HATCH,HATED,HATER,HATES,HAULS,HAUNT,HAVEN,HAVOC,HAWKS,HAZEL,HEADS,HEADY,HEALS,HEAPS,HEARD,HEARS,HEART,HEATS,HEAVY,HEDGE,HEEDS,HEELS,HEFTY,HEIRS,HENCE,HERBS,HERDS,HERON,HIKED,HIKER,HIKES,HILLS,HILLY,HINDS,HINGE,HINTS,HIPPO,HIRED,HITCH,HIVES,HOBBY,HOLDS,HOLES,HOLLY,HOMES,HONEY,HONOR,HOODS,HOOFS,HOOKS,HOOPS,HOPED,HOPES,HORNS,HORNY,HORSE,HOSTS,HOTEL,HOUND,HOURS,HOUSE,HOWLS,HUMAN,HUMID,HUMOR,HUMPS,HUMPY,HUNKY,HUNTS,HURRY,HURTS,HUSKY,HYENA,HYMNS,HYPER,ICING,IDEAL,IDEAS,IDIOT,IMAGE,IMPLY,INBOX,INDEX,INDIE,INEPT,INERT,INFER,INGOT,INKED,INLET,INNER,INPUT,INTRO,IONIC,IRKED,IRONY,ISSUE,ITEMS,IVORY,JACKS,JADED,JAILS,JAPAN,JAZZY,JEANS,JEEPS,JELLY,JERKS,JERKY,JEWEL,JIFFY,JIMMY,JOHNS,JOINT,JOKER,JOKES,JOLLY,JOLTS,JOUST,JUDGE,JUICE,JUICY,JUMBO,JUMPS,JUMPY,JUROR,KEEPS,KNACK,KNEAD,KNEED,KNEEL,KNEES,KNELT,KNIFE,KNOBS,KNOCK,KNOLL,KNOTS,KNOWN,KNOWS,LABEL,LABOR,LACED,LACES,LACKS,LADEN,LADLE,LAGER,LAKES,LAMBS,LAMPS,LANCE,LANDS,LANES,LAPSE,LARGE,LARVA,LASER,LATCH,LATER,LATEX,LATHE,LAUDS,LAUGH,LAYER,LEADS,LEAFY,LEAKS,LEAKY,LEANS,LEAPS,LEAPT,LEARN,LEASE,LEAST,LEAVE,LEDGE,LEGAL,LEMON,LEVEL,LEVER,LIGHT,LIKED,LIKEN,LIKES,LILAC,LIMBO,LIMBS,LIMES,LIMIT,LIMPS,LINED,LINEN,LINER,LINES,LINGO,LINKS,LIONS,LISTS,LITER,LITRE,LIVED,LIVEN,LIVER,LIVES,LIVID,LLAMA,LOADS,LOANS,LOBBY,LOCAL,LOCKS,LOCUS,LODGE,LOFTY,LOGIC,LOGOS,LONER,LOOKS,LOOMS,LOOPS,LOOPY,LOOSE,LORDS,LORRY,LOSER,LOSES,LOVED,LOVER,LOVES,LOWER,LOYAL,LUCID,LUCKY,LUMPS,LUMPY,LUNAR,LUNCH,LUNGE,LUNGS,LURED,LURES,LURKS,LUSTY,LYING,LYNCH,LYRIC,MACHO,MACRO,MAFIA,MAGIC,MAGMA,MAJOR,MAKER,MAKES,MALES,MALLS,MANGO,MANOR,MAPLE,MARCH,MARKS,MARRY,MARSH,MASKS,MATCH,MATED,MATES,MATHS,MAYBE,MAYOR,MEALS,MEANS,MEANT,MEATS,MEATY,MEDAL,MEDIA,MEDIC,MELEE,MELON,MERCY,MERGE,MERIT,MERRY,MESSY,METAL,METER,MIGHT,MILLS,MIMIC,MINCE,MINDS,MINED,MINER,MINES,MINOR,MINTS,MINUS,MIRTH,MISER,MISTY,MITES,MIXED,MIXER,MIXES,MOANS,MOATS,MODEL,MODEM,MODES,MOGUL,MOIST,MOLDS,MOLDY,MONEY,MONKS,MONTH,MOODS,MOODY,MOONS,MOOSE,MORAL,MORPH,MOSSY,MOTEL,MOTHS,MOTOR,MOTTO,MOULD,MOUND,MOUNT,MOURN,MOUSE,MOUSY,MOUTH,MOVED,MOVER,MOVES,MOVIE,MOWED,MOWER,MUCUS,MUDDY,MULES,MUMMY,MURAL,MURKY,MUSHY,MUSIC,MUSKY,MUTED,MYRRH,MYTHS,NAILS,NAIVE,NAKED,NAMED,NAMES,NANNY,NASAL,NASTY,NAVAL,NAVEL,NEARS,NEEDY,NERVE,NERVY,NEVER,NEWER,NEWLY,NEXUS,NICER,NICHE,NIGHT,NINJA,NOBLE,NOBLY,NOISE,NOISY,NOMAD,NORMS,NORTH,NOTCH,NOTED,NOTES,NOUNS,NOVEL,NUDGE,NURSE,NUTTY,NYLON,OAKEN,OASIS,OATHS,OBESE,OCCUR,OCEAN,ODDLY,OFFAL,OFFER,OFTEN,OILED,OLDEN,OLDER,OLIVE,ONSET,OOMPH,OPENS,OPERA,OPTIC,ORBIT,ORDER,ORGAN,OTHER,OTTER,OUGHT,OUNCE,OUTDO,OUTED,OUTER,OVERT,OWNED,OWNER,OXIDE,OZONE,PACED,PACES,PACKS,PADDY,PAGES,PAILS,PAINS,PAINT,PAIRS,PALMS,PANDA,PANEL,PANES,PANIC,PANTS,PAPER,PARTY,PASTA,PASTE,PASTY,PATCH,PATHS,PATIO,PAUSE,PAVED,PAVES,PAWED,PAYEE,PEACE,PEACH,PEAKS,PEARL,PEARS,PEASE,PECAN,PEDAL,PEELS,PEERS,PENAL,PENCE,PENNY,PERCH,PERIL,PERKS,PERKY,PESKY,PETAL,PETTY,PHASE,PHONE,PHOTO,PIANO,PICKS,PICKY,PIECE,PIERS,PIGGY,PILED,PILES,PILLS,PILOT,PINCH,PINED,PINES,PINKY,PINTS,PIOUS,PIPES,PITCH,PITHY,PIVOT,PIXEL,PIZZA,PLACE,PLAID,PLAIN,PLANE,PLANK,PLANS,PLANT,PLATE,PLAZA,PLEAD,PLEAS,PLEAT,PLIED,PLIER,PLODS,PLOTS,PLOWS,PLOYS,PLUCK,PLUGS,PLUMB,PLUME,PLUMP,PLUMS,PLUNK,PLUSH,POACH,POEMS,POETS,POINT,POISE,POLAR,POLES,POLKA,POLLS,POLYP,PONDS,POOLS,PORCH,PORED,PORES,PORTS,POSED,POSER,POSES,POSSE,POSTS,POUCH,POUND,POURS,POUTY,POWER,PRANK,PRAWN,PRAYS,PRESS,PRICE,PRIDE,PRIED,PRIES,PRIME,PRINT,PRIOR,PRISM,PRIVY,PRIZE,PROBE,PRODS,PRONE,PRONG,PROOF,PROPS,PROSE,PROUD,PROVE,PROWL,PROXY,PRUDE,PRUNE,PSALM,PUBIC,PULLS,PULPS,PULPY,PULSE,PUMPS,PUNCH,PUPIL,PUPPY,PUREE,PURGE,PURSE,PUSHY,PUTTY,PYGMY,QUACK,QUAIL,QUAKE,QUALM,QUEEN,QUEER,QUERY,QUEST,QUEUE,QUICK,QUIET,QUILL,QUIRK,QUITE,QUOTA,QUOTE,RABBI,RACES,RACKS,RADAR,RADIO,RAFTS,RAGED,RAGES,RAIDS,RAILS,RAINY,RAISE,RALLY,RAMPS,RANCH,RANGE,RANKS,RAPID,RATED,RATES,RATIO,RAVEN,RAYON,RAZOR,REACH,REACT,READS,READY,REALM,REAMS,REARS,REBEL,REBUS,RECAP,RECON,RECTO,RECUT,REEDY,REEFS,REEKS,REFER,REIGN,REINS,RELAX,RELAY,RELIC,REMIT,RENAL,RENEW,RENTS,REPAY,REPEL,REPLY,RESET,RESIN,RESTS,RETRO,RETRY,REUSE,REVEL,RIDER,RIDES,RIDGE,RIFLE,RIGHT,RIGID,RILED,RINDS,RINGS,RINSE,RIOTS,RISEN,RISES,RISKS,RISKY,RITES,RITZY,RIVAL,RIVER,RIVET,ROADS,ROAMS,ROARS,ROAST,ROBES,ROBIN,ROBOT,ROCKS,ROCKY,ROGUE,ROLES,ROLLS,ROMAN,ROOFS,ROOMS,ROOMY,ROOTS,ROPED,ROPES,ROSES,ROTOR,ROUGE,ROUGH,ROUND,ROUTE,ROVER,ROWDY,ROWED,ROYAL,RUDER,RUGBY,RUINS,RULED,RULER,RULES,RUMOR,RUNGS,RURAL,RUSTY,SACKS,SADLY,SAFER,SAGES,SAINT,SALAD,SALES,SALLY,SALON,SALSA,SALTY,SALVE,SALVO,SANDS,SANDY,SANER,SAUCE,SAUCY,SAUNA,SAVED,SAVER,SAVES,SAVOR,SCALD,SCALE,SCALP,SCAMS,SCANT,SCARE,SCARF,SCARY,SCENE,SCENT,SCOOP,SCOOT,SCOPE,SCORE,SCORN,SCOUT,SCOWL,SCRAM,SCRAP,SCREW,SEALS,SEAMS,SEARS,SEATS,SEEDS,SEEDY,SEEKS,SEEMS,SEIZE,SELLS,SENDS,SENSE,SEPIA,SERIF,SERUM,SERVE,SETUP,SEVEN,SEVER,SEWED,SHADE,SHADY,SHAFT,SHAKE,SHAKY,SHALL,SHAME,SHAPE,SHARE,SHARK,SHARP,SHAVE,SHAWL,SHEAR,SHEDS,SHEEN,SHEEP,SHEER,SHEET,SHELF,SHELL,SHIFT,SHIMS,SHINE,SHINY,SHIPS,SHIRE,SHIRT,SHOCK,SHOES,SHONE,SHOOK,SHOOT,SHORE,SHORN,SHORT,SHOTS,SHOUT,SHOVE,SHOWN,SHOWS,SHOWY,SHRED,SHREW,SHRUB,SHRUG,SHUCK,SHUNS,SHUNT,SIDED,SIDES,SIEGE,SIEVE,SIGHS,SIGHT,SIGMA,SIGNS,SILKS,SILKY,SILLY,SINCE,SIREN,SITES,SIXTH,SIXTY,SIZED,SIZES,SKATE,SKEIN,SKILL,SKIMP,SKIMS,SKINS,SKIPS,SKIRT,SKULL,SKUNK,SLABS,SLAIN,SLANT,SLAPS,SLASH,SLATE,SLAVE,SLAYS,SLEEK,SLEEP,SLEET,SLEPT,SLICE,SLIDE,SLIME,SLIMY,SLING,SLINK,SLOPE,SLOPS,SLOTH,SLOTS,SLOWS,SLUGS,SLUMP,SLUMS,SLUNG,SLUNK,SLURP,SMALL,SMART,SMASH,SMEAR,SMELL,SMELT,SMILE,SMIRK,SMITE,SMITH,SMOCK,SMOKE,SMOKY,SNACK,SNAGS,SNAIL,SNAKE,SNAKY,SNAPS,SNARE,SNARL,SNEAK,SNEER,SNIDE,SNIFF,SNOBS,SNOOP,SNORE,SNORT,SNOUT,SNOWY,SNUBS,SNUCK,SNUFF,SOAPY,SOARS,SOBER,SOCKS,SOILS,SOLAR,SOLED,SOLID,SOLVE,SONGS,SONIC,SORRY,SORTS,SOULS,SOUND,SOUPY,SOUTH,SPACE,SPADE,SPANS,SPARE,SPARK,SPAWN,SPEAK,SPEAR,SPECS,SPEED,SPELL,SPEND,SPENT,SPICE,SPICY,SPIED,SPIEL,SPIES,SPIKE,SPILL,SPINE,SPITE,SPLAT,SPLIT,SPOIL,SPOKE,SPOOK,SPOOL,SPOON,SPORE,SPORT,SPOTS,SPOUT,SPRAY,SPREE,SPRIG,SPRIT,SPUDS,SPUNK,SPURS,SQUAD,SQUAT,SQUID,STABS,STACK,STAFF,STAGE,STAIN,STAIR,STAKE,STALE,STALK,STALL,STAMP,STAND,STANK,STARE,STARK,STARS,START,STASH,STATE,STAVE,STAYS,STEAK,STEAL,STEAM,STEED,STEEL,STEEP,STEER,STEMS,STEPS,STERN,STEWS,STICK,STIFF,STILL,STING,STINK,STINT,STOCK,STOIC,STOKE,STOLE,STOMP,STONE,STOOD,STOOL,STOOP,STOPS,STORE,STORK,STORM,STORY,STOUT,STOVE,STRAP,STRAW,STRAY,STRIP,STRUT,STUCK,STUDS,STUDY,STUFF,STUMP,STUNG,STUNK,STUNT,STYLE,SUAVE,SUGAR,SUING,SUITE,SUITS,SULKY,SUNNY,SUPER,SURGE,SUSHI,SWAMP,SWANS,SWAPS,SWARM,SWEAR,SWEAT,SWEEP,SWEET,SWELL,SWEPT,SWIFT,SWIGS,SWIMS,SWINE,SWING,SWIPE,SWIRL,SWISS,SWOOP,SWORD,SWORE,SWORN,SWUNG,TABBY,TABLE,TACIT,TACKS,TACKY,TAFFY,TAILS,TAKEN,TAKES,TALES,TALKS,TALLY,TALON,TAMED,TANGO,TANGS,TANGY,TANKS,TAPER,TAPES,TARDY,TASKS,TASTE,TASTY,TAXED,TAXES,TEACH,TEAMS,TEARS,TEARY,TEASE,TEDDY,TEENS,TEETH,TEMPO,TENDS,TENSE,TENTH,TERMS,TESTS,TEXTS,THANK,THEFT,THEIR,THEME,THERE,THESE,THICK,THIEF,THIGH,THING,THINK,THIRD,THORN,THOSE,THREE,THREW,THROW,THUDS,THUGS,THUMB,THUMP,TIDAL,TIDES,TIERS,TIGER,TIGHT,TILED,TILES,TILTS,TIMER,TIMES,TIMID,TINTS,TIPSY,TIRED,TIRES,TITAN,TITLE,TOAST,TODAY,TOKEN,TOLLS,TOMBS,TONED,TONER,TONES,TONGS,TOOLS,TOPIC,TORCH,TOTAL,TOUCH,TOUGH,TOURS,TOWEL,TOWER,TOWNS,TOXIC,TRACE,TRACK,TRACT,TRADE,TRAIL,TRAIN,TRAIT,TRAMP,TRAPS,TRASH,TRAWL,TRAYS,TREAD,TREAT,TREES,TREND,TRIAL,TRIBE,TRICK,TRIED,TRIES,TRIMS,TRIPS,TRITE,TROLL,TROOP,TROTS,TROUT,TRUCE,TRUCK,TRULY,TRUNK,TRUSS,TRUST,TRUTH,TUBES,TUCKS,TULIP,TUMMY,TUMOR,TUNED,TUNER,TUNES,TURBO,TURNS,TUTOR,TWEED,TWEET,TWICE,TWIGS,TWINE,TWINS,TWIRL,TWIST,TYPES,UDDER,ULCER,ULTRA,UMBER,UNCLE,UNDER,UNDID,UNDUE,UNFIT,UNIFY,UNION,UNITE,UNITS,UNITY,UNLIT,UNTIL,UPPER,UPSET,URBAN,URGED,URGES,USAGE,USERS,USHER,USING,USUAL,UTTER,VAGUE,VALET,VALID,VALOR,VALUE,VALVE,VAULT,VEINS,VELDT,VENAL,VENUE,VERGE,VERSE,VIDEO,VIEWS,VIGOR,VILLA,VINES,VINYL,VIOLA,VIPER,VIRAL,VIRUS,VISIT,VISOR,VISTA,VITAL,VIVID,VIXEN,VOCAL,VODKA,VOGUE,VOICE,VOILA,VOLTS,VOTED,VOTER,VOTES,VOUCH,VOWEL,VULVA,WADED,WADER,WADES,WAFER,WAGED,WAGER,WAGES,WAGON,WAIFS,WAILS,WAIST,WAITS,WAKED,WAKEN,WAKES,WALKS,WALLS,WALTZ,WANDS,WANTS,WARDS,WARES,WARNS,WASPS,WASTE,WATCH,WATER,WAVED,WAVER,WAVES,WAXED,WAXES,WEALS,WEANS,WEARS,WEARY,WEAVE,WEDGE,WEEDS,WEEDY,WEEKS,WEEPS,WEEPY,WEIGH,WEIRD,WELLS,WELSH,WENCH,WHACK,WHALE,WHEAT,WHEEL,WHERE,WHICH,WHIFF,WHILE,WHIMS,WHINE,WHINY,WHIPS,WHIRL,WHISK,WHITE,WHOLE,WHOSE,WICKS,WIDEN,WIDER,WIDOW,WIDTH,WIELD,WILDS,WILLS,WIMPY,WINCE,WINCH,WINDS,WINDY,WINES,WINGS,WIPED,WIPER,WIPES,WIRED,WIRES,WITCH,WIVES,WOKEN,WOMAN,WOMEN,WOODS,WOODY,WORDS,WORDY,WORKS,WORLD,WORMS,WORRY,WORSE,WORST,WORTH,WOULD,WOUND,WRAPS,WRATH,WREAK,WRECK,WREST,WRITE,WRONG,WROTE,YACHT,YARDS,YARNS,YEARN,YEARS,YEAST,YIELD,YOUNG,YOURS,YOUTH,ZEBRA,ZEROS,ZESTY,ZILCH,ZONES";


// ─── Play Strands ───
function PlayStrands({ user, puzzle, onBack, notify, updateUser }) {
  const { theme, spangram, words, grid, rows, cols, placements } = puzzle.data;
  const allTargets = [spangram, ...words];
  const [found, setFound] = useState([]);
  const [sel, setSel] = useState([]); // [{r,c}]
  const [isDragging, setIsDragging] = useState(false);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [over, setOver] = useState(false);
  const [hints, setHints] = useState(0);
  const [nonTargetCount, setNonTargetCount] = useState(0);
  const [hintCells, setHintCells] = useState(new Set());
  const [hintAvailable, setHintAvailable] = useState(0); // number of banked hints
  const [recentFoundWord, setRecentFoundWord] = useState(null);
  const [strandsDictLoading, setStrandsDictLoading] = useState(true);
  const gridRef = useRef(null);
  const cellRefs = useRef({});

  // Load comprehensive all-lengths dictionary at runtime
  const strandsDictRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    const loadDict = async () => {
      const sources = [
        { url: "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt", allLengths: true },
        { url: "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words", allLengths: false },
      ];
      for (const { url, allLengths } of sources) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const text = await res.text();
          const words = new Set();
          text.split(/[\r\n,]+/).forEach(w => {
            w = w.trim().toUpperCase();
            if (allLengths ? (w.length >= 3 && /^[A-Z]+$/.test(w)) : (w.length === 5 && /^[A-Z]+$/.test(w))) {
              words.add(w);
            }
          });
          if (words.size > 100) {
            // Always add all puzzle target words
            allTargets.forEach(w => words.add(w));
            if (!cancelled) {
              strandsDictRef.current = words;
              setStrandsDictLoading(false);
            }
            return;
          }
        } catch (e) { /* try next */ }
      }
      // Fallback: use embedded 5-letter list + targets
      const fallback = new Set(FIVE_LETTER_WORDS.split(","));
      allTargets.forEach(w => fallback.add(w));
      if (!cancelled) {
        strandsDictRef.current = fallback;
        setStrandsDictLoading(false);
      }
    };
    loadDict();
    return () => { cancelled = true; };
  }, []);

  const isRealWord = (w) => {
    if (!strandsDictRef.current) return false;
    return strandsDictRef.current.has(w) || strandsDictRef.current.has(w.split("").reverse().join(""));
  };

  const cellKey = (r, c) => `${r}-${c}`;
  const isAdj = (r1, c1, r2, c2) => Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && !(r1 === r2 && c1 === c2);

  // Compute found cells synchronously — no stale ref issues
  const foundCellSet = new Set();
  const spangramCellSet = new Set();
  for (const w of found) {
    if (placements[w]) {
      placements[w].forEach(([r, c]) => {
        foundCellSet.add(cellKey(r, c));
        if (w === spangram) spangramCellSet.add(cellKey(r, c));
      });
    }
  }
  const recentCellSet = new Set();
  if (recentFoundWord && placements[recentFoundWord]) {
    placements[recentFoundWord].forEach(([r, c]) => recentCellSet.add(cellKey(r, c)));
  }

  const getCellFromPoint = (x, y) => {
    let closest = null;
    let closestDist = Infinity;
    for (const [key, el] of Object.entries(cellRefs.current)) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      // Accept if inside cell or within a small buffer for touch tolerance
      const radius = Math.max(rect.width, rect.height) / 2 + 4;
      if (dist < radius && dist < closestDist) {
        closestDist = dist;
        const [r, c] = key.split("-").map(Number);
        closest = { r, c };
      }
    }
    return closest;
  };

  const addToSel = (r, c) => {
    const k = cellKey(r, c);
    if (foundCellSet.has(k)) return;
    // Already in selection? Allow backtracking
    const idx = sel.findIndex(s => s.r === r && s.c === c);
    if (idx >= 0) {
      setSel(sel.slice(0, idx + 1));
      return;
    }
    if (sel.length === 0 || isAdj(sel[sel.length - 1].r, sel[sel.length - 1].c, r, c)) {
      setSel(prev => [...prev, { r, c }]);
    }
  };

  const handlePointerDown = (r, c) => {
    setIsDragging(true);
    setSel([{ r, c }]);
  };

  const handlePointerMove = useCallback((e) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const cell = getCellFromPoint(x, y);
    if (cell) addToSel(cell.r, cell.c);
  }, [isDragging, sel]);

  const submitSelection = useCallback(() => {
    if (sel.length < 3) { setSel([]); setIsDragging(false); return; }
    const word = sel.map(s => grid[s.r][s.c]).join("");
    const reverseWord = sel.map(s => grid[s.r][s.c]).reverse().join("");

    let matchedWord = null;
    if (allTargets.includes(word) && !found.includes(word)) matchedWord = word;
    else if (allTargets.includes(reverseWord) && !found.includes(reverseWord)) matchedWord = reverseWord;

    if (matchedWord) {
      // Verify the cells match the placement
      const pCells = placements[matchedWord];
      const selKeys = new Set(sel.map(s => cellKey(s.r, s.c)));
      const placeKeys = new Set(pCells.map(([r, c]) => cellKey(r, c)));
      const match = selKeys.size === placeKeys.size && [...selKeys].every(k => placeKeys.has(k));

      if (match) {
        const newFound = [...found, matchedWord];
        setFound(newFound);
        setRecentFoundWord(matchedWord);
        setTimeout(() => setRecentFoundWord(null), 800);
        if (newFound.length === allTargets.length) {
          setOver(true);
          saveResult(updateUser, user.username, puzzle.id, true, hints);
        }
      } else {
        setWrongFlash(true);
        setTimeout(() => setWrongFlash(false), 500);
      }
    } else {
      // Not a target word — check if it's a real English word for hint system
      if (strandsDictLoading) {
        // Dict still loading — just flash wrong
        setWrongFlash(true);
        setTimeout(() => setWrongFlash(false), 500);
      } else {
        const isValid = word.length >= 4 && isRealWord(word);
        if (isValid) {
          const nc = nonTargetCount + 1;
          setNonTargetCount(nc);
          if (nc % 3 === 0) {
            // Bank a hint for the player to use when they choose
            setHintAvailable(h => h + 1);
            notify(`"${word}" — hint earned! Tap "Use Hint" when ready.`, "success");
          } else {
            notify(`"${word}" — valid word! ${3 - (nc % 3)} more until hint`, "info");
          }
        } else {
          setWrongFlash(true);
          setTimeout(() => setWrongFlash(false), 500);
        }
      }
    }
    setSel([]);
    setIsDragging(false);
  }, [sel, found, allTargets, grid, placements, nonTargetCount]);

  const useHint = () => {
    if (hintAvailable <= 0) return;
    const unfound = allTargets.filter(w => !found.includes(w));
    if (unfound.length === 0) return;
    const hintWord = unfound[Math.floor(Math.random() * unfound.length)];
    const hCells = new Set(placements[hintWord].map(([r, c]) => cellKey(r, c)));
    setHintCells(hCells);
    setHintAvailable(h => h - 1);
    setHints(h => h + 1);
    notify(`Hint! Look for the highlighted letters.`, "success");
    setTimeout(() => setHintCells(new Set()), 3000);
  };

  const handlePointerUp = useCallback(() => {
    if (isDragging) submitSelection();
  }, [isDragging, submitSelection]);

  useEffect(() => {
    const onMove = (e) => handlePointerMove(e);
    const onUp = () => handlePointerUp();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const selKeys = new Set(sel.map(s => cellKey(s.r, s.c)));
  const currentWord = sel.map(s => grid[s.r][s.c]).join("");

  // Compute line path between selected cells for visual feedback
  const getLinePath = () => {
    if (sel.length < 2) return null;
    return sel.map(s => {
      const el = cellRefs.current[cellKey(s.r, s.c)];
      if (!el) return null;
      const gridEl = gridRef.current;
      if (!gridEl) return null;
      const gridRect = gridEl.getBoundingClientRect();
      const cellRect = el.getBoundingClientRect();
      return {
        x: cellRect.left - gridRect.left + cellRect.width / 2,
        y: cellRect.top - gridRect.top + cellRect.height / 2,
      };
    }).filter(Boolean);
  };

  const linePath = getLinePath();

  // Compute line paths for all found words to draw connecting lines
  const getFoundWordLines = () => {
    const gridEl = gridRef.current;
    if (!gridEl) return [];
    const gridRect = gridEl.getBoundingClientRect();
    return found.map(w => {
      const cells = placements[w];
      if (!cells || cells.length < 2) return null;
      const points = cells.map(([r, c]) => {
        const el = cellRefs.current[cellKey(r, c)];
        if (!el) return null;
        const cellRect = el.getBoundingClientRect();
        return { x: cellRect.left - gridRect.left + cellRect.width / 2, y: cellRect.top - gridRect.top + cellRect.height / 2 };
      }).filter(Boolean);
      if (points.length < 2) return null;
      return { word: w, points, isSpangram: w === spangram };
    }).filter(Boolean);
  };
  const foundWordLines = getFoundWordLines();

  // Lock body scroll while this screen is mounted
  useEffect(() => {
    const orig = document.body.style.overflow;
    const origTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    // Also lock the html element for iOS Safari
    const origHtml = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = orig;
      document.body.style.touchAction = origTouch;
      document.documentElement.style.overflow = origHtml;
    };
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10, background: "#0a0a0b",
      display: "flex", flexDirection: "column", alignItems: "center",
      overflow: "hidden", touchAction: "none",
      userSelect: "none", WebkitUserSelect: "none",
    }}>
      {/* Top bar — fixed at top */}
      <div style={{ width: "100%", maxWidth: 420, padding: "16px 20px 0 20px", flexShrink: 0 }}>
        <BackBtn onClick={onBack} />
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 20, marginBottom: 2 }}>{puzzle.title}</h2>
          <p style={{ color: "#555", fontSize: 11 }}>by {puzzle.creatorName}</p>
          <p style={{ color: "#97C1F7", fontSize: 12, fontStyle: "italic", marginTop: 4 }}>"{theme}"</p>
          {strandsDictLoading && <p style={{ color: "#555", fontSize: 10, marginTop: 3 }}>Loading dictionary...</p>}
        </div>
        <div style={{ textAlign: "center", minHeight: 20, marginBottom: 6 }}>
          <p style={{ fontSize: 15, color: wrongFlash ? "#e74c3c" : "#e8e8e8", fontWeight: 700, letterSpacing: 2, transition: "color 0.2s" }}>{currentWord || "\u00A0"}</p>
        </div>
      </div>

      {/* Grid — centered, cells sized to fill width with generous touch targets */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", width: "100%", touchAction: "none", padding: "0 12px" }}>
        <div ref={gridRef} style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center", position: "relative", touchAction: "none", width: "100%", maxWidth: 420 }}>
          {/* Connecting lines for found words */}
          {foundWordLines.length > 0 && (
            <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
              {foundWordLines.map(({ word, points, isSpangram }) => (
                <polyline
                  key={word}
                  points={points.map(p => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={isSpangram ? "#F9DF6D" : "#97C1F7"}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.45"
                />
              ))}
            </svg>
          )}
          {/* Active selection line */}
          {linePath && linePath.length >= 2 && (
            <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 2 }}>
              <polyline
                points={linePath.map(p => `${p.x},${p.y}`).join(" ")}
                fill="none" stroke="#97C1F7" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"
              />
            </svg>
          )}
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} style={{ display: "flex", gap: 6, justifyContent: "center", width: "100%" }}>
              {Array.from({ length: cols }, (_, c) => {
                const k = cellKey(r, c);
                const isFound = foundCellSet.has(k);
                const isSel = selKeys.has(k);
                const isSpangram = spangramCellSet.has(k);
                const isFirstSel = sel.length > 0 && sel[0].r === r && sel[0].c === c;
                const isHint = hintCells.has(k);
                const isRecent = recentCellSet.has(k);
                return (
                  <div
                    key={c}
                    ref={el => cellRefs.current[k] = el}
                    onMouseDown={(e) => { e.preventDefault(); handlePointerDown(r, c); }}
                    onTouchStart={(e) => { e.preventDefault(); handlePointerDown(r, c); }}
                    style={{
                      width: `calc((min(100vw, 420px) - ${(cols + 1) * 6}px) / ${cols})`,
                      aspectRatio: "1",
                      borderRadius: "50%",
                      fontSize: "clamp(16px, 4.5vw, 20px)", fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: isSpangram ? "#F9DF6D"
                        : isFound ? "#97C1F7"
                        : isHint ? "#F9DF6D"
                        : isSel ? (isFirstSel ? "#97C1F7" : "#e8e8e8")
                        : "#1a1a1c",
                      color: (isFound || isSpangram || isHint) ? "#0a0a0b" : isSel ? "#0a0a0b" : "#ccc",
                      transition: "background 0.15s, transform 0.15s, box-shadow 0.2s",
                      transform: isRecent ? "scale(1.12)" : isSel ? "scale(1.08)" : isHint ? "scale(1.05)" : "scale(1)",
                      cursor: isFound ? "default" : "pointer",
                      position: "relative",
                      zIndex: isSel ? 3 : isRecent ? 2 : 1,
                      boxShadow: isRecent ? "0 0 18px rgba(151,193,247,0.7)"
                        : isHint ? "0 0 16px rgba(249,223,109,0.6), 0 0 4px rgba(249,223,109,0.3)"
                        : isSel ? "0 0 14px rgba(151,193,247,0.5)"
                        : isFound ? "inset 0 0 0 2px rgba(151,193,247,0.3)"
                        : "none",
                      touchAction: "none",
                      letterSpacing: 1,
                      animation: isRecent ? "reveal .4s ease" : isHint ? "pop .5s ease infinite alternate" : undefined,
                    }}
                  >
                    {grid[r][c]}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Bottom panel — fixed at bottom */}
      <div style={{ width: "100%", maxWidth: 420, padding: "6px 16px 16px 16px", flexShrink: 0 }}>
        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <p style={{ fontSize: 11, color: "#555", marginBottom: 5 }}>Found: {found.length} / {allTargets.length}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
            {allTargets.map(w => {
              const isF = found.includes(w);
              return (
                <span key={w} style={{
                  padding: "3px 10px", borderRadius: 10, fontSize: 10, fontWeight: 600,
                  background: isF ? (w === spangram ? "#F9DF6D" : "#97C1F7") : "#1e1e1e",
                  color: isF ? "#0a0a0b" : "#333",
                  border: w === spangram && !isF ? "1px dashed #F9DF6D44" : "1px solid transparent",
                }}>
                  {isF ? w : `${w.length} letters`}
                </span>
              );
            })}
          </div>
        </div>

        {!over && (nonTargetCount > 0 || hintAvailable > 0) && (
          <div style={{ textAlign: "center", marginTop: 4 }}>
            {hintAvailable > 0 && (
              <button onClick={useHint} style={{
                padding: "8px 20px", borderRadius: 10, background: "#F9DF6D", color: "#0a0a0b",
                fontSize: 12, fontWeight: 700, marginBottom: 6, border: "none",
              }}>
                Use Hint{hintAvailable > 1 ? ` (${hintAvailable})` : ""}
              </button>
            )}
            {nonTargetCount > 0 && nonTargetCount % 3 !== 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "center", gap: 4, marginBottom: 2 }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width: 8, height: 8, borderRadius: 4,
                      background: i < (nonTargetCount % 3) ? "#97C1F7" : "#2a2a2a",
                      transition: "background 0.3s",
                    }} />
                  ))}
                </div>
                <p style={{ fontSize: 10, color: "#444" }}>
                  {`${3 - (nonTargetCount % 3)} valid word${3 - (nonTargetCount % 3) > 1 ? "s" : ""} until hint`}
                </p>
              </>
            )}
          </div>
        )}

        {over && <GameOver won={true} mistakes={hints} onBack={onBack} color="#97C1F7" />}
      </div>
    </div>
  );
}

// ─── Play Threads ───
function PlayThreads({ user, puzzle, onBack, notify, updateUser }) {
  const { chain } = puzzle.data;
  const [guesses, setGuesses] = useState({});
  const [revealed, setRevealed] = useState({});
  const [attempts, setAttempts] = useState(0);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const maxAttempts = 5;

  const hiddenIndices = chain.map((c, i) => !c.visible ? i : -1).filter(i => i >= 0);

  const submitGuess = (index) => {
    const guess = (guesses[index] || "").trim().toUpperCase();
    if (!guess) return;
    if (guess === chain[index].word) {
      setRevealed(p => ({ ...p, [index]: true }));
      const newRevealed = { ...revealed, [index]: true };
      const allDone = hiddenIndices.every(i => newRevealed[i]);
      if (allDone) { setOver(true); setWon(true); saveResult(updateUser, user.username, puzzle.id, true, attempts); }
      else notify("Correct!", "success");
    } else {
      const na = attempts + 1;
      setAttempts(na);
      if (na >= maxAttempts) {
        setOver(true); setWon(false);
        const allRevealed = {}; hiddenIndices.forEach(i => allRevealed[i] = true);
        setRevealed(allRevealed);
        saveResult(updateUser, user.username, puzzle.id, false, maxAttempts);
      } else {
        // Hint: reveal first letter
        notify(`Wrong! Hint: starts with "${chain[index].word[0]}"`, "error");
      }
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontWeight: 800, fontSize: 22, marginBottom: 3 }}>{puzzle.title}</h2>
        <p style={{ color: "#555", fontSize: 12 }}>by {puzzle.creatorName}</p>
        <p style={{ color: "#C4A0E8", fontSize: 12, marginTop: 6 }}>Deduce the 3 hidden words in the chain</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {chain.map((c, i) => {
          const isHidden = !c.visible;
          const isRevealed = revealed[i];
          const isGuessable = isHidden && !isRevealed && !over;
          return (
            <div key={i}>
              {i > 0 && <div style={{ textAlign: "center", padding: "2px 0" }}>
                {c.linkHint && !c.visible && <p style={{ fontSize: 11, color: "#C4A0E8", fontStyle: "italic" }}>↕ {c.linkHint}</p>}
                {(c.visible || !c.linkHint) && <p style={{ fontSize: 11, color: "#333" }}>↕</p>}
              </div>}
              <div style={{ background: isRevealed ? (c.visible ? "#1e1e1e" : "#C4A0E833") : "#141415", borderRadius: 10, padding: "12px 14px", border: `1px solid ${isHidden ? "#C4A0E833" : "#1e1e1e"}` }}>
                {c.visible || isRevealed ? (
                  <p style={{ fontWeight: 700, fontSize: 16, color: isRevealed && !c.visible ? "#C4A0E8" : "#e8e8e8", textAlign: "center", textTransform: "uppercase", letterSpacing: 2 }}>
                    {c.word}
                    {isRevealed && !c.visible && <span style={{ fontSize: 11, color: "#6AAA64", marginLeft: 8 }}>✓</span>}
                  </p>
                ) : (
                  <div style={{ display: "flex", gap: 6 }}>
                    <input
                      placeholder="Guess..."
                      value={guesses[i] || ""}
                      onChange={e => setGuesses(p => ({ ...p, [i]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && submitGuess(i)}
                      style={{ ...inp, flex: 1, textTransform: "uppercase", fontWeight: 600, textAlign: "center" }}
                      disabled={over}
                    />
                    {isGuessable && <button onClick={() => submitGuess(i)} style={{ padding: "8px 14px", borderRadius: 8, background: "#C4A0E8", color: "#0a0a0b", fontWeight: 700, fontSize: 12 }}>→</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!over && (
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 11, color: "#555" }}>Attempts: {attempts} / {maxAttempts}</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 6 }}>
            {Array.from({ length: maxAttempts }, (_, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 5, background: i < (maxAttempts - attempts) ? "#C4A0E8" : "#333" }} />)}
          </div>
        </div>
      )}
      {over && <GameOver won={won} mistakes={attempts} onBack={onBack} color="#C4A0E8" />}
    </div>
  );
}

// ═══ FRIENDS ═══
function Friends({ user, db, onBack, updateUser, notify, supaUser, reloadUser }) {
  const [fi, setFi] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  // Get friend identifier for comparison
  const getFriendKey = (f) => typeof f === "object" ? (f.username || f.id) : f;
  const getFriendDisplay = (f) => typeof f === "object" ? (f.displayName || f.username) : f;
  const getFriendId = (f) => typeof f === "object" ? f.id : null;
  const friendKeys = (user.friends || []).map(getFriendKey);

  const search = async () => {
    const q = fi.trim();
    if (!q) return;
    if (SB && supaUser) {
      setSearching(true);
      const results = await searchProfiles(q);
      // Filter out self and existing friends
      const filtered = results.filter(r =>
        r.id !== supaUser.id && !friendKeys.includes(r.email)
      );
      setSearchResults(filtered);
      setSearching(false);
      if (filtered.length === 0) notify("No users found", "info");
    } else {
      // Local mode — direct lookup
      const t = q.toLowerCase();
      if (t === user.username) return notify("That's you!", "error");
      if (friendKeys.includes(t)) return notify("Already friends", "error");
      if (!db[t]) return notify("User not found", "error");
      sendLocal(t);
    }
  };

  const sendLocal = (t) => {
    if ((db[t]?.friendRequests || []).some(r => r.from === user.username)) return notify("Already sent", "error");
    if ((user.friendRequests || []).some(r => r.from === t)) {
      updateUser(user.username, u => { u.friends = [...new Set([...u.friends, t])]; u.friendRequests = u.friendRequests.filter(r => r.from !== t); return u; });
      updateUser(t, u => { u.friends = [...new Set([...u.friends, user.username])]; return u; });
      notify(`Now friends with ${t}!`, "success"); setFi(""); return;
    }
    updateUser(t, u => { u.friendRequests = [...u.friendRequests, { from: user.username, sentAt: Date.now() }]; return u; });
    notify(`Request sent to ${t}`, "success"); setFi("");
  };

  const sendRequest = async (profile) => {
    if (!SB || !supaUser) return;
    setBusy(true);
    const result = await sbSendFriendRequest(supaUser.id, profile.id);
    if (result.ok) {
      notify(`Request sent to ${profile.display_name || profile.email}!`, "success");
      setSearchResults(prev => prev.filter(r => r.id !== profile.id));
      setFi("");
    } else {
      notify(result.error || "Failed to send request", "error");
    }
    setBusy(false);
  };

  const accept = async (req) => {
    if (SB && supaUser) {
      setBusy(true);
      await sbAcceptFriendRequest(req.requestId, req.fromId, supaUser.id);
      await reloadUser();
      notify(`Now friends with ${req.fromDisplay || req.from}!`, "success");
      setBusy(false);
    } else {
      updateUser(user.username, u => { u.friends = [...new Set([...u.friends, req.from])]; u.friendRequests = u.friendRequests.filter(r => r.from !== req.from); return u; });
      updateUser(req.from, u => { u.friends = [...new Set([...u.friends, user.username])]; return u; });
      notify(`Now friends with ${req.from}!`, "success");
    }
  };

  const decline = async (req) => {
    if (SB && supaUser) {
      setBusy(true);
      await sbDeclineFriendRequest(req.requestId);
      await reloadUser();
      setBusy(false);
    } else {
      updateUser(user.username, u => { u.friendRequests = u.friendRequests.filter(r => r.from !== req.from); return u; });
    }
  };

  const remove = async (f) => {
    if (SB && supaUser) {
      const fId = getFriendId(f);
      if (!fId) return;
      setBusy(true);
      await sbRemoveFriend(supaUser.id, fId);
      await reloadUser();
      notify("Removed", "info");
      setBusy(false);
    } else {
      const fKey = getFriendKey(f);
      updateUser(user.username, u => { u.friends = u.friends.filter(x => getFriendKey(x) !== fKey); return u; });
      updateUser(fKey, u => { u.friends = u.friends.filter(x => x !== user.username); return u; });
      notify("Removed", "info");
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <Title color="#97C1F7">Friends</Title>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input placeholder={SB ? "Search by email..." : "Username..."} value={fi} onChange={e => { setFi(e.target.value); setSearchResults([]); }} onKeyDown={e => e.key === "Enter" && search()} style={{ ...inp, flex: 1 }} />
        <button onClick={search} disabled={busy || searching} style={{ padding: "10px 18px", borderRadius: 9, background: "#97C1F7", color: "#0a0a0b", fontWeight: 700, fontSize: 13, flexShrink: 0, opacity: (busy || searching) ? 0.5 : 1 }}>{searching ? "..." : SB ? "Search" : "Add"}</button>
      </div>

      {/* Search results (Supabase mode) */}
      {searchResults.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#97C1F7", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Results</p>
          {searchResults.map(r => (
            <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#141415", borderRadius: 10, padding: "10px 14px", marginBottom: 6, border: "1px solid #97C1F722" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.display_name || r.email}</p>
                {r.display_name && <p style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</p>}
              </div>
              <button onClick={() => sendRequest(r)} disabled={busy} style={{ padding: "5px 12px", borderRadius: 6, background: "#97C1F7", color: "#0a0a0b", fontSize: 11, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>Add</button>
            </div>
          ))}
        </div>
      )}

      {/* Friend requests */}
      {(user.friendRequests || []).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#F9DF6D", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Requests</p>
          {user.friendRequests.map(r => (
            <div key={r.requestId || r.from} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#141415", borderRadius: 10, padding: "10px 14px", marginBottom: 6, border: "1px solid #F9DF6D22" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: 13 }}>{r.fromDisplay || r.from}</p>
                {r.fromDisplay && r.from && r.fromDisplay !== r.from && <p style={{ fontSize: 11, color: "#555" }}>{r.from}</p>}
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => accept(r)} disabled={busy} style={{ padding: "5px 12px", borderRadius: 6, background: "#6AAA64", color: "#fff", fontSize: 11, fontWeight: 700 }}>Accept</button>
                <button onClick={() => decline(r)} disabled={busy} style={{ padding: "5px 12px", borderRadius: 6, background: "#2a2a2a", color: "#666", fontSize: 11, fontWeight: 700 }}>Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends list */}
      <p style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Friends ({(user.friends || []).length})</p>
      {(user.friends || []).length === 0 ? <p style={{ color: "#444", fontSize: 13 }}>No friends yet — search by email to add friends!</p>
        : user.friends.map(f => {
          const key = getFriendKey(f);
          const display = getFriendDisplay(f);
          const email = typeof f === "object" ? f.username : null;
          return (
            <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#141415", borderRadius: 10, padding: "10px 14px", marginBottom: 6, border: "1px solid #1e1e1e" }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontWeight: 600, fontSize: 13 }}>{display}</p>
                {email && display !== email && <p style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</p>}
              </div>
              <button onClick={() => remove(f)} disabled={busy} style={{ padding: "5px 10px", borderRadius: 6, background: "#1e1e1e", color: "#555", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>Remove</button>
            </div>
          );
        })}
    </div>
  );
}

// ═══ LEADERBOARD ═══
function Leaderboard({ user, db, onBack, supaUser }) {
  const [lbStats, setLbStats] = useState([]);
  const [loading, setLoading] = useState(true);

  // Compute stats from a list of result objects
  const computeStats = (results) => {
    let wins = 0, losses = 0, totalMistakes = 0, played = 0;
    for (const r of results) {
      played++;
      if (r.solved) { wins++; totalMistakes += (r.mistakes || 0); }
      else { losses++; }
    }
    const avgLives = wins > 0 ? (totalMistakes / wins).toFixed(1) : "-";
    const winRate = played > 0 ? Math.round(wins / played * 100) : 0;
    return { played, wins, losses, avgLives, winRate };
  };

  useEffect(() => {
    (async () => {
      if (SB && supaUser) {
        const friendIds = (user.friends || []).map(f => typeof f === "object" ? f.id : null).filter(Boolean);
        const allIds = [supaUser.id, ...friendIds];
        const allResults = await getLeaderboardStats(allIds);

        // Group results by user_id, excluding puzzles created by the same user
        const byUser = {};
        for (const r of allResults) {
          const creatorId = r.puzzles?.creator_id;
          if (creatorId && creatorId === r.user_id) continue; // skip own puzzles
          if (!byUser[r.user_id]) byUser[r.user_id] = [];
          byUser[r.user_id].push(r);
        }

        const entries = [];
        // Self — merge Supabase + local results (local results lack creator info, include them)
        const selfResults = [...(byUser[supaUser.id] || [])];
        const localRes = user.results || {};
        for (const r of Object.values(localRes)) {
          if (!selfResults.some(sr => sr.puzzle_id === r.puzzle_id)) {
            // Local results: skip if puzzle is user's own
            const myPuzzleIds = new Set((user.puzzles || []).map(p => p.id));
            if (!myPuzzleIds.has(r.puzzle_id)) selfResults.push(r);
          }
        }
        const selfStats = computeStats(selfResults);
        entries.push({ key: supaUser.id, displayName: user.displayName, isSelf: true, ...selfStats });

        // Friends
        for (const f of (user.friends || [])) {
          const fId = typeof f === "object" ? f.id : null;
          const fDisplay = typeof f === "object" ? (f.displayName || f.username) : f;
          if (!fId) {
            const d = db[f]; if (!d) continue;
            const ownIds = new Set((d.puzzles || []).map(p => p.id));
            const filtered = Object.values(d.results || {}).filter(r => !ownIds.has(r.puzzle_id));
            const stats = computeStats(filtered);
            entries.push({ key: f, displayName: d.displayName, isSelf: false, ...stats });
            continue;
          }
          const stats = computeStats(byUser[fId] || []);
          entries.push({ key: fId, displayName: fDisplay, isSelf: false, ...stats });
        }
        setLbStats(entries.sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : a.avgLives !== b.avgLives ? (a.avgLives === "-" ? 1 : b.avgLives === "-" ? -1 : parseFloat(a.avgLives) - parseFloat(b.avgLives)) : b.winRate - a.winRate));
      } else {
        const players = [user.username, ...(user.friends || [])];
        const entries = players.map(p => {
          const d = db[p]; if (!d) return null;
          const stats = computeStats(Object.values(d.results || {}));
          return { key: p, displayName: d.displayName, isSelf: p === user.username, ...stats };
        }).filter(Boolean).sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : a.avgLives !== b.avgLives ? (a.avgLives === "-" ? 1 : b.avgLives === "-" ? -1 : parseFloat(a.avgLives) - parseFloat(b.avgLives)) : b.winRate - a.winRate);
        setLbStats(entries);
      }
      setLoading(false);
    })();
  }, [user, db, supaUser]);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 20px", animation: "fadeUp .4s ease" }}>
      <BackBtn onClick={onBack} />
      <Title color="#C4A0E8">Leaderboard</Title>
      <p style={{ color: "#555", fontSize: 11, marginBottom: 16, lineHeight: 1.5 }}>
        Ranked by wins, then avg lives lost (guesses, hints, mistakes), then win rate.
      </p>
      {loading ? <p style={{ color: "#555", fontSize: 13 }}>Loading...</p>
        : lbStats.length === 0 ? <p style={{ color: "#555", fontSize: 13 }}>No data yet — play some puzzles!</p> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lbStats.map((d, i) => (
            <div key={d.key} style={{ background: "#141415", borderRadius: 12, padding: "14px 16px", border: i === 0 ? "1px solid #F9DF6D33" : "1px solid #1e1e1e", display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: i === 0 ? "#F9DF6D" : i === 1 ? "#999" : i === 2 ? "#cd7f32" : "#2a2a2a", color: i < 3 ? "#0a0a0b" : "#666", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                <p style={{ fontWeight: 700, fontSize: 14, color: d.isSelf ? "#F9DF6D" : "#e8e8e8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.displayName}{d.isSelf && <span style={{ fontSize: 10, color: "#666", marginLeft: 6 }}>(you)</span>}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ color: "#6AAA64", fontSize: 11, fontWeight: 600 }}>{d.wins}W</span>
                  <span style={{ color: "#E85D5D", fontSize: 11, fontWeight: 600 }}>{d.losses}L</span>
                  <span style={{ color: "#555", fontSize: 11 }}>{d.winRate}%</span>
                  <span style={{ color: "#97C1F7", fontSize: 11 }}>avg {d.avgLives} lives</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
