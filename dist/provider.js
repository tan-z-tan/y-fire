var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { getFirestore, onSnapshot, doc, setDoc, getDocs, Bytes, serverTimestamp, } from "@firebase/firestore";
import { collection } from "firebase/firestore";
import * as Y from "yjs";
import { ObservableV2 } from "lib0/observable";
import * as awarenessProtocol from "y-protocols/awareness";
import { get as getLocal, set as setLocal, del as delLocal } from "idb-keyval";
import { deleteInstance, initiateInstance, refreshPeers } from "./utils";
import { DEFAULT_ICE_SERVERS, WebRtc } from "./webrtc";
import { createGraph } from "./graph";
import { hasPendingStructs } from "./sync";
const MAX_SIZE = 800000; // 800KB safety limit (Firestore limit is 1MB)
/**
 * FireProvider class that handles firestore data sync and awareness
 * based on webRTC.
 * @param firebaseApp Firestore instance
 * @param ydoc ydoc
 * @param path path to the firestore document (ex. collection/documentuid)
 * @param maxUpdatesThreshold maximum number of updates to wait for before sending updates to peers
 * @param maxWaitTime maximum miliseconds to wait before sending updates to peers
 * @param maxWaitFirestoreTime miliseconds to wait before syncing this client's update to firestore
 */
export class FireProvider extends ObservableV2 {
    get clientTimeOffset() {
        return this.timeOffset;
    }
    _encodeStateAsUpdate() {
        return this.encodingVersion === 2
            ? Y.encodeStateAsUpdateV2(this.doc)
            : Y.encodeStateAsUpdate(this.doc);
    }
    _applyUpdate(update, origin) {
        if (this.encodingVersion === 2) {
            Y.applyUpdateV2(this.doc, update, origin);
        }
        else {
            Y.applyUpdate(this.doc, update, origin);
        }
    }
    _mergeUpdates(updates) {
        return this.encodingVersion === 2
            ? Y.mergeUpdatesV2(updates)
            : Y.mergeUpdates(updates);
    }
    constructor({ firebaseApp, ydoc, path, docMapper, maxUpdatesThreshold, maxWaitTime, maxWaitFirestoreTime, maxFirestoreDeferral, chunkThreshold, encodingVersion, iceServers, }) {
        super();
        this.timeOffset = 0; // offset to server time in mili seconds
        this.clients = [];
        this.peersReceivers = new Set([]);
        this.peersSenders = new Set([]);
        this.peersRTC = {
            receivers: {},
            senders: {},
        };
        this.documentMapper = (bytes) => ({ content: bytes });
        this.maxCacheUpdates = 20;
        this.cacheUpdateCount = 0;
        this.maxRTCWait = 100;
        this.maxFirestoreWait = 3000;
        /** When the oldest unsaved local change was queued; null when nothing is queued. */
        this.firestoreQueuedSince = null;
        this.chunkThreshold = MAX_SIZE;
        this.encodingVersion = 1;
        this.iceServers = DEFAULT_ICE_SERVERS;
        /**
         * Links that died with ERR_ICE_CONNECTION_FAILURE, cumulative across
         * reconnects. Unlike a zombie peer (which never answers), this is a
         * definitive "signaling worked but no ICE path exists" signal.
         */
        this.iceFailures = 0;
        this.firebaseDataLastUpdatedAt = new Date().getTime();
        this.instanceConnection = new ObservableV2();
        this.ready = false;
        this.init = () => __awaiter(this, void 0, void 0, function* () {
            this.trackData(); // initiate this before creating instance, so that users with read permissions can also view the document
            try {
                const data = yield initiateInstance(this.db, this.documentPath);
                this.instanceConnection.on("closed", this.trackConnections);
                this.instanceConnection.on("link-error", this.handleLinkError);
                this.uid = data.uid;
                this.timeOffset = data.offset;
                this.initiateHandler();
                addEventListener("beforeunload", this.destroy); // destroy instance on window close
            }
            catch (error) {
                this.consoleHandler("Could not connect to a peer network.");
                this.kill(true); // destroy provider but keep the read-only stream alive
            }
        });
        this.syncLocal = () => __awaiter(this, void 0, void 0, function* () {
            try {
                const local = yield getLocal(this.documentPath);
                if (local)
                    this._applyUpdate(local, { key: "local-sync" });
            }
            catch (e) {
                this.consoleHandler("get local error", e);
            }
        });
        this.saveToLocal = () => __awaiter(this, void 0, void 0, function* () {
            try {
                const currentDoc = this._encodeStateAsUpdate();
                setLocal(this.documentPath, currentDoc);
            }
            catch (e) {
                this.consoleHandler("set local error", e);
            }
        });
        this.deleteLocal = () => __awaiter(this, void 0, void 0, function* () {
            try {
                delLocal(this.documentPath);
            }
            catch (e) {
                this.consoleHandler("del local error", e);
            }
        });
        this.initiateHandler = () => {
            this.consoleHandler("FireProvider initiated!");
            this.awareness.on("update", this.awarenessUpdateHandler);
            // We will track the mesh document on Firestore to
            // keep track of selected peers
            this.trackMesh();
            this.doc.on(this.encodingVersion === 2 ? "updateV2" : "update", this.updateHandler);
            this.syncLocal(); // if there's any data in indexedDb, get and apply
        };
        this.trackData = () => {
            // Whenever there are changes to the firebase document
            // pull the changes and merge them to the current
            // yjs document
            if (this.unsubscribeData)
                this.unsubscribeData();
            this.unsubscribeData = onSnapshot(doc(this.db, this.documentPath), (docSnapshot) => __awaiter(this, void 0, void 0, function* () {
                if (docSnapshot.exists()) {
                    const data = docSnapshot.data();
                    if (data) {
                        this.firebaseDataLastUpdatedAt = new Date().getTime();
                        let content;
                        // A chunked save always writes content: null, so inline content is
                        // newer than any chunks (older clients never reset `chunked`).
                        if (data.content) {
                            content = data.content.toUint8Array();
                        }
                        else if (data.chunked) {
                            try {
                                content = yield this.readChunks(data.chunkCount);
                            }
                            catch (error) {
                                this.consoleHandler("Error fetching chunks", error);
                            }
                        }
                        if (content) {
                            const origin = "origin:firebase/update"; // make sure this does not coincide with UID
                            this._applyUpdate(content, origin);
                            // The saved state can itself carry a gap (a saver that missed an
                            // update); peers may still hold the missing piece.
                            if (hasPendingStructs(this.doc))
                                this.requestResync();
                        }
                    }
                    if (!this.ready) {
                        if (this.onReady) {
                            this.onReady();
                            this.ready = true;
                        }
                    }
                }
            }), (error) => {
                this.consoleHandler("Firestore sync error", error);
                if (error.code === "permission-denied") {
                    if (this.onDeleted)
                        this.onDeleted();
                }
            });
        };
        this.trackMesh = () => {
            if (this.unsubscribeMesh)
                this.unsubscribeMesh();
            this.unsubscribeMesh = onSnapshot(collection(this.db, `${this.documentPath}/instances`), (snapshot) => {
                this.clients = [];
                snapshot.forEach((doc) => {
                    this.clients.push(doc.id);
                });
                const mesh = createGraph(this.clients);
                // a -> b, c; a is the sender and b, c are receivers
                const receivers = mesh[this.uid]; // this user's receivers
                const senders = Object.keys(mesh).filter((v, i) => mesh[v] && mesh[v].length && mesh[v].includes(this.uid)); // this user's senders
                this.peersReceivers = this.connectToPeers(receivers, this.peersReceivers, true);
                this.peersSenders = this.connectToPeers(senders, this.peersSenders, false);
            }, (error) => {
                this.consoleHandler("Creating peer mesh error", error);
            });
        };
        this.handleLinkError = (error) => {
            if (error.code === "ERR_ICE_CONNECTION_FAILURE")
                this.iceFailures++;
            if (this.onLinkError)
                this.onLinkError(error);
        };
        /**
         * Replace the ICE servers used for peer links (e.g. add TURN once a
         * STUN-only mesh has proven unreachable). Existing links keep their
         * RTCPeerConnection config, so by default the mesh is rebuilt through
         * reconnect(), which re-creates this instance and every link.
         */
        this.setIceServers = (iceServers, reconnect = true) => {
            this.iceServers = iceServers && iceServers.length ? iceServers : DEFAULT_ICE_SERVERS;
            if (reconnect)
                this.reconnect();
        };
        /** Ask every connected peer to reconcile state vectors with us. */
        this.requestResync = () => {
            var _a, _b;
            const links = [
                ...Object.values((_a = this.peersRTC.receivers) !== null && _a !== void 0 ? _a : {}),
                ...Object.values((_b = this.peersRTC.senders) !== null && _b !== void 0 ? _b : {}),
            ];
            links.forEach((link) => link.sendSyncStep1());
        };
        this.reconnect = () => {
            if (this.recreateTimeout)
                clearTimeout(this.recreateTimeout);
            this.recreateTimeout = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
                this.consoleHandler("triggering reconnect", this.uid);
                this.destroy();
                this.init();
            }), 200);
        };
        this.trackConnections = () => __awaiter(this, void 0, void 0, function* () {
            const clients = this.clients.length;
            let connected = 0;
            Object.values(this.peersRTC.receivers).forEach((receiver) => {
                if (receiver.connection !== "closed")
                    connected++;
            });
            Object.values(this.peersRTC.senders).forEach((sender) => {
                if (sender.connection !== "closed")
                    connected++;
            });
            if (clients > 1 && connected <= 0) {
                // we have lost connection with all peers
                // trigger re-generation of the graph/mesh
                this.reconnect();
            }
        });
        this.connectToPeers = (newPeers, oldPeers, isCaller) => {
            if (!newPeers)
                return new Set([]);
            // We must:
            // 1. remove obselete peers
            // 2. add new peers
            // 3. no change to same peers
            const getNewPeers = refreshPeers(newPeers, oldPeers);
            const peersType = isCaller ? "receivers" : "senders";
            if (!this.peersRTC[peersType])
                this.peersRTC[peersType] = {};
            if (getNewPeers.obselete && getNewPeers.obselete.length) {
                // Old peers, remove them
                getNewPeers.obselete.forEach((peerUid) => __awaiter(this, void 0, void 0, function* () {
                    if (this.peersRTC[peersType][peerUid]) {
                        yield this.peersRTC[peersType][peerUid].destroy();
                        delete this.peersRTC[peersType][peerUid];
                    }
                }));
            }
            if (getNewPeers.new && getNewPeers.new.length) {
                // New peers, initiate new connection to them
                getNewPeers.new.forEach((peerUid) => __awaiter(this, void 0, void 0, function* () {
                    if (this.peersRTC[peersType][peerUid]) {
                        yield this.peersRTC[peersType][peerUid].destroy();
                        delete this.peersRTC[peersType][peerUid];
                    }
                    this.peersRTC[peersType][peerUid] = new WebRtc({
                        firebaseApp: this.firebaseApp,
                        ydoc: this.doc,
                        awareness: this.awareness,
                        instanceConnection: this.instanceConnection,
                        documentPath: this.documentPath,
                        uid: this.uid,
                        peerUid,
                        isCaller,
                        encodingVersion: this.encodingVersion,
                        iceServers: this.iceServers,
                    });
                }));
            }
            return new Set(newPeers);
        };
        this.sendDataToPeers = ({ from, message, data, }) => {
            if (this.peersRTC) {
                if (this.peersRTC.receivers) {
                    Object.keys(this.peersRTC.receivers).forEach((receiver) => {
                        if (receiver !== from) {
                            const rtc = this.peersRTC.receivers[receiver];
                            rtc.sendData({ message, data });
                        }
                    });
                }
                if (this.peersRTC.senders) {
                    Object.keys(this.peersRTC.senders).forEach((sender) => {
                        if (sender !== from) {
                            const rtc = this.peersRTC.senders[sender];
                            rtc.sendData({ message, data });
                        }
                    });
                }
            }
        };
        this.readChunks = (chunkCount) => __awaiter(this, void 0, void 0, function* () {
            if (typeof chunkCount !== "number" || !Number.isInteger(chunkCount) || chunkCount < 1) {
                throw new Error(`Invalid chunkCount: ${chunkCount}`);
            }
            const chunksCollectionRef = collection(this.db, this.documentPath, "yfire_chunks");
            const chunksSnapshot = yield getDocs(chunksCollectionRef);
            // Chunks beyond chunkCount are left over from an earlier, larger save.
            const chunks = chunksSnapshot.docs
                .map((doc) => ({
                index: parseInt(doc.id),
                content: doc.data().content.toUint8Array(),
            }))
                .filter((chunk) => chunk.index >= 0 && chunk.index < chunkCount)
                .sort((a, b) => a.index - b.index);
            if (chunks.length !== chunkCount) {
                throw new Error(`Expected ${chunkCount} chunks, found ${chunks.length}`);
            }
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.content.length, 0);
            const content = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                content.set(chunk.content, offset);
                offset += chunk.content.length;
            }
            return content;
        });
        this.saveToFirestore = () => __awaiter(this, void 0, void 0, function* () {
            // This save captures every change queued so far (the state is encoded below).
            this.firestoreQueuedSince = null;
            try {
                // current document to firestore
                const ref = doc(this.db, this.documentPath);
                const content = this._encodeStateAsUpdate();
                if (content.length > this.chunkThreshold) {
                    // Chunking required
                    const chunkCount = Math.ceil(content.length / this.chunkThreshold);
                    const chunksCollectionRef = collection(this.db, this.documentPath, "yfire_chunks");
                    // Write chunks
                    const promises = [];
                    for (let i = 0; i < chunkCount; i++) {
                        const start = i * this.chunkThreshold;
                        const end = start + this.chunkThreshold;
                        const chunk = content.slice(start, end);
                        const chunkRef = doc(chunksCollectionRef, i.toString());
                        promises.push(setDoc(chunkRef, {
                            content: Bytes.fromUint8Array(chunk),
                            index: i,
                        }));
                    }
                    yield Promise.all(promises);
                    // Update main document
                    yield setDoc(ref, {
                        chunked: true,
                        chunkCount: chunkCount,
                        updatedAt: serverTimestamp(),
                        content: null, // Clear main content
                    }, { merge: true });
                }
                else {
                    // No chunking needed
                    // Stale chunks are left in place; the loader ignores them once
                    // inline content is present.
                    yield setDoc(ref, Object.assign(Object.assign({}, this.documentMapper(Bytes.fromUint8Array(content))), { chunked: false }), { merge: true });
                }
                this.deleteLocal(); // We have successfully saved to Firestore, empty indexedDb for now
            }
            catch (error) {
                this.consoleHandler("error saving to firestore", error);
            }
            finally {
                if (this.onSaving)
                    this.onSaving(false);
            }
        });
        this.sendToFirestoreQueue = () => {
            // if cache settles down, save document to firebase
            if (this.firestoreTimeout)
                clearTimeout(this.firestoreTimeout); // kill other save processes first
            if (this.onSaving)
                this.onSaving(true);
            if (this.firestoreQueuedSince === null)
                this.firestoreQueuedSince = Date.now();
            this.firestoreTimeout = setTimeout(() => {
                var _a, _b;
                const now = Date.now();
                // With several active editors someone saves every few seconds, so
                // yielding alone can starve this client's save until the tab closes,
                // taking its updates with it.
                const deferral = (_a = this.maxFirestoreDeferral) !== null && _a !== void 0 ? _a : this.maxFirestoreWait * 4;
                if (now - this.firebaseDataLastUpdatedAt > this.maxFirestoreWait ||
                    now - ((_b = this.firestoreQueuedSince) !== null && _b !== void 0 ? _b : now) >= deferral) {
                    this.saveToFirestore();
                }
                else {
                    // A peer recently saved to firebase, let's wait a bit
                    this.sendToFirestoreQueue();
                }
            }, this.maxFirestoreWait);
        };
        this.sendCache = (from) => {
            this.sendDataToPeers({
                from,
                message: null,
                data: this.cache,
            });
            this.cache = null;
            this.cacheUpdateCount = 0;
            this.sendToFirestoreQueue(); // save to firestore
        };
        this.sendToQueue = ({ from, update }) => {
            if (from === this.uid) {
                // this update was from this user
                if (this.cacheTimeout)
                    clearTimeout(this.cacheTimeout);
                this.cache = this.cache ? this._mergeUpdates([this.cache, update]) : update;
                this.cacheUpdateCount++;
                if (this.cacheUpdateCount >= this.maxCacheUpdates) {
                    // if the cache was already merged 20 times (this.maxCacheUpdates), send
                    // the updates in cache to the peers
                    this.sendCache(from);
                }
                else {
                    // Wait to see if the user make other changes
                    // if the user does not make changes for the next 500ms
                    // send updates in cache to the peers
                    this.cacheTimeout = setTimeout(() => {
                        this.sendCache(from);
                    }, this.maxRTCWait);
                }
            }
            else {
                // this update was from a peer, not this user
                this.sendDataToPeers({
                    from,
                    message: null,
                    data: update,
                });
            }
        };
        this.updateHandler = (update, origin) => {
            // Origin can be of the following types
            // 1. User typed something -> origin: object
            // 2. User loaded something from local store -> origin: object
            // 3. User received update from a peer -> origin: string = peer uid
            // 4. User received update from Firestore -> origin: string = 'origin:firebase/update'
            // 5. Update triggered because user applied updates from the above sources -> origin: string = uid
            if (origin !== this.uid) {
                // We will not allow no. 5. to propagate any further
                // Apply updates received from no. 1 to 4. -> triggers no. 5
                this._applyUpdate(update, this.uid); // the third parameter sets the transaction-origin
                // Convert no. 1 and 2 to uid, because we want these to eventually trigger 'save' to Firestore
                // sendToQueue method will either:
                // 1. save origin:uid to Firestore (and send to peers through WebRtc)
                // 2. send updates from other origins through WebRtc only
                this.sendToQueue({
                    from: typeof origin === "string" ? origin : this.uid,
                    update,
                });
                this.saveToLocal(); // save data to local indexedDb
            }
        };
        this.awarenessUpdateHandler = ({ added, updated, removed, }, origin) => {
            const changedClients = added.concat(updated).concat(removed);
            this.sendDataToPeers({
                from: origin !== "local" ? origin : this.uid,
                message: "awareness",
                data: awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
            });
        };
        this.consoleHandler = (message, data = null) => {
            console.log("Provider:", this.documentPath, `this client: ${this.uid}`, message, data);
        };
        // use destroy directly if you don't need arguements
        // otherwise use kill
        this.destroy = () => {
            // we have to create a separate function here
            // because beforeunload only takes this.destroy
            // and not this.destroy() or with this.destroy(args)
            this.kill();
        };
        this.kill = (keepReadOnly = false) => {
            this.instanceConnection.destroy();
            removeEventListener("beforeunload", this.destroy);
            if (this.recreateTimeout)
                clearTimeout(this.recreateTimeout);
            if (this.cacheTimeout)
                clearTimeout(this.cacheTimeout);
            if (this.firestoreTimeout)
                clearTimeout(this.firestoreTimeout);
            this.doc.off(this.encodingVersion === 2 ? "updateV2" : "update", this.updateHandler);
            this.awareness.off("update", this.awarenessUpdateHandler);
            deleteInstance(this.db, this.documentPath, this.uid);
            if (this.unsubscribeData && !keepReadOnly) {
                this.unsubscribeData();
                delete this.unsubscribeData;
            }
            if (this.unsubscribeMesh) {
                this.unsubscribeMesh();
                delete this.unsubscribeMesh;
            }
            if (this.peersRTC) {
                if (this.peersRTC.receivers) {
                    Object.values(this.peersRTC.receivers).forEach((receiver) => receiver.destroy());
                }
                if (this.peersRTC.senders) {
                    Object.values(this.peersRTC.senders).forEach((sender) => sender.destroy());
                }
            }
            this.ready = false;
            super.destroy();
        };
        // Initializing values
        this.firebaseApp = firebaseApp;
        this.db = getFirestore(this.firebaseApp);
        this.doc = ydoc;
        this.documentPath = path;
        if (docMapper)
            this.documentMapper = docMapper;
        if (maxUpdatesThreshold)
            this.maxCacheUpdates = maxUpdatesThreshold;
        if (maxWaitTime)
            this.maxRTCWait = maxWaitTime;
        if (maxWaitFirestoreTime)
            this.maxFirestoreWait = maxWaitFirestoreTime;
        if (maxFirestoreDeferral)
            this.maxFirestoreDeferral = maxFirestoreDeferral;
        if (chunkThreshold)
            this.chunkThreshold = chunkThreshold;
        if (encodingVersion)
            this.encodingVersion = encodingVersion;
        if (iceServers && iceServers.length)
            this.iceServers = iceServers;
        this.awareness = new awarenessProtocol.Awareness(this.doc);
        // Initialize the provider
        const init = this.init();
    }
}
