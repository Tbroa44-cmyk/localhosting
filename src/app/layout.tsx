import type { Metadata } from "next";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import PageTransition from "@/components/PageTransition";
import ToastContainer from "@/components/Toast";
import TradeNotificationContainer from "@/components/TradeNotification";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const metadata: Metadata = {
  title: "stockgame.uk - Virtual Stock Market",
  description: "Buy and sell virtual company shares in real-time",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider session={session}>
          <PageTransition>{children}</PageTransition>
          <ToastContainer />
          <TradeNotificationContainer />
        </AuthProvider>
      </body>
    </html>
  );
}
