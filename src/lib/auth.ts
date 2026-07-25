import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { jwtVerify } from "jose";
import getDb from "@/lib/db";

interface DbUser {
  id: number;
  username: string;
  email: string;
  password: string;
  balance: number;
  is_admin: number;
  allowed: number;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        const db = getDb();
        const user = await db.prepare("SELECT * FROM users WHERE username = ?").get(credentials.username) as DbUser | undefined;

        if (!user) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
        if (!isPasswordValid) {
          return null;
        }

        return {
          id: String(user.id),
          email: user.email,
          name: user.username,
          isAdmin: !!user.is_admin,
          allowed: user.allowed ?? 0,
        } as any;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.isAdmin = (user as any).isAdmin;
        token.allowed = (user as any).allowed ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).isAdmin = !!token.isAdmin;
        (session.user as any).username = token.name;
        (session.user as any).allowed = token.allowed ?? 0;

        try {
          const db = getDb();
          let user: any;
          try {
            user = await db.prepare("SELECT id, username, balance, is_admin, allowed FROM users WHERE id = ?").get(token.id);
          } catch {
            user = await db.prepare("SELECT id, username, balance, is_admin FROM users WHERE id = ?").get(token.id);
          }

          if (user) {
            (session.user as any).id = user.id;
            (session.user as any).username = user.username;
            (session.user as any).balance = user.balance;
            (session.user as any).isAdmin = !!user.is_admin;
            (session.user as any).allowed = user.allowed ?? 0;
          }
        } catch {
          (session.user as any).balance = 0;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};

export async function getUserIdFromRequest(request: Request): Promise<number | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const token = cookieStore.get("next-auth.session-token")?.value
    || cookieStore.get("__Secure-next-auth.session-token")?.value;

  if (!token || !process.env.NEXTAUTH_SECRET) return null;

  try {
    const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const userId = Number(payload.id);
    return Number.isFinite(userId) && userId > 0 ? userId : null;
  } catch {
    return null;
  }
}
