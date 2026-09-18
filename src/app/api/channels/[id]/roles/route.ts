import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/channels/[id]/roles
 * Returns all team members + their roles for a channel (§49).
 *
 * POST /api/channels/[id]/roles
 * Body: { browserId, userId, role, invitedBy? }
 * Invites a user to the channel team with a role (§49).
 *
 * PATCH /api/channels/[id]/roles
 * Body: { browserId, roleId, action: "accept" | "update", role? }
 * Accepts an invitation or updates a member's role.
 *
 * DELETE /api/channels/[id]/roles
 * Body: { browserId, roleId }
 * Removes a team member.
 *
 * Per spec §49: "Provide: content, analytics, audience, monetization, rights,
 * moderation, distribution diagnostics, AI tools, live, notifications, API, exports."
 * Channel roles enable creator teams with role-based access control.
 *
 * Roles:
 *   - owner: full control (can delete the channel)
 *   - manager: can manage videos, settings, team (cannot delete channel or change owner)
 *   - editor: can upload/edit videos, moderate comments
 *   - viewer: read-only access to studio analytics
 */

const VALID_ROLES = ["owner", "manager", "editor", "viewer"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  if (!bid) return NextResponse.json({ roles: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const roles = await (db as any).channelRole.findMany({
      where: { channelId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      roles: roles.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        role: r.role,
        accepted: r.accepted,
        invitedBy: r.invitedBy,
        createdAt: r.createdAt?.toISOString(),
      })),
    });
  } catch {
    return NextResponse.json({ roles: [] });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const userId: string = (body.userId || "").slice(0, 60);
  const role: string = body.role || "viewer";
  const invitedBy: string = (body.invitedBy || "").slice(0, 60);

  if (!bid || !userId) {
    return NextResponse.json({ error: "browserId + userId required" }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `invalid role. valid: ${VALID_ROLES.join(", ")}` }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`channel-roles:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    // Verify the channel exists.
    const channel = await db.channel.findUnique({ where: { id } });
    if (!channel) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }

    // Check for existing role (unique on channelId + userId).
    const existing = await (db as any).channelRole.findFirst({
      where: { channelId: id, userId },
    });
    if (existing) {
      return NextResponse.json({ error: "user already has a role on this channel" }, { status: 409 });
    }

    // Limit team size.
    const teamCount = await (db as any).channelRole.count({ where: { channelId: id } });
    if (teamCount >= 20) {
      return NextResponse.json({ error: "maximum 20 team members per channel" }, { status: 400 });
    }

    const roleRecord = await (db as any).channelRole.create({
      data: {
        channelId: id,
        userId,
        role,
        accepted: role === "owner", // owners are auto-accepted
        invitedBy: invitedBy || verification.id,
      },
    });

    return NextResponse.json({
      ok: true,
      role: {
        id: roleRecord.id,
        userId: roleRecord.userId,
        role: roleRecord.role,
        accepted: roleRecord.accepted,
      },
    });
  } catch {
    return NextResponse.json({ error: "failed to create role" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const roleId: string = body.roleId || "";
  const action: string = body.action || "";

  if (!bid || !roleId || !action) {
    return NextResponse.json({ error: "browserId + roleId + action required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const role = await (db as any).channelRole.findUnique({ where: { id: roleId } });
    if (!role || role.channelId !== id) {
      return NextResponse.json({ error: "role not found" }, { status: 404 });
    }

    if (action === "accept") {
      await (db as any).channelRole.update({
        where: { id: roleId },
        data: { accepted: true },
      });
      return NextResponse.json({ ok: true, accepted: true });
    }

    if (action === "update") {
      const newRole: string = body.role || "";
      if (!VALID_ROLES.includes(newRole)) {
        return NextResponse.json({ error: `invalid role` }, { status: 400 });
      }
      await (db as any).channelRole.update({
        where: { id: roleId },
        data: { role: newRole },
      });
      return NextResponse.json({ ok: true, role: newRole });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "failed to update role" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const roleId: string = body.roleId || "";

  if (!bid || !roleId) {
    return NextResponse.json({ error: "browserId + roleId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const role = await (db as any).channelRole.findUnique({ where: { id: roleId } });
    if (!role || role.channelId !== id) {
      return NextResponse.json({ error: "role not found" }, { status: 404 });
    }

    // Don't allow removing the last owner.
    if (role.role === "owner") {
      const ownerCount = await (db as any).channelRole.count({
        where: { channelId: id, role: "owner" },
      });
      if (ownerCount <= 1) {
        return NextResponse.json({ error: "cannot remove the last owner" }, { status: 400 });
      }
    }

    await (db as any).channelRole.delete({ where: { id: roleId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "failed to remove role" }, { status: 500 });
  }
}
