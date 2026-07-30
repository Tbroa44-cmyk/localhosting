export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "public", "version.json");
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return NextResponse.json({
      version: `${data.major}.${data.minor}.${data.patch}`,
      major: data.major,
      minor: data.minor,
      patch: data.patch,
    });
  } catch {
    return NextResponse.json({ version: "1.0.0", major: 1, minor: 0, patch: 0 });
  }
}
