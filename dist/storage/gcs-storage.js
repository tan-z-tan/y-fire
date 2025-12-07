var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getStorage, ref, uploadBytes, getBytes, } from "@firebase/storage";
import { getFirestore, doc, setDoc, onSnapshot, serverTimestamp, } from "@firebase/firestore";
/**
 * GCS storage provider for Y.js state using Firebase Storage.
 * Stores the Y.js document state in Google Cloud Storage (via Firebase Storage).
 * Uses Firestore to store metadata and trigger real-time updates.
 */
export class GcsStorage {
    constructor(options) {
        this.storage = getStorage(options.firebaseApp);
        this.db = getFirestore(options.firebaseApp);
        this.documentPath = options.documentPath;
        this.gcsPath = options.gcsPath || "yjs-documents";
    }
    getStoragePath() {
        return `${this.gcsPath}/${this.documentPath}.yjs`;
    }
    save(data) {
        return __awaiter(this, void 0, void 0, function* () {
            // Save to GCS
            const storageRef = ref(this.storage, this.getStoragePath());
            yield uploadBytes(storageRef, data, {
                contentType: "application/octet-stream",
            });
            // Update Firestore metadata to trigger real-time updates
            const docRef = doc(this.db, this.documentPath);
            yield setDoc(docRef, {
                gcsPath: this.getStoragePath(),
                gcsUpdatedAt: serverTimestamp(),
                storageType: "gcs",
            }, { merge: true });
        });
    }
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const storageRef = ref(this.storage, this.getStoragePath());
                const data = yield getBytes(storageRef);
                return new Uint8Array(data);
            }
            catch (error) {
                if (error.code === "storage/object-not-found") {
                    return null;
                }
                throw error;
            }
        });
    }
    subscribe(callback) {
        // Watch Firestore metadata for changes, then load from GCS
        this.unsubscribe = onSnapshot(doc(this.db, this.documentPath), (docSnapshot) => __awaiter(this, void 0, void 0, function* () {
            if (docSnapshot.exists()) {
                const docData = docSnapshot.data();
                if (docData && docData.gcsPath) {
                    try {
                        const data = yield this.load();
                        callback(data);
                    }
                    catch (error) {
                        console.error("GcsStorage: failed to load from GCS", error);
                    }
                }
            }
        }), (error) => {
            console.error("GcsStorage: snapshot error", error);
        });
        return () => {
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = undefined;
            }
        };
    }
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = undefined;
        }
    }
}
