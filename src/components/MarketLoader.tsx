"use client";

export default function MarketLoader({ text }: { text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6">
      <div className="relative w-64 h-24">
        <svg viewBox="0 0 256 96" className="w-full h-full">
          <defs>
            <linearGradient id="marketGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="50%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="marketFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 80 L30 65 L60 70 L90 40 L120 50 L150 20 L180 35 L210 10 L240 25 L256 15"
            fill="none"
            stroke="url(#marketGrad)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="400"
            strokeDashoffset="400"
            style={{ animation: "marketLineDraw 1.5s ease-in-out infinite" }}
          />
          <path
            d="M0 80 L30 65 L60 70 L90 40 L120 50 L150 20 L180 35 L210 10 L240 25 L256 15 L256 96 L0 96 Z"
            fill="url(#marketFill)"
            opacity="0"
            style={{ animation: "marketFillIn 1.5s ease-in-out 0.5s infinite" }}
          />
          <circle
            cx="256"
            cy="15"
            r="4"
            fill="#3b82f6"
            style={{ animation: "marketDotPulse 1.5s ease-in-out infinite" }}
          >
            <animate attributeName="cx" values="0;30;60;90;120;150;180;210;240;256" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="cy" values="80;65;70;40;50;20;35;10;25;15" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      {text && <p className="text-gray-400 text-sm animate-pulse">{text}</p>}
      <style>{`
        @keyframes marketLineDraw {
          0% { stroke-dashoffset: 400; }
          50% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -400; }
        }
        @keyframes marketFillIn {
          0% { opacity: 0; }
          30% { opacity: 0.6; }
          50% { opacity: 0.3; }
          70% { opacity: 0.6; }
          100% { opacity: 0; }
        }
        @keyframes marketDotPulse {
          0%, 100% { r: 3; opacity: 1; }
          50% { r: 5; opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
