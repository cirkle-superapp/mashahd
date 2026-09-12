"use client";

import { useState, useEffect, useRef } from "react";
import { Users, Copy, Check, X, Send, Play, Pause, Loader2, Tv } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useWatchParty } from "@/hooks/use-watch-party";
import { useAvatar } from "@/hooks/use-avatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * WatchParty — a dialog for real-time co-watching. The host creates a party
 * (gets a 6-char code), shares it with friends, and everyone's playback
 * stays in sync via the watch-party WebSocket service (port 3004).
 *
 * Two modes:
 *   1. Host: clicks "Watch with friends" on a video → creates a party →
 *      gets a shareable code. Their play/pause/seek actions broadcast.
 *   2. Joiner: enters a code in the "Join party" dialog → synced to host.
 *
 * While in a party, a small floating chip shows the party code + member
 * count, and the host's sync actions drive the player.
 */
export function WatchParty({
  open,
  onClose,
  videoId,
  videoTitle,
}: {
  open: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle: string;
}) {
  const { avatar, displayName } = useAvatar();
  const party = useWatchParty();
  const [mode, setMode] = useState<"menu" | "create" | "join">("menu");
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // If we're already in a party when the dialog opens, show the party room
  // directly (derived from party state, not an effect).
  const effectiveMode = party.partyCode ? "create" : mode;

  // Auto-scroll chat to bottom on new messages.
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [party.chat]);

  const handleCreate = () => {
    party.create(videoId, videoTitle, displayName, avatar);
    setMode("create");
  };

  const handleJoin = () => {
    if (joinCode.trim().length !== 6) {
      toast.error("Party codes are 6 characters");
      return;
    }
    party.join(joinCode, displayName, avatar);
    setMode("create"); // show the party view
  };

  const copyCode = () => {
    if (!party.partyCode) return;
    const url = `${window.location.origin}/?v=watch&id=${videoId}&party=${party.partyCode}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast.success("Party link copied — share it with friends");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLeave = () => {
    party.leave();
    onClose();
    setMode("menu");
    setJoinCode("");
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    party.sendChat(chatInput);
    setChatInput("");
  };

  const inParty = party.partyCode && effectiveMode === "create";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-w-md", inParty && "max-w-lg")}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid place-items-center h-8 w-8 rounded-full bg-gradient-to-br from-teal/20 to-transparent border border-teal/30">
              <Tv className="h-4 w-4 text-teal" />
            </span>
            Watch Party
          </DialogTitle>
          <DialogDescription>
            Watch this video together in sync with friends.
          </DialogDescription>
        </DialogHeader>

        {/* Connection status */}
        {!party.connected && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting…
          </div>
        )}
        {party.error && (
          <p className="text-sm text-rose-500 bg-rose-500/10 rounded-lg px-3 py-2">
            {party.error}
          </p>
        )}

        {!inParty ? (
          <div className="space-y-3">
            <Button onClick={handleCreate} disabled={!party.connected} className="w-full">
              <Users className="h-4 w-4 mr-2" />
              Start a new party
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground px-2">or join one</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex gap-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABC123"
                className="font-mono tracking-widest text-center uppercase"
                maxLength={6}
              />
              <Button onClick={handleJoin} disabled={joinCode.length !== 6 || !party.connected} variant="secondary">
                Join
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ask your friend for their 6-character party code.
            </p>
          </div>
        ) : (
          <PartyRoom
            party={party}
            videoTitle={videoTitle}
            copied={copied}
            onCopy={copyCode}
            onLeave={handleLeave}
            chatInput={chatInput}
            onChatChange={setChatInput}
            onSendChat={sendChat}
            chatScrollRef={chatScrollRef}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PartyRoom({
  party,
  videoTitle,
  copied,
  onCopy,
  onLeave,
  chatInput,
  onChatChange,
  onSendChat,
  chatScrollRef,
}: {
  party: ReturnType<typeof useWatchParty>;
  videoTitle: string;
  copied: boolean;
  onCopy: () => void;
  onLeave: () => void;
  chatInput: string;
  onChatChange: (s: string) => void;
  onSendChat: (e: React.FormEvent) => void;
  chatScrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="space-y-4">
      {/* Party code + share */}
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
        <div className="text-xs text-muted-foreground mb-1">Party code</div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-2xl font-bold tracking-[0.3em] text-[hsl(var(--gold))]">
            {party.partyCode}
          </span>
          <Button size="sm" variant="outline" onClick={onCopy}>
            {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 truncate">
          Watching: <span className="text-foreground">{videoTitle}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {party.isHost
            ? "You're the host — your play/pause/seek controls everyone."
            : "Synced to the host's playback."}
        </p>
      </div>

      {/* Members */}
      <div>
        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          {party.members.length} watching
        </div>
        <div className="flex flex-wrap gap-2">
          {party.members.map((m) => (
            <div
              key={m.memberId}
              className="flex items-center gap-1.5 rounded-full bg-muted pl-1 pr-3 py-1"
              title={m.name + (m.isHost ? " (host)" : "")}
            >
              <Avatar className="h-5 w-5">
                <AvatarImage src={m.avatarUrl} alt="" />
                <AvatarFallback className="text-[10px]">{m.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-xs font-medium max-w-[80px] truncate">{m.name}</span>
              {m.isHost && (
                <span className="text-[10px] text-[hsl(var(--gold))]">★</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div>
        <div className="text-xs text-muted-foreground mb-2">Party chat</div>
        <div
          ref={chatScrollRef}
          className="h-32 overflow-y-auto rounded-xl border border-border bg-background/60 p-2 space-y-1.5"
        >
          {party.chat.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No messages yet. Say hi 👋
            </p>
          ) : (
            party.chat.map((m, i) => (
              <div key={i} className="text-xs flex gap-2">
                <Avatar className="h-5 w-5 shrink-0">
                  <AvatarImage src={m.avatarUrl} alt="" />
                  <AvatarFallback className="text-[10px]">{m.name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-muted-foreground ml-1">{m.text}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <form onSubmit={onSendChat} className="flex gap-2 mt-2">
          <Input
            value={chatInput}
            onChange={(e) => onChatChange(e.target.value)}
            placeholder="Message the party…"
            maxLength={500}
            className="text-sm"
          />
          <Button type="submit" size="icon" disabled={!chatInput.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {/* Leave */}
      <Button variant="ghost" className="w-full text-rose-500 hover:text-rose-600 hover:bg-rose-500/10" onClick={onLeave}>
        <X className="h-4 w-4 mr-1" />
        Leave party
      </Button>
    </div>
  );
}
