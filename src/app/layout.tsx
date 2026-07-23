import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = {
  title: "StockSim - Virtual Stock Market",
  description: "Buy and sell virtual company shares in real-time",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider session={session}>{children}</AuthProvider>
      </body>
    </html>
  );
}
