import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="glass-card text-center max-w-md">
        <h2 className="text-6xl font-bold text-white mb-4">404</h2>
        <p className="text-gray-400 mb-6">Page not found</p>
        <Link href="/" className="btn-primary inline-block">Go Home</Link>
      </div>
    </div>
  );
}
