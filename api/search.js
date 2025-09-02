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
function eqi(a, b) { return String(a || "").toLowerCase() === String(b || "").toLowerCase(); }
function includesi(hay, needle) {
  return String(hay || "").toLowerCase().includes(String(needle || "").toLowerCase());
}
function numEq(a, b, eps = 0.05) {
  const A = toFloat(a), B = toFloat(b);
  if (A === null || B === null) return false;
  return Math.abs(A - B) <= eps;
}

function matchProduct(prod, q) {
  // top-level filters
  if (q.category && !eqi(prod["Produktkategorie"], q.category)) return false;
  if (q.subcat && !eqi(prod["Untergruppe Produktkategorie"], q.subcat)) return false;
  if (q.q && !includesi(prod["Produktname"], q.q)) return false;

  const a = prod.attributes || {};

  // numeric attribute filters
  if (q.diameter_mm && !numEq(a.diameter_mm, q.diameter_mm)) return false;
  if (q.length_mm && !numEq(a.length_mm, q.length_mm)) return false;
  if (q.gingival_height_mm && !numEq(a.gingival_height_mm, q.gingival_height_mm)) return false;
  if (q.angle_deg && !numEq(a.angle_deg, q.angle_deg)) return false;
  if (q.retention_g && !numEq(a.retention_g, q.retention_g)) return false;
  if (q.pack_size && toFloat(a.pack_size) !== toFloat(q.pack_size)) return false;

  // string attribute filters
  if (q.collar && !eqi(a.collar, q.collar)) return false;
  if (q.rotation_protection && !eqi(a.rotation_protection, q.rotation_protection)) return false;
  if (q.abformung_type && !eqi(a.abformung_type, q.abformung_type)) return false;
  if (q.variant && !includesi(a.variant, q.variant)) return false;
  if (q.type && !includesi(a.type, q.type)) return false;

  return true;
}

function scoreProduct(prod, q) {
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

function alternatives(pool) {
  const gh = new Set();
  const dia = new Set();
  for (const p of pool) {
    const a = p.attributes || {};
    if (a.gingival_height_mm !== undefined) gh.add(String(a.gingival_height_mm));
    if (a.diameter_mm !== undefined) dia.add(String(a.diameter_mm));
  }
  const toNums = (s) => Array.from(s).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  return {
    same_subcat_other_gingival_heights: toNums(gh),
    same_subcat_other_diameters: toNums(dia),
  };
}

export default async function handler(req, res) {
  const data = loadDB();
  const src = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const q = {
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

  // broad pool for alternatives (only category/subcat)
  const broadPool = data.filter((p) => {
    if (q.category && !eqi(p["Produktkategorie"], q.category)) return false;
    if (q.subcat && !eqi(p["Untergruppe Produktkategorie"], q.subcat)) return false;
    return true;
  });

  // strict matches
  const matches = data.filter((p) => matchProduct(p, q));
  const ranked = matches
    .map((p) => ({ p, score: scoreProduct(p, q) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, q.limit)
    .map((x) => ({ ...x.p, _match_score: x.score }));

  // ask for this if missing
  const missing_fields = [];
  if (!q.subcat) missing_fields.push("Untergruppe Produktkategorie");

  res.status(200).json({
    results: ranked,
    alternatives: alternatives(broadPool),
    missing_fields,
  });
}
