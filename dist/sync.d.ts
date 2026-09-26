import * as Y from "yjs";
/**
 * Peer-to-peer state reconciliation (the y-protocols sync handshake).
 *
 * Live updates are fire-and-forget: a message sent while a link is down is
 * dropped. If a later update from the same client arrives, Yjs parks its
 * structs as pending (they depend on the missing one) but applies its
 * deletions right away, so overwritten map keys simply vanish on the
 * receiver. Exchanging state vectors on every (re)connect, and whenever
 * pending structs show up, fills such gaps from any peer that has them.
 *
 * Kept free of WebRTC/Firestore so it can be exercised in plain tests.
 */
/** SyncStep1: "this is what I have" (state vector). */
export declare const encodeSyncStep1: (doc: Y.Doc) => Uint8Array;
/**
 * Applies a sync message from a peer. Returns the reply to send back
 * (SyncStep2 for a SyncStep1), or null when nothing needs answering.
 * `origin` must identify the sending peer so the provider relays the
 * resulting update to everyone else but not back to the sender.
 */
export declare const handleSyncMessage: (doc: Y.Doc, message: Uint8Array, origin: unknown) => Uint8Array | null;
/** True while some received structs wait for an update this doc never got. */
export declare const hasPendingStructs: (doc: Y.Doc) => boolean;
//# sourceMappingURL=sync.d.ts.map