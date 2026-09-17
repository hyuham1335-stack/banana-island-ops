import { getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { RulesResolveQuerySchema } from "@/lib/schemas";
import type { PostType } from "@/components/plan-format";
import type { ContentDetail } from "@/lib/content-detail";
import { ContentComposer } from "@/components/write/ContentComposer";
import type { PlanBannerData } from "@/components/write/PlanBanner";
import { Notice } from "@/components/ui/Notice";
import { listActiveProducts, listContentChannels } from "@/services/content-options";
import { getContentDetail } from "@/services/content-workflow";

export const dynamic = "force-dynamic";

const KNOWN_POST_TYPES = ["health_info", "activity_news", "comparison", "review"] as const;
const DEFAULT_POST_TYPE: PostType = "health_info";

function asPostType(value: string | undefined): PostType | null {
  return (KNOWN_POST_TYPES as readonly string[]).includes(value ?? "") ? (value as PostType) : null;
}

export default async function WritePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const db = getDb();
  const [channels, products] = await Promise.all([listContentChannels({ db }), listActiveProducts({ db })]);

  // 콘텐츠 상세의 "다시 만들기" 에서 넘어온 경우 — 제목·채널·제품 등은 기존 콘텐츠에서
  // 그대로 가져오고, ContentComposer 를 titles 단계를 건너뛴 body 단계로 초기화한다.
  const contentIdParam = params.contentId ? Number(params.contentId) : null;

  let channelId: number;
  let lang: "ko" | "en";
  let productId: number | null;
  let postType: PostType;
  let plan: PlanBannerData | null;
  let initialContent: ContentDetail | null = null;
  let initialTopicMemo = params.topicMemo ?? "";

  if (contentIdParam !== null && Number.isInteger(contentIdParam) && contentIdParam > 0) {
    const env = getEnv();
    const result = await getContentDetail({ db, productBaseUrl: env.PRODUCT_BASE_URL }, contentIdParam);
    if (!result.ok) {
      return (
        <>
          <div className="page-head">
            <h1 className="page-title">콘텐츠 만들기</h1>
          </div>
          <Notice variant="bad">{result.error.message}</Notice>
        </>
      );
    }
    initialContent = result.data;
    channelId = result.data.channelId;
    lang = result.data.lang;
    productId = result.data.productId;
    postType = result.data.postType;
    plan = null;
    initialTopicMemo = "";
  } else {
    const parsedQuery = RulesResolveQuerySchema.safeParse({
      channelId: params.channelId,
      lang: params.lang,
      productId: params.productId,
    });

    if (parsedQuery.success) {
      channelId = parsedQuery.data.channelId;
      lang = parsedQuery.data.lang;
      productId = parsedQuery.data.productId ?? null;
    } else {
      // 계획 없이 여는 "즉석 생성" — 목업의 page-write 기본값과 같다: 첫 콘텐츠형 채널을 기본으로.
      const fallback = channels[0];
      if (!fallback) {
        return (
          <>
            <div className="page-head">
              <h1 className="page-title">콘텐츠 만들기</h1>
            </div>
            <Notice variant="bad">콘텐츠형 채널이 없습니다. 브랜드 기준에서 채널을 먼저 등록해 주세요.</Notice>
          </>
        );
      }
      channelId = fallback.id;
      lang = fallback.lang;
      productId = null;
    }

    postType = asPostType(params.postType) ?? DEFAULT_POST_TYPE;
    const planId = params.planId ? Number(params.planId) : null;

    plan =
      parsedQuery.success && planId !== null && asPostType(params.postType) !== null
        ? {
            planId,
            scheduledDate: params.scheduledDate ?? "",
            channelId,
            channelName: params.channelName ?? "",
            lang,
            productId,
            productName: params.productName ?? null,
            postType: asPostType(params.postType) as PostType,
            ownerName: params.ownerName ?? null,
            sheetRowKey: params.sheetRowKey ?? "",
          }
        : null;
  }

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">콘텐츠 만들기</h1>
        <p className="page-desc">
          계획에서 열면 제품·채널·언어가 미리 채워집니다. 읽을 사람과 브랜드 톤, 금칙어는 기준 자료에서 자동으로
          불러옵니다.
        </p>
      </div>

      <ContentComposer
        channels={channels}
        products={products}
        plan={plan}
        initialChannelId={channelId}
        initialLang={lang}
        initialProductId={productId}
        initialPostType={postType}
        initialTopicMemo={initialTopicMemo}
        initialContent={initialContent}
      />
    </>
  );
}
