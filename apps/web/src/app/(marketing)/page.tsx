import { AnnouncementBar } from "@/components/sections/announcement-bar";
import { Navbar } from "@/components/sections/navbar";
import { Hero } from "@/components/sections/hero";
import { SectionIdeMarquee } from "@/components/sections/section-ide-marquee";
import { SectionShowcase } from "@/components/sections/section-showcase";
import { SectionProwess } from "@/components/sections/section-prowess";
import { SectionReviews } from "@/components/sections/section-reviews";
import { SectionPricing } from "@/components/sections/section-pricing";
import { SectionFaq } from "@/components/sections/section-faq";
import { Footer } from "@/components/sections/footer";

export default function Home() {
  return (
    <>
      <AnnouncementBar />
      <Navbar />
      <main className="flex-1">
        <Hero />
        <SectionIdeMarquee />
        <SectionShowcase />
        <SectionProwess />
        <SectionReviews />
        <SectionPricing />
        <SectionFaq />
      </main>
      <Footer />
    </>
  );
}
