"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="glass-card text-center max-w-md">
        <h2 className="text-2xl font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-gray-400 mb-6">{error.message || "An unexpected error occurred"}</p>
        <button onClick={reset} className="btn-primary">Try Again</button>
      </div>
    </div>
  );
}
