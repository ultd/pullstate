// @ts-ignore
import { applyPatches, Draft, enablePatches, Patch, PatchListener, produce, produceWithPatches } from "immer";
import { useStoreState } from "./useStoreState";
import { DeepKeyOfArray } from "./useStoreStateOpt-types";

import isEqual from "fast-deep-equal/es6";
import { useLocalStore } from "./useLocalStore";

enablePatches();

// const isEqual = require("fast-deep-equal/es6");
// import produce, { applyPatches, produceWithPatches } from "immer";

// const Immer = require("immer");

// const produce = Immer.produce;
// const produceWithPatches = Immer.produceWithPatches;
// const applyPatches = Immer.applyPatches;

export type TPullstateUpdateListener = () => void;

export interface IStoreInternalOptions<S extends object> {
  ssr: boolean;
  reactionCreators?: TReactionCreator<S>[];
}

/**
 * @typeParam S  The store's state
 * @param draft  The mutable store state to change during this update (uses immer, which makes use of Proxies)
 * @param original  A readonly version of the store's state, for referencing during this update
 */
export type TUpdateFunction<S> = (draft: Draft<S>, original: S) => void;
type TReactionFunction<S extends object, T> = (watched: T, draft: Draft<S>, original: S, previousWatched: T) => void;

/**
 * @internal
 */
type TRunReactionFunction = (forceRun?: boolean) => string[];
type TRunSubscriptionFunction = () => void;
type TReactionCreator<S extends object> = (store: Store<S>) => TRunReactionFunction;

function makeSubscriptionFunction<S extends object, T>(
  store: Store<S>,
  watch: (state: S) => T,
  listener: (watched: T, allState: S, previousWatched: T, uid?: string) => void
): TRunSubscriptionFunction {
  let lastWatchState: T = watch(store.getRawState());

  return () => {
    const currentState = store.getRawState();
    const nextWatchState = watch(currentState);

    if (!isEqual(nextWatchState, lastWatchState)) {
      listener(nextWatchState, currentState, lastWatchState);
      lastWatchState = nextWatchState;
    }
  };
}

function makeReactionFunctionCreator<S extends object, T>(
  watch: (state: S) => T,
  reaction: TReactionFunction<S, T>
): TReactionCreator<S> {
  return (store) => {
    let lastWatchState: T = watch(store.getRawState());

    return (forceRun: boolean = false) => {
      const currentState = store.getRawState();

      const nextWatchState = watch(currentState);

      if (forceRun || !isEqual(nextWatchState, lastWatchState)) {
        if (store._optListenerCount > 0) {
          const [nextState, patches, inversePatches] = produceWithPatches(currentState as any, (s: S) =>
            reaction(nextWatchState, s as Draft<S>, currentState, lastWatchState)
          ) as any;

          store._updateStateWithoutReaction(nextState);
          lastWatchState = nextWatchState;

          if (patches.length > 0) {
            store._patchListeners.forEach((listener) => listener(patches, inversePatches));
            return Object.keys(getChangedPathsFromPatches(patches));
          }
        } else {
          if (store._patchListeners.length > 0) {
            const [nextState, patches, inversePatches] = produceWithPatches(currentState as any, (s: S) =>
              reaction(nextWatchState, s as Draft<S>, currentState, lastWatchState)
            ) as any;

            if (patches.length > 0) {
              store._patchListeners.forEach((listener) => listener(patches, inversePatches));
            }
            store._updateStateWithoutReaction(nextState);
          } else {
            store._updateStateWithoutReaction(
              produce(currentState as any, (s: S) =>
                reaction(nextWatchState, s as Draft<S>, currentState, lastWatchState)
              ) as any
            );
          }
          lastWatchState = nextWatchState;
        }
      }

      return [];
    };
  };
}

interface ICreateReactionOptions {
  /**
   * Should this reaction run on initial registration
   *
   * @default false
   */
  runNow?: boolean;
  /**
   * Should the initial running of this action cause a regular update that
   * notifies any listeners to this store's state
   *
   * @default false
   */
  runNowWithSideEffects?: boolean;
}

const optPathDivider = "~._.~";

export type TStoreActionUpdate<S extends object> = (
  updater: TUpdateFunction<S> | TUpdateFunction<S>[],
  patchesCallback?: (patches: Patch[], inversePatches: Patch[]) => void
) => void;

export type TStoreAction<S extends object> = (update: TStoreActionUpdate<S>) => void;

/**
 * The Store. A home for your state, and from whence you can pull it, shape it and listen to it in various ways.
 *
 * @typeParam S  Your store's state interface
 */
export class Store<S extends object = object> {
  private updateListeners: TPullstateUpdateListener[] = [];
  private currentState: S;
  private batchState: S | undefined;
  private readonly initialState: S;
  private ssr: boolean = false;
  private reactions: TRunReactionFunction[] = [];
  private clientSubscriptions: TRunSubscriptionFunction[] = [];
  private reactionCreators: TReactionCreator<S>[] = [];

  // Optimized listener / updates stuff
  private optimizedUpdateListeners: {
    [listenerOrd: string]: TPullstateUpdateListener;
  } = {};
  private optimizedUpdateListenerPaths: {
    [listenerOrd: string]: string[];
  } = {};
  private optimizedListenerPropertyMap: {
    [pathKey: string]: string[];
  } = {};
  /**
   * @ignore
   */
  public _optListenerCount = 0;
  /**
   * @ignore
   */
  public _patchListeners: PatchListener[] = [];

  /**
   * Create your Store with an initial state.
   *
   * @param initialState  The initial state for this store
   */
  constructor(initialState: S) {
    this.currentState = initialState;
    this.initialState = initialState;
    // this._storeName = name;
  }

  /**
   * @internal
   */
  _setInternalOptions({ ssr, reactionCreators = [] }: IStoreInternalOptions<S>) {
    this.ssr = ssr;
    this.reactionCreators = reactionCreators;
    this.reactions = reactionCreators.map((rc) => rc(this));
  }

  /**
   * @internal
   */
  _getReactionCreators(): TReactionCreator<S>[] {
    return this.reactionCreators;
  }

  /**
   * @internal
   */
  _instantiateReactions() {
    this.reactions = this.reactionCreators.map((rc) => rc(this));
  }

  /**
   * @internal
   */
  _getInitialState(): S {
    return this.initialState;
  }

  /**
   * @internal
   */
  _updateStateWithoutReaction(nextState: S) {
    this.currentState = nextState;
  }

  /**
   * @internal
   */
  _updateState(nextState: S, updateKeyedPaths: string[] = []) {
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
        // console.log(`Got update keyed paths: "${updateKeyedPaths.join(`", "`)}"`);
        const updateOrds = new Set<string>();

        for (const keyedPath of updateKeyedPaths) {
          if (this.optimizedListenerPropertyMap[keyedPath]) {
            for (const ord of this.optimizedListenerPropertyMap[keyedPath]) {
              updateOrds.add(ord);
            }
          }
        }

        for (const ord of updateOrds.values()) {
          // console.log(`Need to notify opt listener with ord: ${ord}`);
          if (this.optimizedUpdateListeners[ord]) {
            this.optimizedUpdateListeners[ord]();
          }
        }
      }

      this.updateListeners.forEach((listener) => listener());
    }
  }

  /**
   * @internal
   * @param listener
   */
  _addUpdateListener(listener: TPullstateUpdateListener) {
    this.updateListeners.push(listener);
  }

  /**
   * @internal
   * @param listener
   * @param ordKey
   * @param paths
   */
  _addUpdateListenerOpt(listener: TPullstateUpdateListener, ordKey: string, paths: DeepKeyOfArray<S>[]) {
    this.optimizedUpdateListeners[ordKey] = listener;
    const listenerPathsKeyed: string[] = paths.map((path) => path.join(optPathDivider));
    this.optimizedUpdateListenerPaths[ordKey] = listenerPathsKeyed;
    for (const keyedPath of listenerPathsKeyed) {
      if (this.optimizedListenerPropertyMap[keyedPath] == null) {
        this.optimizedListenerPropertyMap[keyedPath] = [ordKey];
      } else {
        this.optimizedListenerPropertyMap[keyedPath].push(ordKey);
      }
    }
    this._optListenerCount++;
  }

  /**
   * @internal
   * @param listener
   */
  _removeUpdateListener(listener: TPullstateUpdateListener) {
    this.updateListeners = this.updateListeners.filter((f) => f !== listener);
  }

  /**
   * @internal
   * @param ordKey
   */
  _removeUpdateListenerOpt(ordKey: string) {
    const listenerPathsKeyed = this.optimizedUpdateListenerPaths[ordKey];

    for (const keyedPath of listenerPathsKeyed) {
      this.optimizedListenerPropertyMap[keyedPath] = this.optimizedListenerPropertyMap[keyedPath].filter(
        (ord) => ord !== ordKey
      );
    }

    delete this.optimizedUpdateListenerPaths[ordKey];
    delete this.optimizedUpdateListeners[ordKey];

    this._optListenerCount--;
  }

  /**
   * Listen to all changes made to this store's state in the form of "patches" sent to a patch listener.
   * This is basically a direct link to [Immer's functionality of patches](https://immerjs.github.io/immer/docs/patches).
   *
   * See also: {@link Store.applyPatches}
   *
   * @param patchListener  A function which matches exactly the patch callback functionality in Immer
   */
  listenToPatches(patchListener: PatchListener): () => void {
    this._patchListeners.push(patchListener);
    return () => {
      this._patchListeners = this._patchListeners.filter((f) => f !== patchListener);
    };
  }

  /**
   * Subscribe to changes on this store by watching a sub-selection of its state
   *
   * @typeParam T  The type of the returned watched value
   * @param watch  The selector function. Return the values you want to watch for changes on.
   * @param listener  The listener. The function which will run with those changes whenever they have changed.
   *
   * @returns  An un-subscribe function. Stops listening for watched changes.
   */
  subscribe<T>(watch: (state: S) => T,
               listener:
                 /**
                  * @param watched  The new watched value (returned from the selection function)
                  * @param allState  Your entire store's state (read-only, do not mutate)
                  * @param previousWatched  The previous value that was watched
                  */
                 (watched: T, allState: S, previousWatched: T) => void): () => void {
    if (!this.ssr) {
      const func = makeSubscriptionFunction(this, watch, listener);
      this.clientSubscriptions.push(func);
      return () => {
        this.clientSubscriptions = this.clientSubscriptions.filter((f) => f !== func);
      };
    }

    return () => {
      console.warn(
        `Pullstate: Subscriptions made on the server side are not registered - so therefor this call to unsubscribe does nothing.`
      );
    };
  }

  /**
   * React to changes on this store by watching a sub-selection of its state and
   * then updating the store directly (similar to subscribe, but allows direct
   * batched updates to the store on changes)
   *
   * @typeParam T  The type of the returned watched value
   * @param watch  The selector function. Return the values you want to watch for changes on.
   * @param reaction  The reaction. The function which will run with those changes whenever they have changed.
   * @param options
   *
   * @returns  An un-subscribe function. Stops listening for watched changes.
   */
  createReaction<T>(
    watch: (state: S) => T,
    reaction: TReactionFunction<S, T>,
    options?: ICreateReactionOptions
  ): () => void {
    const { runNow = false, runNowWithSideEffects = false } = options ?? {};
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

  /**
   * Returns the raw state object contained within this store at this moment
   *
   * ---
   *
   * **WARNING**
   *
   * Most of the time, if you're using this in your App, there's probably a better way to do it
   *
   * ---
   */
  getRawState(): S {
    if (this.batchState !== undefined) {
      return this.batchState;
    } else {
      return this.currentState;
    }
  }

  /**
   * 🎣 React hook
   *
   * Select and use the store's state in your React components
   */
  useState(): S;
  useState<SS = any>(getSubState: (state: S) => SS, deps?: ReadonlyArray<any>): SS;
  useState<SS = any>(getSubState?: (state: S) => SS, deps?: ReadonlyArray<any>): SS {
    return useStoreState(this, getSubState!, deps);
  }

  /**
   * 🎣 React hook
   *
   * Makes a local component-bound copy ot this store, using the *initial* state that was set when this store was created, which otherwise functions exactly the same.
   *
   * @param deps  Dependencies, which if changed will cause a new local Store to be created and returned - again set to the initial state.
   */
  useLocalCopyInitial(deps?: ReadonlyArray<any>): Store<S> {
    return useLocalStore(() => this.initialState, deps);
  }

  /**
   * 🎣 React hook
   *
   * Makes a local component-bound copy of this store, using the *current snapshot* of its state, which otherwise functions exactly the same.
   *
   * @param deps  Dependencies, which if changed will cause a new local Store to be created and returned - again at the Store's current snapshot at that time
   */
  useLocalCopySnapshot(deps?: ReadonlyArray<any>): Store<S> {
    return useLocalStore(this.currentState, deps);
  }

  /*action<A extends Array<any>>(
    action: (...args: A) => TStoreAction<S>
  ): (...args: A) => TStoreAction<S> {
    return action;
  }*/

  /*act(action: TStoreAction<S>): void {
    action((u, p) => this.batch(u, p));
    this.flushBatch(true);
  }

  batch(
    updater: TUpdateFunction<S> | TUpdateFunction<S>[],
    patchesCallback?: (patches: Patch[], inversePatches: Patch[]) => void,
  ): void {
    if (this.batchState === undefined) {
      this.batchState = this.currentState;
    }

    const func = typeof updater === "function";
    const [nextState, patches, inversePatches] = runUpdates(this.batchState, updater, func);

    if (patches.length > 0 && (this._patchListeners.length > 0 || patchesCallback)) {
      if (patchesCallback) {
        patchesCallback(patches, inversePatches);
      }

      this._patchListeners.forEach((listener) => listener(patches, inversePatches));
    }

    this.batchState = nextState;
  }

  flushBatch(ignoreError = false) {
    if (this.batchState !== undefined) {
      if (this.batchState !== this.currentState) {
        this._updateState(this.batchState);
      }
    } else if (!ignoreError) {
      console.error(`Pullstate: Trying to flush batch state which was never created or updated on`);
    }
  }*/

  /**
   * The store's update function. Pass in a function which takes the current store's state and mutates it directly, thanks to [Immer](https://immerjs.github.io/immer)
   *
   * @param updater  The update function. Takes the current state and mutates it to the next state.
   *
   * @param patchesCallback  Exactly the same as the Immer patches callback. Gives you the patches
   * which represent the exact granular changes that happened to your store's state during this update.
   */
  update(
    updater: TUpdateFunction<S> | TUpdateFunction<S>[],
    patchesCallback?: (patches: Patch[], inversePatches: Patch[]) => void
  ) {
    update(this, updater, patchesCallback);
  }

  /**
   * Replace the store's state entirely with a new state value
   *
   * @param newState
   */
  replace(newState: S) {
    this._updateState(newState);
  }

  /**
   * See [Immer's documentation on Patches](https://immerjs.github.io/immer/docs/patches). Will apply any patches as an update to this store's state.
   *
   * See also: {@link Store.listenToPatches}
   *
   * @param patches  The patches to apply.
   */
  applyPatches(patches: Patch[]) {
    applyPatchesToStore(this, patches);
  }
}

export function applyPatchesToStore<S extends object = any>(store: Store<S>, patches: Patch[]) {
  const currentState: S = store.getRawState();
  const nextState = applyPatches(currentState, patches);
  if (nextState !== currentState) {
    store._updateState(nextState, Object.keys(getChangedPathsFromPatches(patches)));
  }
}

interface IChangedPaths {
  [path: string]: 1;
}

/**
 * @internal
 *
 * @param changePatches
 * @param prev
 */
function getChangedPathsFromPatches(changePatches: Patch[], prev: IChangedPaths = {}): IChangedPaths {
  // const updateKeyedPathsMap: IChangedPaths = {};

  for (const patch of changePatches) {
    let curKey;

    for (const p of patch.path) {
      if (curKey) {
        curKey = `${curKey}${optPathDivider}${p}`;
      } else {
        curKey = p;
      }

      prev[curKey] = 1;
    }
  }

  return prev;
  // return Object.keys(updateKeyedPathsMap);
}

/**
 * @internal
 *
 * @param currentState
 * @param updater
 * @param func
 */
function runUpdates<S extends object>(
  currentState: S,
  updater: TUpdateFunction<S> | TUpdateFunction<S>[],
  func: boolean
): [S, Patch[], Patch[]] {
  return func
    ? (produceWithPatches(currentState, (s: S) => (updater as TUpdateFunction<S>)(s as Draft<S>, currentState)) as any)
    : ((updater as TUpdateFunction<S>[]).reduce(
      ([nextState, patches, inversePatches], currentValue) => {
        const resp = produceWithPatches(nextState as any, (s: S) => currentValue(s as Draft<S>, nextState)) as any;
        patches.push(...resp[1]);
        inversePatches.push(...resp[2]);
        return [resp[0], patches, inversePatches];
      },
      [currentState, [], []] as [S, Patch[], Patch[]]
    ) as [S, Patch[], Patch[]]);
}

/**
 *
 * @param store  The store to run an update on
 * @param updater  The update function, or an array of update functions
 * @param patchesCallback  A callback to keep track of the patches made during this update.
 */
export function update<S extends object = any>(
  store: Store<S>,
  updater: TUpdateFunction<S> | TUpdateFunction<S>[],
  patchesCallback?: (patches: Patch[], inversePatches: Patch[]) => void
) {
  const currentState: S = store.getRawState();
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
  } else {
    let nextState: S;

    if (store._patchListeners.length > 0 || patchesCallback) {
      const [ns, patches, inversePatches] = runUpdates(currentState, updater, func);

      if (patches.length > 0) {
        if (patchesCallback) {
          patchesCallback(patches, inversePatches);
        }

        store._patchListeners.forEach((listener) => listener(patches, inversePatches));
      }

      nextState = ns;
    } else {
      nextState = produce(currentState as any, (s: S) =>
        func
          ? (updater as TUpdateFunction<S>)(s as Draft<S>, currentState)
          : (updater as TUpdateFunction<S>[]).reduce((previousValue, currentUpdater) => {
            return produce(previousValue as any, (s: S) => currentUpdater(s as Draft<S>, previousValue)) as any;
          }, currentState)
      ) as any;
    }

    // .forEach(up => up(s, currentState))

    if (nextState !== currentState) {
      store._updateState(nextState);
    }
  }
}
