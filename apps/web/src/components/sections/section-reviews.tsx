import { Marquee } from "@/components/ui/marquee";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Container } from "@/components/common/container";
import { Reveal } from "@/components/common/reveal";
import { reviews, type Review } from "@/content/reviews";
import { cn } from "@/lib/utils";

function ReviewCard({ review }: { review: Review }) {
  return (
    <figure
      className={cn(
        "surface-glow w-[320px] shrink-0 rounded-[var(--radius-lg)] border border-border bg-card p-6 md:w-[380px]",
      )}
    >
      <blockquote className="text-sm leading-relaxed text-foreground">
        &ldquo;{review.quote}&rdquo;
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <Avatar className="size-9 border border-border">
          <AvatarFallback className="bg-secondary text-xs text-muted-foreground">
            {review.initials}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="text-sm font-medium text-foreground">
            {review.name}
          </div>
          <div className="text-xs text-muted-foreground/70">{review.role}</div>
        </div>
      </figcaption>
    </figure>
  );
}

export function SectionReviews() {
  const half = Math.ceil(reviews.length / 2);
  const firstRow = reviews.slice(0, half);
  const secondRow = reviews.slice(half);

  return (
    <section
      id="reviews"
      className="relative overflow-hidden border-t border-border py-24 md:py-32"
    >
      <Container>
        <Reveal>
          <div className="mx-auto max-w-none text-center">
            <h2 className="text-4xl font-semibold leading-[1.04] tracking-tight md:text-5xl lg:whitespace-nowrap">
              Loved by builders and their agents.
            </h2>
          </div>
        </Reveal>
      </Container>

      <div className="relative mt-14 flex flex-col gap-4">
        <Marquee pauseOnHover className="[--duration:55s]">
          {firstRow.map((r) => (
            <ReviewCard key={r.name} review={r} />
          ))}
        </Marquee>
        <Marquee reverse pauseOnHover className="[--duration:65s]">
          {secondRow.map((r) => (
            <ReviewCard key={r.name} review={r} />
          ))}
        </Marquee>

        {/* edge fades */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-background to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/5 bg-gradient-to-l from-background to-transparent" />
      </div>
    </section>
  );
}
