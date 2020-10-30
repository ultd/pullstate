import { IPullstateAllStores } from "./PullstateCore";
import { TUpdateFunction } from "./Store";
declare type TPullstateAsyncUpdateListener = () => void;
export declare type TPullstateAsyncWatchResponse<R = any, T extends string = string> = [
    boolean,
    boolean,
    TAsyncActionResult<R, T>,
    boolean,
    number
];
export declare type TPullstateAsyncBeckonResponse<R = any, T extends string = string> = [
    boolean,
    TAsyncActionResult<R, T>,
    boolean
];
export declare type TPullstateAsyncRunResponse<R = any, T extends string = string> = Promise<TAsyncActionResult<R, T>>;
export interface IPullstateAsyncResultState {
    [key: string]: TPullstateAsyncWatchResponse<any, string>;
}
export interface IPullstateAsyncActionOrdState {
    [key: string]: number;
}
export declare enum EAsyncEndTags {
    THREW_ERROR = "THREW_ERROR",
    RETURNED_ERROR = "RETURNED_ERROR",
    UNFINISHED = "UNFINISHED",
    DORMANT = "DORMANT"
}
interface IAsyncActionResultBase<T extends string> {
    message: string;
    tags: (EAsyncEndTags | T)[];
}
export interface IAsyncActionResultPositive<R, T extends string> extends IAsyncActionResultBase<T> {
    error: false;
    payload: R;
}
export interface IAsyncActionResultNegative<T extends string, N = any> extends IAsyncActionResultBase<T> {
    error: true;
    errorPayload?: N;
    payload: null;
}
export declare type TAsyncActionResult<R, T extends string, N = unknown> = IAsyncActionResultPositive<R, T> | IAsyncActionResultNegative<T, N>;
export declare type TPullstateAsyncShortCircuitHook<A, R, T extends string, S extends IPullstateAllStores> = (inputs: {
    args: A;
    stores: S;
}) => TAsyncActionResult<R, T> | false;
export declare type TPullstateAsyncCacheBreakHook<A, R, T extends string, S extends IPullstateAllStores> = (inputs: {
    args: A;
    result: TAsyncActionResult<R, T>;
    stores: S;
    timeCached: number;
}) => boolean;
export declare enum EPostActionContext {
    WATCH_HIT_CACHE = "WATCH_HIT_CACHE",
    BECKON_HIT_CACHE = "BECKON_HIT_CACHE",
    RUN_HIT_CACHE = "RUN_HIT_CACHE",
    READ_HIT_CACHE = "READ_HIT_CACHE",
    READ_RUN = "READ_RUN",
    SHORT_CIRCUIT = "SHORT_CIRCUIT",
    DIRECT_RUN = "DIRECT_RUN",
    BECKON_RUN = "BECKON_RUN",
    CACHE_UPDATE = "CACHE_UPDATE"
}
export declare type TPullstateAsyncPostActionHook<A, R, T extends string, S extends IPullstateAllStores> = (inputs: {
    args: A;
    result: TAsyncActionResult<R, T>;
    stores: S;
    context: EPostActionContext;
}) => void;
export interface IAsyncActionReadOptions {
    postActionEnabled?: boolean;
    cacheBreakEnabled?: boolean;
    key?: string;
}
export interface IAsyncActionBeckonOptions extends IAsyncActionReadOptions {
    ssr?: boolean;
    holdPrevious?: boolean;
    dormant?: boolean;
}
export interface IAsyncActionWatchOptions extends IAsyncActionBeckonOptions {
    initiate?: boolean;
}
export interface IAsyncActionUseOptions<R, A> extends IAsyncActionWatchOptions {
    onSuccess?: (result: R, args: A) => void;
}
export interface IAsyncActionUseDeferOptions<R, A> extends Omit<IAsyncActionReadOptions, "key"> {
    key?: string;
    holdPrevious?: boolean;
    onSuccess?: (result: R, args: A) => void;
    clearOnSuccess?: boolean;
}
export interface IAsyncActionRunOptions<S extends IPullstateAllStores = any> {
    treatAsUpdate?: boolean;
    ignoreShortCircuit?: boolean;
    respectCache?: boolean;
    key?: string;
    _asyncCache?: IPullstateAsyncCache;
    _stores?: S;
}
export interface IAsyncActionGetCachedOptions {
    checkCacheBreak?: boolean;
    key?: string;
}
export interface IGetCachedResponse<R, T extends string> {
    started: boolean;
    finished: boolean;
    result: TAsyncActionResult<R, T>;
    updating: boolean;
    existed: boolean;
    cacheBreakable: boolean;
    timeCached: number;
}
export interface IAsyncActionSetCachedOptions {
    notify?: boolean;
    key?: string;
}
export interface IAsyncActionUpdateCachedOptions extends IAsyncActionSetCachedOptions {
    resetTimeCached?: boolean;
    runPostActionHook?: boolean;
}
export declare type TAsyncActionUse<A, R, T extends string> = (args?: A, options?: IAsyncActionUseOptions<R, A>) => TUseResponse<R, T>;
export declare type TAsyncActionUseDefer<A, R, T extends string> = (options?: IAsyncActionUseDeferOptions<R, A>) => TUseDeferResponse<A, R, T>;
export declare type TAsyncActionBeckon<A, R, T extends string> = (args?: A, options?: IAsyncActionBeckonOptions) => TPullstateAsyncBeckonResponse<R, T>;
export declare type TAsyncActionWatch<A, R, T extends string> = (args?: A, options?: IAsyncActionWatchOptions) => TPullstateAsyncWatchResponse<R, T>;
export declare type TAsyncActionRun<A, R, T extends string> = (args?: A, options?: IAsyncActionRunOptions) => TPullstateAsyncRunResponse<R, T>;
export declare type TAsyncActionClearCache<A> = (args?: A, customKey?: string) => void;
export declare type TAsyncActionClearAllCache = () => void;
export declare type TAsyncActionClearAllUnwatchedCache = () => void;
export declare type TAsyncActionGetCached<A, R, T extends string> = (args?: A, options?: IAsyncActionGetCachedOptions) => IGetCachedResponse<R, T>;
export declare type TAsyncActionSetCached<A, R, T extends string> = (args: A, result: TAsyncActionResult<R, T>, options?: IAsyncActionSetCachedOptions) => void;
export declare type TAsyncActionSetCachedPayload<A, R> = (args: A, payload: R, options?: IAsyncActionSetCachedOptions) => void;
export declare type TAsyncActionUpdateCached<A, R> = (args: A, updater: TUpdateFunction<R>, options?: IAsyncActionUpdateCachedOptions) => void;
export declare type TAsyncActionRead<A, R> = (args?: A, options?: IAsyncActionReadOptions) => R;
export declare type TAsyncActionDelayedRun<A> = (args: A, options: IAsyncActionRunOptions & {
    delay: number;
    clearOldRun?: boolean;
    immediateIfCached?: boolean;
}) => () => void;
export interface IOCreateAsyncActionOutput<A = any, R = any, T extends string = string> {
    use: TAsyncActionUse<A, R, T>;
    useDefer: TAsyncActionUseDefer<A, R, T>;
    read: TAsyncActionRead<A, R>;
    useBeckon: TAsyncActionBeckon<A, R, T>;
    useWatch: TAsyncActionWatch<A, R, T>;
    run: TAsyncActionRun<A, R, T>;
    delayedRun: TAsyncActionDelayedRun<A>;
    getCached: TAsyncActionGetCached<A, R, T>;
    setCached: TAsyncActionSetCached<A, R, T>;
    setCachedPayload: TAsyncActionSetCachedPayload<A, R>;
    updateCached: TAsyncActionUpdateCached<A, R>;
    clearCache: TAsyncActionClearCache<A>;
    clearAllCache: TAsyncActionClearAllCache;
    clearAllUnwatchedCache: TAsyncActionClearAllUnwatchedCache;
}
export interface IPullstateAsyncCache {
    results: IPullstateAsyncResultState;
    listeners: {
        [key: string]: {
            [watchId: string]: TPullstateAsyncUpdateListener;
        };
    };
    actions: {
        [key: string]: () => Promise<TAsyncActionResult<any, string>>;
    };
    actionOrd: IPullstateAsyncActionOrdState;
}
export declare type TPullstateAsyncAction<A, R, T extends string, S extends IPullstateAllStores> = (args: A, stores: S) => Promise<TAsyncActionResult<R, T>>;
export interface ICreateAsyncActionOptions<A, R, T extends string, S extends IPullstateAllStores> {
    forceContext?: boolean;
    shortCircuitHook?: TPullstateAsyncShortCircuitHook<A, R, T, S>;
    cacheBreakHook?: TPullstateAsyncCacheBreakHook<A, R, T, S>;
    postActionHook?: TPullstateAsyncPostActionHook<A, R, T, S>;
    subsetKey?: (args: A) => any;
}
export declare type TRunWithPayload<R> = (func: (payload: R) => any) => any;
export interface IBaseObjResponseUse<R, T extends string> {
    execute: (runOptions?: IAsyncActionRunOptions) => TPullstateAsyncRunResponse<R, T>;
}
export interface IBaseObjResponseUseDefer<A, R, T extends string> {
    execute: (args?: A, runOptions?: Omit<IAsyncActionRunOptions, "key">) => TPullstateAsyncRunResponse<R, T>;
}
export interface IBaseObjResponse<R, T extends string> {
    isLoading: boolean;
    isFinished: boolean;
    isUpdating: boolean;
    isStarted: boolean;
    isSuccess: boolean;
    isFailure: boolean;
    clearCached: () => void;
    updateCached: (updater: TUpdateFunction<R>, options?: IAsyncActionUpdateCachedOptions) => void;
    setCached: (result: TAsyncActionResult<R, T>, options?: IAsyncActionSetCachedOptions) => void;
    setCachedPayload: (payload: R, options?: IAsyncActionSetCachedOptions) => void;
    endTags: (T | EAsyncEndTags)[];
    renderPayload: TRunWithPayload<R>;
    message: string;
    raw: TPullstateAsyncWatchResponse<R, T>;
}
export interface IBaseObjSuccessResponse<R, T extends string> extends IBaseObjResponse<R, T> {
    payload: R;
    error: false;
    isSuccess: true;
    isFailure: false;
}
export interface IBaseObjErrorResponse<R, T extends string> extends IBaseObjResponse<R, T> {
    payload: null;
    error: true;
    isFailure: true;
    isSuccess: false;
}
export declare type TUseResponse<R = any, T extends string = string> = (IBaseObjSuccessResponse<R, T> | IBaseObjErrorResponse<R, T>) & IBaseObjResponseUse<R, T>;
export declare type TUseDeferResponse<A = any, R = any, T extends string = string> = (IBaseObjSuccessResponse<R, T> | IBaseObjErrorResponse<R, T>) & IBaseObjResponseUseDefer<A, R, T>;
export {};
