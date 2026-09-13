import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  getDocs,
  collection,
  Firestore,
  Timestamp,
  runTransaction,
} from "@firebase/firestore";

import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as string from "lib0/string";

/**
 * initiateInstance does the following:
 * 1. Writes server time into a document
 * 2. This makes sure we get the servertime
 *    and makes sure that this user has write
 *    permission in this document path
 * 3. After writing to Firebase, we retrieve the id
 *    of this newly created document, which we will
 *    use as an id for this client connection
 * @param db
 * @param path
 * @returns
 */
export const initiateInstance = async (db: Firestore, path: string) => {
  try {
    let uid: string;
    let offset: number;

    const instanceRef = doc(collection(db, `${path}/instances`));
    const firestoreTimestamp = serverTimestamp();
    const before = Date.now();
    await setDoc(instanceRef, { now: firestoreTimestamp });
    const after = Date.now();
    // console.log("Instance written", path);

    uid = instanceRef.id;

    const avg = Math.floor((before + after) / 2);
    const instanceDoc = await getDoc(doc(db, `${path}/instances/${uid}`));
    if (!instanceDoc.exists()) throw `instance not created`;
    const instanceData = instanceDoc.data();
    const serverTime = instanceData.now as Timestamp;
    offset =
      serverTime.seconds * 1000 +
      Math.floor(serverTime.nanoseconds / 1000000) -
      avg;

    return { uid, offset };
  } catch (error) {
    throw error;
  }
};

// export const recreateInstance = async (
//   db: Firestore,
//   path: string,
//   uid: string
// ) => {
//   await deleteInstance(db, path, uid);
//   return await initiateInstance(db, path);
// };

/**
 *
 * @param db
 * @param path
 * @param uid
 */
export const deleteInstance = async (
  db: Firestore,
  path: string,
  uid: string
) => {
  // console.log("Destroy instance", path, uid);
  try {
    if (!uid) throw `instance id is empty`;
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, `${path}/instances`, uid);
      const callsRef = collection(db, `${path}/instances/${uid}/calls`);
      const answersRef = collection(db, `${path}/instances/${uid}/answers`);
      const calls = await getDocs(callsRef);
      const answers = await getDocs(answersRef);

      calls.forEach((call) => {
        const callRef = doc(db, `${path}/instances/${uid}/calls/${call.id}`);
        transaction.delete(callRef);
      });
      answers.forEach((answer) => {
        const answerRef = doc(
          db,
          `${path}/instances/${uid}/answers/${answer.id}`
        );
        transaction.delete(answerRef);
      });
      transaction.delete(ref);
    });
    // return { success: true };
  } catch (error) {
    // console.log(path, "Delete instance error:", error);
    // return { success: false, error };
  }
};

/**
 * Death to peer!
 * We don't know which peer died so each peer should
 * try to kill othe other peer's firestore instance.
 * Whoever successfully kills the other peer, survives.
 */
export const killZombie = async (
  db: Firestore,
  path: string,
  uid: string,
  peerUid: string
) => {
  try {
    const ref = doc(db, `${path}/instances`, uid);
    const instance = await getDoc(ref);
    if (instance.exists()) {
      // only proceed if this instance exists
      // else it means that this instance was killed
      // by its peer
      deleteInstance(db, path, peerUid);
    }
    // return {
    //   success: true,
    // };
  } catch (error) {
    // console.log("Kill zombie error:", error);
    // return {
    //   success: false,
    //   error,
    // };
  }
};

export const refreshPeers = (newPeers: string[], oldPeers: Set<string>) => {
  const oldMinusNew = Array.from(oldPeers).filter(
    (item) => !newPeers.includes(item)
  );
  const noChange = Array.from(oldPeers).filter((x) => newPeers.includes(x));
  const newMinusOld = newPeers.filter((item) => !oldPeers.has(item));
  return {
    obselete: oldMinusNew,
    same: noChange,
    new: newMinusOld,
  };
};

export const Uint8ArrayToBase64 = async (buffer: Uint8Array) => {
  const base64url = await new Promise((r) => {
    const reader = new FileReader();
    reader.onload = () => r(reader.result);
    reader.readAsDataURL(new Blob([buffer]));
  });
  // remove the `data:...;base64,` part from the start
  const bas64: string = base64url as string;
  return bas64.slice(bas64.indexOf(",") + 1);
};

export const base64ToUint8Array = async (base64: string) => {
  var dataUrl = "data:application/octet-binary;base64," + base64;

  const uint8 = await fetch(dataUrl)
    .then((res) => res.arrayBuffer())
    .then((buffer) => new Uint8Array(buffer));

  return uint8;
};

export const generateKey = async (sender: string, receiver: string) => {
  const secretBuffer = string.encodeUtf8(sender).buffer;
  const salt = string.encodeUtf8(receiver).buffer;
  const key = await crypto.subtle
    .importKey("raw", secretBuffer, "PBKDF2", false, ["deriveKey"])
    .then((keyMaterial) =>
      crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt,
          iterations: 100000,
          hash: "SHA-256",
        },
        keyMaterial,
        {
          name: "AES-GCM",
          length: 256,
        },
        true,
        ["encrypt", "decrypt"]
      )
    );
  return key;
};

export const encryptData = async (message: any, key: CryptoKey) => {
  try {
    const string = JSON.stringify(message); // convert obj to string

    const encoder = new TextEncoder(); // convert string to uint8array
    const data = encoder.encode(string);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
      },
      key,
      data
    );

    const encryptedDataEncoder = encoding.createEncoder();
    encoding.writeVarString(encryptedDataEncoder, "AES-GCM");
    encoding.writeVarUint8Array(encryptedDataEncoder, iv);
    encoding.writeVarUint8Array(encryptedDataEncoder, new Uint8Array(cipher));
    return encoding.toUint8Array(encryptedDataEncoder);
  } catch (error) {
    return null;
  }
};

export const decryptData = async (message: Uint8Array, key: CryptoKey) => {
  try {
    const dataDecoder = decoding.createDecoder(message);
    const algorithm = decoding.readVarString(dataDecoder);
    if (algorithm !== "AES-GCM") throw `Unknown algorithm`;
    const iv = decoding.readVarUint8Array(dataDecoder);
    const cipher = decoding.readVarUint8Array(dataDecoder);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      cipher
    );
    // console.log("Decrypted", decrypted);
    const decoder = new TextDecoder();
    const data = decoder.decode(decrypted); // convert uint8array to string
    const obj = JSON.parse(data);
    return obj;
  } catch (error) {
    // console.log("Decrypt error", error);
    return null;
  }
};

/**
 * RTCDataChannel の 1 メッセージ上限 (Chrome 256 KiB、環境により 64 KiB) を超える
 * ペイロードを分割する。16 KiB は全ブラウザで確実に通るサイズ。
 */
export const RTC_CHUNK_SIZE = 16 * 1024;

const CHUNK_FRAME_TAG = "y-fire/chunk";

/**
 * 暗号化済みメッセージをチャンクフレーム列にする。先頭の varString が "AES-GCM" 以外
 * なので、分割を知らない旧クライアントは decryptData で捨てる (壊れない)。
 */
export const encodeChunkFrames = (
  payload: Uint8Array,
  messageId: number,
  chunkSize: number = RTC_CHUNK_SIZE
): Uint8Array[] => {
  const count = Math.ceil(payload.length / chunkSize);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const encoder = encoding.createEncoder();
    encoding.writeVarString(encoder, CHUNK_FRAME_TAG);
    encoding.writeVarUint(encoder, messageId);
    encoding.writeVarUint(encoder, i);
    encoding.writeVarUint(encoder, count);
    encoding.writeVarUint8Array(
      encoder,
      payload.subarray(i * chunkSize, (i + 1) * chunkSize)
    );
    frames.push(encoding.toUint8Array(encoder));
  }
  return frames;
};

export const isChunkFrame = (message: Uint8Array): boolean => {
  try {
    const decoder = decoding.createDecoder(message);
    return decoding.readVarString(decoder) === CHUNK_FRAME_TAG;
  } catch {
    return false;
  }
};

/** 受信したチャンクフレームをメッセージ id ごとに集め、揃ったら元のペイロードを返す。 */
export class ChunkReassembler {
  private partial = new Map<
    number,
    { count: number; received: number; parts: Uint8Array[] }
  >();

  push(frame: Uint8Array): Uint8Array | null {
    const decoder = decoding.createDecoder(frame);
    if (decoding.readVarString(decoder) !== CHUNK_FRAME_TAG) {
      throw new Error("Not a chunk frame");
    }
    const messageId = decoding.readVarUint(decoder);
    const index = decoding.readVarUint(decoder);
    const count = decoding.readVarUint(decoder);
    const part = decoding.readVarUint8Array(decoder);

    let entry = this.partial.get(messageId);
    if (!entry) {
      entry = { count, received: 0, parts: new Array(count) };
      this.partial.set(messageId, entry);
    }
    if (index >= entry.count || entry.parts[index]) {
      throw new Error(`Bad chunk index ${index}/${entry.count}`);
    }
    entry.parts[index] = part;
    entry.received++;
    if (entry.received < entry.count) return null;

    this.partial.delete(messageId);
    const total = entry.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of entry.parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  clear() {
    this.partial.clear();
  }
}
