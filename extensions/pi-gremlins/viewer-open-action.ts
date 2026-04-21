export interface ViewerOverlayRuntimeState {
	handle?: object;
	closed?: boolean;
}

export type ViewerOpenAction = "open-new" | "focus-existing" | "await-existing";

export function getViewerOpenAction(
	runtime: ViewerOverlayRuntimeState | null,
): ViewerOpenAction {
	if (runtime?.closed) return "open-new";
	if (!runtime) return "open-new";
	return runtime.handle ? "focus-existing" : "await-existing";
}
