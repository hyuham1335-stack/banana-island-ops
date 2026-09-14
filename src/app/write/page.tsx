import Link from "next/link";
import { RulesResolveQuerySchema } from "@/lib/schemas";
import type { PostType } from "@/components/plan-format";
import { PlanBanner } from "@/components/write/PlanBanner";
import { AutoBox } from "@/components/write/AutoBox";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/Button";

const KNOWN_POST_TYPES = ["health_info", "activity_news", "comparison", "review"] as const;

function asPostType(value: string | undefined): PostType | null {
  return (KNOWN_POST_TYPES as readonly string[]).includes(value ?? "") ? (value as PostType) : null;
}

export default async function WritePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const parsed = RulesResolveQuerySchema.safeParse({
    channelId: params.channelId,
    lang: params.lang,
    productId: params.productId,
  });

  if (!parsed.success) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">콘텐츠 작성</h1>
        </div>
        <Notice variant="bad">
          채널·언어 정보가 없습니다. /plans 에서 계획을 선택해 주세요.
          <div className="notice-actions">
            <Link href="/plans" className="btn small ghost">
              계획 목록으로
            </Link>
          </div>
        </Notice>
      </>
    );
  }

  const { channelId, lang, productId = null } = parsed.data;
  const planId = params.planId ? Number(params.planId) : null;
  const postType = asPostType(params.postType);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">콘텐츠 작성</h1>
      </div>

      {planId !== null && postType !== null ? (
        <PlanBanner
          plan={{
            planId,
            scheduledDate: params.scheduledDate ?? "",
            channelId,
            channelName: params.channelName ?? "",
            productId,
            productName: params.productName ?? null,
            postType,
            ownerName: params.ownerName ?? null,
            sheetRowKey: params.sheetRowKey ?? "",
          }}
        />
      ) : null}

      <AutoBox channelId={channelId} productId={productId} initialLang={lang} />

      <Button disabled disabledReason="콘텐츠 생성 기능은 다음 단계에서 연결됩니다">
        콘텐츠 만들기로 진행
      </Button>
    </>
  );
}
