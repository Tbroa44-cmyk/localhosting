import bcrypt from "bcryptjs";
import getDb from "../lib/db";

async function seed() {
  const db = getDb();

  const existingAdmin = await db.prepare("SELECT id FROM users WHERE email = 'T-ADMIN@stocksim.com'").get();
  if (existingAdmin) {
    console.log("Admin user already exists.");
    process.exit(0);
  }

  const hashedPassword = await bcrypt.hash("Ichliebendu-2026!", 12);

  await db.prepare("INSERT INTO users (username, email, password, balance, is_admin) VALUES (?, ?, ?, ?, ?)").run(
    "T-ADMIN",
    "T-ADMIN@stocksim.com",
    hashedPassword,
    0,
    1
  );

  console.log("Admin user created successfully!");
  console.log("Username: T-ADMIN");
  console.log("Email: T-ADMIN@stocksim.com");
  console.log("Password: Ichliebendu-2026!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  process.exit(1);
});
