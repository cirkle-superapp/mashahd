"use client";

import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  User,
  Upload,
  Camera,
  ShieldCheck,
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  IdCard,
  ScanFace,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAppStore } from "@/store/app-store";

/**
 * CreateChannel — a multi-step channel creation flow with identity
 * verification (ID document upload + face capture + match check).
 *
 * Adapted from CIRKLE's Circle Verify concept. Steps:
 *   1. Channel details (name, handle, description)
 *   2. Upload ID document (passport / national ID)
 *   3. Capture face picture (webcam or upload)
 *   4. Verification (simulated match between ID and face)
 *   5. Success — channel created
 *
 * The verification is simulated client-side (in production this would call
 * a KYC/identity-verification API). On success it dispatches a
 * `mashahd:channel-created` event so the rest of the app can navigate to
 * the new channel.
 */

type Step = "details" | "id" | "face" | "verifying" | "done";
const STEP_ORDER: Step[] = ["details", "id", "face", "verifying", "done"];

export function CreateChannel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { navigate } = useAppStore();
  const [step, setStep] = useState<Step>("details");
  const [channelName, setChannelName] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [idFile, setIdFile] = useState<string | null>(null);
  const [faceFile, setFaceFile] = useState<string | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setStep("details");
    setChannelName("");
    setHandle("");
    setDescription("");
    setIdFile(null);
    setFaceFile(null);
    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
      setVideoStream(null);
    }
  };

  const handleClose = (o: boolean) => {
    if (!o) {
      reset();
    }
    onOpenChange(o);
  };

  // Start/stop webcam for the face-capture step.
  useEffect(() => {
    if (step === "face" && !faceFile && !videoStream) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user" } })
        .then((stream) => {
          setVideoStream(stream);
          if (videoRef.current) videoRef.current.srcObject = stream;
        })
        .catch(() => {
          // Webcam unavailable — user can upload instead.
        });
    }
    return () => {
      if (videoStream) {
        videoStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [step]);

  const captureFromWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = video.videoWidth || 320;
    canvas.height = video.videoHeight || 240;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setFaceFile(dataUrl);
    if (videoStream) {
      videoStream.getTracks().forEach((t) => t.stop());
      setVideoStream(null);
    }
  };

  const startVerification = () => {
    setStep("verifying");
    // Simulate the ID + face match check (2.5s).
    setTimeout(() => {
      setStep("done");
      toast.success("Identity verified — channel created!", {
        description: `${channelName} is now live on Mashahd.`,
      });
    }, 2500);
  };

  const finish = async () => {
    handleClose(false);

    // POST to the real /api/channels API to persist the channel.
    try {
      const bid = localStorage.getItem("yt-clone-browser-id") || "";
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          name: channelName,
          handle: (handle || channelName.toLowerCase().replace(/[^a-z0-9_]/g, "")).slice(0, 30),
          description: description || "",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const channel = data.channel;
        // Dispatch event for other components.
        window.dispatchEvent(
          new CustomEvent("mashahd:channel-created", {
            detail: { id: channel.id, name: channel.name, handle: channel.handle },
          })
        );
        toast.success(`Channel "${channel.name}" created successfully!`);
        // Navigate to the new channel page.
        navigate({ kind: "channel", channelId: channel.id });
      } else {
        const error = await res.json().catch(() => ({}));
        toast.error(error.error || "Failed to create channel");
        navigate({ kind: "home" });
      }
    } catch {
      toast.error("Network error — channel could not be created");
      navigate({ kind: "home" });
    }
  };

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto custom-scroll">
        <DialogTitle>Create a channel</DialogTitle>
        <DialogDescription>
          {step === "done"
            ? "Your channel is ready."
            : "Set up your channel and verify your identity to start publishing."}
        </DialogDescription>

        {/* Progress indicator */}
        {step !== "done" && step !== "verifying" && (
          <div className="flex items-center gap-1.5 mb-4">
            {["details", "id", "face"].map((s, i) => (
              <div
                key={s}
                className={cn(
                  "flex-1 h-1.5 rounded-full transition-colors",
                  i <= stepIndex ? "bg-gradient-gold" : "bg-muted"
                )}
              />
            ))}
          </div>
        )}

        {/* Step 1: Channel details */}
        {step === "details" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="channel-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Channel name (required)
              </label>
              <Input
                id="channel-name"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="e.g. Wander Lens"
                maxLength={60}
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="channel-handle" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Handle
              </label>
              <div className="flex items-center mt-1">
                <span className="px-2 py-2 text-sm text-muted-foreground bg-muted rounded-l-md border border-r-0 border-input">
                  @
                </span>
                <Input
                  id="channel-handle"
                  value={handle}
                  onChange={(e) =>
                    setHandle(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "")
                        .slice(0, 30)
                    )
                  }
                  placeholder="wanderlens"
                  className="rounded-l-none"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Only letters, numbers, and underscores.
              </p>
            </div>
            <div>
              <label htmlFor="channel-description" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Description
              </label>
              <textarea
                id="channel-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell viewers what your channel is about"
                rows={3}
                maxLength={500}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60 resize-none"
              />
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => setStep("id")}
                disabled={!channelName.trim()}
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 2: Upload ID */}
        {step === "id" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[hsl(var(--gold)/0.06)] border border-gold/20">
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--gold))] shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Mashahd requires identity verification to publish. Your ID is
                used only once to confirm you&apos;re real — it is never stored
                or shared. This keeps the platform trustworthy.
              </p>
            </div>
            <div>
              <label htmlFor="channel-id-upload" className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                Upload your ID document
              </label>
              <label
                htmlFor="channel-id-upload"
                className={cn(
                  "flex flex-col items-center justify-center gap-2 py-10 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors",
                  idFile
                    ? "border-gold bg-gold/5"
                    : "border-border hover:border-gold/50 hover:bg-gold/5"
                )}
              >
                {idFile ? (
                  <>
                    <div className="flex items-center gap-2 text-[hsl(var(--gold))]">
                      <Check className="h-6 w-6" />
                      <span className="text-sm font-medium">ID uploaded</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Click to replace</p>
                  </>
                ) : (
                  <>
                    <IdCard className="h-8 w-8 text-[hsl(var(--gold))]" />
                    <span className="text-sm font-medium">
                      Drag &amp; drop your ID, or click to browse
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Passport, national ID, or driver&apos;s license · JPG/PNG
                    </span>
                  </>
                )}
                <input
                  id="channel-id-upload"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setIdFile(f.name);
                  }}
                />
              </label>
            </div>
            <div className="flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep("details")}
                className="rounded-full"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={() => setStep("face")}
                disabled={!idFile}
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Capture face */}
        {step === "face" && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[hsl(var(--gold)/0.06)] border border-gold/20">
              <ScanFace className="h-5 w-5 text-[hsl(var(--gold))] shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Take a selfie so we can match it to your ID. Look straight at
                the camera with good lighting.
              </p>
            </div>

            {/* Webcam preview OR captured image OR upload fallback */}
            <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-black border border-border">
              {faceFile ? (
                <img
                  src={faceFile}
                  alt="Your face capture"
                  className="w-full h-full object-cover"
                />
              ) : videoStream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Camera className="h-8 w-8" />
                  <p className="text-xs">Webcam unavailable — upload instead</p>
                </div>
              )}
              {/* Face-guide oval overlay */}
              {!faceFile && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-40 rounded-[50%] border-2 border-white/40" />
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            <div className="flex flex-col gap-2">
              {!faceFile ? (
                <>
                  <Button
                    onClick={captureFromWebcam}
                    disabled={!videoStream}
                    className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    <Camera className="h-4 w-4 mr-1.5" /> Capture selfie
                  </Button>
                  <label className="cursor-pointer text-center text-sm text-muted-foreground hover:text-foreground py-1">
                    or upload a photo instead
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          const reader = new FileReader();
                          reader.onload = () => setFaceFile(reader.result as string);
                          reader.readAsDataURL(f);
                        }
                      }}
                    />
                  </label>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => setFaceFile(null)}
                  className="rounded-full"
                >
                  Retake
                </Button>
              )}
            </div>

            <div className="flex justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep("id")}
                className="rounded-full"
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button
                onClick={startVerification}
                disabled={!faceFile}
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Verify identity <ShieldCheck className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Verifying */}
        {step === "verifying" && (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--gold))]" />
            <div>
              <p className="text-sm font-medium">Verifying your identity…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Matching your selfie to your ID document
              </p>
            </div>
          </div>
        )}

        {/* Step 5: Done */}
        {step === "done" && (
          <div className="py-8 flex flex-col items-center gap-4 text-center">
            <div className="grid place-items-center h-16 w-16 rounded-full bg-gradient-gold text-charcoal shadow-glow">
              <Check className="h-8 w-8" strokeWidth={3} />
            </div>
            <div>
              <p className="text-lg font-semibold font-display">
                Welcome to Mashahd, {channelName.split(" ")[0]}!
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Your identity is verified. You can now publish videos and go
                live.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-[hsl(var(--gold))]">
              <Sparkles className="h-3.5 w-3.5" />
              Verified creator badge added to your channel
            </div>
            <Button
              onClick={finish}
              className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90 mt-2"
            >
              Go to my channel <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
