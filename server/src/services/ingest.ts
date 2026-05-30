// Document ingestion pipeline — implemented in milestone M1.
//
// Planned flow (see .docs/BLUEPRINT.md):
//   1. parse  — extract plain text per format (.txt/.md/.pdf/.docx/.epub/.xls/.xlsx)
//   2. chunk  — split by chunk_size with chunk_overlap
//   3. embed  — OpenAI-compatible /embeddings, batched (BATCH_SIZE),
//               concurrency-limited (CONCURRENCY_LIMIT), retried (MAX_RETRIES)
//   4. store  — write rows into chunks, vec_chunks (dense), chunks_fts (sparse)

export class NotImplementedError extends Error {
  readonly status = 501;
  constructor(message = "文档摄取将在 M1 里程碑实现") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface IngestOptions {
  kbId: string;
  filename: string;
  buffer: Buffer;
  chunkSize: number;
  chunkOverlap: number;
}

export async function ingestDocument(_opts: IngestOptions): Promise<never> {
  throw new NotImplementedError();
}
