import { Store } from "./Store";
declare function useLocalStore<S extends object>(initialState: (() => S) | S, deps?: ReadonlyArray<any>): Store<S>;
export { useLocalStore };
