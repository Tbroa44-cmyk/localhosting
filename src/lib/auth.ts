import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";

interface DbUser {
  id: number;
  username: string;
  email: string;
  password: string;
  balance: number;
  is_admin: number;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const db = getDb();
        const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(credentials.email) as DbUser | undefined;

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
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.isAdmin = (user as any).isAdmin;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).isAdmin = !!token.isAdmin;
        (session.user as any).username = token.name;

        try {
          const db = getDb();
          const user = await db.prepare("SELECT id, username, balance, is_admin FROM users WHERE id = ?").get(token.id) as {
            id: number;
            username: string;
            balance: number;
            is_admin: any;
          } | undefined;

          if (user) {
            (session.user as any).id = user.id;
            (session.user as any).username = user.username;
            (session.user as any).balance = user.balance;
            (session.user as any).isAdmin = !!user.is_admin;
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
