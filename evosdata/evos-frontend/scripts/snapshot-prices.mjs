// Optional build step: bake the current prices into the bundle so even a first-ever visitor
// sees bundles instantly. Never fails the build: on any problem the old snapshot is kept.
import fs from "node:fs";
import path from "node:path";

const base = (process.env.VITE_EVOSDATA_API_URL || "https://evos-data-services.fly.dev").replace(/\/$/, "");
const out = path.resolve("src/data/prices.snapshot.json");

try {
  const res = await fetch(`${base}/prices`, { signal: AbortSignal.timeout(15000) });
  const j = await res.json();
  if (Array.isArray(j?.data) && j.data.length) {
    fs.writeFileSync(out, JSON.stringify({ version: j.version || "", data: j.data }));
    console.log(`[prices] snapshot saved (${j.data.length} bundles)`);
  } else {
    console.log("[prices] empty answer, keeping existing snapshot");
  }
} catch (e) {
  console.log("[prices] snapshot skipped:", e.message);
}
