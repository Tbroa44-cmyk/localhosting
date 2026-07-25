"use client";

import { useEffect, useState } from "react";

export default function LoadingSpinner({ size = "md", text }: { size?: "sm" | "md" | "lg"; text?: string }) {
  const sizeMap = { sm: 24, md: 48, lg: 72 };
  const px = sizeMap[size];
  const [pulseScale, setPulseScale] = useState(1);

  useEffect(() => {
    let frame: number;
    let start: number | null = null;
    const duration = 1500;

    function animate(time: number) {
      if (!start) start = time;
      const progress = ((time - start) % duration) / duration;
      const scale = 1 + 0.15 * Math.sin(progress * Math.PI * 2);
      setPulseScale(scale);
      frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div
        className="relative"
        style={{
          width: px,
          height: px,
          transform: `scale(${pulseScale})`,
        }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(59,130,246,0.35) 0%, transparent 70%)",
          }}
        />
        <svg
          viewBox="0 0 50 50"
          className="absolute inset-0"
          style={{
            width: "100%",
            height: "100%",
            animation: "loadingSpin 0.9s linear infinite",
          }}
        >
          <circle
            cx="25"
            cy="25"
            r="20"
            fill="none"
            stroke="url(#spinnerGrad)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="90, 150"
            strokeDashoffset="0"
          />
          <defs>
            <linearGradient id="spinnerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="50%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      {text && <p className="text-gray-400 text-sm">{text}</p>}
      <style>{`
        @keyframes loadingSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
