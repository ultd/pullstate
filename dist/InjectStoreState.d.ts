import React from "react";
import { Store } from "./Store";
export interface IPropsInjectStoreState<S extends object = any, SS extends any = any> {
    store: Store<S>;
    on?: (state: S) => SS;
    children: (output: SS) => React.ReactElement;
}
export declare function InjectStoreState<S extends object = any, SS = any>({ store, on, children, }: IPropsInjectStoreState<S, SS>): React.ReactElement;
