// Railroad — Signals, JSX, Routes, shared DI and a logger

export { Signal, signal, computed, effect, batch, untrack, Collection, collection } from "./signals";
// Dispose scopes — for advanced cases that mount UI outside a component/route/
// mount(). scoped(build) runs build under a scope of its own, closed on every
// path, and gives back what it made and the disposer; trackDispose registers a
// cleanup in the current scope. App code rarely needs these.
export { scoped, trackDispose, hasActiveDisposeScope } from "./signals";
export type { Dispose, ReadonlySignal, SignalOptions } from "./signals";

export {
  createElement, Fragment,
  when, list, mount,
} from "./jsx";
export type { JSX, Row } from "./jsx";

export { routes, route, navigate, matchRoute } from "./routes";

export { key, provide, inject, tryInject, clearProviders } from "./shared";
export type { Key } from "./shared";

export { createLogger, setLogLevel, getLogLevel, loggedRequest } from "./logger";
export type { LogLevel } from "./logger";
