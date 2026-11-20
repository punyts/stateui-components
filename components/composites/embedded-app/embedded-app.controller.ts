import type { ControllerContext } from '@punyts/stateui';

/** The event that asks the page's app host for an app (the `mountApp` of `@punyts/stateui-app` answers it) */
const APP_OPEN_EVENT = 'ui-app-open';

/** An app mounted inside this component, as the answer to `ui-app-open` gives it */
interface EmbeddedApp {
    navigate(screen: string): string | undefined;
    dispose(): void;
}

/** The detail of `ui-app-open`, in the shape `@punyts/stateui-app` reads it */
interface AppOpenRequest {
    readonly app: string;
    readonly screen?: string;
    readonly live: boolean;
    readonly element: Element;
    readonly onEmit: (name: string, payload: unknown) => void;
    readonly onNavigate: (screen: string) => void;
    readonly respond: (result: Promise<EmbeddedApp>) => void;
}

/** One ask for an app: what was asked, and the app once it has come */
interface Opening {
    readonly key: string;
    screen: string;
    app?: EmbeddedApp;
}

/**
 * Shows another app inside the node. While `active` holds and `app` names one, it asks the page's app host for it by
 * name with the bubbling, composed `ui-app-open` event and mounts the answer in its frame, at `width` by `height`; the
 * host attribute `mounted` is set while one shows. Without a host, while the host refuses, or while not active, the
 * frame shows `_label`. A change of `app` or `live` mounts again, and a change of `appScreen` moves the app there.
 *
 * A preview (`live` false) is inert: it takes no input, and a press or Enter on it raises `press`, a right press or the
 * context-menu key `menu`, both with `{ app, screen }`. A live app takes its own input. The app inside raises
 * `navigated` with `{ screen }` when it moves to another screen itself, and `emit` with `{ name, payload }` for each of
 * its emits. Its state is its own: nothing of it is in this app's store
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const read = (name: string): unknown => store.get<unknown>(`${basePath}.${name}`);
    const text = (name: string): string => {
        const value = read(name);
        return typeof value === 'string' ? value : '';
    };
    const live = (): boolean => read('live') === true;
    const raise = (name: string, detail: unknown): void => {
        element.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    };
    const target = (): { app: string; screen: string } => ({ app: text('app'), screen: text('appScreen') });

    let opening: Opening | undefined;
    let disposed = false;
    let scheduled = false;

    const close = (): void => {
        opening?.app?.dispose();
        opening = undefined;
        element.removeAttribute('mounted');
    };

    /** Moves the app that shows to `screen`, when it shows another */
    const follow = (current: Opening): void => {
        const screen = text('appScreen');
        if (current.app === undefined || screen === '' || screen === current.screen) return;
        if (current.app.navigate(screen) === undefined) current.screen = screen;
    };

    const open = (): void => {
        scheduled = false;
        if (disposed) return;
        const app = text('app');
        const holder = element.shadowRoot?.querySelector<HTMLElement>('.app');
        if (app === '' || read('active') === false || !holder) {
            close();
            return;
        }
        const isLive = live();
        const key = `${isLive ? 'live' : 'preview'}:${app}`;
        if (opening?.key === key) {
            follow(opening);
            return;
        }
        close();
        holder.inert = !isLive;
        const screen = text('appScreen');
        const current: Opening = { key, screen };
        opening = current;
        const request: AppOpenRequest = {
            app,
            live: isLive,
            ...(screen === '' ? {} : { screen }),
            element: holder,
            onEmit: (name, payload) => raise('emit', { name, payload }),
            onNavigate: (shown) => {
                current.screen = shown;
                raise('navigated', { screen: shown });
            },
            respond: (result) => {
                result.then(
                    (embedded) => {
                        if (opening !== current) {
                            embedded.dispose();
                            return;
                        }
                        current.app = embedded;
                        element.setAttribute('mounted', '');
                        follow(current);
                    },
                    () => {
                        if (opening === current) element.removeAttribute('mounted');
                    }
                );
            }
        };
        element.dispatchEvent(new CustomEvent(APP_OPEN_EVENT, { detail: request, bubbles: true, composed: true }));
    };

    // The frame is rendered after the controller runs, and several properties may change in one go: open once, soon
    const schedule = (): void => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(open);
    };
    const paths = ['app', 'appScreen', 'live', 'active'].map((name) => `${basePath}.${name}`);
    store.on(paths, schedule);
    schedule();

    return {
        onClick: (): void => {
            if (!live()) raise('press', target());
        },
        onKeyDown: (event: KeyboardEvent): void => {
            if (live()) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                raise('press', target());
            } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
                event.preventDefault();
                raise('menu', target());
            }
        },
        onContextMenu: (event: MouseEvent): void => {
            if (live()) return;
            event.preventDefault();
            raise('menu', target());
        },
        dispose: (): void => {
            disposed = true;
            store.off(paths, schedule);
            close();
        }
    };
}
