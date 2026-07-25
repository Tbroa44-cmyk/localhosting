"use client";

import { useState, useEffect, useCallback } from "react";
import ButtonSpinner from "./ButtonSpinner";

interface Comment {
  id: number;
  user_id: number;
  comment: string;
  likes: number;
  created_at: string;
  username: string;
  level: number;
  liked: boolean;
}

interface CommentsSectionProps {
  companyId: number;
  isLoggedIn: boolean;
}

function getLevelColor(level: number): string {
  if (level >= 50) return "text-orange-400";
  if (level >= 25) return "text-purple-400";
  if (level >= 10) return "text-blue-400";
  if (level >= 5) return "text-green-400";
  return "text-gray-400";
}

function getLevelBg(level: number): string {
  if (level >= 50) return "bg-orange-500/20";
  if (level >= 25) return "bg-purple-500/20";
  if (level >= 10) return "bg-blue-500/20";
  if (level >= 5) return "bg-green-500/20";
  return "bg-gray-500/20";
}

export default function CommentsSection({ companyId, isLoggedIn }: CommentsSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/stocks/${companyId}/comments?t=${Date.now()}`);
      const data = await res.json();
      if (Array.isArray(data)) setComments(data);
    } catch {}
  }, [companyId]);

  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 10000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  async function handleSubmit() {
    if (!newComment.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch(`/api/stocks/${companyId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: newComment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewComment("");
      fetchComments();
    } catch (err: any) {
      setError(err.message || "Failed to post");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLike(commentId: number) {
    if (!isLoggedIn) return;
    try {
      const res = await fetch(`/api/comments/${commentId}/like`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? { ...c, liked: data.liked, likes: data.liked ? c.likes + 1 : Math.max(0, c.likes - 1) }
              : c
          )
        );
      }
    } catch {}
  }

  return (
    <div className="glass-card mt-6">
      <h3 className="text-lg font-semibold text-white mb-4">Comments ({comments.length})</h3>

      {isLoggedIn && (
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Leave a comment... (+3 XP)"
              maxLength={500}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="input-field flex-1 text-sm"
              disabled={submitting}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting || !newComment.trim()}
              className="btn-primary px-4 py-2 text-sm shrink-0 flex items-center gap-1.5 disabled:opacity-50"
            >
              {submitting ? <><ButtonSpinner size={14} /> ...</> : "Post"}
            </button>
          </div>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <p className="text-xs text-gray-600 mt-1">1 comment per hour</p>
        </div>
      )}

      {!isLoggedIn && (
        <p className="text-gray-500 text-sm mb-4">Sign in to comment and earn XP.</p>
      )}

      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {comments.length === 0 && (
          <p className="text-gray-500 text-sm">No comments yet. Be the first!</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="bg-gray-800/40 rounded-lg px-4 py-3 group">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-white text-sm font-medium">{c.username}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${getLevelBg(c.level)} ${getLevelColor(c.level)}`}>
                Lv.{c.level}
              </span>
              <span className="text-xs text-gray-600 ml-auto">
                {new Date(c.created_at).toLocaleDateString()} {new Date(c.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p className="text-gray-300 text-sm mb-2">{c.comment}</p>
            <button
              onClick={() => handleLike(c.id)}
              disabled={!isLoggedIn}
              className={`flex items-center gap-1 text-xs transition-colors ${
                c.liked
                  ? "text-red-400"
                  : isLoggedIn
                  ? "text-gray-500 hover:text-red-400"
                  : "text-gray-600 cursor-not-allowed"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill={c.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {c.likes > 0 && <span>{c.likes}</span>}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
