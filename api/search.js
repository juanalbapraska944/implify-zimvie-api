import { readFileSync } from "node:fs";
import path from "node:path";

let DB = null;

function loadDB() {
  if (DB) return DB;
  const p = path.join(process.cwd(), "data", "zimvie_products_implify.json");
  DB = JSON.parse(readFileSync(p, "utf8"));
  return DB;
}

function toFloat(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const eqi = (a,b) => String(a||"").toLowerCase() === String(b||"").toLowerCase();
const includesi = (h, n) => String(h||"").toLowerCase().includes(String(n||"").toLowerCase());
const numEq = (a, b, eps = 0.05) => {
  const A = toFloat(a), B = toFloat(b);
  if (A === null || B === null) return false;
  return Math.abs(A - B) <= eps;
};

function matchesWithQuery(prod, q) {
  // Optional top-level filters
  if (q.category && !eqi(prod["Produktkategorie"], q.category)) return false;
  if (q.subcat && !eqi(prod["Untergruppe Produktkategorie"], q.subcat)) return false;
  if (q.q && !includesi(prod["Produktname"], q.q)) return false;

  const a = prod.attributes || {};

  // Numeric
  if (q.diameter_mm && !numEq(a.diameter_mm, q.diameter_mm)) return false;
  if (q.length_mm && !numEq(a.length_mm, q.length_mm)) return false;
  if (q.gingival_height_mm && !numEq(a.gingival_height_mm, q.gingival_height_mm)) return false;
  if (q.angle_deg && !numEq(a.angle_deg, q.angle_deg)) return false;
  if (q.retention_g && !numEq(a.retention_g, q.retention_g)) return false;
  if (q.pack_size && toFloat(a.pack_size) !== toFloat(q.pack_size)) return false;

  // Strings
  if (q.collar && !eqi(a.collar, q.collar)) return false;
  if (q.rotation_protection && !eqi(a.rotation_protection, q.rotation_protection)) return false;
  if (q.abformung_type && !eqi(a.abformung_type, q.abformung_type)) return false;
  if (q.variant && !includesi(a.variant, q.variant)) return false;
  if (q.type && !includesi(a.type, q.type)) return false;

  return true;
}

function score(prod, q) {
  let s = 0;
  const a = prod.attributes || {};
  if (q.category && eqi(prod["Produktkategorie"], q.category)) s += 1;
  if (q.subcat && eqi(prod["Untergruppe Produktkategorie"], q.subcat)) s += 2;
  if (q.diameter_mm && numEq(a.diameter_mm, q.diameter_mm)) s += 2;
  if (q.gingival_height_mm && numEq(a.gingival_height_mm, q.gingival_height_mm)) s += 2;
  if (q.length_mm && numEq(a.length_mm, q.length_mm)) s += 1;
  if (q.collar && eqi(a.collar, q.collar)) s += 1;
  if (q.abformung_type && eqi(a.abformung_type, q.abformung_type)) s += 1;
  if (q.variant && includesi(a.variant, q.variant)) s += 1;
  if (q.q && includesi(prod["Produktname"], q.q)) s += 1;
  return s;
}

function filterRank(data, q, limit=25) {
  const hits = data.filter(p => matchesWithQuery(p, q))
    .map(p => ({p, s: score(p, q)}))
    .sort((a,b) => b.s - a.s)
    .slice(0, limit)
    .map(x => ({ ...x.p, _match_score: x.s }));
  return hits;
}

// NEW: conditional alternatives (based on the other filter)
function conditionalAlternatives(data, q) {
  const pool = data.filter(p => {
    if (q.category && !eqi(p["Produktkategorie"], q.category)) return false;
    if (q.subcat && !eqi(p["Untergruppe Produktkategorie"], q.subcat)) return false;
    return true;
  });
  const byDia = new Map();   // diameter -> Set(GH)
  const byGH  = new Map();   // GH -> Set(diameter)

  for (const p of pool) {
    const a = p.attributes || {};
    const d = toFloat(a.diameter_mm);
    const gh = toFloat(a.gingival_height_mm);
    if (d !== null) {
      if (!byDia.has(d)) byDia.set(d, new Set());
      if (gh !== null) byDia.get(d).add(gh);
    }
    if (gh !== null) {
      if (!byGH.has(gh)) byGH.set(gh, new Set());
      if (d !== null) byGH.get(gh).add(d);
    }
  }

  const sortNums = arr => Array.from(arr).sort((x,y)=>x-y);

  const out = { 
    conditioned_on_diameter: {}, 
    conditioned_on_gingival_height: {} 
  };
  for (const [d, set] of byDia.entries()) out.conditioned_on_diameter[d] = sortNums(set);
  for (const [gh, set] of byGH.entries()) out.conditioned_on_gingival_height[gh] = sortNums(set);
  return out;
}

export default async function handler(req, res) {
  const data = loadDB();
  const src = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const q0 = {
    q: src.q ?? "",
    category: src.category ?? "",
    subcat: src.subcat ?? src["Untergruppe Produktkategorie"] ?? "",
    diameter_mm: src.diameter_mm ?? "",
    length_mm: src.length_mm ?? "",
    gingival_height_mm: src.gingival_height_mm ?? "",
    collar: src.collar ?? "",
    angle_deg: src.angle_deg ?? "",
    rotation_protection: src.rotation_protection ?? "",
    abformung_type: src.abformung_type ?? "",
    pack_size: src.pack_size ?? "",
    retention_g: src.retention_g ?? "",
    variant: src.variant ?? "",
    type: src.type ?? "",
    limit: Number(src.limit ?? 25),
  };

  // 1) Try strict
  let results = filterRank(data, q0, q0.limit);

  // 2) If none, relax step-by-step (keep category/subcat if present)
  const relaxOrder = [
    "gingival_height_mm",
    "diameter_mm",
    "length_mm",
    "collar",
    "abformung_type",
    "rotation_protection",
    "variant",
    "type",
    "q"
  ];
  let relaxed_by = [];
  if (results.length === 0) {
    for (const key of relaxOrder) {
      if (!q0[key]) continue;
      const q1 = { ...q0, [key]: "" };
      const r1 = filterRank(data, q1, q0.limit);
      if (r1.length) {
        results = r1;
        relaxed_by.push(key);
        break;
      }
    }
  }

  // 3) Conditional alternatives (much more useful)
  const alts = conditionalAlternatives(data, q0);

  // 4) “missing_fields”: don’t force subcat; only suggest it
  const missing_fields = [];
  if (!q0.subcat) missing_fields.push("Untergruppe Produktkategorie (optional but helpful: z.B. Gingivaformer, Abformpfosten, Abutment)");

  res.status(200).json({
    results,
    alternatives: alts,
    relaxed_by,
    missing_fields
  });
}
