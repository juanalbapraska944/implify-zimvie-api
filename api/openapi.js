export default function handler(req, res) {
  // build the correct base URL automatically (works on vercel)
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  const base = `https://${host}`;

  const schema = {
    openapi: "3.1.0",
    info: {
      title: "Implify ZimVie Catalog API",
      version: "1.0.0",
      description: "Search ZimVie products by category, subcategory, and parsed attributes."
    },
    servers: [{ url: base }],
    paths: {
      "/api/search": {
        get: {
          operationId: "searchProducts",
          summary: "Search products",
          parameters: [
            { name: "q", in: "query", schema: { type: "string" }, description: "Text search in Produktname" },
            { name: "category", in: "query", schema: { type: "string" }, description: "Produktkategorie" },
            { name: "subcat", in: "query", schema: { type: "string" }, description: "Untergruppe Produktkategorie" },
            { name: "diameter_mm", in: "query", schema: { type: "number" } },
            { name: "gingival_height_mm", in: "query", schema: { type: "number" } },
            { name: "length_mm", in: "query", schema: { type: "number" } },
            { name: "collar", in: "query", schema: { type: "string" }, description: "z.B. 'ohne Kragen' or 'mit X mm Kragen'" },
            { name: "abformung_type", in: "query", schema: { type: "string" }, description: "Geschlossene/Offene Abformung" },
            { name: "rotation_protection", in: "query", schema: { type: "string" } },
            { name: "variant", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 25 } }
          ],
          responses: {
            "200": {
              description: "Results + alternatives",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      results: { type: "array", items: { type: "object" } },
                      alternatives: {
                        type: "object",
                        properties: {
                          same_subcat_other_gingival_heights: { type: "array", items: { type: "number" } },
                          same_subcat_other_diameters: { type: "array", items: { type: "number" } }
                        }
                      },
                      missing_fields: { type: "array", items: { type: "string" } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  };

  res.setHeader("Content-Type", "application/json");
  res.status(200).send(JSON.stringify(schema));
}
