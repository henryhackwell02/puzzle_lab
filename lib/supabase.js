import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase env vars missing — running in offline/demo mode");
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// ═══════════════════════════════════════
// DATABASE HELPERS
// ═══════════════════════════════════════

// Auth
export async function signUp(email, password, displayName) {
  if (!supabase) return { error: "Supabase not configured" };
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) return { error: error.message };
  // Create profile row
  if (data.user) {
    await supabase.from("profiles").upsert({
      id: data.user.id,
      email,
      display_name: displayName,
    });
  }
  return { user: data.user };
}

export async function signIn(email, password) {
  if (!supabase) return { error: "Supabase not configured" };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { user: data.user, session: data.session };
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// Profile
export async function getProfile(userId) {
  if (!supabase) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
  return data;
}

export async function searchProfiles(query) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name")
    .or(`email.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(10);
  if (error) console.error("searchProfiles error:", error);
  return data || [];
}

// Puzzles
export async function createPuzzle(userId, puzzle) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("puzzles").insert({
    creator_id: userId,
    type: puzzle.type,
    title: puzzle.title,
    data: puzzle.data,
  }).select().single();
  if (error) { console.error("createPuzzle error:", error); return null; }
  return data;
}

export async function getMyPuzzles(userId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("puzzles")
    .select("*, profiles!puzzles_creator_id_fkey(display_name)")
    .eq("creator_id", userId)
    .order("created_at", { ascending: false });
  return data || [];
}

export async function deletePuzzle(puzzleId, userId) {
  if (!supabase) return false;
  const { error } = await supabase.from("puzzles").delete().eq("id", puzzleId).eq("creator_id", userId);
  return !error;
}

export async function getFriendsPuzzles(friendIds) {
  if (!supabase || friendIds.length === 0) return [];
  const { data, error } = await supabase
    .from("puzzles")
    .select("*, profiles!puzzles_creator_id_fkey(display_name, email)")
    .in("creator_id", friendIds)
    .order("created_at", { ascending: false });
  if (error) console.error("getFriendsPuzzles error:", error);
  return data || [];
}

// Sharing
export async function sharePuzzle(puzzleId, fromUserId, toUserId) {
  if (!supabase) return false;
  const { error } = await supabase.from("shared_puzzles").upsert({
    puzzle_id: puzzleId,
    from_user_id: fromUserId,
    to_user_id: toUserId,
  });
  return !error;
}

export async function getSharedWithMe(userId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("shared_puzzles")
    .select("*, puzzles(*, profiles!puzzles_creator_id_fkey(display_name)), from:profiles!shared_puzzles_from_user_id_fkey(display_name)")
    .eq("to_user_id", userId)
    .order("shared_at", { ascending: false });
  return data || [];
}

// Friends
export async function sendFriendRequest(fromUserId, toUserId) {
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  // Check if a pending request already exists in either direction
  const { data: existing } = await supabase
    .from("friend_requests")
    .select("id, status, from_user_id, to_user_id")
    .or(`and(from_user_id.eq.${fromUserId},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${fromUserId})`)
    .in("status", ["pending"]);
  if (existing && existing.length > 0) {
    return { ok: false, error: "A friend request already exists" };
  }
  // Check if already friends
  const { data: friendship } = await supabase
    .from("friendships")
    .select("id")
    .eq("user_id", fromUserId)
    .eq("friend_id", toUserId)
    .maybeSingle();
  if (friendship) {
    return { ok: false, error: "Already friends" };
  }
  // Delete any old declined/accepted requests before inserting new one
  await supabase
    .from("friend_requests")
    .delete()
    .eq("from_user_id", fromUserId)
    .eq("to_user_id", toUserId)
    .in("status", ["declined", "accepted"]);
  const { error } = await supabase.from("friend_requests").insert({
    from_user_id: fromUserId,
    to_user_id: toUserId,
  });
  if (error) {
    console.error("sendFriendRequest error:", error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function getFriendRequests(userId) {
  if (!supabase) return [];
  const { data } = await supabase
    .from("friend_requests")
    .select("*, from:profiles!friend_requests_from_user_id_fkey(id, display_name, email)")
    .eq("to_user_id", userId)
    .eq("status", "pending");
  return data || [];
}

export async function acceptFriendRequest(requestId, fromUserId, toUserId) {
  if (!supabase) return false;
  // Update request status
  const { error: updateErr } = await supabase
    .from("friend_requests")
    .update({ status: "accepted" })
    .eq("id", requestId);
  if (updateErr) console.error("acceptFriendRequest update error:", updateErr);

  // Add friendship both ways — insert separately to avoid RLS batch issues
  const { error: err1 } = await supabase
    .from("friendships")
    .upsert({ user_id: toUserId, friend_id: fromUserId }, { onConflict: "user_id,friend_id" });
  if (err1) console.error("acceptFriendRequest friendship1 error:", err1);

  const { error: err2 } = await supabase
    .from("friendships")
    .upsert({ user_id: fromUserId, friend_id: toUserId }, { onConflict: "user_id,friend_id" });
  if (err2) console.error("acceptFriendRequest friendship2 error:", err2);

  return !updateErr && !err1 && !err2;
}

export async function declineFriendRequest(requestId) {
  if (!supabase) return false;
  const { error } = await supabase.from("friend_requests").update({ status: "declined" }).eq("id", requestId);
  if (error) console.error("declineFriendRequest error:", error);
  return !error;
}

export async function getFriends(userId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("friendships")
    .select("*, friend:profiles!friendships_friend_id_fkey(id, display_name, email)")
    .eq("user_id", userId);
  if (error) console.error("getFriends error:", error);
  return data || [];
}

export async function removeFriend(userId, friendId) {
  if (!supabase) return false;
  const { error: e1 } = await supabase.from("friendships").delete().eq("user_id", userId).eq("friend_id", friendId);
  const { error: e2 } = await supabase.from("friendships").delete().eq("user_id", friendId).eq("friend_id", userId);
  if (e1) console.error("removeFriend error1:", e1);
  if (e2) console.error("removeFriend error2:", e2);
  return !e1;
}

// Results
export async function saveResult(userId, puzzleId, solved, mistakes) {
  if (!supabase) return false;
  const { error } = await supabase.from("results").upsert({
    user_id: userId,
    puzzle_id: puzzleId,
    solved,
    mistakes,
  });
  return !error;
}

export async function getMyResults(userId) {
  if (!supabase) return {};
  const { data } = await supabase.from("results").select("*").eq("user_id", userId);
  const map = {};
  (data || []).forEach(r => { map[r.puzzle_id] = r; });
  return map;
}

export async function getLeaderboardStats(userIds) {
  if (!supabase) return [];
  const { data } = await supabase.from("results").select("*").in("user_id", userIds);
  return data || [];
}
