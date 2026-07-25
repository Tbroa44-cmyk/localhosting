export default function PageBackground({ variant = "default" }: { variant?: "default" | "market" | "stock" | "portfolio" | "wallet" }) {
  const configs: Record<string, { orbs: { color: string; size: string; pos: string }[]; shapes: number }> = {
    default: {
      orbs: [
        { color: "blue", size: "w-80 h-80", pos: "top-[5%] right-[10%]" },
        { color: "purple", size: "w-60 h-60", pos: "bottom-[15%] left-[5%]" },
      ],
      shapes: 5,
    },
    market: {
      orbs: [
        { color: "blue", size: "w-96 h-96", pos: "top-[10%] right-[5%]" },
        { color: "indigo", size: "w-72 h-72", pos: "bottom-[10%] left-[15%]" },
        { color: "purple", size: "w-48 h-48", pos: "top-[50%] left-[40%]" },
      ],
      shapes: 7,
    },
    stock: {
      orbs: [
        { color: "emerald", size: "w-64 h-64", pos: "top-[15%] right-[15%]" },
        { color: "blue", size: "w-80 h-80", pos: "bottom-[20%] left-[10%]" },
      ],
      shapes: 6,
    },
    portfolio: {
      orbs: [
        { color: "blue", size: "w-72 h-72", pos: "top-[8%] left-[20%]" },
        { color: "cyan", size: "w-56 h-56", pos: "bottom-[12%] right-[10%]" },
      ],
      shapes: 6,
    },
    wallet: {
      orbs: [
        { color: "green", size: "w-80 h-80", pos: "top-[12%] right-[8%]" },
        { color: "emerald", size: "w-56 h-56", pos: "bottom-[18%] left-[12%]" },
      ],
      shapes: 5,
    },
  };

  const cfg = configs[variant] || configs.default;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {cfg.orbs.map((orb, i) => (
        <div
          key={`orb-${i}`}
          className={`absolute rounded-full blur-3xl ${orb.size} ${orb.pos}`}
          style={{
            background: `radial-gradient(circle, ${orb.color === "blue" ? "rgba(59,130,246,0.04)" : orb.color === "purple" ? "rgba(139,92,246,0.04)" : orb.color === "indigo" ? "rgba(99,102,241,0.04)" : orb.color === "emerald" ? "rgba(16,185,129,0.04)" : orb.color === "cyan" ? "rgba(6,182,212,0.04)" : "rgba(16,185,129,0.04)"} 0%, transparent 70%)`,
          }}
        />
      ))}
      {[...Array(cfg.shapes)].map((_, i) => {
        const colors = ["#3b82f6", "#8b5cf6", "#6366f1", "#06b6d4", "#10b981", "#f59e0b"];
        return (
          <div
            key={`shape-${i}`}
            className="absolute"
            style={{
              left: `${5 + (i * 100 / cfg.shapes)}%`,
              top: `${10 + ((i * 37) % 70)}%`,
              animation: `float${i % 3} ${12 + i * 4}s ease-in-out infinite`,
              animationDelay: `${i * 1.5}s`,
            }}
          >
            <div
              style={{
                width: `${6 + (i % 3) * 4}px`,
                height: `${6 + (i % 3) * 4}px`,
                borderRadius: i % 3 === 0 ? "50%" : i % 3 === 1 ? "2px" : "50%",
                background: colors[i % colors.length],
                opacity: 0.06,
                transform: `rotate(${i * 45}deg)`,
                boxShadow: `0 0 ${8 + i * 2}px ${colors[i % colors.length]}20`,
              }}
            />
          </div>
        );
      })}
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse at 20% 50%, rgba(59,130,246,0.015) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.015) 0%, transparent 50%)",
      }} />
    </div>
  );
}
