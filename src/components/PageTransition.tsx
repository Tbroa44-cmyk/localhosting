"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useRef } from "react";

export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [displayPath, setDisplayPath] = useState(pathname);
  const [animClass, setAnimClass] = useState("animate-page-in");
  const prevPath = useRef(pathname);
  const isAnimating = useRef(false);

  useEffect(() => {
    if (pathname === prevPath.current) return;
    if (isAnimating.current) {
      setDisplayPath(pathname);
      setAnimClass("animate-page-in");
      prevPath.current = pathname;
      return;
    }

    isAnimating.current = true;
    setAnimClass("animate-page-out");

    const timer = setTimeout(() => {
      setDisplayPath(pathname);
      setAnimClass("animate-page-in");
      prevPath.current = pathname;
      isAnimating.current = false;
    }, 200);

    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <div key={displayPath} className={animClass}>
      {children}
    </div>
  );
}
