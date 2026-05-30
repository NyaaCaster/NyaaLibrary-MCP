import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listKnowledgeBases, resolveKnowledgeBase } from "../services/kb.js";
import { searchKnowledgeBase } from "../services/retrieval.js";
import { config } from "../config.js";

export function registerKnowledgeBaseTools(server: McpServer): void {
  server.registerTool(
    "list_knowledge_bases",
    {
      title: "列出知识库",
      description:
        "List all available knowledge bases with their id, name, description, " +
        "document count and chunk count. Call this first to discover which " +
        "knowledge base to search.",
      inputSchema: {},
    },
    async () => {
      const kbs = listKnowledgeBases();
      if (kbs.length === 0) {
        return { content: [{ type: "text", text: "（暂无知识库）" }] };
      }
      const lines = kbs.map(
        (kb) =>
          `- ${kb.name} [id: ${kb.id}]\n  ${kb.description || "（无描述）"}\n  文档 ${kb.document_count} · 分块 ${kb.chunk_count}`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.registerTool(
    "search_knowledge_base",
    {
      title: "检索知识库",
      description:
        "Search a knowledge base for the most relevant chunks using hybrid " +
        "dense + sparse retrieval. Use this to ground answers in stored " +
        "documents. Provide the knowledge base by name or id.",
      inputSchema: {
        knowledge_base: z
          .string()
          .min(1)
          .describe("Knowledge base name or id (from list_knowledge_bases)."),
        query: z.string().min(1).describe("The search query / question."),
        top_k: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe(
            `Number of results to return (default ${config.retrieval.topK}).`,
          ),
      },
    },
    async ({ knowledge_base, query, top_k }) => {
      const kb = resolveKnowledgeBase(knowledge_base);
      if (!kb) {
        return {
          isError: true,
          content: [
            { type: "text", text: `找不到知识库："${knowledge_base}"` },
          ],
        };
      }
      try {
        const hits = await searchKnowledgeBase(
          kb.id,
          query,
          top_k ?? config.retrieval.topK,
        );
        if (hits.length === 0) {
          return {
            content: [{ type: "text", text: "（未检索到相关内容）" }],
          };
        }
        const blocks = hits.map(
          (h, i) =>
            `#${i + 1} | 文档：${h.document_name} | 文本块 #${h.seq} | ` +
            `相关度 ${h.score.toFixed(4)} | ${h.char_count} 字符\n${h.content}`,
        );
        return {
          content: [
            {
              type: "text",
              text: `在「${kb.name}」中检索「${query}」，命中 ${hits.length} 条：\n\n${blocks.join("\n\n---\n\n")}`,
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `检索失败：${msg}` }] };
      }
    },
  );
}
