var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getFirestore, doc, setDoc, onSnapshot, Bytes, } from "@firebase/firestore";
import { getStorage, ref, uploadBytes, getBytes, } from "@firebase/storage";
import { DEFAULT_STORAGE_CONFIG } from "./types";
/**
 * Hybrid storage provider for Y.js state.
 * Automatically selects between Firestore and GCS based on data size.
 * - Small documents: stored directly in Firestore (fast, real-time)
 * - Large documents: stored in GCS with metadata in Firestore
 */
export class HybridStorage {
    constructor(options) {
        this.currentStorageType = "firestore";
        this.db = getFirestore(options.firebaseApp);
        this.storage = getStorage(options.firebaseApp);
        this.documentPath = options.documentPath;
        this.docMapper = options.docMapper || ((bytes) => ({ content: bytes }));
        this.threshold =
            options.hybridThreshold || DEFAULT_STORAGE_CONFIG.hybridThreshold;
        this.gcsPath = options.gcsPath || DEFAULT_STORAGE_CONFIG.gcsPath;
    }
    getStoragePath() {
        return `${this.gcsPath}/${this.documentPath}.yjs`;
    }
    save(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const docRef = doc(this.db, this.documentPath);
            if (data.byteLength >= this.threshold) {
                // Large document: store in GCS
                const storageRef = ref(this.storage, this.getStoragePath());
                yield uploadBytes(storageRef, data, {
                    contentType: "application/octet-stream",
                });
                // Update Firestore with GCS metadata
                yield setDoc(docRef, Object.assign(Object.assign({}, this.docMapper(Bytes.fromUint8Array(new Uint8Array(0)))), { content: null, gcsPath: this.getStoragePath(), storageType: "gcs", gcsUpdatedAt: new Date().toISOString() }), { merge: true });
                this.currentStorageType = "gcs";
            }
            else {
                // Small document: store in Firestore
                yield setDoc(docRef, Object.assign(Object.assign({}, this.docMapper(Bytes.fromUint8Array(data))), { gcsPath: null, storageType: "firestore" }), { merge: true });
                this.currentStorageType = "firestore";
            }
        });
    }
    load() {
        return __awaiter(this, void 0, void 0, function* () {
            // Load is handled via subscribe for real-time updates
            return null;
        });
    }
    loadFromGcs() {
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
        let lastGcsUpdatedAt = null;
        this.unsubscribe = onSnapshot(doc(this.db, this.documentPath), (docSnapshot) => __awaiter(this, void 0, void 0, function* () {
            if (docSnapshot.exists()) {
                const docData = docSnapshot.data();
                if (docData) {
                    if (docData.storageType === "gcs" && docData.gcsPath) {
                        // Data is in GCS - check if it's been updated
                        const gcsUpdatedAt = docData.gcsUpdatedAt;
                        if (gcsUpdatedAt !== lastGcsUpdatedAt) {
                            lastGcsUpdatedAt = gcsUpdatedAt;
                            try {
                                const data = yield this.loadFromGcs();
                                if (data) {
                                    callback(data);
                                }
                            }
                            catch (error) {
                                console.error("HybridStorage: failed to load from GCS", error);
                            }
                        }
                    }
                    else if (docData.content) {
                        // Data is in Firestore
                        lastGcsUpdatedAt = null;
                        const content = docData.content.toUint8Array();
                        callback(content);
                    }
                }
            }
        }), (error) => {
            console.error("HybridStorage: snapshot error", error);
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
    /**
     * Get the current storage type being used
     */
    getCurrentStorageType() {
        return this.currentStorageType;
    }
}
