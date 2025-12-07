import { FirebaseApp } from "@firebase/app";
import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  onSnapshot,
  Bytes,
  Unsubscribe,
} from "@firebase/firestore";
import { StorageProvider } from "./types";

export interface FirestoreStorageOptions {
  firebaseApp: FirebaseApp;
  documentPath: string;
  docMapper?: (bytes: Bytes) => object;
}

/**
 * Firestore storage provider for Y.js state.
 * Stores the Y.js document state directly in Firestore.
 */
export class FirestoreStorage implements StorageProvider {
  private db: Firestore;
  private documentPath: string;
  private docMapper: (bytes: Bytes) => object;
  private unsubscribe?: Unsubscribe;

  constructor(options: FirestoreStorageOptions) {
    this.db = getFirestore(options.firebaseApp);
    this.documentPath = options.documentPath;
    this.docMapper = options.docMapper || ((bytes) => ({ content: bytes }));
  }

  async save(data: Uint8Array): Promise<void> {
    const ref = doc(this.db, this.documentPath);
    await setDoc(ref, this.docMapper(Bytes.fromUint8Array(data)), {
      merge: true,
    });
  }

  async load(): Promise<Uint8Array | null> {
    // Load is handled via subscribe for real-time updates
    // This method is kept for interface compliance
    return null;
  }

  subscribe(callback: (data: Uint8Array | null) => void): () => void {
    this.unsubscribe = onSnapshot(
      doc(this.db, this.documentPath),
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const docData = docSnapshot.data();
          if (docData && docData.content) {
            const content = docData.content.toUint8Array();
            callback(content);
          }
        }
      },
      (error) => {
        console.error("FirestoreStorage: snapshot error", error);
      }
    );

    return () => {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = undefined;
      }
    };
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }
  }
}
