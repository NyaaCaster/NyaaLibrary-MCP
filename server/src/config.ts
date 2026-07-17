import { config as loadDotenv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root resolved from this module (server/{src,dist}/config → ../../).
const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../");

// Load env from the repo root. In local dev the server runs from ./server,
// so the project .env sits one level up; in Docker, compose injects env vars
// directly (env_file) and these file loads simply no-op. dotenv never
// overrides already-set process.env keys, so layering is safe.
loadDotenv({ path: resolve(process.cwd(), ".env") });
loadDotenv({ path: resolve(process.cwd(), "../.env") });

function str(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int("APP_PORT", 5101),
  host: str("HOST", "0.0.0.0"),

  mcpApiKey: str("MCP_API_KEY"),

  auth: {
    username: str("AUTH_USERNAME", "admin"),
    password: str("AUTH_PASSWORD"),
    secret: str("AUTH_SECRET"),
    tokenTtlHours: int("AUTH_TOKEN_TTL_HOURS", 720),
  },

  upload: {
    maxFileSizeMb: int("MAX_FILE_SIZE_MB", 128),
    maxUploadCount: int("MAX_UPLOAD_COUNT", 10),
  },

  chunk: {
    size: int("CHUNK_SIZE", 512),
    overlap: int("CHUNK_OVERLAP", 50),
  },

  batch: {
    size: int("BATCH_SIZE", 32),
    concurrency: int("CONCURRENCY_LIMIT", 3),
    maxRetries: int("MAX_RETRIES", 3),
  },

  retrieval: {
    topK: int("RETRIEVAL_TOP_K", 5),
    denseTopK: int("DENSE_TOP_K", 50),
    sparseTopK: int("SPARSE_TOP_K", 50),
  },

  embedding: {
    baseUrl: str("EMBEDDING_BASE_URL"),
    apiKey: str("EMBEDDING_API_KEY"),
    model: str("EMBEDDING_MODEL"),
    dim: int("EMBEDDING_DIM", 0),
  },

  dataDir: str("DATA_DIR", resolve(repoRoot, "data")),

  // 本体记忆 REST 端点成对鉴权（决策10/F4）——调用端 KB_CLIENT_TOKEN 须与此相等
  memoryServerToken: str("KB_SERVER_TOKEN"),
} as const;

export const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".pdf",
  ".docx",
  ".epub",
  ".xls",
  ".xlsx",
] as const;
