import { AnnouncementBar } from "@/components/sections/announcement-bar";
import { Navbar } from "@/components/sections/navbar";
import { Hero } from "@/components/sections/hero";
import { SectionIdeMarquee } from "@/components/sections/section-ide-marquee";
import { SectionShowcase } from "@/components/sections/section-showcase";
import { SectionRoadmap } from "@/components/sections/section-roadmap";
import { SectionComparison } from "@/components/sections/section-comparison";
import { SectionProwess } from "@/components/sections/section-prowess";
import { SectionChangelog } from "@/components/sections/section-changelog";
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
        <SectionRoadmap />
        <SectionComparison />
        <SectionShowcase />
        <SectionProwess />
        <SectionChangelog />
        <SectionFaq />
      </main>
      <Footer />
    </>
  );
}
