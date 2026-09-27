import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

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
export const encodeSyncStep1 = (doc: Y.Doc): Uint8Array => {
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
};

/**
 * Applies a sync message from a peer. Returns the reply to send back
 * (SyncStep2 for a SyncStep1), or null when nothing needs answering.
 * `origin` must identify the sending peer so the provider relays the
 * resulting update to everyone else but not back to the sender.
 */
export const handleSyncMessage = (
  doc: Y.Doc,
  message: Uint8Array,
  origin: unknown
): Uint8Array | null => {
  const decoder = decoding.createDecoder(message);
  const encoder = encoding.createEncoder();
  syncProtocol.readSyncMessage(decoder, encoder, doc, origin);
  return encoding.length(encoder) > 0 ? encoding.toUint8Array(encoder) : null;
};

/** True while some received structs wait for an update this doc never got. */
export const hasPendingStructs = (doc: Y.Doc): boolean =>
  (doc.store as unknown as { pendingStructs: unknown }).pendingStructs != null;
