import { useEffect, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Scroll-in animations inside `scope`:
 *  - [data-reveal]        → fades/slides up on entering viewport
 *  - [data-reveal-left]   → slides in from the left
 *  - [data-parallax]      → gentle vertical parallax (value = strength %)
 */
export function useReveal(scope: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = scope.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((target) => {
        gsap.from(target, {
          y: 44,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: target, start: "top 88%" },
        });
      });
      gsap.utils.toArray<HTMLElement>("[data-reveal-left]").forEach((target) => {
        gsap.from(target, {
          x: -56,
          opacity: 0,
          duration: 0.9,
          ease: "power3.out",
          scrollTrigger: { trigger: target, start: "top 88%" },
        });
      });
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((target) => {
        const strength = Number(target.dataset.parallax ?? 12);
        gsap.fromTo(
          target,
          { yPercent: -strength },
          {
            yPercent: strength,
            ease: "none",
            scrollTrigger: { trigger: target, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });
    }, el);

    return () => ctx.revert();
  }, [scope]);
}
