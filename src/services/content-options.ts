import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { products, salesChannels } from "@/lib/db/schema";

/**
 * /write 화면의 채널 chip · 제품 select 옵션 — 쓰기가 아니라 읽기이므로 새 /api 라우트를
 * 만들지 않고 페이지(서버 컴포넌트)가 이 서비스를 직접 호출한다(docs/ARCHITECTURE.md
 * "Pages(읽기전용) → Services"). 목업의 `CH`·제품 select 하드코딩을 실제 DB 조회로 대체한다.
 */

export interface ChannelOption {
  id: number;
  name: string;
  lang: "ko" | "en";
  channelCode: string;
}

export interface ProductOption {
  id: number;
  name: string;
}

export async function listContentChannels(deps: { db: Db }): Promise<ChannelOption[]> {
  const query = deps.db
    .select({
      id: salesChannels.id,
      name: salesChannels.name,
      lang: salesChannels.lang,
      channelCode: salesChannels.channelCode,
    })
    .from(salesChannels);
  query.where(eq(salesChannels.kind, "content"));
  query.orderBy(salesChannels.id);
  const rows = await query;
  return rows;
}

export async function listActiveProducts(deps: { db: Db }): Promise<ProductOption[]> {
  const query = deps.db.select({ id: products.id, name: products.name }).from(products);
  query.where(eq(products.isActive, true));
  query.orderBy(products.id);
  const rows = await query;
  return rows;
}
