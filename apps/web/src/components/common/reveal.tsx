"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  // Ref-based observer fires a guaranteed initial callback once mounted, so
  // sections already on screen at load reliably reveal (avoids the whileInView
  // hydration race that left parts of the page stuck at opacity 0).
  const inView = useInView(ref, { once: true, margin: "-80px" });

  if (reduce) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}
