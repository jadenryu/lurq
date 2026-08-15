"use client";

/**
 * The dashboard's motion vocabulary, in one file.
 *
 * Three primitives, deliberately few. Motion in an application surface is
 * wayfinding, not decoration: it should tell you that the view changed, which
 * thing is now current, and that content arrived in an order. Anything past
 * that is a thing the user has to sit through on every navigation, and a
 * dashboard is a place people visit repeatedly.
 *
 * The shape of every transition here is the same — a short rise plus a fade, on
 * one easing curve — so separate surfaces read as one system rather than as
 * several people's animation choices stacked up.
 *
 * `useReducedMotion` is honoured in each primitive by collapsing distance and
 * duration to zero rather than by removing the component, so the DOM is
 * identical either way and nothing can render only under one preference.
 */

import { motion, useReducedMotion, type Variants } from "framer-motion";
import { usePathname } from "next/navigation";

/** One curve for the whole surface. Matches --ease in tokens.css (expo-out). */
const EASE = [0.16, 1, 0.3, 1] as const;

/** Rise distance. Small on purpose: this is a hint that content arrived, not a
 *  slide. Past ~12px it starts to read as the page assembling itself. */
const RISE = 8;

/**
 * Wraps a dashboard route's content so a navigation reads as a change of view.
 *
 * Keyed on the pathname, which is what makes it re-run: the App Router keeps the
 * layout mounted across routes, so without a changing key this would animate
 * once on first load and never again.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: reduce ? 0 : RISE }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A container whose children arrive in sequence.
 *
 * `staggerChildren` is small (55ms): the point is an order, not a queue. With
 * eight stat tiles a longer step means the last one lands almost half a second
 * after the first, which stops reading as polish and starts reading as slow.
 */
export function Stagger({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();

  const container: Variants = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: reduce ? 0 : 0.055,
        delayChildren: reduce ? 0 : delay,
      },
    },
  };

  return (
    <motion.div
      className={className}
      variants={container}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  );
}

/** One member of a `Stagger`. Inherits its timing from the parent's variants. */
export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();

  const item: Variants = {
    hidden: { opacity: 0, y: reduce ? 0 : RISE },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: reduce ? 0 : 0.32, ease: EASE },
    },
  };

  return (
    <motion.div className={className} variants={item}>
      {children}
    </motion.div>
  );
}
