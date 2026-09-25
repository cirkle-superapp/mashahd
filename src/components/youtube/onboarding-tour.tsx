"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Radio, UserPlus, X, ChevronRight } from "lucide-react";
import { MashahdMark } from "@/components/brand/mashahd-logo";

const STORAGE_KEY = "mashahd-onboarding-seen";

const STEPS = [
  {
    icon: Sparkles,
    title: "Discover with AI",
    body: "Every video on Mashahd comes with AI Recap, Smart Chapters, an Oracle that answers your questions, and live comment translation — all powered by real LLM calls.",
    color: "text-[hsl(var(--gold))]",
  },
  {
    icon: Radio,
    title: "Go Live in seconds",
    body: "Tap the red Go Live button anytime to start streaming. Or create a channel with ID verification and start publishing your own videos.",
    color: "text-red-500",
  },
  {
    icon: UserPlus,
    title: "Make it yours",
    body: "Pick a CIRKLE username, customize your avatar, favorite videos, build a Watch Later queue, and sync everything across devices.",
    color: "text-teal-light",
  },
];

export function OnboardingTour() {
  const [step, setStep] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(STORAGE_KEY);
      if (!seen) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShow(true);
      }
    } catch {}
  }, []);

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  };

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      close();
    }
  };

  const current = STEPS[step];
  const Icon = current.icon;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            transition={{ type: "spring", damping: 20 }}
            className="glass-strong rounded-2xl border border-gold/20 p-8 max-w-md w-full shadow-float relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={close}
              className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-accent text-muted-foreground"
              aria-label="Skip tour"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Logo — strokeWidth=5 so the gradient stays visible at the
                modal's small render size (56px on a 100×100 viewBox). */}
            <div className="flex justify-center mb-6">
              <MashahdMark size={64} strokeWidth={5} />
            </div>

            {/* Step icon */}
            <div className="flex justify-center mb-4">
              <span className={`grid place-items-center h-16 w-16 rounded-full bg-[hsl(var(--gold)/0.1)] ${current.color}`}>
                <Icon className="h-8 w-8" />
              </span>
            </div>

            {/* Content */}
            <h2 className="text-xl font-bold font-display text-center mb-2">
              {current.title}
            </h2>
            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              {current.body}
            </p>

            {/* Progress dots */}
            <div className="flex justify-center gap-2 mt-6">
              {STEPS.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setStep(i)}
                  className={`h-2 rounded-full transition-all ${
                    i === step ? "w-8 bg-gradient-gold" : "w-2 bg-muted-foreground/30"
                  }`}
                  aria-label={`Step ${i + 1}`}
                />
              ))}
            </div>

            {/* Actions */}
            <div className="flex justify-between items-center mt-6">
              <button
                onClick={close}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Skip tour
              </button>
              <button
                onClick={next}
                className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 px-5 h-9 text-sm font-medium"
              >
                {step < STEPS.length - 1 ? "Next" : "Get started"}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            {/* Step counter */}
            <p className="text-center text-xs text-muted-foreground mt-3">
              {step + 1} of {STEPS.length}
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
