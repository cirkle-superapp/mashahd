# Mashahd — P2P Networking

## Swarm ID

Every compatible representation has a deterministic swarm:

```
swarmId = sha256(videoId + renditionId + manifestVersion)
```

This prevents peers from exchanging incompatible media. The swarm changes
when the video, rendition, or manifest version changes.

## Network Policy (hard rules)

| Network | P2P |
|---------|:---:|
| Wi-Fi | ON (bounded: max 6 peers) |
| Ethernet | ON |
| 2g/3g/4g/5g (cellular) | **OFF** |
| saveData=true | **OFF** |
| Background tab | OFF or receive-only |
| Poor network (high RTT) | OFF |
| User opt-out | OFF |

## WebRTC Signaling (Tracker)

The self-hosted tracker runs at `mini-services/p2p-tracker/index.ts` on
port 3003. It handles:

- swarm discovery
- peer announcement + membership
- WebRTC offer/answer exchange
- ICE candidate exchange
- heartbeat (20s) + peer expiration (60s timeout)

It **only transports signaling messages** — never video. Media flows
peer ⇄ peer via WebRTC data channels.

## TURN Policy

TURN is **never mandatory**. If direct WebRTC fails, playback falls back
to HTTP HLS. The system remains functional with TURN absent.

## P2P Upload Safety

- Peers only share segments they legitimately downloaded
- Swarm isolation (peers only exchange within their authorized swarm)
- Max upload rate (default 2 Mbps), max upload bytes (250 MB/session)
- Background tabs don't upload
- Cellular/data-saver viewers never contribute
