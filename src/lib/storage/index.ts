import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { signFileToken } from "./signed-token";

// NFR-02: files are never public. Every URL handed to a browser is signed and expires within 5 minutes,
// and is only issued after an access check in the calling route.
export const URL_TTL_SECONDS = 5 * 60;
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

export type UploadTarget = { url: string; headers: Record<string, string> };

export interface Storage {
  uploadUrl(key: string, contentType: string): Promise<UploadTarget>;
  readUrl(key: string, opts?: { contentType?: string; downloadName?: string }): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

class LocalStorage implements Storage {
  constructor(
    private root: string,
    private secret: string,
  ) {}

  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  private exp() {
    return Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
  }

  async uploadUrl(key: string, contentType: string): Promise<UploadTarget> {
    const token = signFileToken(this.secret, { k: key, op: "put", exp: this.exp(), ct: contentType, max: MAX_UPLOAD_BYTES });
    return { url: `/api/files/${token}`, headers: { "Content-Type": contentType } };
  }

  async readUrl(key: string, opts: { contentType?: string; downloadName?: string } = {}): Promise<string> {
    const token = signFileToken(this.secret, {
      k: key,
      op: "get",
      exp: this.exp(),
      ct: opts.contentType,
      dn: opts.downloadName,
    });
    return `/api/files/${token}`;
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

class S3Storage implements Storage {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}

  async uploadUrl(key: string, contentType: string): Promise<UploadTarget> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: URL_TTL_SECONDS },
    );
    return { url, headers: { "Content-Type": contentType } };
  }

  async readUrl(key: string, opts: { contentType?: string; downloadName?: string } = {}): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: opts.downloadName ? contentDisposition(opts.downloadName) : undefined,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: URL_TTL_SECONDS },
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${key} has no body`);
    return res.Body.transformToByteArray();
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: Storage | null = null;

export function storage(): Storage {
  if (instance) return instance;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    const client = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
    });
    instance = new S3Storage(client, e.S3_BUCKET!);
  } else {
    instance = new LocalStorage(e.LOCAL_STORAGE_DIR, e.APP_SECRET);
  }
  return instance;
}

export { contentDisposition };
