export default function PageBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full opacity-[0.025]"
          style={{
            width: `${100 + i * 70}px`,
            height: `${100 + i * 70}px`,
            left: `${8 + i * 18}%`,
            top: `${15 + (i % 3) * 30}%`,
            background: i % 2 === 0 ? "#3b82f6" : "#8b5cf6",
            animation: `float${i % 3} ${10 + i * 3}s ease-in-out infinite`,
          }}
        />
      ))}
      <div className="absolute top-[10%] right-[15%] w-64 h-64 rounded-full bg-blue-500/[0.02] blur-3xl" />
      <div className="absolute bottom-[20%] left-[10%] w-48 h-48 rounded-full bg-purple-500/[0.02] blur-3xl" />
    </div>
  );
}
