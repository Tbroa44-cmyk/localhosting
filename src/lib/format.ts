export function formatCoins(cents: number): string {
  const value = (typeof cents === "number" && isFinite(cents)) ? cents : 0;
  const dollars = value / 100;
  return dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "c";
}

export function formatCoinsRaw(cents: number): string {
  const value = (typeof cents === "number" && isFinite(cents)) ? cents : 0;
  const dollars = value / 100;
  return dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
