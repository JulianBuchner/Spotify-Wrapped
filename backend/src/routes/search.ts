import { FastifyPluginAsync } from "fastify";
import { search } from "../lib/searchIndex";
import { parseLimit } from "../lib/query";

const searchRoutes: FastifyPluginAsync = async (app) => {
  // Fuzzy, case-insensitive, diacritic-insensitive search across titles/artists/albums.
  app.get("/api/search", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (!q) return reply.status(400).send({ error: "Query param 'q' is required." });

    const typesRaw =
      typeof query.types === "string" ? query.types : "songs,artists,albums";
    const types = new Set(
      typesRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );
    const limit = parseLimit(query, 5, 20);

    const data = await search(q, types, limit);
    return { data };
  });
};

export default searchRoutes;
