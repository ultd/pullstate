import isEqual from'fast-deep-equal/es6';import React,{useRef,useState,useEffect,useContext}from'react';import produce$1,{enablePatches,produceWithPatches,produce,applyPatches}from'immer';function useStoreState(store, getSubState, deps) {
    const updateRef = useRef({ state: undefined, initialized: false });
    if (!updateRef.current.initialized) {
        updateRef.current.state = getSubState ? getSubState(store.getRawState()) : store.getRawState();
        updateRef.current.initialized = true;
    }
    const [, setUpdateTrigger] = useState(0);
    useEffect(() => {
        const effectState = { shouldUpdate: true };
        function update() {
            if (effectState.shouldUpdate) {
                const nextSubState = getSubState
                    ? getSubState(store.getRawState())
                    : store.getRawState();
                if (!isEqual(updateRef.current.state, nextSubState)) {
                    if (effectState.shouldUpdate) {
                        updateRef.current.state = nextSubState;
                        setUpdateTrigger((val) => val + 1);
                    }
                }
            }
        }
        store._addUpdateListener(update);
        return () => {
            effectState.shouldUpdate = false;
            store._removeUpdateListener(update);
        };
    }, deps !== null && deps !== void 0 ? deps : []);
    if (deps !== undefined) {
        const prevDeps = useRef(deps);
        if (!isEqual(deps, prevDeps)) {
            updateRef.current.state = getSubState(store.getRawState());
        }
    }
    return updateRef.current.state;
}let updateListenerOrd = 0;
function fastGet(obj, path) {
    return path.reduce((cur = obj, key) => {
        return cur[key];
    }, undefined);
}
function getSubStateFromPaths(store, paths) {
    const state = store.getRawState();
    const resp = [];
    for (const path of paths) {
        resp.push(fastGet(state, path));
    }
    return resp;
}
function useStoreStateOpt(store, paths) {
    const [subState, setSubState] = useState(() => getSubStateFromPaths(store, paths));
    const updateRef = useRef({
        shouldUpdate: true,
        onStoreUpdate: null,
        currentSubState: null,
        ordKey: `_${updateListenerOrd++}`,
    });
    updateRef.current.currentSubState = subState;
    if (updateRef.current.onStoreUpdate === null) {
        updateRef.current.onStoreUpdate = function onStoreUpdateOpt() {
            if (updateRef.current.shouldUpdate) {
                setSubState(getSubStateFromPaths(store, paths));
            }
        };
        store._addUpdateListenerOpt(updateRef.current.onStoreUpdate, updateRef.current.ordKey, paths);
    }
    useEffect(() => () => {
        updateRef.current.shouldUpdate = false;
        store._removeUpdateListenerOpt(updateRef.current.ordKey);
    }, []);
    return subState;
}function useLocalStore(initialState, deps) {
    const storeRef = useRef();
    if (storeRef.current == null) {
        storeRef.current = new Store(typeof initialState === "function" ? initialState() : initialState);
    }
    if (deps !== undefined) {
        const prevDeps = useRef(deps);
        if (!isEqual(deps, prevDeps)) {
            storeRef.current = new Store(typeof initialState === "function" ? initialState() : initialState);
        }
    }
    return storeRef.current;
}enablePatches();
function makeSubscriptionFunction(store, watch, listener) {
    let lastWatchState = watch(store.getRawState());
    return () => {
        const currentState = store.getRawState();
        const nextWatchState = watch(currentState);
        if (!isEqual(nextWatchState, lastWatchState)) {
            listener(nextWatchState, currentState, lastWatchState);
            lastWatchState = nextWatchState;
        }
    };
}
function makeReactionFunctionCreator(watch, reaction) {
    return (store) => {
        let lastWatchState = watch(store.getRawState());
        return (forceRun = false) => {
            const currentState = store.getRawState();
            const nextWatchState = watch(currentState);
            if (forceRun || !isEqual(nextWatchState, lastWatchState)) {
                if (store._optListenerCount > 0) {
                    const [nextState, patches, inversePatches] = produceWithPatches(currentState, (s) => reaction(nextWatchState, s, currentState, lastWatchState));
                    store._updateStateWithoutReaction(nextState);
                    lastWatchState = nextWatchState;
                    if (patches.length > 0) {
                        store._patchListeners.forEach((listener) => listener(patches, inversePatches));
                        return Object.keys(getChangedPathsFromPatches(patches));
                    }
                }
                else {
                    if (store._patchListeners.length > 0) {
                        const [nextState, patches, inversePatches] = produceWithPatches(currentState, (s) => reaction(nextWatchState, s, currentState, lastWatchState));
                        if (patches.length > 0) {
                            store._patchListeners.forEach((listener) => listener(patches, inversePatches));
                        }
                        store._updateStateWithoutReaction(nextState);
                    }
                    else {
                        store._updateStateWithoutReaction(produce(currentState, (s) => reaction(nextWatchState, s, currentState, lastWatchState)));
                    }
                    lastWatchState = nextWatchState;
                }
            }
            return [];
        };
    };
}
const optPathDivider = "~._.~";
class Store {
    constructor(initialState) {
        this.updateListeners = [];
        this.ssr = false;
        this.reactions = [];
        this.clientSubscriptions = [];
        this.reactionCreators = [];
        this.optimizedUpdateListeners = {};
        this.optimizedUpdateListenerPaths = {};
        this.optimizedListenerPropertyMap = {};
        this._optListenerCount = 0;
        this._patchListeners = [];
        this.currentState = initialState;
        this.initialState = initialState;
    }
    _setInternalOptions({ ssr, reactionCreators = [] }) {
        this.ssr = ssr;
        this.reactionCreators = reactionCreators;
        this.reactions = reactionCreators.map((rc) => rc(this));
    }
    _getReactionCreators() {
        return this.reactionCreators;
    }
    _instantiateReactions() {
        this.reactions = this.reactionCreators.map((rc) => rc(this));
    }
    _getInitialState() {
        return this.initialState;
    }
    _updateStateWithoutReaction(nextState) {
        this.currentState = nextState;
    }
    _updateState(nextState, updateKeyedPaths = []) {
        this.currentState = nextState;
        this.batchState = undefined;
        for (const runReaction of this.reactions) {
            updateKeyedPaths.push(...runReaction());
        }
        if (!this.ssr) {
            for (const runSubscription of this.clientSubscriptions) {
                runSubscription();
            }
            if (updateKeyedPaths.length > 0) {
                const updateOrds = new Set();
                for (const keyedPath of updateKeyedPaths) {
                    if (this.optimizedListenerPropertyMap[keyedPath]) {
                        for (const ord of this.optimizedListenerPropertyMap[keyedPath]) {
                            updateOrds.add(ord);
                        }
                    }
                }
                for (const ord of updateOrds.values()) {
                    if (this.optimizedUpdateListeners[ord]) {
                        this.optimizedUpdateListeners[ord]();
                    }
                }
            }
            this.updateListeners.forEach((listener) => listener());
        }
    }
    _addUpdateListener(listener) {
        this.updateListeners.push(listener);
    }
    _addUpdateListenerOpt(listener, ordKey, paths) {
        this.optimizedUpdateListeners[ordKey] = listener;
        const listenerPathsKeyed = paths.map((path) => path.join(optPathDivider));
        this.optimizedUpdateListenerPaths[ordKey] = listenerPathsKeyed;
        for (const keyedPath of listenerPathsKeyed) {
            if (this.optimizedListenerPropertyMap[keyedPath] == null) {
                this.optimizedListenerPropertyMap[keyedPath] = [ordKey];
            }
            else {
                this.optimizedListenerPropertyMap[keyedPath].push(ordKey);
            }
        }
        this._optListenerCount++;
    }
    _removeUpdateListener(listener) {
        this.updateListeners = this.updateListeners.filter((f) => f !== listener);
    }
    _removeUpdateListenerOpt(ordKey) {
        const listenerPathsKeyed = this.optimizedUpdateListenerPaths[ordKey];
        for (const keyedPath of listenerPathsKeyed) {
            this.optimizedListenerPropertyMap[keyedPath] = this.optimizedListenerPropertyMap[keyedPath].filter((ord) => ord !== ordKey);
        }
        delete this.optimizedUpdateListenerPaths[ordKey];
        delete this.optimizedUpdateListeners[ordKey];
        this._optListenerCount--;
    }
    listenToPatches(patchListener) {
        this._patchListeners.push(patchListener);
        return () => {
            this._patchListeners = this._patchListeners.filter((f) => f !== patchListener);
        };
    }
    subscribe(watch, listener) {
        if (!this.ssr) {
            const func = makeSubscriptionFunction(this, watch, listener);
            this.clientSubscriptions.push(func);
            return () => {
                this.clientSubscriptions = this.clientSubscriptions.filter((f) => f !== func);
            };
        }
        return () => {
            console.warn(`Pullstate: Subscriptions made on the server side are not registered - so therefor this call to unsubscribe does nothing.`);
        };
    }
    createReaction(watch, reaction, { runNow = false, runNowWithSideEffects = false } = {}) {
        const creator = makeReactionFunctionCreator(watch, reaction);
        this.reactionCreators.push(creator);
        const func = creator(this);
        this.reactions.push(func);
        if (runNow || runNowWithSideEffects) {
            func(true);
            if (runNowWithSideEffects && !this.ssr) {
                this._updateState(this.currentState);
            }
        }
        return () => {
            this.reactions = this.reactions.filter((f) => f !== func);
        };
    }
    getRawState() {
        if (this.batchState !== undefined) {
            return this.batchState;
        }
        else {
            return this.currentState;
        }
    }
    useState(getSubState, deps) {
        return useStoreState(this, getSubState, deps);
    }
    useLocalCopyInitial(deps) {
        return useLocalStore(() => this.initialState, deps);
    }
    useLocalCopySnapshot(deps) {
        return useLocalStore(this.currentState, deps);
    }
    update(updater, patchesCallback) {
        update(this, updater, patchesCallback);
    }
    replace(newState) {
        this._updateState(newState);
    }
    applyPatches(patches) {
        applyPatchesToStore(this, patches);
    }
}
function applyPatchesToStore(store, patches) {
    const currentState = store.getRawState();
    const nextState = applyPatches(currentState, patches);
    if (nextState !== currentState) {
        store._updateState(nextState, Object.keys(getChangedPathsFromPatches(patches)));
    }
}
function getChangedPathsFromPatches(changePatches, prev = {}) {
    for (const patch of changePatches) {
        let curKey;
        for (const p of patch.path) {
            if (curKey) {
                curKey = `${curKey}${optPathDivider}${p}`;
            }
            else {
                curKey = p;
            }
            prev[curKey] = 1;
        }
    }
    return prev;
}
function runUpdates(currentState, updater, func) {
    return func
        ? produceWithPatches(currentState, (s) => updater(s, currentState))
        : updater.reduce(([nextState, patches, inversePatches], currentValue) => {
            const resp = produceWithPatches(nextState, (s) => currentValue(s, nextState));
            patches.push(...resp[1]);
            inversePatches.push(...resp[2]);
            return [resp[0], patches, inversePatches];
        }, [currentState, [], []]);
}
function update(store, updater, patchesCallback) {
    const currentState = store.getRawState();
    const func = typeof updater === "function";
    if (store._optListenerCount > 0) {
        const [nextState, patches, inversePatches] = runUpdates(currentState, updater, func);
        if (patches.length > 0) {
            if (patchesCallback) {
                patchesCallback(patches, inversePatches);
            }
            store._patchListeners.forEach((listener) => listener(patches, inversePatches));
            store._updateState(nextState, Object.keys(getChangedPathsFromPatches(patches)));
        }
    }
    else {
        let nextState;
        if (store._patchListeners.length > 0 || patchesCallback) {
            const [ns, patches, inversePatches] = runUpdates(currentState, updater, func);
            if (patches.length > 0) {
                if (patchesCallback) {
                    patchesCallback(patches, inversePatches);
                }
                store._patchListeners.forEach((listener) => listener(patches, inversePatches));
            }
            nextState = ns;
        }
        else {
            nextState = produce(currentState, (s) => func
                ? updater(s, currentState)
                : updater.reduce((previousValue, currentUpdater) => {
                    return produce(previousValue, (s) => currentUpdater(s, previousValue));
                }, currentState));
        }
        if (nextState !== currentState) {
            store._updateState(nextState);
        }
    }
}function InjectStoreState({ store, on = s => s, children, }) {
    const state = useStoreState(store, on);
    return children(state);
}var EAsyncEndTags;
(function (EAsyncEndTags) {
    EAsyncEndTags["THREW_ERROR"] = "THREW_ERROR";
    EAsyncEndTags["RETURNED_ERROR"] = "RETURNED_ERROR";
    EAsyncEndTags["UNFINISHED"] = "UNFINISHED";
    EAsyncEndTags["DORMANT"] = "DORMANT";
})(EAsyncEndTags || (EAsyncEndTags = {}));
var EPostActionContext;
(function (EPostActionContext) {
    EPostActionContext["WATCH_HIT_CACHE"] = "WATCH_HIT_CACHE";
    EPostActionContext["BECKON_HIT_CACHE"] = "BECKON_HIT_CACHE";
    EPostActionContext["RUN_HIT_CACHE"] = "RUN_HIT_CACHE";
    EPostActionContext["READ_HIT_CACHE"] = "READ_HIT_CACHE";
    EPostActionContext["READ_RUN"] = "READ_RUN";
    EPostActionContext["SHORT_CIRCUIT"] = "SHORT_CIRCUIT";
    EPostActionContext["DIRECT_RUN"] = "DIRECT_RUN";
    EPostActionContext["BECKON_RUN"] = "BECKON_RUN";
    EPostActionContext["CACHE_UPDATE"] = "CACHE_UPDATE";
})(EPostActionContext || (EPostActionContext = {}));const clientAsyncCache = {
    listeners: {},
    results: {},
    actions: {},
    actionOrd: {}
};
let asyncCreationOrdinal = 0;
function keyFromObject(json) {
    if (json === null) {
        return "(n)";
    }
    const typeOf = typeof json;
    if (typeOf !== "object") {
        if (typeOf === "undefined") {
            return "(u)";
        }
        else if (typeOf === "string") {
            return ":" + json + ";";
        }
        else if (typeOf === "boolean" || typeOf === "number") {
            return "(" + json + ")";
        }
    }
    let prefix = "{";
    for (const key of Object.keys(json).sort()) {
        prefix += key + keyFromObject(json[key]);
    }
    return prefix + "}";
}
function notifyListeners(key) {
    if (clientAsyncCache.listeners.hasOwnProperty(key)) {
        for (const watchId of Object.keys(clientAsyncCache.listeners[key])) {
            clientAsyncCache.listeners[key][watchId]();
        }
    }
}
function clearActionCache(key, clearPending = true) {
    if (clearPending && clientAsyncCache.actionOrd.hasOwnProperty(key)) {
        clientAsyncCache.actionOrd[key] += 1;
    }
    delete clientAsyncCache.results[key];
    notifyListeners(key);
}
function actionOrdUpdate(cache, key) {
    if (!cache.actionOrd.hasOwnProperty(key)) {
        cache.actionOrd[key] = 0;
    }
    else {
        cache.actionOrd[key] += 1;
    }
    return cache.actionOrd[key];
}
function successResult(payload = null, tags = [], message = "") {
    return {
        payload,
        tags,
        message,
        error: false
    };
}
function errorResult(tags = [], message = "", errorPayload) {
    return {
        payload: null,
        tags: [EAsyncEndTags.RETURNED_ERROR, ...tags],
        message,
        error: true,
        errorPayload,
    };
}
class PullstateAsyncError extends Error {
    constructor(message, tags) {
        super(message);
        this.tags = tags;
    }
}
let storeErrorProxy;
try {
    storeErrorProxy = new Proxy({}, {
        get: function (obj, prop) {
            throw new Error(`Pullstate: Trying to access store (${String(prop)}) inside async actions without the correct usage or setup.
If this error occurred on the server:
* If using run(), make use of your created instance for this request: instance.runAsyncAction()
* If using read(), useWatch(), useBeckon() etc. - make sure you have properly set up your <PullstateProvider/>

If this error occurred on the client:
* Make sure you have created your "pullstateCore" object with all your stores, using createPullstateCore(), and are making use of instantiate() before rendering.`);
        }
    });
}
catch {
    storeErrorProxy = {};
}
const startedButUnfinishedResult = [
    true,
    false,
    {
        message: "",
        tags: [EAsyncEndTags.UNFINISHED],
        error: true,
        payload: null
    },
    false,
    -1
];
function createAsyncActionDirect(action, options = {}) {
    return createAsyncAction(async (args) => {
        return successResult(await action(args));
    }, options);
}
function createAsyncAction(action, { forceContext = false, shortCircuitHook, cacheBreakHook, postActionHook, subsetKey } = {}) {
    const ordinal = asyncCreationOrdinal++;
    const onServer = typeof window === "undefined";
    function _createKey(args, customKey) {
        if (customKey != null) {
            return `${ordinal}-c-${customKey}`;
        }
        if (subsetKey !== undefined) {
            return `${ordinal}-${keyFromObject(subsetKey(args))}`;
        }
        return `${ordinal}-${keyFromObject(args)}`;
    }
    let cacheBreakWatcher = {};
    let watchIdOrd = 0;
    const shouldUpdate = {};
    function runPostActionHook(result, args, stores, context) {
        if (postActionHook !== undefined) {
            postActionHook({ args, result, stores, context });
        }
    }
    function getCachedResult(key, cache, args, stores, context, postActionEnabled, cacheBreakEnabled, fromListener) {
        if (cache.results.hasOwnProperty(key)) {
            const cacheBreakLoop = cacheBreakWatcher.hasOwnProperty(key) && cacheBreakWatcher[key] > 2;
            if (cache.results[key][1] &&
                cacheBreakEnabled &&
                cacheBreakHook !== undefined &&
                cacheBreakHook({
                    args,
                    result: cache.results[key][2],
                    stores,
                    timeCached: cache.results[key][4]
                }) &&
                !cacheBreakLoop) {
                if (cacheBreakWatcher.hasOwnProperty(key)) {
                    cacheBreakWatcher[key]++;
                }
                else {
                    cacheBreakWatcher[key] = 1;
                }
                delete cache.results[key];
            }
            else {
                if (cacheBreakLoop) {
                    console.error(`[${key}] Pullstate detected an infinite loop caused by cacheBreakHook()
returning true too often (breaking cache as soon as your action is resolving - hence
causing beckoned actions to run the action again) in one of your AsyncActions - Pullstate prevented
further looping. Fix in your cacheBreakHook() is needed.`);
                }
                else {
                    cacheBreakWatcher[key] = 0;
                }
                if (postActionEnabled && cache.results[key][1] && !fromListener) {
                    runPostActionHook(cache.results[key][2], args, stores, context);
                }
                return cache.results[key];
            }
        }
        return undefined;
    }
    function createInternalAction(key, cache, args, stores, currentActionOrd, postActionEnabled, context) {
        return () => action(args, stores)
            .then((resp) => {
            if (currentActionOrd === cache.actionOrd[key]) {
                if (postActionEnabled) {
                    runPostActionHook(resp, args, stores, context);
                }
                cache.results[key] = [true, true, resp, false, Date.now()];
            }
            return resp;
        })
            .catch((e) => {
            console.error(e);
            const result = {
                payload: null,
                error: true,
                tags: [EAsyncEndTags.THREW_ERROR],
                message: e.message
            };
            if (currentActionOrd === cache.actionOrd[key]) {
                if (postActionEnabled) {
                    runPostActionHook(result, args, stores, context);
                }
                cache.results[key] = [true, true, result, false, Date.now()];
            }
            return result;
        })
            .then((resp) => {
            if (currentActionOrd === cache.actionOrd[key]) {
                delete cache.actions[key];
                if (!onServer) {
                    notifyListeners(key);
                }
            }
            return resp;
        });
    }
    function checkKeyAndReturnResponse(key, cache, initiate, ssr, args, stores, fromListener = false, postActionEnabled = true, cacheBreakEnabled = true, holdingResult = undefined) {
        const cached = getCachedResult(key, cache, args, stores, initiate ? EPostActionContext.BECKON_HIT_CACHE : EPostActionContext.WATCH_HIT_CACHE, postActionEnabled, cacheBreakEnabled, fromListener);
        if (cached) {
            return cached;
        }
        if (!cache.actions.hasOwnProperty(key)) {
            const currentActionOrd = actionOrdUpdate(cache, key);
            if (initiate) {
                if (shortCircuitHook !== undefined) {
                    const shortCircuitResponse = shortCircuitHook({ args, stores });
                    if (shortCircuitResponse !== false) {
                        runPostActionHook(shortCircuitResponse, args, stores, EPostActionContext.SHORT_CIRCUIT);
                        cache.results[key] = [true, true, shortCircuitResponse, false, Date.now()];
                        return cache.results[key];
                    }
                }
                if (ssr || !onServer) {
                    cache.actions[key] = createInternalAction(key, cache, args, stores, currentActionOrd, postActionEnabled, EPostActionContext.BECKON_RUN);
                }
                if (!onServer) {
                    cache.actions[key]();
                    cache.results[key] = startedButUnfinishedResult;
                }
                else {
                    return startedButUnfinishedResult;
                }
            }
            else {
                const resp = [
                    false,
                    false,
                    {
                        message: "",
                        tags: [EAsyncEndTags.UNFINISHED],
                        error: true,
                        payload: null
                    },
                    false,
                    -1
                ];
                if (!onServer) {
                    cache.results[key] = resp;
                }
                if (holdingResult) {
                    const response = [...holdingResult];
                    response[3] = true;
                    return response;
                }
                return resp;
            }
        }
        if (holdingResult) {
            const response = [...holdingResult];
            response[3] = true;
            return response;
        }
        return startedButUnfinishedResult;
    }
    const read = (args = {}, { cacheBreakEnabled = true, postActionEnabled = true, key: customKey } = {}) => {
        const key = _createKey(args, customKey);
        const cache = onServer ? useContext(PullstateContext)._asyncCache : clientAsyncCache;
        const stores = onServer || forceContext
            ? useContext(PullstateContext).stores
            : clientStores.loaded
                ? clientStores.stores
                : storeErrorProxy;
        const cached = getCachedResult(key, cache, args, stores, EPostActionContext.READ_HIT_CACHE, postActionEnabled, cacheBreakEnabled, false);
        if (cached) {
            if (!cached[2].error) {
                return cached[2].payload;
            }
            else {
                throw new PullstateAsyncError(cached[2].message, cached[2].tags);
            }
        }
        if (!cache.actions.hasOwnProperty(key)) {
            if (shortCircuitHook !== undefined) {
                const shortCircuitResponse = shortCircuitHook({ args, stores });
                if (shortCircuitResponse !== false) {
                    runPostActionHook(shortCircuitResponse, args, stores, EPostActionContext.SHORT_CIRCUIT);
                    cache.results[key] = [true, true, shortCircuitResponse, false, Date.now()];
                    if (!shortCircuitResponse.error) {
                        return shortCircuitResponse.payload;
                    }
                    else {
                        throw new PullstateAsyncError(shortCircuitResponse.message, shortCircuitResponse.tags);
                    }
                }
            }
            const currentActionOrd = actionOrdUpdate(cache, key);
            cache.actions[key] = createInternalAction(key, cache, args, stores, currentActionOrd, postActionEnabled, EPostActionContext.READ_RUN);
            if (onServer) {
                throw new Error(`Pullstate Async Action: action.read() : Resolve all async state for Suspense actions before Server-side render ( make use of instance.runAsyncAction() )`);
            }
            throw cache.actions[key]();
        }
        if (onServer) {
            throw new Error(`Pullstate Async Action: action.read() : Resolve all async state for Suspense actions before Server-side render ( make use of instance.runAsyncAction() )`);
        }
        const watchOrd = watchIdOrd++;
        throw new Promise((resolve) => {
            cache.listeners[key][watchOrd] = () => {
                delete cache.listeners[key][watchOrd];
                resolve();
            };
        });
    };
    const useWatch = (args = {}, { initiate = false, ssr = true, postActionEnabled = false, cacheBreakEnabled = false, holdPrevious = false, dormant = false, key: customKey } = {}) => {
        const responseRef = useRef();
        const prevKeyRef = useRef(".");
        const key = dormant ? "." : _createKey(args, customKey);
        let watchId = useRef(-1);
        if (watchId.current === -1) {
            watchId.current = watchIdOrd++;
        }
        if (!dormant) {
            if (!shouldUpdate.hasOwnProperty(key)) {
                shouldUpdate[key] = {
                    [watchId.current]: true
                };
            }
            else {
                shouldUpdate[key][watchId.current] = true;
            }
        }
        const cache = onServer ? useContext(PullstateContext)._asyncCache : clientAsyncCache;
        const stores = onServer || forceContext
            ? useContext(PullstateContext).stores
            : clientStores.loaded
                ? clientStores.stores
                : storeErrorProxy;
        if (!onServer) {
            const onAsyncStateChanged = () => {
                if (shouldUpdate[key][watchId.current] && !isEqual(responseRef.current, cache.results[key])) {
                    responseRef.current = checkKeyAndReturnResponse(key, cache, initiate, ssr, args, stores, true, postActionEnabled, cacheBreakEnabled);
                    setWatchUpdate((prev) => {
                        return prev + 1;
                    });
                }
            };
            if (!dormant) {
                if (!cache.listeners.hasOwnProperty(key)) {
                    cache.listeners[key] = {};
                }
                cache.listeners[key][watchId.current] = onAsyncStateChanged;
                shouldUpdate[key][watchId.current] = true;
            }
            useEffect(() => {
                if (!dormant) {
                    cache.listeners[key][watchId.current] = onAsyncStateChanged;
                    shouldUpdate[key][watchId.current] = true;
                }
                return () => {
                    if (!dormant) {
                        delete cache.listeners[key][watchId.current];
                        shouldUpdate[key][watchId.current] = false;
                    }
                };
            }, [key]);
        }
        const [_, setWatchUpdate] = useState(0);
        if (dormant) {
            responseRef.current =
                holdPrevious && responseRef.current && responseRef.current[1]
                    ? responseRef.current
                    : [
                        false,
                        false,
                        {
                            message: "",
                            tags: [EAsyncEndTags.DORMANT],
                            error: true,
                            payload: null
                        },
                        false,
                        -1
                    ];
            prevKeyRef.current = ".";
        }
        else if (prevKeyRef.current !== key) {
            if (prevKeyRef.current !== null && shouldUpdate.hasOwnProperty(prevKeyRef.current)) {
                delete cache.listeners[prevKeyRef.current][watchId.current];
                shouldUpdate[prevKeyRef.current][watchId.current] = false;
            }
            prevKeyRef.current = key;
            responseRef.current = checkKeyAndReturnResponse(key, cache, initiate, ssr, args, stores, false, postActionEnabled, cacheBreakEnabled, holdPrevious && responseRef.current && responseRef.current[1] ? responseRef.current : undefined);
        }
        return responseRef.current;
    };
    const useBeckon = (args = {}, { ssr = true, postActionEnabled = true, cacheBreakEnabled = true, holdPrevious = false, dormant = false } = {}) => {
        const result = useWatch(args, { initiate: true, ssr, postActionEnabled, cacheBreakEnabled, holdPrevious, dormant });
        return [result[1], result[2], result[3]];
    };
    const run = async (args = {}, { treatAsUpdate = false, ignoreShortCircuit = false, respectCache = false, key: customKey, _asyncCache = clientAsyncCache, _stores = clientStores.loaded ? clientStores.stores : storeErrorProxy } = {}) => {
        const key = _createKey(args, customKey);
        if (respectCache) {
            const cached = getCachedResult(key, _asyncCache, args, _stores, EPostActionContext.RUN_HIT_CACHE, true, true, false);
            if (cached) {
                if (!cached[1]) {
                    const watchOrd = watchIdOrd++;
                    if (!_asyncCache.listeners.hasOwnProperty(key)) {
                        _asyncCache.listeners[key] = {};
                    }
                    return new Promise((resolve) => {
                        _asyncCache.listeners[key][watchOrd] = () => {
                            const [, finished, resp] = _asyncCache.results[key];
                            if (finished) {
                                delete _asyncCache.listeners[key][watchOrd];
                                resolve(resp);
                            }
                        };
                    });
                }
                return cached[2];
            }
        }
        if (!ignoreShortCircuit && shortCircuitHook !== undefined) {
            const shortCircuitResponse = shortCircuitHook({ args, stores: _stores });
            if (shortCircuitResponse !== false) {
                _asyncCache.results[key] = [true, true, shortCircuitResponse, false, Date.now()];
                runPostActionHook(shortCircuitResponse, args, _stores, EPostActionContext.SHORT_CIRCUIT);
                notifyListeners(key);
                return shortCircuitResponse;
            }
        }
        const [, prevFinished, prevResp, prevUpdate, prevCacheTime] = _asyncCache.results[key] || [
            false,
            false,
            {
                error: true,
                message: "",
                payload: null,
                tags: [EAsyncEndTags.UNFINISHED]
            },
            false,
            -1
        ];
        if (prevFinished && treatAsUpdate) {
            _asyncCache.results[key] = [true, true, prevResp, true, prevCacheTime];
        }
        else {
            _asyncCache.results[key] = [
                true,
                false,
                {
                    error: true,
                    message: "",
                    payload: null,
                    tags: [EAsyncEndTags.UNFINISHED]
                },
                false,
                -1
            ];
        }
        let currentActionOrd = actionOrdUpdate(_asyncCache, key);
        _asyncCache.actions[key] = createInternalAction(key, _asyncCache, args, _stores, currentActionOrd, true, EPostActionContext.DIRECT_RUN);
        notifyListeners(key);
        return _asyncCache.actions[key]();
    };
    const clearCache = (args = {}, customKey) => {
        const key = _createKey(args, customKey);
        clearActionCache(key);
    };
    const clearAllCache = () => {
        for (const key of Object.keys(clientAsyncCache.actionOrd)) {
            if (key.startsWith(`${ordinal}-`)) {
                clearActionCache(key);
            }
        }
    };
    const clearAllUnwatchedCache = () => {
        for (const key of Object.keys(shouldUpdate)) {
            if (!Object.values(shouldUpdate[key]).some((su) => su)) {
                delete shouldUpdate[key];
                clearActionCache(key, false);
            }
        }
    };
    const setCached = (args, result, options) => {
        const { notify = true, key: customKey } = options || {};
        const key = _createKey(args, customKey);
        const cache = onServer ? useContext(PullstateContext)._asyncCache : clientAsyncCache;
        cache.results[key] = [true, true, result, false, Date.now()];
        if (notify) {
            notifyListeners(key);
        }
    };
    const setCachedPayload = (args, payload, options) => {
        return setCached(args, successResult(payload), options);
    };
    const updateCached = (args, updater, options) => {
        const { notify = true, resetTimeCached = true, runPostActionHook: postAction = false, key: customKey } = options || {};
        const key = _createKey(args, customKey);
        const cache = onServer ? useContext(PullstateContext)._asyncCache : clientAsyncCache;
        if (cache.results.hasOwnProperty(key) && !cache.results[key][2].error) {
            const currentCached = cache.results[key][2].payload;
            const newResult = {
                payload: produce$1(currentCached, (s) => updater(s, currentCached)),
                error: false,
                message: cache.results[key][2].message,
                tags: cache.results[key][2].tags
            };
            if (postAction) {
                runPostActionHook(newResult, args, clientStores.loaded ? clientStores.stores : storeErrorProxy, EPostActionContext.CACHE_UPDATE);
            }
            cache.results[key] = [
                true,
                true,
                newResult,
                cache.results[key][3],
                resetTimeCached ? Date.now() : cache.results[key][4]
            ];
            if (notify) {
                notifyListeners(key);
            }
        }
    };
    const getCached = (args = {}, options) => {
        const { checkCacheBreak = false, key: customKey } = options || {};
        const key = _createKey(args, customKey);
        let cacheBreakable = false;
        const cache = onServer ? useContext(PullstateContext)._asyncCache : clientAsyncCache;
        if (cache.results.hasOwnProperty(key)) {
            if (checkCacheBreak && cacheBreakHook !== undefined) {
                const stores = onServer
                    ? useContext(PullstateContext).stores
                    : clientStores.loaded
                        ? clientStores.stores
                        : storeErrorProxy;
                if (cacheBreakHook({
                    args,
                    result: cache.results[key][2],
                    stores,
                    timeCached: cache.results[key][4]
                })) {
                    cacheBreakable = true;
                }
            }
            const [started, finished, result, updating, timeCached] = cache.results[key];
            return {
                started,
                finished,
                result: result,
                existed: true,
                cacheBreakable,
                updating,
                timeCached
            };
        }
        else {
            return {
                started: false,
                finished: false,
                result: {
                    message: "",
                    tags: [EAsyncEndTags.UNFINISHED],
                    error: true,
                    payload: null
                },
                updating: false,
                existed: false,
                cacheBreakable,
                timeCached: -1
            };
        }
    };
    let delayedRunActionTimeout;
    const delayedRun = (args = {}, { clearOldRun = true, delay, immediateIfCached = true, ...otherRunOptions }) => {
        if (clearOldRun) {
            clearTimeout(delayedRunActionTimeout);
        }
        if (immediateIfCached) {
            const { finished, cacheBreakable } = getCached(args, { checkCacheBreak: true });
            if (finished && !cacheBreakable) {
                run(args, otherRunOptions);
                return () => {
                };
            }
        }
        let ref = { cancelled: false };
        delayedRunActionTimeout = setTimeout(() => {
            if (!ref.cancelled) {
                run(args, otherRunOptions);
            }
        }, delay);
        return () => {
            ref.cancelled = true;
        };
    };
    const use = (args = {}, { initiate = true, ssr = true, postActionEnabled, cacheBreakEnabled, holdPrevious = false, dormant = false, key, onSuccess } = {}) => {
        if (postActionEnabled == null) {
            postActionEnabled = initiate;
        }
        if (cacheBreakEnabled == null) {
            cacheBreakEnabled = initiate;
        }
        const raw = useWatch(args, { initiate, ssr, postActionEnabled, cacheBreakEnabled, holdPrevious, dormant, key });
        const [isStarted, isFinished, result, isUpdating] = raw;
        const isSuccess = isFinished && !result.error;
        const isFailure = isFinished && result.error;
        if (onSuccess) {
            useEffect(() => {
                if (isSuccess && !dormant) {
                    onSuccess(result.payload, args);
                }
            }, [isSuccess]);
        }
        const renderPayload = (func) => {
            if (!result.error) {
                return func(result.payload);
            }
            return React.Fragment;
        };
        return {
            isStarted,
            isFinished,
            isUpdating,
            isSuccess,
            isFailure,
            isLoading: isStarted && (!isFinished || isUpdating),
            endTags: result.tags,
            error: result.error,
            payload: result.payload,
            renderPayload,
            message: result.message,
            raw,
            execute: (runOptions) => run(args, runOptions),
            clearCached: () => clearCache(args),
            setCached: (response, options) => {
                setCached(args, response, options);
            },
            setCachedPayload: (payload, options) => {
                setCachedPayload(args, payload, options);
            },
            updateCached: (updater, options) => {
                updateCached(args, updater, options);
            }
        };
    };
    const useDefer = (inputs = {}) => {
        const [key, setKey] = useState(() => inputs.key ? inputs.key : _createKey({}));
        const initialResponse = use({}, {
            ...inputs,
            key,
            initiate: false
        });
        return {
            ...initialResponse,
            clearCached: () => {
                clearCache({}, key);
            },
            setCached: (response, options = {}) => {
                options.key = key;
                setCached({}, response, options);
            },
            setCachedPayload: (payload, options = {}) => {
                options.key = key;
                setCachedPayload({}, payload, options);
            },
            updateCached: (updater, options = {}) => {
                options.key = key;
                updateCached({}, updater, options);
            },
            execute: (args = {}, runOptions) => {
                var _a;
                const executionKey = (_a = inputs.key) !== null && _a !== void 0 ? _a : _createKey(args);
                setKey(executionKey);
                return run(args, { ...runOptions, key: executionKey }).then(resp => {
                    if (inputs.clearOnSuccess) {
                        clearCache({}, executionKey);
                    }
                    return resp;
                });
            }
        };
    };
    return {
        use,
        useDefer,
        read,
        useBeckon,
        useWatch,
        run,
        delayedRun,
        clearCache,
        clearAllCache,
        clearAllUnwatchedCache,
        getCached,
        setCached,
        setCachedPayload,
        updateCached
    };
}const PullstateContext = React.createContext(null);
const PullstateProvider = ({ instance, children, }) => {
    return React.createElement(PullstateContext.Provider, { value: instance }, children);
};
let singleton = null;
const clientStores = {
    internalClientStores: true,
    loaded: false,
    stores: {},
};
class PullstateSingleton {
    constructor(allStores, options = {}) {
        this.options = {};
        if (singleton !== null) {
            console.error(`Pullstate: createPullstate() - Should not be creating the core Pullstate class more than once! In order to re-use pull state, you need to call instantiate() on your already created object.`);
        }
        singleton = this;
        clientStores.stores = allStores;
        clientStores.loaded = true;
        this.options = options;
    }
    instantiate({ hydrateSnapshot, ssr = false, } = {}) {
        if (!ssr) {
            const instantiated = new PullstateInstance(clientStores.stores, false);
            if (hydrateSnapshot != null) {
                instantiated.hydrateFromSnapshot(hydrateSnapshot);
            }
            instantiated.instantiateReactions();
            return instantiated;
        }
        const newStores = {};
        for (const storeName of Object.keys(clientStores.stores)) {
            if (hydrateSnapshot == null) {
                newStores[storeName] = new Store(clientStores.stores[storeName]._getInitialState());
            }
            else if (hydrateSnapshot.hasOwnProperty(storeName)) {
                newStores[storeName] = new Store(hydrateSnapshot.allState[storeName]);
            }
            else {
                newStores[storeName] = new Store(clientStores.stores[storeName]._getInitialState());
                console.warn(`Pullstate (instantiate): store [${storeName}] didn't hydrate any state (data was non-existent on hydration object)`);
            }
            newStores[storeName]._setInternalOptions({
                ssr,
                reactionCreators: clientStores.stores[storeName]._getReactionCreators(),
            });
        }
        return new PullstateInstance(newStores, true);
    }
    useStores() {
        return useStores();
    }
    useInstance() {
        return useInstance();
    }
    createAsyncActionDirect(action, options = {}) {
        return createAsyncActionDirect(action, options);
    }
    createAsyncAction(action, options = {}) {
        var _a;
        if (((_a = this.options.asyncActions) === null || _a === void 0 ? void 0 : _a.defaultCachingSeconds) && !options.cacheBreakHook) {
            options.cacheBreakHook = (inputs) => inputs.timeCached < Date.now() - this.options.asyncActions.defaultCachingSeconds * 1000;
        }
        return createAsyncAction(action, options);
    }
}
class PullstateInstance {
    constructor(allStores, ssr) {
        this._ssr = false;
        this._stores = {};
        this._asyncCache = {
            listeners: {},
            results: {},
            actions: {},
            actionOrd: {},
        };
        this._stores = allStores;
        this._ssr = ssr;
    }
    getAllUnresolvedAsyncActions() {
        return Object.keys(this._asyncCache.actions).map((key) => this._asyncCache.actions[key]());
    }
    instantiateReactions() {
        for (const storeName of Object.keys(this._stores)) {
            this._stores[storeName]._instantiateReactions();
        }
    }
    getPullstateSnapshot() {
        const allState = {};
        for (const storeName of Object.keys(this._stores)) {
            allState[storeName] = this._stores[storeName].getRawState();
        }
        return { allState, asyncResults: this._asyncCache.results, asyncActionOrd: this._asyncCache.actionOrd };
    }
    async resolveAsyncState() {
        const promises = this.getAllUnresolvedAsyncActions();
        await Promise.all(promises);
    }
    hasAsyncStateToResolve() {
        return Object.keys(this._asyncCache.actions).length > 0;
    }
    get stores() {
        return this._stores;
    }
    async runAsyncAction(asyncAction, args = {}, runOptions = {}) {
        if (this._ssr) {
            runOptions._asyncCache = this._asyncCache;
            runOptions._stores = this._stores;
        }
        return await asyncAction.run(args, runOptions);
    }
    hydrateFromSnapshot(snapshot) {
        for (const storeName of Object.keys(this._stores)) {
            if (snapshot.allState.hasOwnProperty(storeName)) {
                this._stores[storeName]._updateState(snapshot.allState[storeName]);
            }
            else {
                console.warn(`${storeName} didn't hydrate any state (data was non-existent on hydration object)`);
            }
        }
        clientAsyncCache.results = snapshot.asyncResults || {};
        clientAsyncCache.actionOrd = snapshot.asyncActionOrd || {};
    }
}
function createPullstateCore(allStores = {}, options = {}) {
    return new PullstateSingleton(allStores, options);
}
function useStores() {
    return useContext(PullstateContext).stores;
}
function useInstance() {
    return useContext(PullstateContext);
}var EAsyncActionInjectType;
(function (EAsyncActionInjectType) {
    EAsyncActionInjectType["WATCH"] = "watch";
    EAsyncActionInjectType["BECKON"] = "beckon";
})(EAsyncActionInjectType || (EAsyncActionInjectType = {}));
function InjectAsyncAction(props) {
    if (props.type === EAsyncActionInjectType.BECKON) {
        const response = props.action.useBeckon(props.args, props.options);
        return props.children(response);
    }
    const response = props.action.useWatch(props.args, props.options);
    return props.children(response);
}function InjectStoreStateOpt({ store, paths, children }) {
    const state = useStoreStateOpt(store, paths);
    return children(state);
}function registerInDevtools(stores, { namespace = "" } = {}) {
    if (typeof document !== "undefined") {
        for (const key of Object.keys(stores)) {
            const store = stores[key];
            const devToolsExtension = window.__REDUX_DEVTOOLS_EXTENSION__;
            if (devToolsExtension) {
                const devTools = devToolsExtension.connect({ name: `${namespace}${key}` });
                devTools.init(store.getRawState());
                let ignoreNext = false;
                store.subscribe((s) => s, (watched) => {
                    if (ignoreNext) {
                        ignoreNext = false;
                        return;
                    }
                    devTools.send("Change", watched);
                });
                devTools.subscribe((message) => {
                    if (message.type === "DISPATCH" && message.state) {
                        ignoreNext = true;
                        const parsed = JSON.parse(message.state);
                        store.replace(parsed);
                    }
                });
            }
        }
    }
}export{EAsyncActionInjectType,EAsyncEndTags,EPostActionContext,InjectAsyncAction,InjectStoreState,InjectStoreStateOpt,PullstateContext,PullstateProvider,Store,createAsyncAction,createAsyncActionDirect,createPullstateCore,errorResult,registerInDevtools,successResult,update,useInstance,useLocalStore,useStoreState,useStoreStateOpt,useStores};