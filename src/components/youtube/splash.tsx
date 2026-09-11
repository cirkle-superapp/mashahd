"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MashahdMark } from "@/components/brand/mashahd-logo";

/**
 * Splash — a brief, one-time animated entrance screen shown the first time a
 * visitor opens Mashahd. Adapted from CIRKLE's splash.tsx.
 *
 * Sequence:
 *   1. Aurora wash + a slowly rotating, blurred gradient-mesh ring fade in.
 *   2. The MashahdMark scales up from 0.4 with a blur-to-sharp entrance.
 *   3. The wordmark (Mashahd + Arabic مشاهِد) fades up 0.6s later.
 *   4. After ~1.8s the whole splash fades + blurs out.
 *
 * A `mashahd-splash-seen` flag in localStorage suppresses it on return
 * visits (so it never feels like friction).
 */
const STORAGE_KEY = "mashahd-splash-seen";
const DURATION = 2000; // ms before fade-out begins

export function Splash() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // localStorage is an external store; this one-shot setState after
        // the initial client read is intentional.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShow(true);
        const t = setTimeout(() => {
          setShow(false);
          localStorage.setItem(STORAGE_KEY, "1");
        }, DURATION);
        return () => clearTimeout(t);
      }
    } catch {
      /* localStorage unavailable — skip splash */
    }
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(20px)" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center overflow-hidden"
        >
          {/* Aurora wash backdrop */}
          <div className="absolute inset-0 aurora-bg opacity-70" />

          {/* Slowly rotating blurred gradient-mesh ring (from CIRKLE splash) */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
            className="absolute w-[140vw] h-[140vw] rounded-full opacity-30"
            style={{
              background: "var(--gradient-mesh)",
              filter: "blur(100px)",
            }}
          />

          {/* Mark — scale up + de-blur */}
          <motion.div
            initial={{ scale: 0.4, opacity: 0, filter: "blur(30px)" }}
            animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <MashahdMark size={140} animated full />
          </motion.div>

          {/* Wordmark — fades up 0.6s after mark */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.7 }}
            className="mt-10 text-center relative"
          >
            <div className="font-display text-5xl gradient-text-gold">Mashahd</div>
            <div
              className="text-sm tracking-[0.4em] uppercase text-muted-foreground mt-3 font-arabic"
              dir="rtl"
            >
              مشاهِد · Video pillar of the super-app
            </div>
          </motion.div>

          {/* Footer caption */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.5 }}
            className="absolute bottom-10 text-[10px] tracking-widest uppercase text-muted-foreground"
          >
            free for everyone · forever
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
