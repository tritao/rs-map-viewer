import { OsrsMenuEntry } from "../components/rs/menu/OsrsMenu";

const EMPTY_MENU_ENTRIES: ReadonlyArray<OsrsMenuEntry> = [];

export type ViewerMenuState = Readonly<{
    open: boolean;
    openedFrame: number;
    x: number;
    y: number;
    entries: ReadonlyArray<OsrsMenuEntry>;
}>;

export const EMPTY_MENU_STATE: ViewerMenuState = {
    open: false,
    openedFrame: 0,
    x: -1,
    y: -1,
    entries: EMPTY_MENU_ENTRIES,
};

export class MapViewerMenuState {
    private state: ViewerMenuState = EMPTY_MENU_STATE;

    constructor(private readonly focusCanvas: () => void) {}

    getState(): ViewerMenuState {
        return this.state;
    }

    close(): void {
        this.state = {
            ...this.state,
            open: false,
            x: -1,
            y: -1,
        };
        this.focusCanvas();
    }

    reset(): void {
        this.state = EMPTY_MENU_STATE;
        this.focusCanvas();
    }

    set(
        input: Readonly<{
            open: boolean;
            openedFrame: number;
            x: number;
            y: number;
            entries: ReadonlyArray<OsrsMenuEntry>;
        }>,
    ): void {
        this.state = {
            open: input.open,
            openedFrame: input.openedFrame | 0,
            x: input.x | 0,
            y: input.y | 0,
            entries: input.entries,
        };
    }

    dispose(): void {
        this.state = EMPTY_MENU_STATE;
    }
}
